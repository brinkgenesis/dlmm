import { ComputeBudgetProgram, Keypair, PublicKey, Transaction, Connection, sendAndConfirmTransaction } from "@solana/web3.js";
import DLMM, { StrategyParameters, StrategyType } from '@meteora-ag/dlmm';
import { BN } from '@coral-xyz/anchor';
import { getTokenPriceJupiter } from './fetchPriceJupiter';
import { Decimal } from 'decimal.js';

/**
 * Creates a new single-sided position ON-CHAIN.
 * Calculates the bin range based on the active bin at the time of creation.
 * Calculates the initial USD value of the deposited amount.
 * Returns necessary data for storage updates.
 */
export async function createSingleSidePosition(
  connection: Connection,
  pool: DLMM,
  wallet: Keypair, // Fee payer and owner
  positionKeypair: Keypair, // Pre-generated keypair for the new position
  amountLamports: BN,
  singleSidedX: boolean,
): Promise<{
  positionKey: PublicKey;
  minBinId: number;
  maxBinId: number;
  originalActiveBin: number;
  startingValue: number;
  txSignature: string;
}> {
  try {
    if (!pool) throw new Error('DLMM Pool is not initialized');

    // --- Calculate Bin Range Internally ---
    const activeBin = await pool.getActiveBin();
    const currentActiveBinId = activeBin.binId;
    const totalRangeInterval = 69;
    const [minBinId, maxBinId] = singleSidedX
      ? [currentActiveBinId, currentActiveBinId + totalRangeInterval]
      : [currentActiveBinId - totalRangeInterval, currentActiveBinId];
    console.log(`OnChain: Creating ${singleSidedX ? 'X' : 'Y'}-sided position ${positionKeypair.publicKey.toString()}`);
    console.log(`  Active Bin: ${currentActiveBinId}, Calculated Range: [${minBinId}, ${maxBinId}], Amount: ${amountLamports.toString()}`);

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
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 30000 }));

    const { blockhash } = await connection.getLatestBlockhash('finalized');
    tx.recentBlockhash = blockhash;
    tx.feePayer = wallet.publicKey;

    // Sign and send with confirmation
    const signature = await sendAndConfirmTransaction(
      connection,
      tx,
      [wallet, positionKeypair],
      { skipPreflight: false, commitment: 'confirmed' }
    );

    console.log('✅ OnChain: Position created successfully');
    console.log('OnChain: Transaction Signature:', signature);

    // --- Calculate Starting Value ---
    let startingValue = 0;
    try {
        const depositedTokenMint = singleSidedX ? pool.tokenX.publicKey : pool.tokenY.publicKey;
        const depositedTokenDecimals = singleSidedX ? pool.tokenX.decimal : pool.tokenY.decimal;

        const price = await getTokenPriceJupiter(depositedTokenMint.toBase58()); // Fetch price

        if (price > 0) {
            const amountDecimal = new Decimal(amountLamports.toString()).div(new Decimal(10).pow(depositedTokenDecimals));
            startingValue = amountDecimal.times(price).toNumber();
            console.log(`OnChain: Calculated Starting Value for ${positionKeypair.publicKey.toString()}: $${startingValue.toFixed(4)}`);
        } else {
            console.warn(`OnChain: Could not fetch price for ${depositedTokenMint.toBase58()} to calculate starting value for ${positionKeypair.publicKey.toString()}. Defaulting to 0.`);
        }
    } catch(priceError) {
        console.error(`OnChain: Error calculating starting value for ${positionKeypair.publicKey.toString()}:`, priceError);
        // Keep startingValue as 0
    }
    // --- End Starting Value Calculation ---


    // Return the extended data
    return {
        positionKey: positionKeypair.publicKey,
        minBinId: minBinId,
        maxBinId: maxBinId,
        originalActiveBin: currentActiveBinId,
        startingValue: startingValue,
        txSignature: signature
    };

  } catch (error) {
    console.error(`❌ OnChain: Error creating position ${positionKeypair.publicKey.toString()}:`, error);
    throw error;
  }
}
