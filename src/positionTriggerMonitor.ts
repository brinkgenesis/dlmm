import { PublicKey, Connection, Keypair, ComputeBudgetProgram, sendAndConfirmTransaction } from '@solana/web3.js';
import { Config } from './models/Config';
import DLMM from '@meteora-ag/dlmm';
import BN from 'bn.js';
import { withSafeKeypair } from './utils/walletHelper';
import { PositionRepository } from './services/positionRepository';
import { getTokenPricesJupiter } from './utils/fetchPriceJupiter';
import fs from 'fs';

export class PositionTriggerMonitor {
  private connection: Connection;
  private wallet: Keypair;
  private config: Config;
  private positionRepository: PositionRepository;
  private monitorInterval: NodeJS.Timeout | null = null;
  private dlmmInstances: Map<string, DLMM> = new Map();
  private MONITOR_INTERVAL = 5 * 60 * 1000; // Check every 5 minutes

  constructor(
    connection: Connection,
    wallet: Keypair,
    config: Config,
    positionRepository?: PositionRepository
  ) {
    this.connection = connection;
    this.wallet = wallet;
    this.config = config;
    this.positionRepository = positionRepository || new PositionRepository();
  }

  /**
   * Starts monitoring positions for take profit and stop loss triggers
   */
  public startMonitoring(): void {
    console.log('Starting position trigger monitoring...');
    
    // Do an initial check
    this.checkAllPositionTriggers().catch(error => {
      console.error('Error during initial position trigger check:', error);
    });
    
    // Set up interval for regular checking
    this.monitorInterval = setInterval(async () => {
      try {
        await this.checkAllPositionTriggers();
        fs.writeFileSync('./last_trigger_check.txt', new Date().toISOString());
      } catch (error) {
        console.error('Error checking position triggers:', error);
      }
    }, this.MONITOR_INTERVAL);
    
    console.log(`Position trigger monitoring started. Checking every ${this.MONITOR_INTERVAL / 60000} minutes.`);
  }

  /**
   * Stops the monitoring process
   */
  public stopMonitoring(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
      console.log('Position trigger monitoring stopped.');
    }
  }

  /**
   * Gets or creates a DLMM instance for a specific pool
   */
  private async getDLMMInstance(poolAddress: PublicKey): Promise<DLMM> {
    const poolKey = poolAddress.toString();
    
    if (!this.dlmmInstances.has(poolKey)) {
      // Create a new DLMM instance for this pool
      const dlmm = await DLMM.create(this.connection, poolAddress);
      this.dlmmInstances.set(poolKey, dlmm);
    }
    
    return this.dlmmInstances.get(poolKey)!;
  }

  /**
   * Checks all positions for take profit and stop loss triggers
   */
  private async checkAllPositionTriggers(): Promise<void> {
    console.log('Checking all positions for TP/SL triggers...');
    
    // Get all positions with triggers
    const positionsWithTriggers = await this.positionRepository.getPositionsWithTriggers();
    console.log(`Found ${positionsWithTriggers.length} positions with TP/SL triggers set.`);
    
    if (positionsWithTriggers.length === 0) return;
    
    // Group positions by pool for efficiency
    const poolPositionsMap = new Map<string, any[]>();
    
    positionsWithTriggers.forEach(position => {
      const poolAddress = position.pool_address;
      if (!poolPositionsMap.has(poolAddress)) {
        poolPositionsMap.set(poolAddress, []);
      }
      poolPositionsMap.get(poolAddress)!.push(position);
    });
    
    // Check positions pool by pool
    for (const [poolAddressStr, positions] of poolPositionsMap.entries()) {
      try {
        const poolAddress = new PublicKey(poolAddressStr);
        console.log(`\nChecking ${positions.length} positions with triggers in pool: ${poolAddressStr}`);
        
        // Get current price for this pool
        const currentPrice = await this.getCurrentPriceForPool(poolAddress);
        console.log(`Current price for pool ${poolAddressStr}: $${currentPrice.toFixed(6)}`);
        
        // Check each position in this pool
        for (const position of positions) {
          await this.checkPositionTriggers(position, poolAddress, currentPrice);
        }
      } catch (error) {
        console.error(`Error checking triggers for pool ${poolAddressStr}:`, error);
        continue; // Continue to next pool
      }
    }
    
    console.log('Finished checking all position triggers.');
  }

  /**
   * Gets the current price for a specific pool in USD terms
   */
  private async getCurrentPriceForPool(poolAddress: PublicKey): Promise<number> {
    try {
      const dlmm = await this.getDLMMInstance(poolAddress);
      const activeBin = await dlmm.getActiveBin();
      const pricePerToken = parseFloat(activeBin.pricePerToken);
      
      // Get token prices in USD
      const tokenXMint = dlmm.tokenX.publicKey.toString();
      const tokenYMint = dlmm.tokenY.publicKey.toString();
      const prices = await getTokenPricesJupiter([tokenXMint, tokenYMint]);
      
      // If tokenX is the quote token (like USDC), then price is directly in USD
      if (prices[tokenXMint] && prices[tokenXMint] > 0.95 && prices[tokenXMint] < 1.05) {
        return pricePerToken;
      }
      
      // If tokenY is the quote token, invert the price and return
      if (prices[tokenYMint] && prices[tokenYMint] > 0.95 && prices[tokenYMint] < 1.05) {
        return 1 / pricePerToken;
      }
      
      // Otherwise, need to calculate using both token prices
      const tokenXPrice = prices[tokenXMint] || 0;
      const tokenYPrice = prices[tokenYMint] || 0;
      
      if (tokenXPrice > 0 && tokenYPrice > 0) {
        // Price is tokenY per tokenX, so:
        // USD per tokenY = tokenYPrice
        // tokenY per tokenX = pricePerToken
        // USD per tokenX = tokenY per tokenX * USD per tokenY = pricePerToken * tokenYPrice
        return pricePerToken * tokenYPrice / tokenXPrice;
      }
      
      console.warn(`Could not determine USD price for pool ${poolAddress.toString()}`);
      return 0;
    } catch (error) {
      console.error(`Error getting current price for pool ${poolAddress.toString()}:`, error);
      return 0;
    }
  }

  /**
   * Checks if a position has triggered take profit or stop loss conditions
   */
  private async checkPositionTriggers(
    position: any, 
    poolAddress: PublicKey, 
    currentPrice: number
  ): Promise<void> {
    const positionKey = position.position_key;
    console.log(`\nChecking triggers for position: ${positionKey}`);
    
    // Skip if price couldn't be determined
    if (currentPrice <= 0) {
      console.log(`Skipping trigger check for position ${positionKey} due to invalid price.`);
      return;
    }
    
    const takeProfitPrice = position.take_profit_price;
    const stopLossPrice = position.stop_loss_price;
    
    console.log(`Position ${positionKey} - Current: $${currentPrice.toFixed(6)}, TP: ${takeProfitPrice ? '$' + takeProfitPrice.toFixed(6) : 'None'}, SL: ${stopLossPrice ? '$' + stopLossPrice.toFixed(6) : 'None'}`);
    
    let triggered = false;
    let triggerType: 'TAKE_PROFIT' | 'STOP_LOSS' | null = null;
    
    // Check take profit (price >= TP price)
    if (takeProfitPrice && currentPrice >= takeProfitPrice) {
      console.log(`✅ Take profit triggered for position ${positionKey}: $${currentPrice.toFixed(6)} >= $${takeProfitPrice.toFixed(6)}`);
      triggered = true;
      triggerType = 'TAKE_PROFIT';
    }
    // Check stop loss (price <= SL price)
    else if (stopLossPrice && currentPrice <= stopLossPrice) {
      console.log(`⚠️ Stop loss triggered for position ${positionKey}: $${currentPrice.toFixed(6)} <= $${stopLossPrice.toFixed(6)}`);
      triggered = true;
      triggerType = 'STOP_LOSS';
    }
    
    if (triggered && triggerType) {
      try {
        // Execute the trigger
        await this.closePosition(positionKey, poolAddress, triggerType);
        
        // Clear the relevant trigger after successful execution
        if (triggerType === 'TAKE_PROFIT') {
          await this.positionRepository.clearPositionTriggers(positionKey, true, false);
        } else {
          await this.positionRepository.clearPositionTriggers(positionKey, false, true);
        }
        
        console.log(`Successfully executed ${triggerType} for position ${positionKey}`);
      } catch (error) {
        console.error(`Error executing ${triggerType} for position ${positionKey}:`, error);
      }
    } else {
      console.log(`No triggers met for position ${positionKey}`);
    }
  }

  /**
   * Closes a position that hit a trigger
   */
  private async closePosition(
    positionKeyStr: string, 
    poolAddress: PublicKey, 
    triggerType: 'TAKE_PROFIT' | 'STOP_LOSS'
  ): Promise<void> {
    console.log(`Closing position ${positionKeyStr} due to ${triggerType}...`);
    
    try {
      const dlmm = await this.getDLMMInstance(poolAddress);
      const positionKey = new PublicKey(positionKeyStr);
      
      // Get position data from on-chain
      const { userPositions } = await dlmm.getPositionsByUserAndLbPair(this.wallet.publicKey);
      const positionToClose = userPositions.find(p => p.publicKey.toString() === positionKeyStr);
      
      if (!positionToClose) {
        throw new Error(`Position ${positionKeyStr} not found on-chain. It may have been already closed.`);
      }
      
      // Determine bin range
      const lowerBinId = positionToClose.positionData.lowerBinId;
      const upperBinId = positionToClose.positionData.upperBinId;
      const binIds = Array.from(
        { length: upperBinId - lowerBinId + 1 },
        (_, i) => lowerBinId + i
      );
      
      // Set BPS to 10000 (100%) for full closure
      const bpsBN = new BN(10000);
      
      console.log(`Removing liquidity from position ${positionKeyStr}, bins: [${lowerBinId}, ${upperBinId}], BPS: 10000 (100%)`);
      
      // Check if there are bins with liquidity
      if (binIds.length > 0) {
        // Remove liquidity and close position
        const removeLiquidityTx = await dlmm.removeLiquidity({
          position: positionKey,
          binIds,
          bps: bpsBN,
          user: this.wallet.publicKey,
          shouldClaimAndClose: true
        });
        
        // Add priority fee
        const txsToSend = Array.isArray(removeLiquidityTx) ? removeLiquidityTx : [removeLiquidityTx];
        
        for (const tx of txsToSend) {
          // Add compute budget instructions
          tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 30000 }));
          
          // Set blockhash and fee payer
          const { blockhash } = await this.connection.getLatestBlockhash('finalized');
          tx.recentBlockhash = blockhash;
          tx.feePayer = this.wallet.publicKey;
          
          // Send transaction
          const signature = await withSafeKeypair(this.config, async (keypair) => {
            return sendAndConfirmTransaction(
              this.connection,
              tx,
              [keypair],
              { skipPreflight: false, commitment: 'confirmed' }
            );
          });
          
          console.log(`${triggerType} execution transaction: ${signature}`);
        }
      } else {
        // No liquidity bins, just close the position
        console.log(`Position ${positionKeyStr} has no liquidity bins. Closing directly...`);
        
        const closeTx = await dlmm.closePosition({
          owner: this.wallet.publicKey,
          position: positionToClose
        });
        
        // Add compute budget instruction
        closeTx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 30000 }));
        
        // Set blockhash and fee payer
        const { blockhash } = await this.connection.getLatestBlockhash('finalized');
        closeTx.recentBlockhash = blockhash;
        closeTx.feePayer = this.wallet.publicKey;
        
        // Send transaction
        const signature = await withSafeKeypair(this.config, async (keypair) => {
          return sendAndConfirmTransaction(
            this.connection,
            closeTx,
            [keypair],
            { skipPreflight: false, commitment: 'confirmed' }
          );
        });
        
        console.log(`${triggerType} direct close transaction: ${signature}`);
      }
      
      console.log(`Position ${positionKeyStr} closed successfully due to ${triggerType}`);
      
      // Don't remove from position repository, just mark as closed by clearing triggers
      // This preserves position history while preventing future trigger checks
    } catch (error) {
      console.error(`Error closing position ${positionKeyStr}:`, error);
      throw error;
    }
  }
} 