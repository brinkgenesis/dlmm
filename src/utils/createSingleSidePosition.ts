import { ComputeBudgetProgram, Keypair, PublicKey, Transaction, Connection, sendAndConfirmTransaction } from "@solana/web3.js";
import DLMM, { StrategyParameters, StrategyType, LbPair } from '@meteora-ag/dlmm';
import { BN } from '@coral-xyz/anchor';
import { PositionStorage } from './PositionStorage';
import { FetchPrice } from './fetch_price';
import { getFeedIdForMint } from './pythUtils';
import { token } from "@coral-xyz/anchor/dist/cjs/utils";


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
    const tokenAmount = totalTokenAmount.toNumber() / Math.pow(10, tokenDecimals);

    // Fetch current price
    const tokenMint = singleSidedX 
      ? pool.tokenX.publicKey.toBase58() 
      : pool.tokenY.publicKey.toBase58();

    try {
      const priceFeedID = await getFeedIdForMint(tokenMint, connection);
      if (!priceFeedID) {
        console.warn(`⚠️ No price feed for ${tokenMint}, using $1 default`);
        return { 
          positionPubKey, 
          minBinId, 
          maxBinId 
        }; // Return position data without dollar value
      }
    } catch (error) {
      console.log(`Pyth feed not available for ${tokenMint}, using Jupiter prices instead`);
    }

     // Determine which token is SOL
     const SOL_MINT = 'So11111111111111111111111111111111111111112';
    
 
   

    const solPrice = await getSOLPrice();
    const pricePerToken = parseFloat(activeBin.pricePerToken);
    const dollarValueToken = pricePerToken * solPrice;
    const dollarValue = tokenAmount * dollarValueToken;
    // Store position data
    positionStorage.addPosition(positionPubKey, {
      originalActiveBin,
      minBinId,
      maxBinId,
      snapshotPositionValue: dollarValue
    });

    // Must verify which token is SOL
    const isTokenSOL = singleSidedX 
      ? pool.tokenY.publicKey.toBase58() === SOL_MINT 
      : pool.tokenX.publicKey.toBase58() === SOL_MINT;

    if (!isTokenSOL) {
      throw new Error('Position valuation requires SOL as counterparty');
    }

    return { positionPubKey, minBinId, maxBinId };

  } catch (error) {
    console.error('❌ Error creating position:', error);
    throw error;
  }
}
async function getSOLPrice(): Promise<number> {
    const solPriceStr = await FetchPrice(process.env.SOL_Price_ID as string);
    const solPriceNumber = parseFloat(solPriceStr);
    console.log(`Fetched current Solana Price: ${solPriceStr}`);
    return solPriceNumber;
  }
