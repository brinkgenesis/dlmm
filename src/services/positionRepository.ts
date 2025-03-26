import { supabase } from './supabase';
import { PublicKey } from '@solana/web3.js';

export class PositionRepository {
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
}
