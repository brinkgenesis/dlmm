import { supabase } from './supabase';
import { PublicKey } from '@solana/web3.js';

// This matches the structure in your positions table
interface SupabasePosition {
  id: string;
  user_id: string;
  pool_address: string;
  position_key: string; // We'll need to add this column
  token_x_mint: string;
  token_y_mint: string;
  token_x_symbol?: string;
  token_y_symbol?: string;
  token_x_logo?: string;
  token_y_logo?: string;
  min_bin_id: number;
  max_bin_id: number;
  current_price?: number;
  current_price_usd?: number;
  pending_fees_usd?: number;
  total_claimed_fee_x?: string;
  total_claimed_fee_y?: string;
  daily_apr?: number;
  starting_position_value: number;
  current_value?: number;
  original_start_date?: string;
  rebalance_count?: number;
  previous_position_key?: string;
  fee_history?: any; // We'll store this as JSONB
}

export class PositionRepository {
  // Since auth is not required now, we'll use a default user ID
  private defaultUserId = 'default-user';

  // Sync a single position to Supabase
  async syncPosition(positionKey: string, positionData: any): Promise<void> {
    try {
      // Check if position already exists
      const { data: existingPosition } = await supabase
        .from('positions')
        .select('id')
        .eq('position_key', positionKey)
        .single();
      
      // Format the data for Supabase
      const supabaseData = {
        user_id: this.defaultUserId,
        position_key: positionKey,
        pool_address: positionData.poolAddress || '',
        token_x_mint: positionData.tokenXMint || '',
        token_y_mint: positionData.tokenYMint || '',
        token_x_symbol: positionData.tokenXSymbol,
        token_y_symbol: positionData.tokenYSymbol,
        token_x_logo: positionData.tokenXLogo,
        token_y_logo: positionData.tokenYLogo,
        min_bin_id: positionData.minBinId,
        max_bin_id: positionData.maxBinId,
        pending_fees_usd: positionData.lastFeesUSD,
        total_claimed_fee_x: positionData.lastFeeX,
        total_claimed_fee_y: positionData.lastFeeY,
        daily_apr: positionData.dailyAPR,
        starting_position_value: positionData.startingPositionValue || positionData.snapshotPositionValue,
        current_value: positionData.lastPositionValue,
        original_start_date: positionData.originalStartDate ? new Date(positionData.originalStartDate).toISOString() : undefined,
        rebalance_count: positionData.rebalanceCount,
        previous_position_key: positionData.previousPositionKey,
        fee_history: positionData.feeHistory
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
      // Continue with normal operation - Supabase is an add-on, not a replacement
    }
  }

  // Load all positions from Supabase
  async loadPositions(): Promise<Record<string, any>> {
    try {
      const { data: positions, error } = await supabase
        .from('positions')
        .select('*')
        .eq('user_id', this.defaultUserId);
      
      if (error) throw error;
      
      // Convert to the format expected by PositionStorage
      const positionsMap: Record<string, any> = {};
      positions?.forEach(position => {
        if (position.position_key) {
          positionsMap[position.position_key] = {
            originalActiveBin: position.min_bin_id, // Approximation, adjust as needed
            minBinId: position.min_bin_id,
            maxBinId: position.max_bin_id,
            snapshotPositionValue: position.starting_position_value,
            startingPositionValue: position.starting_position_value,
            lastFeeTimestamp: position.updated_at ? new Date(position.updated_at).getTime() : undefined,
            lastFeeX: position.total_claimed_fee_x,
            lastFeeY: position.total_claimed_fee_y,
            lastFeesUSD: position.pending_fees_usd,
            lastPositionValue: position.current_value,
            dailyAPR: position.daily_apr,
            feeHistory: position.fee_history || [],
            originalStartDate: position.original_start_date ? new Date(position.original_start_date).getTime() : undefined,
            rebalanceCount: position.rebalance_count,
            previousPositionKey: position.previous_position_key
          };
        }
      });
      
      return positionsMap;
    } catch (error) {
      console.error('Error loading positions from Supabase:', error);
      return {}; // Return empty object on error - will fall back to file
    }
  }

  // Remove a position from Supabase
  async removePosition(positionKey: string): Promise<void> {
    try {
      await supabase
        .from('positions')
        .delete()
        .eq('position_key', positionKey);
    } catch (error) {
      console.error(`Error removing position ${positionKey} from Supabase:`, error);
      // Continue with normal operation
    }
  }

  // Sync all positions at once
  async syncAllPositions(positions: Record<string, any>): Promise<void> {
    try {
      // Convert to an array of records for batch operation
      const positionEntries = Object.entries(positions);
      for (const [key, data] of positionEntries) {
        await this.syncPosition(key, data);
      }
    } catch (error) {
      console.error('Error syncing all positions to Supabase:', error);
    }
  }

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

  // Add new method to get market data for a pool address
  async getMarketDataForPool(poolAddress: string): Promise<any | null> {
    try {
      const { data, error } = await supabase
        .from('markets')
        .select('*')
        .eq('public_key', poolAddress)
        .single();
      
      if (error) {
        console.log(`No market found for pool ${poolAddress}`);
        return null;
      }
      
      return data;
    } catch (error) {
      console.error(`Error fetching market data for pool ${poolAddress}:`, error);
      return null;
    }
  }

  // Enhanced version of syncPosition that cross-references market data
  async syncPositionWithMarketData(positionKey: string, positionData: any, poolAddress: string): Promise<void> {
    try {
      // First check if we have market data for this pool
      const marketData = await this.getMarketDataForPool(poolAddress);
      
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
        pending_fees_usd: positionData.lastFeesUSD,
        total_claimed_fee_x: positionData.lastFeeX,
        total_claimed_fee_y: positionData.lastFeeY,
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
}
