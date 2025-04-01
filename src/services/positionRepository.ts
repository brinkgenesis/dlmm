import { supabase } from './supabase';
import { PublicKey } from '@solana/web3.js';
import axios from 'axios';
import { Decimal } from 'decimal.js';

// This matches the structure in your positions table
interface SupabasePosition {
  id: string;
  user_id: string;
  pool_address: string;
  position_key: string;
  token_x_mint: string;
  token_y_mint: string;
  token_x_symbol?: string;
  token_y_symbol?: string;
  token_x_logo?: string;
  token_y_logo?: string;
  original_active_bin?: number;
  min_bin_id: number;
  max_bin_id: number;
  snapshot_position_value?: number;
  current_price?: number;
  current_price_usd?: number;
  pending_fee_x?: string;
  pending_fee_y?: string;
  pending_fees_usd?: number;
  total_claimed_fee_x: string;
  total_claimed_fee_y: string;
  total_fee_usd_claimed?: number;
  daily_apr?: number;
  starting_position_value: number;
  current_value?: number;
  original_start_date?: string;
  rebalance_count?: number;
  previous_position_key?: string;
  fee_history?: any;
  updated_at?: string;
  take_profit_price?: number;
  stop_loss_price?: number;
}

interface MeteoraPosData {
  address: string;
  pair_address: string;
  owner: string;
  total_fee_x_claimed: number; // int64
  total_fee_y_claimed: number; // int64
  total_reward_x_claimed: number;
  total_reward_y_claimed: number;
  total_fee_usd_claimed: number; // double
  total_reward_usd_claimed: number;
  fee_apy_24h: number;
  fee_apr_24h: number;
  daily_fee_yield: number;
}

// Helper function for async delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class PositionRepository {
  // Since auth is not required now, we'll use a default user ID
  private defaultUserId = 'default-user';

  // Method to fetch a specific position's data from the database
  async getPositionByKey(positionKey: string): Promise<SupabasePosition | null> {
    try {
      const { data, error } = await supabase
        .from('positions')
        .select('*')
        .eq('position_key', positionKey)
        .eq('user_id', this.defaultUserId)
        .maybeSingle();

      if (error) {
        console.error(`Error fetching position by key ${positionKey}:`, error);
        return null;
      }
      return data;
    } catch (error) {
      console.error(`Exception fetching position by key ${positionKey}:`, error);
      return null;
    }
  }

  // Updated syncPosition - primary method for inserts/updates
  async syncPosition(positionKey: string, positionData: any): Promise<void> {
    try {
      // Use maybeSingle to handle both insert and update cases smoothly
      const { data: existingPosition } = await supabase
        .from('positions')
        .select('id')
        .eq('position_key', positionKey)
        .eq('user_id', this.defaultUserId)
        .maybeSingle();

      // Prepare data for Supabase, respecting persistent fields
      const supabaseData: Partial<SupabasePosition> = { // Use Partial for flexibility
        user_id: this.defaultUserId,
        position_key: positionKey,
        pool_address: positionData.poolAddress || '',
        // FIX: Prioritize mints from positionData if available
        token_x_mint: positionData.tokenXMint || '',
        token_y_mint: positionData.tokenYMint || '',
        token_x_symbol: positionData.tokenXSymbol,
        token_y_symbol: positionData.tokenYSymbol,
        token_x_logo: positionData.tokenXLogo,
        token_y_logo: positionData.tokenYLogo,
        original_active_bin: positionData.originalActiveBin, // Bin at time of creation/rebalance
        min_bin_id: positionData.minBinId, // Current range min
        max_bin_id: positionData.maxBinId, // Current range max
        snapshot_position_value: positionData.snapshotPositionValue, // Value for drawdown
        pending_fee_x: positionData.lastFeeX, // Use local storage's last recorded pending
        pending_fee_y: positionData.lastFeeY, // Use local storage's last recorded pending
        pending_fees_usd: positionData.lastFeesUSD, // Use local storage's last recorded pending
        // Claimed fees are passed accumulated from PositionStorage/RebalanceManager
        total_claimed_fee_x: positionData.totalClaimedFeeX !== undefined ? String(positionData.totalClaimedFeeX) : '0',
        total_claimed_fee_y: positionData.totalClaimedFeeY !== undefined ? String(positionData.totalClaimedFeeY) : '0',
        total_fee_usd_claimed: positionData.totalFeeUsdClaimed !== undefined ? Number(positionData.totalFeeUsdClaimed) : 0,
        daily_apr: positionData.dailyAPR,
        // --- Persistent Fields ---
        starting_position_value: positionData.startingPositionValue, // The VERY original value
        original_start_date: positionData.originalStartDate ? new Date(positionData.originalStartDate).toISOString() : new Date().toISOString(), // The VERY original date
        // --- Updated Fields ---
        current_value: positionData.lastPositionValue !== undefined ? positionData.lastPositionValue : positionData.currentValue, // Latest value
        rebalance_count: positionData.rebalanceCount || 0,
        previous_position_key: positionData.previousPositionKey, // Track lineage if needed
        fee_history: positionData.feeHistory, // Store APR history
        updated_at: new Date().toISOString(), // Always update timestamp
      };

      if (existingPosition) {
        // Update existing position
        const { error } = await supabase
          .from('positions')
          .update(supabaseData)
          .eq('id', existingPosition.id);
        if (error) throw error;
        // console.log(`Updated position ${positionKey} in DB.`);
      } else {
        // Insert new position (includes created_at by default)
        const { error } = await supabase
          .from('positions')
          .insert({ ...supabaseData, user_id: this.defaultUserId }); // Ensure user_id on insert
        if (error) throw error;
        // console.log(`Inserted new position ${positionKey} in DB.`);
      }
    } catch (error) {
       if (error instanceof Error && (error as any).code === '23505') {
         console.warn(`Position ${positionKey} likely already exists or race condition occurred. Skipping insert/update.`);
       } else {
        console.error(`Error syncing position ${positionKey} to Supabase:`, error);
       }
    }
  }

  // Updated loadPositions to fetch necessary fields
  async loadPositions(): Promise<Record<string, any>> {
    try {
      const { data: positions, error } = await supabase
        .from('positions')
        .select('*') // Select all columns defined in SupabasePosition
        .eq('user_id', this.defaultUserId);

      if (error) throw error;

      const positionsMap: Record<string, any> = {};
      positions?.forEach(position => {
        if (position.position_key) {
          positionsMap[position.position_key] = {
            originalActiveBin: position.original_active_bin,
            minBinId: position.min_bin_id,
            maxBinId: position.max_bin_id,
            snapshotPositionValue: parseFloat(position.snapshot_position_value || '0'), // Value for drawdown
            startingPositionValue: parseFloat(position.starting_position_value || '0'), // Persistent original value
            lastFeeTimestamp: position.updated_at ? new Date(position.updated_at).getTime() : undefined,
            lastFeeX: position.pending_fee_x, // Raw pending X from DB
            lastFeeY: position.pending_fee_y, // Raw pending Y from DB
            lastFeesUSD: parseFloat(position.pending_fees_usd || '0'), // Pending USD from DB
            lastPositionValue: parseFloat(position.current_value || '0'), // Current value from DB
            dailyAPR: parseFloat(position.daily_apr || '0'),
            feeHistory: position.fee_history || [],
            originalStartDate: position.original_start_date ? new Date(position.original_start_date).getTime() : undefined, // Persistent start date
            rebalanceCount: position.rebalance_count || 0,
            previousPositionKey: position.previous_position_key,
            poolAddress: position.pool_address, // Needed for context
            // Load claimed fees from DB
            totalClaimedFeeX: position.total_claimed_fee_x || '0',
            totalClaimedFeeY: position.total_claimed_fee_y || '0',
            totalFeeUsdClaimed: parseFloat(position.total_fee_usd_claimed || '0'),
          };
        }
      });
      return positionsMap;
    } catch (error) {
      console.error('Error loading positions from Supabase:', error);
      return {};
    }
  }

  // Remove syncPositionWithMarketData if syncPosition handles all cases,
  // OR ensure it follows the same logic regarding persistent fields.
  // For simplicity, let's assume syncPosition is the primary method.

  // Remove syncAllPositions if not used, or ensure it calls the updated syncPosition

  async createPosition(userId: string, positionData: {
    poolAddress: string;
    tokenXMint: string;
    tokenYMint: string;
    tokenXSymbol?: string;
    tokenYSymbol?: string;
    tokenXLogo?: string;
    tokenYLogo?: string;
    minBinId: number;
    maxBinId: number;
    startingPositionValue: number;
    currentValue: number;
    originalStartDate?: Date;
  }) {
    const { data, error } = await supabase
      .from('positions')
      .insert({
        user_id: userId,
        pool_address: positionData.poolAddress,
        token_x_mint: positionData.tokenXMint,
        token_y_mint: positionData.tokenYMint,
        token_x_symbol: positionData.tokenXSymbol,
        token_y_symbol: positionData.tokenYSymbol,
        token_x_logo: positionData.tokenXLogo,
        token_y_logo: positionData.tokenYLogo,
        min_bin_id: positionData.minBinId,
        max_bin_id: positionData.maxBinId,
        starting_position_value: positionData.startingPositionValue,
        current_value: positionData.currentValue,
        original_start_date: positionData.originalStartDate || new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create position: ${error.message}`);
    return data;
  }

  async updatePosition(id: string, updates: any) {
    const { data, error } = await supabase
      .from('positions')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update position: ${error.message}`);
    return data;
  }

  async getPositionsByUserId(userId: string) {
    const { data, error } = await supabase
      .from('positions')
      .select('*')
      .eq('user_id', userId);

    if (error) throw new Error(`Failed to retrieve positions: ${error.message}`);
    return data;
  }

  async getPositionByPublicKey(userId: string, positionKey: string) {
    // You'll need to add a position_key column to your positions table
    const { data, error } = await supabase
      .from('positions')
      .select('*')
      .eq('user_id', userId)
      .eq('position_key', positionKey)
      .single();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 is "no rows returned" which we handle by returning null
      throw new Error(`Failed to retrieve position: ${error.message}`);
    }
    return data || null;
  }

  async updatePositionFeeData(id: string, feeData: {
    pendingFeesUSD: number;
    totalClaimedFeeX: string;
    totalClaimedFeeY: string;
    dailyAPR?: number;
  }) {
    const { data, error } = await supabase
      .from('positions')
      .update({
        pending_fees_usd: feeData.pendingFeesUSD,
        total_claimed_fee_x: feeData.totalClaimedFeeX,
        total_claimed_fee_y: feeData.totalClaimedFeeY,
        daily_apr: feeData.dailyAPR,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update position fee data: ${error.message}`);
    return data;
  }

  // Enhanced version of syncPosition that cross-references market data
  async syncPositionWithMarketData(positionKey: string, positionData: any, poolAddress: string): Promise<void> {
    try {
      // First check if we have market data for this pool
      const marketData = await this.getMarketDataForPool(poolAddress);
      
      // NEW: Get claimed fee data from Meteora API
      const meteoraData = await this.fetchPositionDataFromMeteora(positionKey);
      
      // Check if position already exists
      const { data: existingPosition } = await supabase
        .from('positions')
        .select('id')
        .eq('position_key', positionKey)
        .single();
      
      // Format the data for Supabase with values from marketData when available
      const supabaseData = {
        user_id: this.defaultUserId,
        position_key: positionKey,
        pool_address: poolAddress,
        token_x_mint: positionData.tokenXMint || '',
        token_y_mint: positionData.tokenYMint || '',
        // Use market data if available, otherwise use position data or null
        token_x_symbol: marketData?.token_x_symbol || positionData.tokenXSymbol || null,
        token_y_symbol: marketData?.token_y_symbol || positionData.tokenYSymbol || null,
        token_x_logo: marketData?.token_x_logo || positionData.tokenXLogo || null,
        token_y_logo: marketData?.token_y_logo || positionData.tokenYLogo || null,
        original_active_bin: positionData.originalActiveBin,
        min_bin_id: positionData.minBinId,
        max_bin_id: positionData.maxBinId,
        // IMPORTANT: Current fees are different from claimed fees
        pending_fees_usd: positionData.lastFeesUSD,
        // These fields now correctly represent PENDING fees (not claimed)
        pending_fee_x: positionData.lastFeeX,
        pending_fee_y: positionData.lastFeeY, 
        // NEW: Use Meteora API data for claimed fees if available
        total_claimed_fee_x: meteoraData?.total_fee_x_claimed || null,
        total_claimed_fee_y: meteoraData?.total_fee_y_claimed || null,
        total_fee_usd_claimed: meteoraData?.total_fee_usd_claimed || null,
        // Use market data for APR if position doesn't have it
        daily_apr: positionData.dailyAPR !== undefined ? positionData.dailyAPR : marketData?.daily_apr,
        starting_position_value: positionData.startingPositionValue || positionData.snapshotPositionValue,
        current_value: positionData.lastPositionValue,
        original_start_date: positionData.originalStartDate ? new Date(positionData.originalStartDate).toISOString() : undefined,
        rebalance_count: positionData.rebalanceCount,
        previous_position_key: positionData.previousPositionKey,
        fee_history: positionData.feeHistory,
        // Additional data from markets table
        bin_step: marketData?.bin_step,
        base_fee: marketData?.base_fee
      };
      
      if (existingPosition) {
        // Update existing position
        await supabase
          .from('positions')
          .update(supabaseData)
          .eq('id', existingPosition.id);
      } else {
        // Insert new position
        await supabase
          .from('positions')
          .insert(supabaseData);
      }
    } catch (error) {
      console.error(`Error syncing position ${positionKey} to Supabase:`, error);
    }
  }

  // Enhanced getMarketDataForPool function with extensive logging and better matching
  async getMarketDataForPool(poolAddress: string): Promise<any | null> {
    try {
      console.log(`Looking up market data for pool: ${poolAddress}`);
      
      // First try by public_key (standard lookup)
      const { data: publicKeyData, error: publicKeyError } = await supabase
        .from('markets')
        .select('*')
        .eq('public_key', poolAddress)
        .single();
      
      if (!publicKeyError && publicKeyData) {
        console.log(`Found market by public_key: ${poolAddress}`);
        return publicKeyData;
      }
      
      // Then try by address field
      const { data: addressData, error: addressError } = await supabase
        .from('markets')
        .select('*')
        .eq('address', poolAddress)
        .single();
      
      if (!addressError && addressData) {
        console.log(`Found market by address: ${poolAddress}`);
        return addressData;
      }
      
      // If still not found, try a non-case-sensitive search
      const { data: caseInsensitiveData, error: caseInsensitiveError } = await supabase
        .from('markets')
        .select('*')
        .ilike('public_key', poolAddress)
        .single();
      
      if (!caseInsensitiveError && caseInsensitiveData) {
        console.log(`Found market by case-insensitive public_key: ${poolAddress}`);
        return caseInsensitiveData;
      }
      
      // Last attempt: try removing any whitespace
      const cleanPoolAddress = poolAddress.trim();
      if (cleanPoolAddress !== poolAddress) {
        const { data: cleanedData, error: cleanedError } = await supabase
          .from('markets')
          .select('*')
          .eq('public_key', cleanPoolAddress)
          .single();
        
        if (!cleanedError && cleanedData) {
          console.log(`Found market by cleaned public_key: ${cleanPoolAddress}`);
          return cleanedData;
        }
      }
      
      // If we get here, log a helpful message with more context
      console.error(`Market lookup failed for pool ${poolAddress}. Checking if market exists...`);
      
      // Check if the market exists at all by counting total records
      const { count } = await supabase
        .from('markets')
        .select('*', { count: 'exact', head: true });
      
      console.error(`Total markets in database: ${count}`);
      
      // Sample some markets for debugging
      const { data: sampleMarkets } = await supabase
        .from('markets')
        .select('public_key, address')
        .limit(3);
      
      console.error('Sample markets for format comparison:');
      sampleMarkets?.forEach(market => {
        console.error(`- public_key: ${market.public_key}, address: ${market.address}`);
      });
      
      return null;
    } catch (error) {
      console.error(`Error fetching market data for pool ${poolAddress}:`, error);
      return null;
    }
  }

  /**
   * Gets positions in a format compatible with the old positions.json structure
   */
  async getPositionsInLegacyFormat(): Promise<{[key: string]: any}> {
    try {
      const positions = await this.getPositionsByUserId('default-user');
      
      // Convert to old format
      const formattedPositions: {[key: string]: any} = {};
      
      for (const position of positions) {
        if (position.position_key) {
          formattedPositions[position.position_key] = {
            originalActiveBin: position.original_active_bin || 0,
            minBinId: position.min_bin_id,
            maxBinId: position.max_bin_id,
            snapshotPositionValue: parseFloat(position.snapshot_position_value) || 0,
            startingPositionValue: parseFloat(position.starting_position_value) || 0,
            originalStartDate: position.original_start_date ? new Date(position.original_start_date).getTime() : undefined,
            rebalanceCount: position.rebalance_count || 0,
            previousPositionKey: position.previous_position_key
          };
        }
      }
      
      return formattedPositions;
    } catch (error) {
      console.error('Error loading positions in legacy format:', error);
      return {};
    }
  }

  // Updated fetchPositionDataFromMeteora with retry logic
  async fetchPositionDataFromMeteora(positionKey: string): Promise<MeteoraPosData | null> {
    const maxRetries = 3;
    let currentDelay = 500; // Start with 500ms delay
    const url = `https://dlmm-api.meteora.ag/position_v2/${positionKey}`;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Attempt ${attempt}: Fetching position data from Meteora API for: ${positionKey}`);
        const response = await axios.get(url, { timeout: 15000 }); // 15 sec timeout

        if (response.status === 200 && response.data) {
          console.log(`Successfully fetched Meteora data for position ${positionKey} on attempt ${attempt}`);
          // Ensure the response contains expected fields before returning
          if (typeof response.data.total_fee_x_claimed !== 'undefined') {
             return response.data as MeteoraPosData;
          } else {
             console.warn(`Meteora API response for ${positionKey} missing expected fields. Status: ${response.status}`);
             return null; // Treat malformed success as failure for this purpose
          }
        } else {
          // Handle non-200 success codes if necessary, though unlikely for GET
          console.warn(`Meteora API returned non-200 status ${response.status} for ${positionKey}`);
          // Decide whether to retry or fail based on status if needed
          // For now, we'll let this fall through to the catch block if axios throws for non-2xx
        }
      } catch (error) {
        console.error(`Attempt ${attempt} failed for ${positionKey}: ${error instanceof Error ? error.message : String(error)}`);

        // Check if the error is from Axios and has a response status
        if (axios.isAxiosError(error) && error.response) {
          const statusCode = error.response.status;
          // Retry only on 5xx server errors
          if (statusCode >= 500 && statusCode < 600) {
            if (attempt < maxRetries) {
              console.log(`Server error (${statusCode}). Retrying in ${currentDelay}ms...`);
              await delay(currentDelay);
              currentDelay *= 2; // Exponential backoff
              continue; // Go to the next attempt
            } else {
              console.error(`Max retries (${maxRetries}) reached for ${positionKey} after server error.`);
              break; // Exit loop after max retries
            }
          } else {
            // Don't retry for 4xx client errors (like 404 Not Found) or other non-5xx issues
            console.warn(`Non-retryable error status ${statusCode} for ${positionKey}. Aborting fetch.`);
            break; // Exit loop, won't retry
          }
        } else {
           // Network errors or other issues not related to HTTP status
           console.error(`Network or unknown error fetching ${positionKey}. Aborting fetch.`);
           break; // Exit loop, won't retry
        }
      }
      // Should only reach here if a non-error, non-200 status was somehow encountered
      // Or if axios didn't throw an error for a non-2xx response (unlikely with default config)
      break;
    }

    // If the loop completes without returning data
    console.error(`Failed to fetch Meteora data for position ${positionKey} after all attempts.`);
    return null;
  }

  // removePosition remains the same, ensure it targets user_id
  async removePosition(positionKey: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('positions')
        .delete()
        .eq('position_key', positionKey)
        .eq('user_id', this.defaultUserId); // Ensure user context

      if (error) {
        console.error(`Error removing position ${positionKey} from Supabase:`, error);
      } else {
        console.log(`Successfully removed position ${positionKey} from Supabase.`);
      }
    } catch (error) {
      console.error(`Exception removing position ${positionKey} from Supabase:`, error);
    }
  }

  /**
   * Sets a take profit price for a position
   * @param positionKey The position's public key
   * @param takeProfitPrice The take profit price to set
   */
  async setTakeProfitForPosition(positionKey: string, takeProfitPrice: number): Promise<void> {
    try {
      const { error } = await supabase
        .from('positions')
        .update({ take_profit_price: takeProfitPrice })
        .eq('position_key', positionKey)
        .eq('user_id', this.defaultUserId);
        
      if (error) throw error;
      console.log(`Take profit set for position ${positionKey}: $${takeProfitPrice}`);
    } catch (error) {
      console.error(`Error setting take profit for position ${positionKey}:`, error);
      throw error;
    }
  }

  /**
   * Sets a stop loss price for a position
   * @param positionKey The position's public key
   * @param stopLossPrice The stop loss price to set
   */
  async setStopLossForPosition(positionKey: string, stopLossPrice: number): Promise<void> {
    try {
      const { error } = await supabase
        .from('positions')
        .update({ stop_loss_price: stopLossPrice })
        .eq('position_key', positionKey)
        .eq('user_id', this.defaultUserId);
        
      if (error) throw error;
      console.log(`Stop loss set for position ${positionKey}: $${stopLossPrice}`);
    } catch (error) {
      console.error(`Error setting stop loss for position ${positionKey}:`, error);
      throw error;
    }
  }

  /**
   * Gets all positions that have take profit or stop loss prices set
   * @returns Array of positions with triggers
   */
  async getPositionsWithTriggers(): Promise<SupabasePosition[]> {
    try {
      const { data, error } = await supabase
        .from('positions')
        .select('*')
        .or('take_profit_price.gte.0,stop_loss_price.gte.0')
        .eq('user_id', this.defaultUserId);
        
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching positions with triggers:', error);
      return [];
    }
  }

  /**
   * Sets both take profit and stop loss prices for a position
   * @param positionKey The position's public key
   * @param takeProfitPrice The take profit price (optional)
   * @param stopLossPrice The stop loss price (optional)
   */
  async setPositionTriggers(
    positionKey: string, 
    takeProfitPrice?: number, 
    stopLossPrice?: number
  ): Promise<void> {
    try {
      // Validate that take profit is greater than stop loss if both are provided
      if (takeProfitPrice !== undefined && stopLossPrice !== undefined && 
          takeProfitPrice <= stopLossPrice) {
        throw new Error('Take profit price must be greater than stop loss price');
      }
      
      // Validate prices are positive if provided
      if ((takeProfitPrice !== undefined && takeProfitPrice <= 0) || 
          (stopLossPrice !== undefined && stopLossPrice <= 0)) {
        throw new Error('Trigger prices must be greater than zero');
      }
      
      const updates: Record<string, any> = {};
      
      if (takeProfitPrice !== undefined) {
        updates.take_profit_price = takeProfitPrice;
      }
      
      if (stopLossPrice !== undefined) {
        updates.stop_loss_price = stopLossPrice;
      }
      
      if (Object.keys(updates).length === 0) {
        return; // Nothing to update
      }
      
      const { error } = await supabase
        .from('positions')
        .update(updates)
        .eq('position_key', positionKey)
        .eq('user_id', this.defaultUserId);
        
      if (error) throw error;
      
      console.log(`Triggers set for position ${positionKey}: TP=${takeProfitPrice}, SL=${stopLossPrice}`);
    } catch (error) {
      console.error(`Error setting triggers for position ${positionKey}:`, error);
      throw error;
    }
  }

  /**
   * Clears the take profit and/or stop loss for a position
   * @param positionKey The position's public key
   * @param clearTakeProfit Whether to clear take profit
   * @param clearStopLoss Whether to clear stop loss
   */
  async clearPositionTriggers(
    positionKey: string,
    clearTakeProfit: boolean = true,
    clearStopLoss: boolean = true
  ): Promise<void> {
    try {
      const updates: Record<string, any> = {};
      
      if (clearTakeProfit) {
        updates.take_profit_price = null;
      }
      
      if (clearStopLoss) {
        updates.stop_loss_price = null;
      }
      
      if (Object.keys(updates).length === 0) {
        return; // Nothing to clear
      }
      
      const { error } = await supabase
        .from('positions')
        .update(updates)
        .eq('position_key', positionKey)
        .eq('user_id', this.defaultUserId);
        
      if (error) throw error;
      
      console.log(`Triggers cleared for position ${positionKey}`);
    } catch (error) {
      console.error(`Error clearing triggers for position ${positionKey}:`, error);
      throw error;
    }
  }
}
