import { supabase } from './supabase';
import axios from 'axios';
import { getTokenInfo, isTokenOldEnough } from '../utils/fetchPriceJupiter';

interface MarketFeesTvlRatio {
  min_30: number;
  hour_1: number;
  hour_2: number;
  hour_4: number;
  hour_12: number;
  hour_24: number;
}

interface MarketVolume extends MarketFeesTvlRatio {}
interface MarketFees extends MarketFeesTvlRatio {}

export interface MeteoraPairData {
  address: string;
  name: string;
  mint_x: string;
  mint_y: string;
  reserve_x: string;
  reserve_y: string;
  reserve_x_amount: number;
  reserve_y_amount: number;
  bin_step: number;
  base_fee_percentage: string;
  max_fee_percentage: string;
  protocol_fee_percentage: string;
  liquidity: string;
  fees_24h: number;
  today_fees: number;
  trade_volume_24h: number;
  cumulative_trade_volume: string;
  cumulative_fee_volume: string;
  current_price: number;
  apr: number;
  apy: number;
  is_blacklisted: boolean;
  fee_tvl_ratio: MarketFeesTvlRatio;
  fees: MarketFees;
  volume: MarketVolume;
  tags: string[];
}

export interface MeteoraPairGroup {
  name: string;
  pairs: MeteoraPairData[];
}

export interface MeteoraPairsResponse {
  groups: MeteoraPairGroup[];
}

export class MarketRepository {
  private METEORA_API_URL = 'https://dlmm-api.meteora.ag';

  async getAllMarkets() {
    const { data, error } = await supabase
      .from('markets')
      .select('*')
      .gte('liquidity', 10000)
      .eq('tokens_old_enough', true)
      .order('apr', { ascending: false });
    
    if (error) throw new Error(`Failed to fetch markets: ${error.message}`);
    return data;
  }
  
  async getFilteredMarkets(filters: {
    minLiquidity?: number;
    minVolume?: number;
    minApr?: number;
    minFeeTvlRatio?: number;
    limit?: number;
  } = {}) {
    let query = supabase
      .from('markets')
      .select('*');
    
    const minLiquidity = Math.max(filters.minLiquidity || 0, 10000);
    query = query.gte('liquidity', minLiquidity);
    
    query = query.eq('tokens_old_enough', true);
    
    if (filters.minVolume) {
      query = query.gte('trade_volume_24h', filters.minVolume);
    }
    
    if (filters.minApr) {
      query = query.gte('apr', filters.minApr);
    }
    
    // For fee_tvl_ratio, we need to be careful since it's in JSONB
    // If your Supabase supports it, you could use something like:
    // .gte('fee_tvl_ratio->>hour_24', filters.minFeeTvlRatio)
    
    // Order by APR descending by default
    query = query.order('apr', { ascending: false });
    
    // Apply limit
    if (filters.limit) {
      query = query.limit(filters.limit);
    }
    
    const { data, error } = await query;
    
    if (error) throw new Error(`Failed to fetch filtered markets: ${error.message}`);
    return data;
  }
  
  async syncMarkets(markets: any[]) {
    for (const market of markets) {
      const { data: existingMarket } = await supabase
        .from('markets')
        .select('id')
        .eq('public_key', market.publicKey)
        .single();
      
      const marketData = {
        name: market.name,
        public_key: market.publicKey,
        bin_step: market.binStep,
        base_fee: market.baseFee,
        daily_apr: market.dailyAPR,
        tvl: market.tvl || 0,
        volume_tvl_ratio: market.volumeTvlRatio || 0,
        risk: market.risk,
        token_x_mint: market.tokenXMint || '',
        token_y_mint: market.tokenYMint || '',
        token_x_symbol: market.tokenXSymbol,
        token_y_symbol: market.tokenYSymbol,
        token_x_logo: market.tokenXLogo,
        token_y_logo: market.tokenYLogo
      };
      
      if (existingMarket) {
        // Update
        await supabase
          .from('markets')
          .update(marketData)
          .eq('id', existingMarket.id);
      } else {
        // Insert
        await supabase
          .from('markets')
          .insert(marketData);
      }
    }
  }
  
  async fetchAndSyncMeteoraPairs(
    params: {
      sortKey?: 'feetvlratio' | 'apr' | 'tvl' | 'volume';
      orderBy?: 'asc' | 'desc';
      hideLowTvl?: number;
      hideLowApr?: boolean;
      limit?: number;
    } = {}
  ) {
    try {
      // Build URL with exact parameter formats expected by Meteora API
      const url = new URL(`${this.METEORA_API_URL}/pair/all_by_groups`);
      
      // Use lowercase parameter names and values exactly as shown in the sample curl
      url.searchParams.set('sort_key', params.sortKey || 'feetvlratio');
      url.searchParams.set('order_by', params.orderBy || 'desc');
      
      if (params.hideLowTvl) {
        url.searchParams.set('hide_low_tvl', params.hideLowTvl.toString());
      }
      
      if (params.hideLowApr !== undefined) {
        url.searchParams.set('hide_low_apr', params.hideLowApr.toString());
      }
      
      // Log the exact URL for debugging
      console.log(`Fetching market data from: ${url.toString()}`);
      
      // Make the API call
      const response = await axios.get<MeteoraPairsResponse>(url.toString(), {
        headers: {
          'accept': 'application/json'
        }
      });
      
      if (!response.data || !response.data.groups) {
        console.error('API Response:', JSON.stringify(response.data, null, 2));
        throw new Error('Invalid response format from Meteora API');
      }
      
      // Log the number of pairs found
      let allPairs: MeteoraPairData[] = [];
      response.data.groups.forEach(group => {
        console.log(`Group: ${group.name}, Pairs: ${group.pairs.length}`);
        allPairs = allPairs.concat(group.pairs);
      });
      
      // Apply client-side limit if requested
      if (params.limit && allPairs.length > params.limit) {
        allPairs = allPairs.slice(0, params.limit);
      }
      
      console.log(`Found ${allPairs.length} pairs from Meteora API`);
      
      // Sync each pair to Supabase
      for (const pair of allPairs) {
        await this.syncPairToSupabase(pair);
      }
      
      console.log('Market data sync completed successfully');
      return allPairs;
    } catch (error) {
      console.error('Error fetching and syncing Meteora pairs:', error);
      throw error;
    }
  }
  
  private async syncPairToSupabase(pair: MeteoraPairData) {
    try {
      console.log(`Syncing pair: ${pair.name} (${pair.address})`);
      
      // Check if market already exists
      const { data: existingMarket, error: lookupError } = await supabase
        .from('markets')
        .select('id, token_x_symbol, token_y_symbol, token_x_logo, token_y_logo')
        .eq('public_key', pair.address)
        .single();
      
      // Get token ages when syncing
      const tokenXInfo = await getTokenInfo(pair.mint_x);
      const tokenYInfo = await getTokenInfo(pair.mint_y);
      
      const isTokenXOldEnough = isTokenOldEnough(tokenXInfo?.created_at);
      const isTokenYOldEnough = isTokenOldEnough(tokenYInfo?.created_at);
      
      const marketData = {
        name: pair.name,
        public_key: pair.address,
        address: pair.address,
        mint_x: pair.mint_x,
        mint_y: pair.mint_y,
        token_x_mint: pair.mint_x,
        token_y_mint: pair.mint_y,
        reserve_x: pair.reserve_x,
        reserve_y: pair.reserve_y,
        reserve_x_amount: pair.reserve_x_amount,
        reserve_y_amount: pair.reserve_y_amount,
        bin_step: pair.bin_step,
        base_fee_percentage: pair.base_fee_percentage,
        max_fee_percentage: pair.max_fee_percentage,
        protocol_fee_percentage: pair.protocol_fee_percentage,
        liquidity: pair.liquidity,
        fees_24h: pair.fees_24h,
        today_fees: pair.today_fees,
        trade_volume_24h: pair.trade_volume_24h,
        cumulative_trade_volume: pair.cumulative_trade_volume,
        cumulative_fee_volume: pair.cumulative_fee_volume,
        current_price: pair.current_price,
        apr: pair.apr,
        apy: pair.apy,
        is_blacklisted: pair.is_blacklisted,
        fee_volume_ratios: pair.fee_tvl_ratio,
        fees_by_timeframe: pair.fees,
        volume_by_timeframe: pair.volume,
        tags: pair.tags,
        last_updated: new Date().toISOString(),
        
        // Maintain compatibility with your existing schema
        base_fee: pair.base_fee_percentage + '%',
        daily_apr: pair.apr,
        tvl: parseFloat(pair.liquidity),
        volume_tvl_ratio: pair.fee_tvl_ratio.hour_24,
        risk: this.calculateRiskLevel(pair),
        
        // Keep any token metadata if already available
        token_x_symbol: existingMarket?.token_x_symbol || null,
        token_y_symbol: existingMarket?.token_y_symbol || null,
        token_x_logo: existingMarket?.token_x_logo || null,
        token_y_logo: existingMarket?.token_y_logo || null,
        
        // Add token age information
        token_x_created_at: tokenXInfo?.created_at || null,
        token_y_created_at: tokenYInfo?.created_at || null,
        tokens_old_enough: isTokenXOldEnough && isTokenYOldEnough
      };
      
      if (existingMarket) {
        // Update existing market (faster)
        await supabase
          .from('markets')
          .update(marketData)
          .eq('id', existingMarket.id);
      } else {
        // Insert new market (less common over time)
        await supabase
          .from('markets')
          .insert(marketData);
      }
    } catch (error) {
      console.error(`Error syncing pair ${pair.name} to Supabase:`, error);
    }
  }
  
  private calculateRiskLevel(pair: MeteoraPairData): 'Low' | 'Medium' | 'High' {
    // Simple risk calculation based on liquidity, volume, and APR
    const liquidity = parseFloat(pair.liquidity);
    
    if (liquidity > 100000 && pair.trade_volume_24h > 50000 && pair.apr < 50) {
      return 'Low';
    } else if (liquidity > 30000 && pair.trade_volume_24h > 10000) {
      return 'Medium';
    } else {
      return 'High';
    }
  }

  /**
   * Update token metadata for a market
   */
  async updateMarketTokenMetadata(marketId: string, metadata: {
    token_x_symbol?: string;
    token_y_symbol?: string;
    token_x_logo?: string;
    token_y_logo?: string;
  }) {
    const { error } = await supabase
      .from('markets')
      .update(metadata)
      .eq('id', marketId);
    
    if (error) {
      console.error(`Error updating market token metadata: ${error.message}`);
      throw error;
    }
    
    return true;
  }
}
