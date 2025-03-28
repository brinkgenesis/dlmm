import { supabase } from '../src/services/supabase';

async function repairPoolAddresses() {
  try {
    console.log('Starting pool address repair...');
    
    // 1. First get all positions
    const { data: positions, error: posError } = await supabase
      .from('positions')
      .select('id, position_key, pool_address');
    
    if (posError) throw posError;
    console.log(`Found ${positions.length} positions to check`);
    
    // 2. For each position, try to find matching market
    let fixed = 0;
    for (const position of positions) {
      const { data: market } = await supabase
        .from('markets')
        .select('id, public_key, address')
        .or(`public_key.eq.${position.pool_address},address.eq.${position.pool_address}`)
        .maybeSingle();
      
      if (market) {
        console.log(`Found market match for position ${position.position_key}`);
        
        // 3. Update position with token data from market
        const { data: marketData } = await supabase
          .from('markets')
          .select('token_x_symbol, token_y_symbol, token_x_logo, token_y_logo, token_x_mint, token_y_mint, daily_apr, base_fee_percentage')
          .eq('id', market.id)
          .single();
        
        if (marketData) {
          const { error: updateError } = await supabase
            .from('positions')
            .update({
              token_x_symbol: marketData.token_x_symbol,
              token_y_symbol: marketData.token_y_symbol,
              token_x_logo: marketData.token_x_logo,
              token_y_logo: marketData.token_y_logo,
              token_x_mint: marketData.token_x_mint,
              token_y_mint: marketData.token_y_mint,
              daily_apr: marketData.daily_apr
            })
            .eq('id', position.id);
          
          if (!updateError) {
            fixed++;
            console.log(`✅ Updated position ${position.position_key} with market data`);
          }
        }
      }
    }
    
    console.log(`Repair complete. Fixed ${fixed} of ${positions.length} positions`);
  } catch (error) {
    console.error('Error in repair script:', error);
  }
}

repairPoolAddresses().catch(console.error); 