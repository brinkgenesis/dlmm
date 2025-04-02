import { Connection, PublicKey, Keypair, ComputeBudgetProgram, sendAndConfirmTransaction, Transaction } from '@solana/web3.js';
import DLMM from '@meteora-ag/dlmm';
import { Config } from '../models/Config';
import { withSafeKeypair } from './walletHelper';
import { BN } from '@coral-xyz/anchor';
import { swapTokensWithRetry } from './swapTokens';

/**
 * Closes a position in a specific pool with options for partial closing and token swapping
 * 
 * @param connection Solana connection
 * @param wallet Wallet keypair
 * @param config Application configuration
 * @param positionKey Public key of the position to close
 * @param poolAddress Public key of the pool containing the position
 * @param options Optional parameters:
 *   - bps: Basis points (0-10000) of liquidity to remove (default: 10000 = 100%)
 *   - shouldRemoveLiquidity: Whether to remove liquidity first (default: true)
 *   - swapTokenXToY: Whether to swap token X to token Y after closing (default: true)
 * @returns Object with success status, transaction signature, and swap information
 */
export async function closePosition(
  connection: Connection,
  wallet: Keypair,
  config: Config,
  positionKey: PublicKey,
  poolAddress: PublicKey,
  options?: {
    bps?: number;
    shouldRemoveLiquidity?: boolean;
    swapTokenXToY?: boolean;
  }
): Promise<{ 
  success: boolean; 
  signature?: string; 
  swapSignature?: string;
  error?: string;
  swapError?: string;
}> {
  // Default options
  const {
    bps = 10000, // Default to 100%
    shouldRemoveLiquidity = true,
    swapTokenXToY = true
  } = options || {};
  
  try {
    console.log(`Attempting to close ${bps/100}% of position ${positionKey.toString()} in pool ${poolAddress.toString()}`);
    
    // Create DLMM instance for the pool
    const dlmm = await DLMM.create(connection, poolAddress);
    
    // Get position data to check if it has liquidity
    const { userPositions } = await dlmm.getPositionsByUserAndLbPair(wallet.publicKey);
    const positionToClose = userPositions.find(p => p.publicKey.toString() === positionKey.toString());
    
    if (!positionToClose) {
      return { 
        success: false, 
        error: `Position ${positionKey.toString()} not found on-chain for this wallet` 
      };
    }
    
    // Initialize signature variable
    let signature: string = '';
    const bnBps = new BN(bps);
    const isFullClose = bps === 10000;
    
    // Track if we're actually removing all liquidity, even if not closing the position
    const isRemovingAllLiquidity = isFullClose || !shouldRemoveLiquidity;
    
    // Check if we need to remove liquidity first
    if (shouldRemoveLiquidity) {
      const binIds = positionToClose.positionData.positionBinData.map(bin => bin.binId);
      
      if (binIds.length > 0) {
        console.log(`Position has ${binIds.length} bins with liquidity. Removing ${bps/100}% of liquidity...`);
        
        // Remove liquidity (and close if removing 100%)
        const removeLiquidityTx = await dlmm.removeLiquidity({
          position: positionKey,
          binIds,
          bps: bnBps,
          user: wallet.publicKey,
          shouldClaimAndClose: isFullClose // Only close if removing 100%
        });
        
        // Handle transaction(s)
        if (Array.isArray(removeLiquidityTx)) {
          // Multiple transactions required
          for (let i = 0; i < removeLiquidityTx.length; i++) {
            const tx = removeLiquidityTx[i];
            
            // Add compute budget instructions
            tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }));
            tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 30000 }));
            
            // Set blockhash and fee payer
            const { blockhash } = await connection.getLatestBlockhash('finalized');
            tx.recentBlockhash = blockhash;
            tx.feePayer = wallet.publicKey;
            
            // Send transaction
            const txSignature = await withSafeKeypair(config, async (keypair) => {
              return sendAndConfirmTransaction(
                connection,
                tx,
                [keypair],
                { skipPreflight: false, commitment: 'confirmed' }
              );
            });
            
            // Store the last signature
            signature = txSignature;
            console.log(`Transaction ${i+1}/${removeLiquidityTx.length} signature: ${signature}`);
          }
        } else {
          // Single transaction
          const tx = removeLiquidityTx;
          
          // Add compute budget instructions
          tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }));
    
          
          // Set blockhash and fee payer
          const { blockhash } = await connection.getLatestBlockhash('finalized');
          tx.recentBlockhash = blockhash;
          tx.feePayer = wallet.publicKey;
          
          // Send transaction
          signature = await withSafeKeypair(config, async (keypair) => {
            return sendAndConfirmTransaction(
              connection,
              tx,
              [keypair],
              { skipPreflight: false, commitment: 'confirmed' }
            );
          });
          
          console.log(`Transaction signature: ${signature}`);
        }
      } else {
        console.log('Position has no liquidity. Proceeding to close directly if requested.');
        
        // Only close if we're doing a full close
        if (isFullClose) {
          const closeTx = await dlmm.closePosition({
            owner: wallet.publicKey,
            position: positionToClose
          });
          
          // Add compute budget instructions
          closeTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }));
         
          
          // Set blockhash and fee payer
          const { blockhash } = await connection.getLatestBlockhash('finalized');
          closeTx.recentBlockhash = blockhash;
          closeTx.feePayer = wallet.publicKey;
          
          // Send transaction
          signature = await withSafeKeypair(config, async (keypair) => {
            return sendAndConfirmTransaction(
              connection,
              closeTx,
              [keypair],
              { skipPreflight: false, commitment: 'confirmed' }
            );
          });
          
          console.log(`Close transaction signature: ${signature}`);
        } else {
          console.log('Skipping position closure as partial close was requested but position has no liquidity');
        }
      }
    } else if (isFullClose) {
      // Just close the position without removing liquidity (only if full close)
      console.log('Closing position directly without removing liquidity...');
      const closeTx = await dlmm.closePosition({
        owner: wallet.publicKey,
        position: positionToClose
      });
      
      // Add compute budget instructions
      closeTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }));
    
      
      // Set blockhash and fee payer
      const { blockhash } = await connection.getLatestBlockhash('finalized');
      closeTx.recentBlockhash = blockhash;
      closeTx.feePayer = wallet.publicKey;
      
      // Send transaction
      signature = await withSafeKeypair(config, async (keypair) => {
        return sendAndConfirmTransaction(
          connection,
          closeTx,
          [keypair],
          { skipPreflight: false, commitment: 'confirmed' }
        );
      });
      
      console.log(`Close transaction signature: ${signature}`);
    }
    
    // Perform token swap if requested and we actually removed liquidity
    let swapSignature: string | undefined;
    let swapError: string | undefined;
    
    if (swapTokenXToY && shouldRemoveLiquidity) {
      try {
        // Allow some time for the network to catch up
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Get token X's mint and ATA
        const tokenXMint = dlmm.tokenX.publicKey;
        const tokenXDecimals = dlmm.tokenX.decimal;
        
        // Get token Y's mint (usually SOL)
        const tokenYMint = dlmm.tokenY.publicKey;
        
        // Check if token Y is SOL (or any token we want to swap to)
        const SOL_MINT = 'So11111111111111111111111111111111111111112';
        const isTokenYSol = tokenYMint.toString() === SOL_MINT;
        
        if (isTokenYSol) {
          console.log(`Token Y is SOL. Attempting to swap token X to SOL...`);
          
          // Get associated token account for token X
          const { getAssociatedTokenAddress } = await import('@solana/spl-token');
          const tokenXAccount = await getAssociatedTokenAddress(tokenXMint, wallet.publicKey);
          
          // Get token X balance
          const tokenAccountInfo = await connection.getTokenAccountBalance(tokenXAccount);
          const tokenXBalance = new BN(tokenAccountInfo.value.amount);
          
          if (tokenXBalance.gt(new BN(0))) {
            console.log(`Found ${tokenAccountInfo.value.uiAmount} token X. Swapping to SOL...`);
            
            // Swap token X to token Y (SOL)
            // Use 95% of balance to account for any fees or minimum balance requirements
            const amountToSwap = tokenXBalance.mul(new BN(99)).div(new BN(100));
            
            swapSignature = await withSafeKeypair(config, async (keypair) => {
              return swapTokensWithRetry(
                connection,
                dlmm,
                amountToSwap,
                false, // swapYtoX = false means X to Y
                keypair
              );
            });
            
            console.log(`Swap transaction successful with signature: ${swapSignature}`);
          } else {
            console.log(`No token X balance to swap`);
          }
        } else {
          console.log(`Token Y is not SOL, skipping automatic swap`);
        }
      } catch (swapErr) {
        console.error('Error swapping tokens:', swapErr);
        swapError = swapErr instanceof Error ? swapErr.message : String(swapErr);
      }
    }
    
    const successMessage = isFullClose ? 
      `Position ${positionKey.toString()} closed successfully` : 
      `${bps/100}% of liquidity removed from position ${positionKey.toString()}`;
    
    console.log(successMessage);
    
    return { 
      success: true, 
      signature,
      swapSignature,
      swapError
    };
    
  } catch (error) {
    console.error(`Error ${bps === 10000 ? 'closing' : 'removing liquidity from'} position ${positionKey.toString()}:`, error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
}

/**
 * Utility function to find a position by pool
 * 
 * @param connection Solana connection
 * @param wallet Wallet keypair
 * @param poolAddress Public key of the pool
 * @returns Array of position keys in the pool
 */
export async function findPositionsByPool(
  connection: Connection,
  wallet: PublicKey,
  poolAddress: PublicKey
): Promise<PublicKey[]> {
  try {
    const dlmm = await DLMM.create(connection, poolAddress);
    const { userPositions } = await dlmm.getPositionsByUserAndLbPair(wallet);
    
    return userPositions.map(position => position.publicKey);
  } catch (error) {
    console.error(`Error finding positions for pool ${poolAddress.toString()}:`, error);
    return [];
  }
} 