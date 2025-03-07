import { PublicKey, Connection, Keypair, ComputeBudgetProgram, sendAndConfirmTransaction } from '@solana/web3.js';
import { Config } from './models/Config';
import { PositionStorage } from './utils/PositionStorage';
import DLMM, { PositionInfo, StrategyType, StrategyParameters } from '@meteora-ag/dlmm';
import { BN } from '@coral-xyz/anchor';
import { FetchPrice } from './utils/fetch_price';

export class RebalanceManager {
  private connection: Connection;
  private wallet: Keypair;
  private config: Config;
  private positionStorage: PositionStorage;
  private lastRebalanceTime: Record<string, number> = {};
  private COOLDOWN_PERIOD = .25 * 60 * 60 * 1000; // 6 hours in milliseconds
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
        
        const now = Date.now();
        const lastRebalance = this.lastRebalanceTime[poolAddressStr] || 0;
        if (now - lastRebalance < this.COOLDOWN_PERIOD) {
          console.log(`Skipping rebalance for pool ${poolAddressStr}, cooldown period not elapsed`);
          continue;
        }
        
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
        
        this.lastRebalanceTime[poolAddressStr] = now;
      }
      
    } catch (error) {
      console.error('Error checking positions for rebalancing:', error);
    }
  }

  /**
   * Closes all positions in a specific pool and creates new single-sided positions
   */
  private async closeAllPositionsInPool(poolAddress: PublicKey, positions: PositionInfo[]): Promise<void> {
    try {
      console.log(`Closing all positions in pool ${poolAddress.toString()}...`);
      
      const dlmm = await this.getDLMMInstance(poolAddress);
      
      // Get current active bin
      const activeBin = await dlmm.getActiveBin();
      const activeBinId = activeBin.binId;
      
      for (const position of positions) {
        const positionKey = position.publicKey.toString();
        console.log(`Closing position ${positionKey}...`);
        
        try {
          // Store position data for recreating later
          const storedPosition = this.positionStorage.getPositionRange(position.publicKey);
          let singleSidedX: boolean;
          
          if (storedPosition) {
            // Determine if we should create X or Y single-sided position
            if (activeBinId < storedPosition.minBinId) {
              // Active bin is below min bin - we hold X tokens
              singleSidedX = true;
              console.log(`Active bin ${activeBinId} < min bin ${storedPosition.minBinId}, will create X-sided position`);
            } else {
              // Active bin is above max bin - we hold Y tokens (SOL)
              singleSidedX = false;
              console.log(`Active bin ${activeBinId} > max bin ${storedPosition.maxBinId}, will create Y-sided position`);
            }
          } else {
            // Default to X-sided if no stored position data
            singleSidedX = true;
            console.log(`No stored position data, defaulting to X-sided position`);
          }
          
          // Store token amounts before removing liquidity
          const positionData = position.lbPairPositionsData[0].positionData;
          const totalXAmount = positionData.totalXAmount;
          const totalYAmount = positionData.totalYAmount;
          console.log(`Position has ${totalXAmount.toString()} X tokens and ${totalYAmount.toString()} Y tokens`);
          
          // 1. Remove liquidity
          console.log(`Removing liquidity from position ${positionKey}...`);
          
          // Get all bin IDs from the position
          const binIds = positionData.positionBinData.map(b => Number(b.binId));
          
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
          
          // 4. Create new single-sided position
          if (singleSidedX) {
            // Use the X amount from the position we just closed
            await this.createSingleSidePosition(dlmm, poolAddress, true, new BN(totalXAmount.toString()), new BN(0));
          } else {
            // Use 1 SOL for Y-sided position
            const oneSol = new BN(1_000_000_000); // 1 SOL in lamports
            await this.createSingleSidePosition(dlmm, poolAddress, false, new BN(0), oneSol);
          }
          
        } catch (error) {
          console.error(`Error closing position ${positionKey}:`, error);
        }
      }
      
    } catch (error) {
      console.error(`Error closing positions in pool ${poolAddress.toString()}:`, error);
    }
  }

  /**
   * Creates a new single-sided position
   */
  private async createSingleSidePosition(
    dlmm: DLMM, 
    poolAddress: PublicKey, 
    singleSidedX: boolean,
    totalXAmount: BN = new BN(0),
    totalYAmount: BN = new BN(0)
  ): Promise<void> {
    try {
      console.log(`Creating new single-sided position (${singleSidedX ? 'X' : 'Y'}-sided) in pool ${poolAddress.toString()}...`);
      
      // Get current active bin
      const activeBin = await dlmm.getActiveBin();
      const activeBinId = activeBin.binId;
      
      // Calculate bin range
      const totalRangeInterval = 69;
      let minBinId: number;
      let maxBinId: number;
      
      if (singleSidedX) {
        // For X-sided positions, set range above active bin
        minBinId = activeBinId;
        maxBinId = activeBinId + totalRangeInterval;
        console.log(`Using ${totalXAmount.toString()} X tokens for new position`);
      } else {
        // For Y-sided positions, set range below active bin
        minBinId = activeBinId - totalRangeInterval;
        maxBinId = activeBinId;
        console.log(`Using ${totalYAmount.toString()} Y tokens (1 SOL) for new position`);
      }
      
      console.log(`New position bin range: [${minBinId}, ${maxBinId}]`);
      
      // Create strategy parameters
      const strategy: StrategyParameters = {
        minBinId,
        maxBinId,
        strategyType: StrategyType.BidAskImBalanced,
        singleSidedX
      };
      
      // Generate new position keypair
      const newPositionKeypair = Keypair.generate();
      
      // Create the new position
      const createTx = await dlmm.initializePositionAndAddLiquidityByStrategy({
        positionPubKey: newPositionKeypair.publicKey,
        totalXAmount,
        totalYAmount,
        strategy,
        user: this.wallet.publicKey
      });
      
      // Add priority fee
      createTx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 30000 }));
      
      // Set recent blockhash
      const { blockhash } = await this.connection.getLatestBlockhash('finalized');
      createTx.recentBlockhash = blockhash;
      createTx.feePayer = this.wallet.publicKey;
      
      // Sign and send
      const signature = await sendAndConfirmTransaction(
        this.connection, createTx, [this.wallet, newPositionKeypair], 
        { skipPreflight: false, commitment: 'confirmed' }
      );
      console.log('Create Position Transaction Signature:', signature);
      
      // Wait for the transaction to be confirmed and position to be created
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Get the position info to calculate its value
      const positionsMap = await this.getUserPositions();
      const newPosition = positionsMap.get(newPositionKeypair.publicKey.toString());
      
      let positionValue = 0;
      if (newPosition) {
        positionValue = await this.calculatePositionValue(newPosition);
        console.log(`New position value: $${positionValue.toFixed(2)}`);
      } else {
        console.log('New position not found in user positions, using default value 0');
      }
      
      // Add new position to storage
      this.positionStorage.addPosition(newPositionKeypair.publicKey, {
        originalActiveBin: activeBinId,
        minBinId,
        maxBinId,
        snapshotPositionValue: positionValue
      });
      
      console.log(`New position created: ${newPositionKeypair.publicKey.toString()}`);
      
    } catch (error) {
      console.error(`Error creating single-sided position:`, error);
    }
  }

  /**
   * Calculates the value of a position in USD
   */
  public async calculatePositionValue(position: PositionInfo): Promise<number> {
    try {
      // The position's publicKey refers to the pool
      const poolAddress = position.publicKey;
      
      if (!poolAddress) {
        console.error('Pool address not found in position data');
        return 0;
      }
      
      const dlmm = await this.getDLMMInstance(poolAddress);
      
      // Get the active bin to determine current price
      const activeBinData = await dlmm.getActiveBin();
      console.log(`Pool ${poolAddress.toString()} - Active bin: ${activeBinData.binId}, Price: ${activeBinData.price.toString()}`);
      
      // Use pricePerToken which should be correctly formatted
      const pricePerToken = Number(activeBinData.pricePerToken);
      console.log(`Price per token: $${pricePerToken}`);
      
      const solPrice = await this.getSOLPrice();

      const lbPosition = position.lbPairPositionsData[0];
      console.log(`Position data - X amount: ${lbPosition.positionData.totalXAmount.toString()}, Y amount: ${lbPosition.positionData.totalYAmount.toString()}`);
      
      const { tokenX, tokenY } = position;
      console.log(`Token decimals - X: ${tokenX.decimal}, Y: ${tokenY.decimal}`);

      // Convert amounts using token decimals
      const xAmount = Number(lbPosition.positionData.totalXAmount) / 10 ** tokenX.decimal;
      const yAmount = Number(lbPosition.positionData.totalYAmount) / 10 ** tokenY.decimal;
      console.log(`Converted amounts - X: ${xAmount}, Y: ${yAmount}`);
       
      // Calculate token values
      let totalValue = 0;
      
      // If Y is SOL
      if (tokenY.publicKey.toString() === 'So11111111111111111111111111111111111111112') {
        // X value in USD = X amount * price per token * SOL price in USD
        const xValueInUsd = xAmount * pricePerToken * solPrice;
        // Y value in USD = Y amount * SOL price in USD
        const yValueInUsd = yAmount * solPrice;
        
        console.log(`Value calculation - X value: $${xValueInUsd.toFixed(4)}, Y value: $${yValueInUsd.toFixed(4)}`);
        totalValue = xValueInUsd + yValueInUsd;
      } 
      // If X is SOL
      else if (tokenX.publicKey.toString() === 'So11111111111111111111111111111111111111112') {
        // X value in USD = X amount * SOL price in USD
        const xValueInUsd = xAmount * solPrice;
        // Y value in USD = Y amount / price per token * SOL price in USD
        const yValueInUsd = yAmount / pricePerToken * solPrice;
        
        console.log(`Value calculation - X value: $${xValueInUsd.toFixed(4)}, Y value: $${yValueInUsd.toFixed(4)}`);
        totalValue = xValueInUsd + yValueInUsd;
      }
      // For other token pairs, we would need external price data
      else {
        console.log('Non-SOL pair detected, using placeholder values');
        // Placeholder calculation
        totalValue = (xAmount + yAmount) * 1.0;
      }
      
      console.log(`Total position value: $${totalValue.toFixed(4)}`);
      
      return totalValue;
    } catch (error) {
      console.error('Error calculating position value:', error);
      return 0;
    }
  }

  /**
   * Gets the current SOL price
   */
  private async getSOLPrice(): Promise<number> {
    try {
      // Use the same method as RiskManager
      const solPriceStr = await FetchPrice(process.env.SOL_Price_ID as string);
      const solPriceNumber = parseFloat(solPriceStr);
      console.log(`Fetched current Solana Price: ${solPriceStr}`);
      return solPriceNumber;
    } catch (error) {
      console.error('Error fetching SOL price:', error);
      // Fallback price if fetch fails
      return 100.0;
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