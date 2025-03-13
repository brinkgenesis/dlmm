import { Connection, PublicKey, Transaction, Signer, sendAndConfirmTransaction, ComputeBudgetProgram } from '@solana/web3.js';
import BN from 'bn.js';
import DLMM from '@meteora-ag/dlmm';

/**
 * Performs a token swap using the DLMM SDK.
 * 
 * @param connection - Solana connection
 * @param dlmm - Initialized DLMM instance
 * @param inAmount - The amount of token to swap in as BN
 * @param swapYtoX - Boolean indicating swap direction (Y to X if true, X to Y if false)
 * @param allowedSlippageBps - Allowed slippage in basis points
 * @param wallet - The wallet to use for the transaction
 * @returns Transaction signature
 */
export async function swapTokens(
  connection: Connection,
  dlmm: DLMM,
  inAmount: BN,
  swapYtoX: boolean,
  allowedSlippageBps: BN,
  wallet: Signer
): Promise<string> {
  try {
    console.log(`Starting swap of ${inAmount.toString()} ${swapYtoX ? 'Y→X' : 'X→Y'} tokens with ${allowedSlippageBps.toString()} bps slippage`);

    // Get bin arrays required for swap
    const binArrays = await dlmm.getBinArrayForSwap(swapYtoX);
    
    // Get swap quote
    const swapQuote = await dlmm.swapQuote(
      inAmount,
      swapYtoX,
      allowedSlippageBps,
      binArrays
    );

    console.log(`Swap quote: Min out amount: ${swapQuote.minOutAmount.toString()}`);

    // Determine input and output tokens based on swap direction
    const inToken = swapYtoX ? dlmm.tokenY.publicKey : dlmm.tokenX.publicKey;
    const outToken = swapYtoX ? dlmm.tokenX.publicKey : dlmm.tokenY.publicKey;

    // Create swap transaction
    const swapTx = await dlmm.swap({
      inToken: inToken,
      binArraysPubkey: swapQuote.binArraysPubkey,
      inAmount: inAmount,
      lbPair: dlmm.pubkey,
      user: wallet.publicKey,
      minOutAmount: swapQuote.minOutAmount,
      outToken: outToken,
    });

    // Add compute budget instruction to avoid compute limit errors
    const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 30000,
    });
    swapTx.add(addPriorityFee);

    // Send and confirm the transaction
    const signature = await sendAndConfirmTransaction(
      connection,
      swapTx,
      [wallet],
      {
        commitment: 'confirmed',
        skipPreflight: false
      }
    );

    console.log(`Swap transaction successful with signature: ${signature}`);
    return signature;
  } catch (error: any) {
    console.error('Error performing swap:', error.message || error);
    
    // Log transaction logs if available
    if (error.logs) {
      console.error('Transaction Logs:', error.logs);
    }
    
    throw error;
  }
}

/**
 * Helper function to perform swap with retry logic and increasing slippage.
 */
export async function swapTokensWithRetry(
  connection: Connection,
  dlmm: DLMM,
  inAmount: BN,
  swapYtoX: boolean,
  wallet: Signer,
  initialSlippageBps = new BN(100), // Default 1% slippage
  maxRetries = 3
): Promise<string> {
  let lastError;
  let delay = 500; // Start with 500ms delay
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Calculate slippage for this attempt, capped at 300 bps
    const slippageBps = new BN(Math.min(
      initialSlippageBps.toNumber() + (attempt * 100), // Increase by 100 bps per attempt
      300 // Cap at 300 bps (3%)
    ));
    
    console.log(`Attempt #${attempt + 1} with slippage: ${slippageBps.toString()} bps`);
    
    try {
      return await swapTokens(connection, dlmm, inAmount, swapYtoX, slippageBps, wallet);
    } catch (error: any) {
      lastError = error;
      
      // Check if it's a retryable error
      const msg = error?.message?.toLowerCase() || '';
      if (msg.includes('blockhash') || msg.includes('expired') || msg.includes('slippage')) {
        console.warn(`Retry #${attempt + 1} due to error: ${msg}. Waiting ${delay}ms...`);
        await new Promise((res) => setTimeout(res, delay));
        delay *= 2; // Exponential backoff
      } else {
        // Non-retryable error
        throw error;
      }
    }
  }
  
  // If we've exhausted retries
  throw lastError || new Error(`Failed after ${maxRetries} retries`);
} 