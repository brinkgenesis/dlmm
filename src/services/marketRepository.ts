import { supabase } from './supabase';

export class MarketRepository {
  async getAllMarkets() {
    const { data, error } = await supabase
      .from('markets')
      .select('*');
    
    if (error) throw new Error(`Failed to fetch markets: ${error.message}`);
    return data;
  }
  
  async syncMarkets(markets: any[]) {
    // For each market in the array
    for (const market of markets) {
      // Check if market exists
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
}
