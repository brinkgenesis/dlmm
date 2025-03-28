import { PublicKey, Connection, Keypair, ComputeBudgetProgram, sendAndConfirmTransaction } from '@solana/web3.js';
import { Config } from './models/Config';
import { PositionStorage } from './utils/PositionStorage';
import DLMM, { PositionInfo, PositionData, LbPosition, StrategyType, StrategyParameters } from '@meteora-ag/dlmm';
import BN from 'bn.js';
import { FetchPrice } from './utils/fetch_price';
import { withSafeKeypair } from './utils/walletHelper';
import fs from 'fs';

export class RebalanceManager {
  private connection: Connection;
  private wallet: Keypair;
  private config: Config;
  private positionStorage: PositionStorage;
  private lastRebalanceTime: Record<string, number> = {};
  private COOLDOWN_PERIOD = .25 * 60 * 60 * 1000; // 1.5 hours in milliseconds
  private dlmmInstances: Map<string, DLMM> = new Map();

  constructor(
    connection: Connection,
    wallet: Keypair,
    config: Config,
    positionStorage?: PositionStorage
  ) {
    this.connection = connection;
    this.wallet = wallet;
    this.config = config;
    this.positionStorage = positionStorage || new PositionStorage(config);
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
    try {
      // Get all positions for the wallet
      const positions = await DLMM.getAllLbPairPositionsByUser(
        this.connection,
        this.wallet.publicKey
      );
      
      console.log(`Found ${positions.size} positions for wallet ${this.wallet.publicKey.toString()}`);
      
      return positions;
    } catch (error) {
      console.error('Error getting user positions:', error);
      return new Map();
    }
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
      
      // Clean up stale positions in storage
      const activePositionKeys: PublicKey[] = [];
      positions.forEach(position => {
        position.lbPairPositionsData.forEach(lbPosition => {
          activePositionKeys.push(lbPosition.publicKey);
        });
      });
      this.positionStorage.cleanupStalePositions(activePositionKeys);
      
      // Group positions by pool address (still needed for DLMM instances)
      const poolPositionsMap = new Map<string, PositionInfo[]>();
      
      for (const position of positions) {
        const poolAddress = position.publicKey.toString();
        
        if (!poolPositionsMap.has(poolAddress)) {
          poolPositionsMap.set(poolAddress, []);
        }
        poolPositionsMap.get(poolAddress)!.push(position);
      }
      
      // Process each position individually
      for (const [poolAddressStr, poolPositions] of poolPositionsMap.entries()) {
        const poolAddress = new PublicKey(poolAddressStr);
        console.log(`\nChecking pool: ${poolAddressStr}`);
        
        // Get DLMM instance for this pool
        const dlmm = await this.getDLMMInstance(poolAddress);
        
        // Get current active bin
        const activeBin = await dlmm.getActiveBin();
        const activeBinId = activeBin.binId;
        console.log(`Pool ${poolAddressStr} - Active bin: ${activeBinId}`);
        
        // Check each position individually
        for (const position of poolPositions) {
          // For each LbPosition in this PositionInfo
          for (const lbPosition of position.lbPairPositionsData) {
            const positionKey = lbPosition.publicKey.toString();
            
            console.log(`\n==========================================`);
            console.log(`Checking position ${positionKey} in pool ${poolAddressStr}`);
            console.log(`Position details:`);
            console.log(`  Pool address: ${poolAddressStr}`);
            console.log(`  Position key: ${positionKey}`);
            console.log(`  Lower bin: ${lbPosition.positionData.lowerBinId}`);
            console.log(`  Upper bin: ${lbPosition.positionData.upperBinId}`);
            console.log(`==========================================\n`);
            
            // Check position cooldown
            const now = Date.now();
            const lastRebalance = this.lastRebalanceTime[positionKey] || 0;
            if (now - lastRebalance < this.COOLDOWN_PERIOD) {
              console.log(`Skipping rebalance for position ${positionKey}, cooldown period not elapsed`);
              continue;
            }
            
            // Get stored position data from positions.json
            const storedPosition = this.positionStorage.getPositionRange(lbPosition.publicKey);
            
            if (storedPosition) {
              console.log(`Position ${positionKey} - Min: ${storedPosition.minBinId}, Max: ${storedPosition.maxBinId}`);
              
              // Check if active bin is outside position range
              console.log(`Checking if bin ${activeBinId} is outside range [${storedPosition.minBinId}, ${storedPosition.maxBinId}]`);
              console.log(`Condition check: ${activeBinId < storedPosition.minBinId || activeBinId > storedPosition.maxBinId}`);
              
              if (activeBinId < storedPosition.minBinId || activeBinId > storedPosition.maxBinId) {
                console.log(`⚠️ Range breach detected for position ${positionKey}`);
                console.log(`Active bin ${activeBinId} is outside range [${storedPosition.minBinId}, ${storedPosition.maxBinId}]`);
                
                // Rebalance this specific position only
                await this.closeAndRebalancePosition(dlmm, poolAddress, lbPosition);
                
                // Update last rebalance time for this position
                this.lastRebalanceTime[positionKey] = now;
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
              console.log(`Position ${positionKey} not found in storage, adding it...`);
              
              // Create new position info
              const newPositionInfo = {
                originalActiveBin: activeBinId,
                minBinId: lbPosition.positionData.lowerBinId,
                maxBinId: lbPosition.positionData.upperBinId,
                snapshotPositionValue: await this.calculatePositionValue(position)
              };
              
              // Store the position
              this.positionStorage.addPosition(
                lbPosition.publicKey,
                newPositionInfo
              );
              
              console.log(`Added position to storage: Min: ${newPositionInfo.minBinId}, Max: ${newPositionInfo.maxBinId}`);
            }
          }
        }
      }
      
      // At the end of checkAndRebalancePositions
      console.log(`Rebalance check completed at ${new Date().toISOString()}`);
      fs.writeFileSync('./last_rebalance_check.txt', new Date().toISOString());
    } catch (error) {
      console.error('Error checking positions for rebalancing:', error);
    }
  }

  /**
   * Closes and rebalances a single position
   */
  private async closeAndRebalancePosition(
    dlmm: DLMM, 
    poolAddress: PublicKey, 
    lbPosition: LbPosition
  ): Promise<void> {
    try {
      const positionKey = lbPosition.publicKey.toString();
      console.log(`Closing position ${positionKey}...`);
      
      // Declare the new position keypair at the top of the function
      let newPositionKeypair: Keypair | undefined;
      
      // Store position data for recreating later
      const storedPosition = this.positionStorage.getPositionRange(lbPosition.publicKey);
      let singleSidedX: boolean;
      
      // Get current active bin
      const activeBin = await dlmm.getActiveBin();
      const activeBinId = activeBin.binId;
      
      // Determine new position range based on active bin
      let newMinBinId: number;
      let newMaxBinId: number;
      
      // Determine if we should create X-sided or Y-sided position
      if (storedPosition) {
        // If we have stored position data, use it to determine
        if (activeBinId < storedPosition.minBinId) {
          console.log(`Active bin ${activeBinId} < min bin ${storedPosition.minBinId}, will create X-sided position`);
          singleSidedX = true;
          newMinBinId = activeBinId;
          newMaxBinId = activeBinId + 69; // Use same range size
        } else if (activeBinId > storedPosition.maxBinId) {
          console.log(`Active bin ${activeBinId} > max bin ${storedPosition.maxBinId}, will create Y-sided position`);
          singleSidedX = false;
          newMinBinId = activeBinId - 69; // Use same range size
          newMaxBinId = activeBinId;
        } else {
          console.log(`Active bin ${activeBinId} is within range [${storedPosition.minBinId}, ${storedPosition.maxBinId}], skipping rebalance`);
          return; // Skip this position as it's in range
        }
      } else {
        // Default to X-sided if we don't have stored data
        console.log(`No stored position data, defaulting to X-sided position`);
        singleSidedX = true;
        newMinBinId = activeBinId;
        newMaxBinId = activeBinId + 69;
      }
      
      // Get token amounts before removing liquidity
      const posData = lbPosition.positionData;
      const totalXAmount = posData.totalXAmount;
      const totalYAmount = posData.totalYAmount;
      console.log(`Position has ${totalXAmount} X tokens and ${totalYAmount} Y tokens`);
      
      // Log more details about the position - Fix position key confusion
      console.log(`Position details - CORRECTED KEY:`);
      console.log(`  Pool address: ${poolAddress.toString()}`);
      console.log(`  Position key: ${positionKey}`);
      console.log(`  Lower bin: ${lbPosition.positionData.lowerBinId}`);
      console.log(`  Upper bin: ${lbPosition.positionData.upperBinId}`);
      console.log(`  X amount: ${totalXAmount.toString()}`);
      console.log(`  Y amount: ${totalYAmount.toString()}`);
      
      // Remove liquidity and close position
      console.log(`Removing liquidity and closing position ${positionKey}...`);
      try {
        // Get all bin IDs with liquidity
        console.log(`Getting bin IDs with liquidity...`);
        const positionBinData = lbPosition.positionData.positionBinData;
        const binIds = positionBinData.map(bin => bin.binId);
        console.log(`Found ${binIds.length} bins with liquidity: ${binIds.join(', ')}`);
        
        if (binIds.length > 0) {
          // Remove liquidity from all bins and close position
          const removeLiquidityTx = await dlmm.removeLiquidity({
            position: lbPosition.publicKey,
            binIds: binIds,
            bps: new BN('10000'), // Use string '10000' instead of number 10000
            user: this.wallet.publicKey,
            shouldClaimAndClose: true // Close the position after removing liquidity
          });
          
          // Handle both single transaction and array of transactions
          const txsToSend = Array.isArray(removeLiquidityTx) ? removeLiquidityTx : [removeLiquidityTx];
          
          for (const tx of txsToSend) {
            // Log the transaction instructions to identify duplicates
            console.log(`Transaction has ${tx.instructions.length} instructions`);
            
            // Create a map to track duplicate instructions
            const instructionMap = new Map();
            
            tx.instructions.forEach((ix, index) => {
              // Create a simple hash of the instruction for comparison
              const ixHash = `${ix.programId.toString()}-${ix.data.slice(0, 8).toString('hex')}`;
              
              if (instructionMap.has(ixHash)) {
                console.log(`⚠️ Potential duplicate instruction found at index ${index}:`);
                console.log(`  First occurrence at index ${instructionMap.get(ixHash)}`);
                console.log(`  Program: ${ix.programId.toString()}`);
                console.log(`  Data prefix: ${ix.data.slice(0, 8).toString('hex')}`);
                
                // Remove the duplicate instruction
                console.log(`  Removing duplicate instruction at index ${index}`);
                tx.instructions.splice(index, 1);
              } else {
                instructionMap.set(ixHash, index);
              }
            });
            
            // Add priority fee - increase compute units and price
            // Check if compute budget instructions already exist
            const computeBudgetProgramId = ComputeBudgetProgram.programId.toString();
            const hasComputeBudgetInstructions = tx.instructions.some(ix => 
              ix.programId.toString() === computeBudgetProgramId
            );
            
            if (!hasComputeBudgetInstructions) {
              console.log('Adding compute budget instructions');
              tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }));
            } else {
              console.log('Compute budget instructions already present, skipping');
            }
          }

          // Set recent blockhash
          const { blockhash } = await this.connection.getLatestBlockhash('finalized');
          for (const tx of txsToSend) {
            tx.recentBlockhash = blockhash;
            tx.feePayer = this.wallet.publicKey;
            
            // Use withSafeKeypair here
            const signature = await withSafeKeypair(this.config, async (keypair) => {
              return sendAndConfirmTransaction(
                this.connection, tx, [keypair], 
                { skipPreflight: false, commitment: 'confirmed' }
              );
            });
            console.log('Remove Liquidity and Close Position Transaction Signature:', signature);
          }
          
          // Remove from storage
          if (typeof positionKey === 'string') {
            // Convert string to PublicKey
            this.positionStorage.removePosition(new PublicKey(positionKey));
          } else {
            // Already a PublicKey
            this.positionStorage.removePosition(positionKey);
          }
          console.log(`Removed position ${positionKey.toString()} from position storage`);
          
          // Initialize the keypair here
          newPositionKeypair = Keypair.generate();
          
          // Create new single-sided position
          if (singleSidedX) {
            // Use the X amount from the position we just closed
            const xAmountParts = totalXAmount.toString().split('.');
            const xAmountInteger = xAmountParts[0]; // Just take the integer part
            console.log(`Using integer X amount: ${xAmountInteger}`);
            await this.createSingleSidePosition(dlmm, poolAddress, true, new BN(xAmountInteger), new BN('0'));
          } else {
            // Use the Y amount from the position we just closed
            const yAmountParts = totalYAmount.toString().split('.');
            const yAmountInteger = yAmountParts[0]; // Just take the integer part
            console.log(`Using integer Y amount: ${yAmountInteger}`);
            await this.createSingleSidePosition(dlmm, poolAddress, false, new BN('0'), new BN(yAmountInteger));
          }
        } else {
          console.log(`No bins with liquidity found for position ${positionKey}`);
        }
      } catch (error) {
        console.error(`Error closing position ${positionKey}:`, error);
      }
      
      // Check if we successfully created a new position
      if (!newPositionKeypair) {
        console.error('Failed to create new position keypair');
        return;
      }
      
      // Now newPositionKeypair is in scope and we've confirmed it exists
      const positionsMap = await this.getUserPositions();
      const newPosition = positionsMap.get(newPositionKeypair.publicKey.toString());
      
      let positionValue = 0;
      if (newPosition) {
        positionValue = await this.calculatePositionValue(newPosition);
        console.log(`New position value: $${positionValue.toFixed(2)}`);
      } else {
        console.log('New position not found in user positions, using default value 0');
      }
      
      // Before transfer operation
      console.log(`REBALANCE: About to transfer history from ${positionKey} to ${newPositionKeypair.publicKey.toString()}`);
      console.log(`REBALANCE: Original startingPositionValue: ${
        storedPosition?.startingPositionValue || 'undefined'
      }`);
      
      // Transfer position history
      this.positionStorage.transferPositionHistory(
        lbPosition.publicKey,
        newPositionKeypair.publicKey,
        {
          originalActiveBin: activeBinId,
          minBinId: newMinBinId,
          maxBinId: newMaxBinId,
          snapshotPositionValue: positionValue,
          poolAddress: poolAddress.toString()
        }
      );
      
      // After transfer
      console.log(`REBALANCE: History transfer complete`);
      
    } catch (error) {
      console.error(`Error processing position:`, error);
    }
  }

  /**
   * Creates a new single-sided position
   */
  public async createSingleSidePosition(
    dlmm: DLMM, 
    poolAddress: PublicKey, 
    singleSidedX: boolean,
    totalXAmount: BN = new BN('0'),
    totalYAmount: BN = new BN('0')
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
      
      // Use withSafeKeypair here
      const signature = await withSafeKeypair(this.config, async (keypair) => {
        return sendAndConfirmTransaction(
          this.connection, createTx, [this.wallet, newPositionKeypair], 
          { skipPreflight: false, commitment: 'confirmed' }
        );
      });
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
      
      // Add new position to storage with pool address
      this.positionStorage.addPosition(newPositionKeypair.publicKey, {
        originalActiveBin: activeBinId,
        minBinId,
        maxBinId,
        snapshotPositionValue: positionValue,
        poolAddress: poolAddress.toString()
      });
      
      console.log(`New position created: ${newPositionKeypair.publicKey.toString()}`);
      
    } catch (error) {
      console.error(`Error creating single-sided position:`, error);
    }
  }

  /**
   * Calculates the USD value of a position based on token amounts and current prices
   */
  public async calculatePositionValue(position: PositionInfo): Promise<number> {
    try {
      // Check if we're already calculating this position (to prevent recursion)
      const poolAddress = position.publicKey.toString();
      
      // Get the active bin price information for the position's pool
      const dlmm = await DLMM.create(this.connection, position.publicKey);
      const activeBinData = await dlmm.getActiveBin();
      console.log(`Pool ${poolAddress} - Active bin: ${activeBinData.binId}, Price: ${activeBinData.price.toString()}`);
      
      // Get price per token
      const pricePerToken = Number(activeBinData.pricePerToken);
      
      // Get SOL price from Pyth
      const solPriceStr = await FetchPrice(process.env.SOL_Price_ID as string);
      const solPrice = parseFloat(solPriceStr);
      console.log(`Current SOL Price: $${solPrice}`);

      // Extract position amounts
      const lbPosition = position.lbPairPositionsData[0];
      if (!lbPosition || !lbPosition.positionData) {
        console.error('Invalid position data structure');
        return 0;
      }

      // Convert amounts using token decimals
      const { tokenX, tokenY } = position;
      const xAmount = Number(lbPosition.positionData.totalXAmount) / 10 ** tokenX.decimal;
      const yAmount = Number(lbPosition.positionData.totalYAmount) / 10 ** tokenY.decimal;
      console.log(`Position amounts - X: ${xAmount}, Y: ${yAmount}`);
       
      // Calculate value based on which token is SOL
      let totalValue = 0;
      const SOL_MINT = 'So11111111111111111111111111111111111111112';
      
      // If Y is SOL
      if (tokenY.publicKey.toString() === SOL_MINT) {
        // X value in USD = X amount * price per token * SOL price in USD
        const xValueInUsd = xAmount * pricePerToken * solPrice;
        // Y value in USD = Y amount * SOL price in USD
        const yValueInUsd = yAmount * solPrice;
        
        console.log(`Value calculation - X: $${xValueInUsd.toFixed(2)}, Y: $${yValueInUsd.toFixed(2)}`);
        totalValue = xValueInUsd + yValueInUsd;
      } 
      // If X is SOL
      else if (tokenX.publicKey.toString() === SOL_MINT) {
        // X value in USD = X amount * SOL price in USD
        const xValueInUsd = xAmount * solPrice;
        // Y value in USD = Y amount / price per token * SOL price in USD
        const yValueInUsd = yAmount / pricePerToken * solPrice;
        
        console.log(`Value calculation - X: $${xValueInUsd.toFixed(2)}, Y: $${yValueInUsd.toFixed(2)}`);
        totalValue = xValueInUsd + yValueInUsd;
      }
      // For other token pairs, we would need external price data
      else {
        console.log('Non-SOL pair detected. Cannot calculate value without price data.');
        return 0;
      }
      
      console.log(`Total position value: $${totalValue.toFixed(2)}`);
      
      return totalValue;
    } catch (error) {
      console.error('Error calculating position value:', error);
      return 0;
    }
  }
}