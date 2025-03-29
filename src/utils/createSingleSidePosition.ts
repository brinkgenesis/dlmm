import { ComputeBudgetProgram, Keypair, PublicKey, Transaction, Connection, sendAndConfirmTransaction } from "@solana/web3.js";
import DLMM, { StrategyParameters, StrategyType } from '@meteora-ag/dlmm';
import { BN } from '@coral-xyz/anchor';
import { PositionStorage } from './PositionStorage';
import { getTokenPriceJupiter } from './fetchPriceJupiter';
import { token } from "@coral-xyz/anchor/dist/cjs/utils";

/**
 * Creates a new single-sided position ON-CHAIN ONLY.
 * Calculates the bin range based on the active bin at the time of creation.
 * Returns necessary data for storage updates.
 */
export async function createSingleSidePosition(
  connection: Connection,
  pool: DLMM,
  wallet: Keypair, // Fee payer and owner
  positionKeypair: Keypair, // Pre-generated keypair for the new position
  amountLamports: BN,
  singleSidedX: boolean,
  // Range is NOT passed, it's calculated here
): Promise<{ positionPubKey: PublicKey; minBinId: number; maxBinId: number; originalActiveBin: number }> {
  try {
    if (!pool) throw new Error('DLMM Pool is not initialized');

    // --- Calculate Bin Range Internally ---
    const activeBin = await pool.getActiveBin();
    const currentActiveBinId = activeBin.binId;
    // Use a fixed range or derive from config/pool properties if needed
    const totalRangeInterval = 69; // Keep your existing logic/value
    const [minBinId, maxBinId] = singleSidedX
      ? [currentActiveBinId, currentActiveBinId + totalRangeInterval]
      : [currentActiveBinId - totalRangeInterval, currentActiveBinId];
    console.log(`OnChain: Creating ${singleSidedX ? 'X' : 'Y'}-sided position ${positionKeypair.publicKey.toString()}`);
    console.log(`  Active Bin: ${currentActiveBinId}, Calculated Range: [${minBinId}, ${maxBinId}], Amount: ${amountLamports.toString()}`);
    // --- End Bin Range Calculation ---


    // Build strategy
    const strategy: StrategyParameters = {
      minBinId,
      maxBinId,
      strategyType: StrategyType.BidAskImBalanced,
      singleSidedX
    };

    // Set amounts based on side
    const [totalXAmount, totalYAmount] = singleSidedX
      ? [amountLamports, new BN(0)]
      : [new BN(0), amountLamports];

    // Create transaction
    const tx = await pool.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: positionKeypair.publicKey,
      totalXAmount,
      totalYAmount,
      strategy,
      user: wallet.publicKey,
    });

    // Add priority fee
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 30000 })); // Adjust as needed

    // Set recent blockhash
    const { blockhash } = await connection.getLatestBlockhash('finalized');
    tx.recentBlockhash = blockhash;
    tx.feePayer = wallet.publicKey;

    // Sign and send with confirmation
    const signature = await sendAndConfirmTransaction(
      connection,
      tx,
      [wallet, positionKeypair], // Sign with fee payer and position keypair
      { skipPreflight: false, commitment: 'confirmed' }
    );

    console.log('✅ OnChain: Position created successfully');
    console.log('OnChain: Transaction Signature:', signature);

    // Return the data needed by the caller (RebalanceManager)
    return {
        positionPubKey: positionKeypair.publicKey,
        minBinId: minBinId,
        maxBinId: maxBinId,
        originalActiveBin: currentActiveBinId // The active bin when created
    };

  } catch (error) {
    console.error(`❌ OnChain: Error creating position ${positionKeypair.publicKey.toString()}:`, error);
    throw error; // Re-throw error
  }
}
