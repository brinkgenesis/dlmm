import { ComputeBudgetProgram, Keypair, PublicKey, Transaction, Connection, sendAndConfirmTransaction } from "@solana/web3.js";
import DLMM, { StrategyParameters, StrategyType, LbPair } from '@meteora-ag/dlmm';
import { BN } from '@coral-xyz/anchor';
import { PositionStorage } from './PositionStorage';

export async function createSingleSidePosition(
  connection: Connection,
  pool: DLMM,
  wallet: Keypair,
  totalTokenAmount: BN,
  singleSidedX: boolean,
  positionStorage: PositionStorage
): Promise<{ positionPubKey: PublicKey; minBinId: number; maxBinId: number }> {
  try {
    if (!pool) throw new Error('DLMM Pool is not initialized');

    // Get active bin info
    const activeBin = await pool.getActiveBin();
    const currentActiveBinId = activeBin.binId;
    const totalRangeInterval = 69; // Same as original strategy

    // Calculate bin range
    const [minBinId, maxBinId] = singleSidedX 
      ? [currentActiveBinId, currentActiveBinId + totalRangeInterval]
      : [currentActiveBinId - totalRangeInterval, currentActiveBinId];

    // Build strategy
    const strategy: StrategyParameters = {
      minBinId,
      maxBinId,
      strategyType: StrategyType.BidAskImBalanced,
      singleSidedX
    };

    // Set amounts based on side
    const [totalXAmount, totalYAmount] = singleSidedX
      ? [totalTokenAmount, new BN(0)]
      : [new BN(0), totalTokenAmount];

    // Generate position keypair
    const positionKeypair = Keypair.generate();
    const positionPubKey = positionKeypair.publicKey;

    // Create transaction
    const tx = await pool.initializePositionAndAddLiquidityByStrategy({
      positionPubKey,
      totalXAmount,
      totalYAmount,
      strategy,
      user: wallet.publicKey,
    });

    // Add priority fee
    tx.add(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 30000 })
    );

    // Set recent blockhash
    const { blockhash } = await connection.getLatestBlockhash('finalized');
    tx.recentBlockhash = blockhash;
    tx.feePayer = wallet.publicKey;

    // Sign and send with confirmation
    const signature = await sendAndConfirmTransaction(
      connection,
      tx,
      [wallet, positionKeypair],
      {
        skipPreflight: false,
        commitment: 'confirmed'
      }
    );

    console.log('✅ Position created successfully');
    console.log('Transaction Signature:', signature);
    console.log('Position Public Key:', positionPubKey.toBase58());

    // After successful position creation
    const originalActiveBin = currentActiveBinId;
    const tokenDecimals = singleSidedX 
      ? pool.tokenX.decimal 
      : pool.tokenY.decimal;
    
    // Convert lamports to token amount with decimals
    const snapshotValue = totalTokenAmount.toNumber() / Math.pow(10, tokenDecimals);

    // Store position data
    positionStorage.addPosition(positionPubKey, {
      originalActiveBin,
      minBinId,
      maxBinId,
      snapshotPositionValue: snapshotValue
    });

    return { positionPubKey, minBinId, maxBinId };

  } catch (error) {
    console.error('❌ Error creating position:', error);
    throw error;
  }
}
