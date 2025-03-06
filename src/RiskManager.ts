import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { fetchTokenMetrics } from './utils/token_data';
import { PositionSnapshotService } from './utils/positionSnapshot';
import DLMM, { PositionInfo, BinLiquidity, StrategyType, PositionVersion, StrategyParameters, LbPosition, SwapQuote, computeBudgetIx } from '@meteora-ag/dlmm';
import { FetchPrice } from './utils/fetch_price';
import { VolumeData } from './utils/data/marketData';
import { BN } from '@coral-xyz/anchor';
import { ComputeBudgetProgram, sendAndConfirmTransaction } from '@solana/web3.js';
import { PositionStorage } from './utils/PositionStorage';
import { Config } from './models/Config';

// Mock data generator for testing
const MOCK_VOLUME_DATA: VolumeData[] = [
  { timestamp: Date.now() - 5*3600*1000, volume: 150000 },
  { timestamp: Date.now() - 4*3600*1000, volume: 175000 },
  { timestamp: Date.now() - 3*3600*1000, volume: 130000 },
  { timestamp: Date.now() - 2*3600*1000, volume: 190000 },
  { timestamp: Date.now() - 1*3600*1000, volume: 165000 },
  { timestamp: Date.now(), volume: 140000 }
];

export class RiskManager {
  private snapshotService = new PositionSnapshotService();
  private lastAdjustmentTime: number = 0;
  private readonly COOLDOWN_PERIOD = 30 * 60 * 1000; // 30 minutes in ms
  private dlmmInstances: Map<string, DLMM> = new Map();
  private positionStorage: PositionStorage;

  constructor(
    private connection: Connection,
    private wallet: Keypair,
    private config: Config
  ) {
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
   * Enforces circuit breakers across all pools
   */
  public async enforceAllCircuitBreakers(): Promise<void> {
    const now = Date.now();
    if (now - this.lastAdjustmentTime < this.COOLDOWN_PERIOD) {
      console.log('Still in cooldown period, skipping circuit breaker check');
      return;
    }

    const positionsMap = await this.getUserPositions();
    const positions = Array.from(positionsMap.values());
    
    // Group positions by pool address
    const poolPositionsMap = new Map<string, PositionInfo[]>();
    
    for (const position of positions) {
      // Get the pool address from the position
      const poolAddress = position.publicKey.toString();
      console.log(`Position found in pool: ${poolAddress}`);
      
      // Verify this is actually the pool address by logging some details
      console.log(`Pool details - Token X: ${position.tokenX.publicKey.toString()}, Token Y: ${position.tokenY.publicKey.toString()}`);
      
      if (!poolPositionsMap.has(poolAddress)) {
        poolPositionsMap.set(poolAddress, []);
      }
      poolPositionsMap.get(poolAddress)!.push(position);
    }
    
    // Check drawdowns for each pool
    let anyTriggered = false;
    for (const [poolAddressStr, poolPositions] of poolPositionsMap.entries()) {
      console.log(`Checking drawdown for pool: ${poolAddressStr} with ${poolPositions.length} positions`);
      
      const poolAddress = new PublicKey(poolAddressStr);
      const triggered = await this.checkDrawdown(poolAddress, 15); // 15% drawdown threshold
      
      if (triggered) {
        console.log(`⚠️ Circuit breaker triggered for pool: ${poolAddressStr}`);
        anyTriggered = true;
      } else {
        console.log(`✅ No drawdown detected for pool: ${poolAddressStr}`);
      }
    }
    
    if (anyTriggered) {
      this.lastAdjustmentTime = Date.now();
      console.log(`Updated last adjustment time to: ${new Date(this.lastAdjustmentTime).toISOString()}`);
    }
  }

  /**
   * Checks for drawdowns in a specific pool
   */
  public async checkDrawdown(poolAddress: PublicKey, thresholdPercent: number): Promise<boolean> {
    const positionsMap = await this.getUserPositions();
    const positions = Array.from(positionsMap.values());
    
    let anyTriggered = false;
    
    for (const position of positions) {
      // Verify position belongs to target pool
      const positionPoolAddress = position.publicKey.toString();
      console.log(`Comparing position pool ${positionPoolAddress} with target pool ${poolAddress.toString()}`);
      
      if (positionPoolAddress !== poolAddress.toString()) {
        console.log('Position is for a different pool, skipping');
        continue;
      }
      
      console.log(`Checking drawdown for position in pool: ${poolAddress.toString()}`);
      const currentValue = await this.calculatePositionValue(position);
      console.log(`Current position value: $${currentValue.toFixed(2)}`);
      
      const positionKey = position.publicKey.toBase58();

      // Record per-position snapshot
      await this.snapshotService.recordSnapshot(positionKey, {
        value: currentValue,
        timestamp: Date.now()
      });
      
      // Update position storage with latest value
      const storedPosition = this.positionStorage.getPositionRange(position.publicKey);
      if (storedPosition) {
        // Update existing position with new value
        this.positionStorage.addPosition(position.publicKey, {
          ...storedPosition,
          snapshotPositionValue: currentValue
        });
        console.log(`Updated position ${positionKey} value to $${currentValue.toFixed(2)}`);
      } else {
        // If position not in storage yet, add it with basic info
        const binIds = position.lbPairPositionsData[0].positionData.positionBinData.map(b => Number(b.binId));
        const minBinId = Math.min(...binIds);
        const maxBinId = Math.max(...binIds);
        
        this.positionStorage.addPosition(position.publicKey, {
          originalActiveBin: 0, // We don't know this, but can set it to 0 or fetch it
          minBinId,
          maxBinId,
          snapshotPositionValue: currentValue
        });
        console.log(`Added new position ${positionKey} to storage with value $${currentValue.toFixed(2)}`);
      }

      // Check individual position drawdown
      const peakValue = await this.snapshotService.getPeakValue(
        positionKey,
        Date.now() - 30 * 60 * 1000
      );
      
      console.log(`Peak position value in last 30 minutes: $${peakValue.toFixed(2)}`);

      if (peakValue > 0) {
        const drawdownPercent = ((peakValue - currentValue) / peakValue) * 100;
        console.log(`Drawdown percentage: ${drawdownPercent.toFixed(2)}%`);
        
        if (drawdownPercent >= thresholdPercent) {
          console.log(`⚠️ Drawdown threshold exceeded: ${drawdownPercent.toFixed(2)}% > ${thresholdPercent}%`);
          anyTriggered = true;
          await this.adjustSinglePosition(position, 5000); // 50% reduction
        } else {
          console.log(`✅ Drawdown within acceptable range: ${drawdownPercent.toFixed(2)}% < ${thresholdPercent}%`);
        }
      } else {
        console.log('No peak value found, position may be new');
      }
    }

    return anyTriggered;
  }

  private async adjustSinglePosition(position: PositionInfo, bpsToRemove: number): Promise<void> {
    try {
      // Get the DLMM instance for this position's pool
      const poolAddress = position.publicKey;
      
      if (!poolAddress) {
        console.error('Pool address not found in position data');
        return;
      }
      
      const dlmm = await this.getDLMMInstance(poolAddress);
      
      // Get all bin IDs from the position
      const bins = position.lbPairPositionsData[0].positionData.positionBinData.map(b => 
        Number(b.binId)
      );
      
      // Get the full range of bins
      const binIdsToRemove = this.getFullBinRange(bins);
      
      // Create the remove liquidity transaction
      const txOrTxs = await dlmm.removeLiquidity({
        user: this.wallet.publicKey,
        position: position.publicKey,
        bps: new BN(bpsToRemove),
        binIds: binIdsToRemove
      });
      
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

      // After successful adjustment, update the position value
      const newValue = await this.calculatePositionValue(position);
      const storedPosition = this.positionStorage.getPositionRange(position.publicKey);
      
      if (storedPosition) {
        this.positionStorage.addPosition(position.publicKey, {
          ...storedPosition,
          snapshotPositionValue: newValue
        });
        console.log(`Updated position ${position.publicKey.toBase58()} value to $${newValue.toFixed(2)} after adjustment`);
      }
      
      console.log(`Reduced position ${position.publicKey.toString()} by ${bpsToRemove/100}%`);
    } catch (error) {
      console.error('Error adjusting position:', error);
      throw error;
    }
  }

  public async adjustPositionSize(bpsToRemove: number): Promise<void> {
    const positionsMap = await this.getUserPositions();
    const positions = Array.from(positionsMap.values());
    
    if (!positions.length) return;
    
    for (const position of positions) {
      await this.adjustSinglePosition(position, bpsToRemove);
    }
  }

  public async checkVolumeDrop(threshold: number): Promise<boolean> {
    const positionsMap = await this.getUserPositions();
    const positions = Array.from(positionsMap.values());
    
    if (!positions || positions.length === 0) return false;
    
    // Check volume for each token in positions
    for (const position of positions) {
      const tokenMint = position.tokenX.publicKey.toBase58();
      const metrics = await fetchTokenMetrics('solana', tokenMint);
      const volumeMA = await this.calculateVolumeMA(tokenMint);
      
      if (metrics.volumeMcapRatio < volumeMA * threshold) {
        return true; // Volume drop detected for at least one token
      }
    }
    
    return false;
  }

  public async closeAllPositions(): Promise<void> {
    const positionsMap = await this.getUserPositions();
    const positions = Array.from(positionsMap.values());
    
    if (!positions || positions.length === 0) return;
    
    for (const position of positions) {
      try {
        const poolAddress = position.publicKey;
        
        if (!poolAddress) {
          console.error('Pool address not found in position data');
          continue;
        }
        
        const dlmm = await this.getDLMMInstance(poolAddress);
        
        // Close the position completely
        const txOrTxs = await dlmm.closePosition({
          owner: this.wallet.publicKey,
          position: position.lbPairPositionsData[0]  // Use the LbPosition object
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
        
        console.log(`Closed position ${position.publicKey.toString()}`);
        
        // After successful closure, remove the position from storage
        this.positionStorage.removePosition(position.publicKey);
        console.log(`Removed position ${position.publicKey.toBase58()} from storage after closing`);
        
      } catch (error) {
        console.error(`Error closing position ${position.publicKey.toString()}:`, error);
      }
    }
  }

  private async calculateVolumeMA(tokenMint: string): Promise<number> {
    try {
      // Get last 6 hours of data
      const endTime = Date.now();
      const startTime = endTime - 6 * 3600 * 1000;
      
      // Real implementation would call:
      // const history = await fetchVolumeHistory(tokenMint, startTime, endTime);
      const history = MOCK_VOLUME_DATA; // Remove for production
      
      if (history.length === 0) {
        console.warn('No volume data available');
        return 0;
      }

      // Calculate simple moving average
      const sum = history.reduce((acc, entry) => acc + entry.volume, 0);
      return sum / history.length;
      
    } catch (error) {
      console.error('Volume MA calculation failed:', error);
      return 0; // Fail-safe return
    }
  }

  private async calculatePositionValue(position: PositionInfo): Promise<number> {
    try {
      // The position's lbPair should have a publicKey property that refers to the pool
      const poolAddress = position.publicKey;
      
      if (!poolAddress) {
        console.error('Pool address not found in position data');
        return 0;
      }
      
      const dlmm = await this.getDLMMInstance(poolAddress);
      
      // Get the active bin to determine current price
      const { activeBin, bins } = await dlmm.getBinsAroundActiveBin(0, 0);
      const activeBinData = bins[0];
      
      const [solPrice] = await Promise.all([
        this.getSOLPrice()
      ]);

      const lbPosition = position.lbPairPositionsData[0];
      const { tokenX, tokenY } = position;

      // Convert amounts using token decimals
      const xAmount = Number(lbPosition.positionData.totalXAmount) / 10 ** tokenX.decimal;
      const yAmount = Number(lbPosition.positionData.totalYAmount) / 10 ** tokenY.decimal;
       
      // Convert price from BN to number
      const pricePerToken = Number(activeBinData.price) / 
        (10 ** (tokenX.decimal + tokenY.decimal));

      return (xAmount * pricePerToken) + (yAmount * solPrice);
    } catch (error) {
      console.error('Error calculating position value:', error);
      return 0;
    }
  }

  private async getSOLPrice(): Promise<number> {
    const solPriceStr = await FetchPrice(process.env.SOL_Price_ID as string);
    const solPriceNumber = parseFloat(solPriceStr);
    console.log(`Fetched current Solana Price: ${solPriceStr}`);
    return solPriceNumber;
  }

  private getFullBinRange(bins: number[]): number[] {
    const min = Math.min(...bins);
    const max = Math.max(...bins);
    const fullRange: number[] = [];
    for (let i = min; i <= max; i++) {
      fullRange.push(i);
    }
    return fullRange;
  }
}
