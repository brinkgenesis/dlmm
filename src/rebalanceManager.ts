import { PublicKey, Connection, Keypair, ComputeBudgetProgram, sendAndConfirmTransaction } from '@solana/web3.js';
import { Config } from './models/Config';
import { PositionStorage } from './utils/PositionStorage';
import DLMM, { PositionInfo, PositionData, LbPosition, StrategyType, StrategyParameters } from '@meteora-ag/dlmm';
import BN from 'bn.js';
import { FetchPrice } from './utils/fetch_price';
import { withSafeKeypair } from './utils/walletHelper';
import fs from 'fs';
import { Decimal } from 'decimal.js';
import { PositionRepository } from './services/positionRepository';
import { createSingleSidePosition } from './utils/createSingleSidePosition';
import { getTokenPricesJupiter } from './utils/fetchPriceJupiter';

export class RebalanceManager {
  private connection: Connection;
  private wallet: Keypair;
  private config: Config;
  private positionStorage: PositionStorage;
  private positionRepository: PositionRepository;
  private lastRebalanceTime: Record<string, number> = {};
  private COOLDOWN_PERIOD = 0.25 * 60 * 60 * 1000; // 15 mins cooldown? (was 1.5hr)
  private dlmmInstances: Map<string, DLMM> = new Map();

  constructor(
    connection: Connection,
    wallet: Keypair,
    config: Config,
    positionStorage?: PositionStorage,
    positionRepository?: PositionRepository
  ) {
    this.connection = connection;
    this.wallet = wallet;
    this.config = config;
    this.positionStorage = positionStorage || new PositionStorage(config);
    this.positionRepository = positionRepository || new PositionRepository();
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
      const positionsMap = await this.getUserPositions();
      const activePositionKeys: PublicKey[] = [];

      if (positionsMap.size === 0) {
          console.log('No positions found on-chain for this wallet.');
          await this.positionStorage.cleanupStalePositions([]);
          return;
      }

      // Group positions by pool address string first
      const poolPositionsMap = new Map<string, LbPosition[]>();
      for (const [poolAddressStr, posInfo] of positionsMap.entries()) {
          const currentPositions = poolPositionsMap.get(poolAddressStr) || [];
          posInfo.lbPairPositionsData.forEach(lbPos => {
              currentPositions.push(lbPos);
              activePositionKeys.push(lbPos.publicKey); // Collect active keys here
          });
          poolPositionsMap.set(poolAddressStr, currentPositions);
      }

      console.log(`Found ${activePositionKeys.length} active position(s) across ${poolPositionsMap.size} pool(s).`);

      // Cleanup stale positions using keys found *on-chain*
      // Ensure cleanup uses the correct method from PositionStorage
      await this.positionStorage.cleanupStalePositions(activePositionKeys);

      // Process positions pool by pool
      // FIX: Iterate over the grouped map
      for (const [poolAddressStr, lbPositionsInPool] of poolPositionsMap.entries()) {
        const poolAddress = new PublicKey(poolAddressStr);
        console.log(`\nChecking pool: ${poolAddressStr}`);
        const dlmm = await this.getDLMMInstance(poolAddress); // Get DLMM instance per pool
        const activeBin = await dlmm.getActiveBin();
        const activeBinId = activeBin.binId;
        console.log(`Pool ${poolAddressStr} - Active bin: ${activeBinId}`);

        for (const lbPosition of lbPositionsInPool) {
           const positionKey = lbPosition.publicKey.toString();
           console.log(`\n==========================================`);
           console.log(`Checking position ${positionKey} in pool ${poolAddressStr}`);
           console.log(`Position details:`);
           console.log(`  Pool address: ${poolAddressStr}`);
           console.log(`  Position key: ${positionKey}`);
           console.log(`  Lower bin: ${lbPosition.positionData.lowerBinId}`);
           console.log(`  Upper bin: ${lbPosition.positionData.upperBinId}`);
           console.log(`==========================================\n`);

           const now = Date.now();
           const lastRebalance = this.lastRebalanceTime[positionKey] || 0;
           if (now - lastRebalance < this.COOLDOWN_PERIOD) {
             console.log(`Skipping rebalance check for position ${positionKey}, cooldown period not elapsed`);
             continue;
           }

           const storedPosition = this.positionStorage.getPositionRange(lbPosition.publicKey);
           if (!storedPosition) {
              console.warn(`Position ${positionKey} found on-chain but not in local storage after sync/cleanup. Skipping check.`);
              continue;
           }

           if (activeBinId < storedPosition.minBinId || activeBinId > storedPosition.maxBinId) {
                console.log(`⚠️ Range breach detected for position ${positionKey}`);
                console.log(`   Active bin ${activeBinId} is outside stored range [${storedPosition.minBinId}, ${storedPosition.maxBinId}]`);

                await this.closeAndRebalancePosition(dlmm, poolAddress, lbPosition);

                this.lastRebalanceTime[positionKey] = now;
            } else {
                const totalRange = storedPosition.maxBinId - storedPosition.minBinId;
                const distanceFromMin = activeBinId - storedPosition.minBinId;
                const percentageThroughRange = (distanceFromMin / totalRange) * 100;
                
                console.log(`Position ${positionKey} - ${percentageThroughRange.toFixed(2)}% through range`);
                
                if (percentageThroughRange <= 30 || percentageThroughRange >= 70) {
                  console.log(`⚠️ Position ${positionKey} is approaching range edge (${percentageThroughRange.toFixed(2)}%)`);
                }
            }
        }
      }

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
    const oldPositionKey = lbPosition.publicKey;
    const oldPositionKeyStr = oldPositionKey.toString();
    console.log(`Rebalancing position ${oldPositionKeyStr}...`);

    try {
      const oldDbPositionData = await this.positionRepository.getPositionByKey(oldPositionKeyStr);
      if (!oldDbPositionData) {
        console.error(`Cannot rebalance: DB data for old position ${oldPositionKeyStr} not found.`);
        const localData = this.positionStorage.getPositionRange(oldPositionKey);
        if (!localData){
           console.error(`Local storage data also missing for ${oldPositionKeyStr}. Aborting rebalance.`);
           return;
        }
         console.warn(`Using local storage data for ${oldPositionKeyStr} as DB data was missing.`);
         return;
      }

      let accumulatedFees = {
          totalClaimedFeeX: oldDbPositionData.total_claimed_fee_x || '0',
          totalClaimedFeeY: oldDbPositionData.total_claimed_fee_y || '0',
          totalFeeUsdClaimed: Number(oldDbPositionData.total_fee_usd_claimed || 0),
      };

      const pendingRawFeeX = lbPosition.positionData.feeX || new BN(0);
      const pendingRawFeeY = lbPosition.positionData.feeY || new BN(0);

      // FIX: Access token info directly from the DLMM instance properties
      // const { tokenX, tokenY } = await dlmm.getLbPair(); // Incorrect
      const tokenX = dlmm.tokenX;
      const tokenY = dlmm.tokenY;
      const tokenXDecimals = tokenX.decimal;
      const tokenYDecimals = tokenY.decimal;

      const prices = await getTokenPricesJupiter([tokenX.publicKey.toString(), tokenY.publicKey.toString()]);
      const tokenXPrice = prices[tokenX.publicKey.toString()] || 0;
      const tokenYPrice = prices[tokenY.publicKey.toString()] || 0;

      if (pendingRawFeeX.gtn(0) || pendingRawFeeY.gtn(0)) {
        const pendingFeeXAmount = new Decimal(pendingRawFeeX.toString()).div(new Decimal(10).pow(tokenXDecimals));
        const pendingFeeYAmount = new Decimal(pendingRawFeeY.toString()).div(new Decimal(10).pow(tokenYDecimals));
        const pendingFeesUSDValue = pendingFeeXAmount.times(tokenXPrice).plus(pendingFeeYAmount.times(tokenYPrice));

        const newTotalClaimedX = new Decimal(accumulatedFees.totalClaimedFeeX).plus(pendingFeeXAmount);
        const newTotalClaimedY = new Decimal(accumulatedFees.totalClaimedFeeY).plus(pendingFeeYAmount);
        const newTotalClaimedUSD = new Decimal(accumulatedFees.totalFeeUsdClaimed).plus(pendingFeesUSDValue);

        accumulatedFees = {
          totalClaimedFeeX: newTotalClaimedX.toString(),
          totalClaimedFeeY: newTotalClaimedY.toString(),
          totalFeeUsdClaimed: newTotalClaimedUSD.toNumber(),
        };
        console.log(`Added pending fees. New accumulated USD: ${accumulatedFees.totalFeeUsdClaimed.toFixed(4)}`);
      } else {
        console.log("No pending fees detected on closing position.");
      }

      const activeBin = await dlmm.getActiveBin();
      const activeBinId = activeBin.binId;
      let singleSidedX: boolean;
      if (activeBinId < oldDbPositionData.min_bin_id) {
        singleSidedX = true;
      } else if (activeBinId > oldDbPositionData.max_bin_id) {
        singleSidedX = false;
      } else {
        console.log(`Active bin ${activeBinId} still within DB range [${oldDbPositionData.min_bin_id}, ${oldDbPositionData.max_bin_id}]. Unexpected state. Skipping rebalance.`);
        return;
      }
      console.log(`Determined new position side: ${singleSidedX ? 'X-sided' : 'Y-sided'}`);

      console.log(`Closing old on-chain position ${oldPositionKeyStr}...`);
      const positionBinData = lbPosition.positionData.positionBinData;
      const binIds = positionBinData.map(bin => bin.binId);
      let closeSuccess = false;

      if (binIds.length > 0) {
         console.log(`Position ${oldPositionKeyStr} has ${binIds.length} bins. Attempting removeLiquidity...`);
         try {
             const removeLiquidityTx = await dlmm.removeLiquidity({
                position: oldPositionKey, binIds, bps: new BN('10000'), user: this.wallet.publicKey, shouldClaimAndClose: true
             });
             const txsToSend = Array.isArray(removeLiquidityTx) ? removeLiquidityTx : [removeLiquidityTx];
             for (const tx of txsToSend) {
                const computeBudgetProgramId = ComputeBudgetProgram.programId.toString();
                const hasComputeBudgetInstructions = tx.instructions.some(ix => ix.programId.toString() === computeBudgetProgramId);
                if (!hasComputeBudgetInstructions) {
                   tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }));
                   tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 30000 }));
                }
                const { blockhash } = await this.connection.getLatestBlockhash('finalized');
                tx.recentBlockhash = blockhash; tx.feePayer = this.wallet.publicKey;
                const signature = await withSafeKeypair(this.config, k => sendAndConfirmTransaction(this.connection, tx, [k], { skipPreflight: false, commitment: 'confirmed' }));
                console.log('Remove & Close Tx Signature:', signature);
             }
             closeSuccess = true;
         } catch (error) {
            console.error(`Error removing liquidity/closing ${oldPositionKeyStr}:`, error);
            throw error;
         }
      } else {
         console.log(`Position ${oldPositionKeyStr} has no liquidity bins. Attempting direct close...`);
         try {
            const closeTx = await dlmm.closePosition({ owner: this.wallet.publicKey, position: lbPosition });
            const computeBudgetProgramId = ComputeBudgetProgram.programId.toString();
            const hasComputeBudgetInstructions = closeTx.instructions.some(ix => ix.programId.toString() === computeBudgetProgramId);
            if (!hasComputeBudgetInstructions) {
               closeTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }));
            
            }
            const { blockhash } = await this.connection.getLatestBlockhash('finalized');
            closeTx.recentBlockhash = blockhash; closeTx.feePayer = this.wallet.publicKey;
            const signature = await withSafeKeypair(this.config, k => sendAndConfirmTransaction(this.connection, closeTx, [k], { skipPreflight: false, commitment: 'confirmed' }));
            console.log('Direct Close Tx Signature:', signature);
            closeSuccess = true;
         } catch (error) {
             console.error(`Error directly closing empty position ${oldPositionKeyStr}:`, error);
             throw error;
         }
      }
       if (!closeSuccess) {
           console.error(`Failed to close on-chain position ${oldPositionKeyStr}. Aborting rebalance.`);
           return;
       }
       console.log(`On-chain position ${oldPositionKeyStr} closed.`);

       // ---- START: New Balance Query Logic ----

       let amountToDepositLamports = new BN(0);
       let actualTokenAmountDeposited = new Decimal(0); // Track the actual token amount (not lamports)

       try {
            // Determine the mint address of the token to deposit for the new position
            const targetTokenMint = singleSidedX ? tokenX.publicKey : tokenY.publicKey;
            const targetTokenDecimals = singleSidedX ? tokenXDecimals : tokenYDecimals;
            console.log(`New position requires ${singleSidedX ? 'X' : 'Y'} token (${targetTokenMint.toString()})`);

            // Find the Associated Token Account (ATA) for the target token in the wallet
            const { getAssociatedTokenAddress } = await import('@solana/spl-token'); // Dynamic import for clarity
            const targetTokenATA = await getAssociatedTokenAddress(targetTokenMint, this.wallet.publicKey);
            console.log(`Wallet's ATA for target token: ${targetTokenATA.toString()}`);

            // Get the balance of the ATA
            const balanceResponse = await this.connection.getTokenAccountBalance(targetTokenATA);

            if (balanceResponse?.value?.uiAmount === null || balanceResponse?.value?.amount === '0') {
                 console.log(`Wallet balance for ${targetTokenMint.toString()} is zero or ATA not found. Creating new position with no deposit.`);
                 amountToDepositLamports = new BN(0);
                 actualTokenAmountDeposited = new Decimal(0);
            } else {
                 amountToDepositLamports = new BN(balanceResponse.value.amount);
                 actualTokenAmountDeposited = new Decimal(balanceResponse.value.uiAmountString ?? '0');
                 console.log(`Actual wallet balance for ${targetTokenMint.toString()}: ${actualTokenAmountDeposited.toString()} tokens (Lamports: ${amountToDepositLamports.toString()})`);

                 // Optional: Apply a small safety margin (e.g., 99.9%) if needed, though often depositing full balance is desired
                 // const safetyFactor = new Decimal('0.999');
                 // amountToDepositLamports = new BN(new Decimal(amountToDepositLamports.toString()).mul(safetyFactor).floor().toString());
                 // actualTokenAmountDeposited = new Decimal(amountToDepositLamports.toString()).div(new Decimal(10).pow(targetTokenDecimals));
                 // console.log(`Using 99.9% of balance for safety: ${actualTokenAmountDeposited.toString()} tokens (Lamports: ${amountToDepositLamports.toString()})`);
             }
       } catch (balanceError) {
            console.error(`Error querying wallet balance for ${singleSidedX ? 'X' : 'Y'} token:`, balanceError);
            console.warn(`Proceeding to create position with zero deposit due to balance query error.`);
            amountToDepositLamports = new BN(0);
            actualTokenAmountDeposited = new Decimal(0);
       }

       // ---- END: New Balance Query Logic ----

      const newPositionKeypair = Keypair.generate();
      console.log(`Creating new ${singleSidedX ? 'X' : 'Y'}-sided position ${newPositionKeypair.publicKey.toString()} with actual balance...`);

      // Create the new position using the actual balance queried
      const { positionPubKey: newPositionPubKey, minBinId: newMinBinId, maxBinId: newMaxBinId, originalActiveBin: newOriginalActiveBin } = await createSingleSidePosition(
          this.connection,
          dlmm,
          this.wallet, // Pass the signing wallet (already available as this.wallet)
          newPositionKeypair,
          amountToDepositLamports, // Use the actual queried balance
          singleSidedX
      );
      console.log(`New on-chain position created: ${newPositionPubKey.toString()}. Range: [${newMinBinId}, ${newMaxBinId}], Created at Bin: ${newOriginalActiveBin}`);

      // Recalculate snapshot value based on ACTUAL deposited amount and current price
      const currentTargetTokenPrice = singleSidedX ? tokenXPrice : tokenYPrice;
      const newPositionSnapshotValue = actualTokenAmountDeposited.times(currentTargetTokenPrice).toNumber();
      console.log(`Calculated snapshot value for new position based on actual deposit: $${newPositionSnapshotValue.toFixed(4)}`);

      console.log(`Transferring history from ${oldPositionKeyStr} to ${newPositionPubKey.toString()}`);
      this.positionStorage.transferPositionHistory(
        oldPositionKey,
        newPositionPubKey,
        {
          originalActiveBin: newOriginalActiveBin,
          minBinId: newMinBinId,
          maxBinId: newMaxBinId,
          snapshotPositionValue: newPositionSnapshotValue,
          poolAddress: poolAddress.toString(),
        },
        accumulatedFees
      );

      // FIX: Call the correct removePosition method (via PositionStorage)
      // await this.positionRepository.removePosition(oldPositionKeyStr); // Incorrect
      await this.positionStorage.removePosition(oldPositionKey); // Correct way

      // Update last rebalance time for the *new* position key
      this.lastRebalanceTime[newPositionPubKey.toString()] = Date.now();
      delete this.lastRebalanceTime[oldPositionKeyStr];

      console.log(`Rebalance complete for ${oldPositionKeyStr} -> ${newPositionPubKey.toString()}`);

    } catch (error) {
      console.error(`Error during rebalance process for ${oldPositionKeyStr}:`, error);
    }
  }

  /**
   * Calculates the USD value of a position based on token amounts and current prices
   */
  public async calculatePositionValue(position: PositionInfo): Promise<number> {
     // ... implementation to calculate value based on current amounts and prices ...
     // Ensure it uses position.lbPairPositionsData[0].positionData.totalXAmount etc.
     // and fetches token decimals and prices correctly.
     try {
        // FIX: Use position.publicKey which refers to the pool in PositionInfo context
        const poolAddress = position.publicKey;
        const dlmm = await this.getDLMMInstance(poolAddress); // Use correct pool address
        const activeBinData = await dlmm.getActiveBin();
        const pricePerToken = Number(activeBinData.pricePerToken);
        const solPriceStr = await FetchPrice(process.env.SOL_Price_ID as string);
        const solPrice = parseFloat(solPriceStr);

        const lbPosition = position.lbPairPositionsData[0];
        if (!lbPosition || !lbPosition.positionData) return 0;

        // FIX: Use dlmm.tokenX and dlmm.tokenY for token info
        const { tokenX, tokenY } = dlmm;
        const xAmount = Number(lbPosition.positionData.totalXAmount) / 10 ** tokenX.decimal;
        const yAmount = Number(lbPosition.positionData.totalYAmount) / 10 ** tokenY.decimal;

        let totalValue = 0;
        const SOL_MINT = 'So11111111111111111111111111111111111111112';

        if (tokenY.publicKey.toString() === SOL_MINT) {
            totalValue = (xAmount * pricePerToken * solPrice) + (yAmount * solPrice);
        } else if (tokenX.publicKey.toString() === SOL_MINT) {
            totalValue = (xAmount * solPrice) + (yAmount / pricePerToken * solPrice);
        } else {
            console.warn(`Value calc: Non-SOL pair ${tokenX.publicKey.toString()}/${tokenY.publicKey.toString()} - needs external prices.`);
            // Fallback or return 0
            return 0; // Or implement external price fetching
        }
        return totalValue;
     } catch(error){
         console.error("Error in calculatePositionValue:", error);
         return 0;
     }
  }
}