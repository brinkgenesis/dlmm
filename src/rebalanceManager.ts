import { PublicKey, Connection, Keypair, ComputeBudgetProgram, sendAndConfirmTransaction } from '@solana/web3.js';
import { Config } from './models/Config';
import { PositionStorage } from './utils/PositionStorage';
import DLMM, { PositionInfo, StrategyType, StrategyParameters } from '@meteora-ag/dlmm';
import { BN } from '@coral-xyz/anchor';

export class RebalanceManager {
  private connection: Connection;
  private wallet: Keypair;
  private config: Config;
  private positionStorage: PositionStorage;
  private lastRebalanceTime: Record<string, number> = {};
  private COOLDOWN_PERIOD = .25 * 60 * 60 * 1000; // 6 hours in milliseconds
  private RANGE_WIDTH = 138; // Total range width (±69 bins from active bin)
  private dlmmInstances: Map<string, DLMM> = new Map();

  constructor(connection: Connection, wallet: Keypair, config: Config) {
    this.connection = connection;
    this.wallet = wallet;
    this.config = config;
    this.positionStorage = new PositionStorage(config);
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
   * Gets all user positions across all pools
   */
  public async getUserPositions(): Promise<Map<string, PositionInfo>> {
    return DLMM.getAllLbPairPositionsByUser(
      this.connection, 
      this.wallet.publicKey
    );
  }

  /**
   * Checks all positions for range breaches and rebalances if needed
   */
  public async checkAndRebalancePositions(): Promise<void> {
    try {
      console.log('Checking positions for rebalancing...');
      
      // Get all positions from chain
      const positionsMap = await this.getUserPositions();
      const positions = Array.from(positionsMap.values());
      
      if (positions.length === 0) {
        console.log('No positions found on-chain');
        return;
      }
      
      console.log(`Found ${positions.length} positions to check`);
      
      // Group positions by pool address
      const poolPositionsMap = new Map<string, PositionInfo[]>();
      
      for (const position of positions) {
        const poolAddress = position.publicKey.toString();
        
        if (!poolPositionsMap.has(poolAddress)) {
          poolPositionsMap.set(poolAddress, []);
        }
        poolPositionsMap.get(poolAddress)!.push(position);
      }
      
      // Check each pool for range breaches
      for (const [poolAddressStr, poolPositions] of poolPositionsMap.entries()) {
        const poolAddress = new PublicKey(poolAddressStr);
        console.log(`Checking pool: ${poolAddressStr} with ${poolPositions.length} positions`);
        
        // Get DLMM instance for this pool
        const dlmm = await this.getDLMMInstance(poolAddress);
        
        // Get current active bin
        const activeBin = await dlmm.getActiveBin();
        const activeBinId = activeBin.binId;
        console.log(`Pool ${poolAddressStr} - Active bin: ${activeBinId}`);
        
        // Check if any position is out of range
        let outOfRange = false;
        
        for (const position of poolPositions) {
          const positionKey = position.publicKey.toString();
          
          // Get stored position data from positions.json
          const storedPosition = this.positionStorage.getPositionRange(position.publicKey);
          
          if (storedPosition) {
            console.log(`Position ${positionKey} - Min: ${storedPosition.minBinId}, Max: ${storedPosition.maxBinId}`);
            
            // Check if active bin is outside position range
            if (activeBinId <= storedPosition.minBinId || activeBinId >= storedPosition.maxBinId) {
              console.log(`⚠️ Range breach detected for position ${positionKey}`);
              console.log(`Active bin ${activeBinId} is outside range [${storedPosition.minBinId}, ${storedPosition.maxBinId}]`);
              outOfRange = true;
              break;
            } else {
              // Calculate how far through the range we are
              const totalRange = storedPosition.maxBinId - storedPosition.minBinId;
              const distanceFromMin = activeBinId - storedPosition.minBinId;
              const percentageThroughRange = (distanceFromMin / totalRange) * 100;
              
              console.log(`Position ${positionKey} - ${percentageThroughRange.toFixed(2)}% through range`);
              
              // Check if we're approaching the edge of the range (70% threshold)
              if (percentageThroughRange <= 30 || percentageThroughRange >= 70) {
                console.log(`⚠️ Position ${positionKey} is approaching range edge (${percentageThroughRange.toFixed(2)}%)`);
              }
            }
          } else {
            console.log(`Position ${positionKey} not found in storage, skipping`);
          }
        }
        
        // If any position is out of range, close all positions in this pool
        if (outOfRange) {
          console.log(`Closing all positions in pool ${poolAddressStr} due to range breach`);
          await this.closeAllPositionsInPool(poolAddress, poolPositions);
        }
      }
      
    } catch (error) {
      console.error('Error checking positions for rebalancing:', error);
    }
  }

  /**
   * Closes all positions in a specific pool
   */
  private async closeAllPositionsInPool(poolAddress: PublicKey, positions: PositionInfo[]): Promise<void> {
    try {
      console.log(`Closing all positions in pool ${poolAddress.toString()}...`);
      
      const dlmm = await this.getDLMMInstance(poolAddress);
      
      for (const position of positions) {
        const positionKey = position.publicKey.toString();
        console.log(`Closing position ${positionKey}...`);
        
        try {
          // 1. Remove liquidity
          console.log(`Removing liquidity from position ${positionKey}...`);
          
          // Get all bin IDs from the position
          const binIds = position.lbPairPositionsData[0].positionData.positionBinData.map(b => 
            Number(b.binId)
          );
          
          // Create the remove liquidity transaction
          const txOrTxs = await dlmm.removeLiquidity({
            user: this.wallet.publicKey,
            position: position.publicKey,
            bps: new BN(10000), // 100% removal
            binIds: binIds
          });
          
          // Handle single transaction or array of transactions
          if (Array.isArray(txOrTxs)) {
            // Handle multiple transactions
            for (const tx of txOrTxs) {
              // Add priority fee
              tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 30000 }));
              
              // Set recent blockhash
              const { blockhash } = await this.connection.getLatestBlockhash('finalized');
              tx.recentBlockhash = blockhash;
              tx.feePayer = this.wallet.publicKey;
              
              // Sign and send
              const signature = await sendAndConfirmTransaction(
                this.connection, tx, [this.wallet], { skipPreflight: false, commitment: 'confirmed' }
              );
              console.log('Transaction Signature:', signature);
            }
          } else {
            // Handle single transaction
            txOrTxs.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 30000 }));
            
            // Set recent blockhash
            const { blockhash } = await this.connection.getLatestBlockhash('finalized');
            txOrTxs.recentBlockhash = blockhash;
            txOrTxs.feePayer = this.wallet.publicKey;
            
            // Sign and send
            const signature = await sendAndConfirmTransaction(
              this.connection, txOrTxs, [this.wallet], { skipPreflight: false, commitment: 'confirmed' }
            );
            console.log('Transaction Signature:', signature);
          }
          
          console.log(`Liquidity removed from position ${positionKey}`);
          
          // 2. Close the position
          console.log(`Closing position ${positionKey}...`);
          const closeTx = await dlmm.closePosition({
            owner: this.wallet.publicKey,
            position: position.lbPairPositionsData[0]
          });
          
          // Add priority fee
          closeTx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 30000 }));
          
          // Set recent blockhash
          const { blockhash } = await this.connection.getLatestBlockhash('finalized');
          closeTx.recentBlockhash = blockhash;
          closeTx.feePayer = this.wallet.publicKey;
          
          // Sign and send
          const signature = await sendAndConfirmTransaction(
            this.connection, closeTx, [this.wallet], { skipPreflight: false, commitment: 'confirmed' }
          );
          console.log('Close Transaction Signature:', signature);
          
          console.log(`Position ${positionKey} closed`);
          
          // 3. Remove from storage
          this.positionStorage.removePosition(position.publicKey);
          console.log(`Position ${positionKey} removed from storage`);
          
        } catch (error) {
          console.error(`Error closing position ${positionKey}:`, error);
        }
      }
      
    } catch (error) {
      console.error(`Error closing positions in pool ${poolAddress.toString()}:`, error);
    }
  }

  /**
   * Starts the rebalancing monitor
   */
  public startRebalanceMonitor(intervalMinutes: number = 30): void {
    console.log(`Starting rebalance monitor with ${intervalMinutes} minute interval`);
    
    // Run immediately
    this.checkAndRebalancePositions();
    
    // Then run on interval
    setInterval(() => {
      this.checkAndRebalancePositions();
    }, intervalMinutes * 60 * 1000);
  }
} 