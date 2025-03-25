import { ComputeBudgetProgram, Keypair, PublicKey, Transaction, Connection, sendAndConfirmTransaction } from "@solana/web3.js";
import DLMM, { StrategyParameters, StrategyType, LbPair } from '@meteora-ag/dlmm';
import { BN } from '@coral-xyz/anchor';
import { PositionStorage } from './PositionStorage';
import { getTokenPriceJupiter } from './fetchPriceJupiter';
import { token } from "@coral-xyz/anchor/dist/cjs/utils";


export async function createSingleSidePosition(
  connection: Connection,
  pool: DLMM,
  wallet: Keypair,
  totalTokenAmount: BN,
  singleSidedX: boolean,
  positionStorage: PositionStorage,
  isRebalancing: boolean = false,
  oldPositionKey?: PublicKey
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
    const tokenAmount = totalTokenAmount.toNumber() / Math.pow(10, tokenDecimals);

    // Get token mints
    const targetTokenMint = singleSidedX 
      ? pool.tokenX.publicKey
      : pool.tokenY.publicKey;

    // REPLACE PYTH WITH JUPITER - Get token price using Jupiter
    try {
      // Get token price from Jupiter
      const targetTokenPrice = await getTokenPriceJupiter(targetTokenMint.toString(), connection);
      
      if (targetTokenPrice <= 0) {
        console.warn(`⚠️ No price found for ${targetTokenMint.toString()}, using $1 default`);
        // Store position with default $1 price - allows tracking without USD valuation
        positionStorage.addPosition(positionPubKey, {
          originalActiveBin,
          minBinId,
          maxBinId,
          snapshotPositionValue: tokenAmount,
          startingPositionValue: tokenAmount
        });
      } else {
        // Calculate position value
        const dollarValue = tokenAmount * targetTokenPrice;
        
        console.log(`Position value: $${dollarValue.toFixed(2)}`);
        
        // Store position data with Jupiter-based valuation
        if (isRebalancing && oldPositionKey) {
          // If rebalancing, transfer history from old position
          positionStorage.transferPositionHistory(
            oldPositionKey,
            positionPubKey,
            {
              originalActiveBin,
              minBinId,
              maxBinId,
              snapshotPositionValue: dollarValue
            }
          );
        } else {
          // Normal new position creation with startingPositionValue
          positionStorage.addPosition(positionPubKey, {
            originalActiveBin,
            minBinId,
            maxBinId,
            snapshotPositionValue: dollarValue,
            startingPositionValue: dollarValue // Important: set initial starting value
          });
        }
      }
    } catch (error) {
      console.warn(`Error getting token price: ${error instanceof Error ? error.message : String(error)}`);
      // Fallback to storing without price data
      positionStorage.addPosition(positionPubKey, {
        originalActiveBin,
        minBinId,
        maxBinId,
        snapshotPositionValue: 0,
        startingPositionValue: 0
      });
    }

    return { positionPubKey, minBinId, maxBinId };

  } catch (error) {
    console.error('❌ Error creating position:', error);
    throw error;
  }
}
