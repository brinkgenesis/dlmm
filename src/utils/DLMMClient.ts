import { PublicKey, Connection, sendAndConfirmTransaction, Transaction, Signer, Keypair, TransactionSignature, ComputeBudgetProgram } from '@solana/web3.js';
import DLMM, { StrategyType, PositionVersion, StrategyParameters, LbPosition, SwapQuote, computeBudgetIx } from '@meteora-ag/dlmm';
import { Config } from '../models/Config';
import '@coral-xyz/anchor';
import BN from 'bn.js';
import { 
  getAssociatedTokenAddress, 
  getAccount, 
  createAssociatedTokenAccountInstruction 
} from '@solana/spl-token';
import { SendTransactionError } from '@solana/web3.js';
import { formatBN } from './formatBN';
import Decimal from 'decimal.js';

/**
 * Represents a user's position.
 */
interface UserPosition {
    publicKey: PublicKey;
    positionData: PositionData;
  }

interface PositionData {
    totalXAmount: string;
    totalYAmount: string;
    positionBinData: PositionBinData[];
    lastUpdatedAt: BN;
    upperBinId: number;
    lowerBinId: number;
    feeX: BN;
    feeY: BN;
    rewardOne: BN;
    rewardTwo: BN;
    feeOwner: PublicKey;
    totalClaimedFeeXAmount: BN;
    totalClaimedFeeYAmount: BN;
  }

interface PositionBinData {
    binId: number;
    price: string;
    pricePerToken: string;
    binXAmount: string;
    binYAmount: string;
    binLiquidity: string;
    positionLiquidity: string;
    positionXAmount: string;
    positionYAmount: string;
  }
  


/**
 * DLMMClient is responsible for initializing the Meteora DLMM SDK and managing operations.
 */
export class DLMMClient {
  private dlmmPool?: DLMM;
  private config: Config;

  /**
   * Constructs a new DLMMClient instance.
   * @param config - The configuration object containing necessary settings.
   */
  constructor(config: Config) {
    this.config = config;
  }

  /**
   * Initializes the DLMM SDK with a single pool.
   * @param pubkey - The public key of the DLMM pool.
   */
  async initializeDLMMPool(pubkey: PublicKey): Promise<void> {
    try {
      // Initialize DLMM Pool using Connection and Wallet Keypair from Config
      this.dlmmPool = await DLMM.create(this.config.connection, pubkey);

      console.log('DLMM SDK initialized successfully with pool:', pubkey.toBase58());
    } catch (error: any) {
      console.error('Error initializing DLMM SDK:', error.message || error);
      throw error;
    }
  }

  /**
   * Retrieves the active bin from the initialized DLMM pool.
   * @returns The active bin details.
   */
  async getActiveBin(): Promise<{ binId: number; price: number }> {
    try {
      if (!this.dlmmPool) {
        throw new Error('DLMM Pool is not initialized. Call initializeDLMMPool() first.');
      }

      const activeBin = await this.dlmmPool.getActiveBin();
      console.log('Active Bin:', formatBN(activeBin));

      const activeBinPriceLamport = activeBin.price;
      const activeBinPricePerToken = Number(this.dlmmPool.fromPricePerLamport(Number(activeBin.price)));

      console.log(`Active Bin Price (Lamport): ${activeBinPriceLamport}`);
      console.log(`Active Bin Price per Token: ${activeBinPricePerToken}`);

      return {
        binId: activeBin.binId,
        price: activeBinPricePerToken,
      };
    } catch (error: any) {
      console.error('Error retrieving active bin:', error.message || error);
      throw error;
    }
  }

  /**
   * Retrieves user positions from the initialized DLMM pool.
   */
  async getUserPositions(): Promise<UserPosition[]> {
    try {
      if (!this.dlmmPool) {
        throw new Error('DLMM Pool is not initialized. Call initializeDLMMPool() first.');
      }

      const userPublicKey = new PublicKey(this.config.publickey); //User Wallet Address
      console.log(`Fetching positions for user: ${userPublicKey.toBase58()}`);

      // Fetch user positions using the initialized dlmmPool
      const { userPositions } = await this.dlmmPool.getPositionsByUserAndLbPair(userPublicKey);

      if (!userPositions || userPositions.length === 0) {
        console.log('No positions found for the user.');
        return userPositions;
      }

      // Extract and log bin data from each position
      userPositions.forEach((position: UserPosition, index: number) => {
        const binData = position.positionData.positionBinData;
        console.log(`Position ${index + 1}:`, position);
        console.log(`Bin Data ${index + 1}:`, binData);
        
      });
      return userPositions;

    } catch (error: any) {
      console.error('Error fetching user positions:', error.message || error);
      throw error;
    }
  }

  /**
   * Ensures that the user has ATAs for Token X and Token Y.
   */
  async ensureATAs(): Promise<void> {
    try {
      if (!this.dlmmPool) {
        throw new Error('DLMM Pool is not initialized. Call initializeDLMMPool() first.');
      }

      const userPublicKey = this.config.walletKeypair.publicKey;
      const tokenXMint = this.dlmmPool.tokenX.publicKey;
      const tokenYMint = this.dlmmPool.tokenY.publicKey;
      const payer = this.config.walletKeypair;

      // Derive ATAs for Token X and Token Y
      const ataTokenX = await getAssociatedTokenAddress(tokenXMint, userPublicKey);
      const ataTokenY = await getAssociatedTokenAddress(tokenYMint, userPublicKey);

      const transaction = new Transaction();

      // Check if ATAs exist
      const ataXInfo = await getAccount(this.config.connection, ataTokenX).catch(() => null);
      if (!ataXInfo) {
        // Create ATA for Token X
        transaction.add(
          createAssociatedTokenAccountInstruction(
            payer.publicKey, // Payer
            ataTokenX,       // ATA
            userPublicKey,   // Owner
            tokenXMint       // Mint
          )
        );
        console.log(`Instruction to create ATA for Token X added.`);
      } else {
        console.log(`ATA for Token X already exists: ${ataTokenX.toBase58()}`);
      }

      const ataYInfo = await getAccount(this.config.connection, ataTokenY).catch(() => null);
      if (!ataYInfo) {
        // Create ATA for Token Y
        transaction.add(
          createAssociatedTokenAccountInstruction(
            payer.publicKey, // Payer
            ataTokenY,       // ATA
            userPublicKey,   // Owner
            tokenYMint       // Mint
          )
        );
        console.log(`Instruction to create ATA for Token Y added.`);
      } else {
        console.log(`ATA for Token Y already exists: ${ataTokenY.toBase58()}`);
      }

      // If there are ATA creation instructions, send the transaction
      if (transaction.instructions.length > 0) {
        const signature = await sendAndConfirmTransaction(
          this.config.connection,
          transaction,
          [payer]
        );
        console.log(`Created ATAs. Transaction signature: ${signature}`);
      } else {
        console.log('All required ATAs are already initialized.');
      }
    } catch (error: any) {
      console.error('Error ensuring ATAs:', error.message || error);
    }
  }

  /**
   * Checks and returns the token balances for the user.
   * @returns An object containing the token X and Y balances.
   */
  async checkTokenBalances(): Promise<{ xTokenBalance: BN; yTokenBalance: BN }> {
    try {
      if (!this.dlmmPool) {
        throw new Error('DLMM Pool is not initialized. Call initializeDLMMPool() first.');
      }

      const userPublicKey = new PublicKey(this.config.publickey);

      // Get Associated Token Account addresses
      const atatokenX = await getAssociatedTokenAddress(this.dlmmPool.tokenX.publicKey, userPublicKey);
      const atatokenY = await getAssociatedTokenAddress(this.dlmmPool.tokenY.publicKey, userPublicKey);

      // Fetch token account info
      const tokenXAccount = await getAccount(this.config.connection, atatokenX);
      const tokenYAccount = await getAccount(this.config.connection, atatokenY);

      // Extract token balances
      const xTokenBalance = new BN(tokenXAccount.amount.toString());
      const yTokenBalance = new BN(tokenYAccount.amount.toString());

      console.log(`Token X Balance: ${xTokenBalance.toString()}`);
      console.log(`Token Y Balance: ${yTokenBalance.toString()}`);

      // Return balances
      return { xTokenBalance, yTokenBalance };
    } catch (error: any) {
      console.error('Error checking token balances:', error.message || error);
      throw error;
    }
  }

  /**
   * Performs a token swap using the DLMM SDK.
   * @param inAmount - The amount of token to swap in.
   * @param swapYtoX - Boolean indicating the direction of the swap (Y to X if true, else X to Y).
   * @param allowedSlippageBps - Allowed slippage in basis points.
   */
  async swapTokens(inAmount: BN, swapYtoX: boolean, allowedSlippageBps: BN): Promise<void> {
    try {
      if (!this.dlmmPool) {
        throw new Error('DLMM Pool is not initialized. Call initializeDLMMPool() first.');
      }

      // Swap quote
      const binArrays = await this.dlmmPool.getBinArrayForSwap(swapYtoX);
      const swapQuote = await this.dlmmPool.swapQuote(
        inAmount,
        swapYtoX,
        allowedSlippageBps,
        binArrays
      );

      // Determine input and output tokens based on swap direction
      const inToken = swapYtoX ? this.dlmmPool.tokenY.publicKey : this.dlmmPool.tokenX.publicKey;
      const outToken = swapYtoX ? this.dlmmPool.tokenX.publicKey : this.dlmmPool.tokenY.publicKey;

      // Swap transaction
      const swapTx = await this.dlmmPool.swap({
        inToken: inToken,
        binArraysPubkey: swapQuote.binArraysPubkey,
        inAmount: inAmount,
        lbPair: this.dlmmPool.pubkey, //Address of the Liquidity Pair
        user: this.config.walletKeypair.publicKey, //User Wallet Address
        minOutAmount: swapQuote.minOutAmount,
        outToken: outToken,
      });

      // Send and confirm the transaction
      const swapTxHash = await sendAndConfirmTransaction(
        this.config.connection,
        swapTx,
        [this.config.walletKeypair]
      );
      console.log('Swap Transaction Hash:', swapTxHash);
    } catch (error: any) {
      if (error instanceof SendTransactionError) {
        if (error.logs) {
          console.error('Transaction Logs:', error.logs);
        }
        console.error('Transaction Error:', error.message);
      } else {
        console.error('Error performing swap:', error.message || error);
      }
    }
  }

  /**
   * Creates a new liquidity position within the DLMM pool.
   * @param totalXAmount - The total amount of Token X to add to the liquidity pool.
   * @param strategyType - The strategy type to use for adding liquidity.
   * @param strategy - Strategy parameters including minBinId and maxBinId.
   * @param totalYAmount - (Optional) The total amount of Token Y to add to the liquidity pool.
   * @returns The public key of the created position.
   */
  public async createPosition(
    totalXAmount: BN,
    strategyType: StrategyType,
    strategy: StrategyParameters,
    totalYAmount?: BN
  ): Promise<PublicKey> {
    if (!this.dlmmPool) {
      throw new Error('DLMM Pool is not initialized. Call initializeDLMMPool() first.');
    }

    try {
      console.log('--- Initiating createPosition ---');
      console.log('Strategy Type:', strategyType);

      // If totalYAmount is not provided, calculate it
      if (!totalYAmount) {
        // Fetch Active Bin Info
        const activeBin = await this.getActiveBin();
        console.log('Active Bin:', activeBin);
        console.log(`Active Bin Price per Token: ${activeBin.price}`);

        // Convert totalXAmount to Decimal for calculations
        const totalXAmountDecimal = new Decimal(totalXAmount.toString());

        // Get the market price as Decimal
        const activeBinPrice = new Decimal(activeBin.price.toString());

        // Calculate totalYAmount
        const totalYAmountDecimal = totalXAmountDecimal.mul(activeBinPrice);

        // Convert totalYAmount back to BN
        totalYAmount = new BN(totalYAmountDecimal.toFixed(0, Decimal.ROUND_DOWN));

        console.log(`Calculated Total Y Amount: ${totalYAmount.toString()}`);
      } else {
        console.log(`Using provided Total Y Amount: ${totalYAmount.toString()}`);
      }

      // Generate new Keypair for the position
      const positionKeypair = Keypair.generate();
      const positionPubKey = positionKeypair.publicKey;

      // Use the strategy parameters provided
      console.log('Creating position with strategy parameters.');

      const transaction = await this.dlmmPool.initializePositionAndAddLiquidityByStrategy({
        positionPubKey: positionPubKey,
        totalXAmount: totalXAmount,
        totalYAmount: totalYAmount,
        strategy: strategy,
        user: this.config.walletKeypair.publicKey,
      });

      // Signers for the transaction
      const signers: Signer[] = [this.config.walletKeypair, positionKeypair];

      // Send and confirm the transaction
      const signature = await sendAndConfirmTransaction(
        this.config.connection,
        transaction,
        signers,
        {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
          commitment: 'finalized',
        }
      );
      console.log(`Transaction Signature: ${signature}`);
      console.log(`Position created successfully with signature: ${signature}`);
      console.log(`Position Public Key: ${positionPubKey.toBase58()}`);

      return positionPubKey;
    } catch (error: any) {
      console.error('Error creating position:', error.message || error);
      throw error;
    }
  }

  /**
   * Adds liquidity to an existing position within the DLMM pool.
   * @param positionPubKey - The public key of the liquidity position.
   * @param totalXAmount - The amount of Token X to add.
   */
  async addLiquidity(
    positionPubKey: PublicKey,
    totalXAmount: BN
  ): Promise<void> {
    try {
      console.log('--- Initiating addLiquidity ---');
      console.log(`Position Public Key: ${positionPubKey.toBase58()}`);
      console.log(`Total X Amount: ${totalXAmount.toString()}`);

      if (!this.dlmmPool) {
        throw new Error('DLMM Pool is not initialized. Call initializeDLMMPool() first.');
      }

      // Retrieve active bin information
      const activeBin = await this.getActiveBin();
      console.log('Retrieved Active Bin:', activeBin);

      // Calculate min and max bin IDs based on active bin
      const TOTAL_RANGE_INTERVAL = 10; // 10 bins on each side of the active bin
      const minBinId = activeBin.binId - TOTAL_RANGE_INTERVAL;
      const maxBinId = activeBin.binId + TOTAL_RANGE_INTERVAL;

      console.log(`Total Range Interval: ${TOTAL_RANGE_INTERVAL}`);
      console.log(`Min Bin ID: ${minBinId}`);
      console.log(`Max Bin ID: ${maxBinId}`);

      // Calculate total Y amount based on active bin price
      const activeBinPricePerTokenStr = this.dlmmPool.fromPricePerLamport(
        Number(activeBin.price)
      );
      const activeBinPricePerToken = parseFloat(activeBinPricePerTokenStr);
      
      const totalYAmount = totalXAmount.mul(new BN(Math.floor(activeBinPricePerToken)));
      console.log(`Active Bin Price per Token: ${activeBinPricePerToken}`);
      console.log(`Total Y Amount: ${totalYAmount.toString()}`);

      // Add Liquidity to existing position
      const addLiquidityTx = await this.dlmmPool.addLiquidityByStrategy({
        positionPubKey,
        user: this.config.walletKeypair.publicKey,
        totalXAmount,
        totalYAmount,
        strategy: {
          minBinId,
          maxBinId,
          strategyType: StrategyType.SpotBalanced,
        },
      });


      console.log('Initialized Transaction Instructions');

      // Assign the recent blockhash and fee payer
      const { blockhash } = await this.config.connection.getLatestBlockhash('finalized');
      addLiquidityTx.recentBlockhash = blockhash;
      addLiquidityTx.feePayer = this.config.walletKeypair.publicKey;
      console.log('Assigned Blockhash and Fee Payer to Transaction');

      // Signers for the transaction: the user
      const signers: Signer[] = [this.config.walletKeypair];
      console.log('Assigned Signers:', signers.map((s) => s.publicKey.toBase58()));

      // Send and confirm the transaction
      console.log('Sending Transaction...');
      const signature: TransactionSignature = await sendAndConfirmTransaction(
        this.config.connection,
        addLiquidityTx,
        signers,
        {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
        }
      );
      console.log(`Transaction Signature: ${signature}`);
      console.log(`Liquidity added successfully with signature: ${signature}`);
      console.log('--- addLiquidity Completed Successfully ---');
    } catch (error: any) {
      console.error('Error adding liquidity:', error.message || error);
      console.log('--- addLiquidity Encountered an Error ---');
    }
  }

  /**
   * Removes liquidity from an existing position within the DLMM pool.
   * @param newBalancePosition - The public key of the balance position.
   */
  async removeLiquidity(newBalancePosition: PublicKey): Promise<void> {
    try {
      console.log('--- Initiating removeLiquidity ---');
      console.log(`Position Public Key: ${newBalancePosition.toBase58()}`);

      if (!this.dlmmPool) {
        throw new Error('DLMM Pool is not initialized. Call initializeDLMMPool() first.');
      }

      // Retrieve user positions
      const userPublicKey = this.config.walletKeypair.publicKey;
      const { userPositions } = await this.dlmmPool.getPositionsByUserAndLbPair(userPublicKey);
      console.log('Retrieved User Positions:', userPositions);

      // Find the specific position matching newBalancePosition
      const userPosition = userPositions.find(({ publicKey }) => publicKey.equals(newBalancePosition));

      if (!userPosition) {
        console.log('No matching position found for the provided position public key.');
        return;
      }

      console.log('Matched User Position:', userPosition);

      // Extract binIds to remove liquidity from
      const binIdsToRemove: number[] = userPosition.positionData.positionBinData.map(
        (bin) => bin.binId
      );

      // Use bpsToRemove from Config
      const bpsToRemove: BN = new BN(this.config.bpsToRemove);
      console.log(`Basis Points to Remove: ${bpsToRemove.toString()}`);
      console.log(`Should Claim and Close: true`);

      // Create transaction instructions to remove liquidity
      const removeLiquidityTxs = await this.dlmmPool.removeLiquidity({
        user: this.config.walletKeypair.publicKey,
        position: userPosition.publicKey,
        binIds: binIdsToRemove,
        bps: bpsToRemove,
        shouldClaimAndClose: true,
      });

      console.log('Initialized Transaction Instructions');

      // Handle multiple transactions if returned as an array
      const transactions = Array.isArray(removeLiquidityTxs) ? removeLiquidityTxs : [removeLiquidityTxs];
      console.log(`Number of Transactions to Send: ${transactions.length}`);

      for (const [index, tx] of transactions.entries()) {
        console.log(`--- Sending Transaction ${index + 1} of ${transactions.length} ---`);

        // Assign the recent blockhash and fee payer
        const { blockhash } = await this.config.connection.getLatestBlockhash('finalized');
        tx.recentBlockhash = blockhash;
        tx.feePayer = this.config.walletKeypair.publicKey;
        console.log('Assigned Blockhash and Fee Payer to Transaction');


        // Signers for the transaction: the user
        const signers: Signer[] = [this.config.walletKeypair];
        console.log('Assigned Signers:', signers.map((s) => s.publicKey.toBase58()));

        // Send and confirm the transaction
        console.log(`Sending Transaction ${index + 1}...`);
        const removeLiquidityTxHash: TransactionSignature = await sendAndConfirmTransaction(
          this.config.connection,
          tx,
          signers,
          {
            skipPreflight: false,
            preflightCommitment: 'confirmed',
          }
        );
        console.log(`Transaction ${index + 1} Signature: ${removeLiquidityTxHash}`);
        console.log(
          `Liquidity removed successfully with signature: ${removeLiquidityTxHash}`
        );
      }

      console.log('--- removeLiquidity Completed Successfully ---');
    } catch (error: any) {
      console.error('Error removing liquidity:', error.message || error);
      console.log('--- removeLiquidity Encountered an Error ---');
    }
  }

  /**
   * Closes a position within the DLMM pool.
   * @param positionPubKey - The public key of the position to close.
   */
  public async closePosition(positionPubKey: PublicKey): Promise<void> {
    try {
      console.log('--- Initiating closePosition ---');
      console.log(`Position Public Key: ${positionPubKey.toBase58()}`);

      if (!this.dlmmPool) {
        throw new Error('DLMM Pool is not initialized. Call initializeDLMMPool() first.');
      }

      // Retrieve all user positions using existing method
      const userPositions = await this.getUserPositions();

      // Find the specific position matching positionPubKey
      const userPosition = userPositions.find((position) =>
        position.publicKey.equals(positionPubKey)
      );

      if (!userPosition) {
        console.error('No matching position found for the provided position public key.');
        return; // Or throw an error if appropriate
      }

      console.log('Matched User Position:', userPosition);

      // **Construct LbPosition with version explicitly set to PositionVersion.V2**
      const position: LbPosition = {
        publicKey: userPosition.publicKey,
        positionData: userPosition.positionData,
        version: PositionVersion.V2, // Explicitly set to V2
      };

      // Generate transaction to close the position
      const closePositionTx = await this.dlmmPool.closePosition({
        owner: this.config.walletKeypair.publicKey,
        position: position, // Pass the LbPosition object
      });

      console.log('Initialized Close Position Transaction');

      // Assign the recent blockhash and fee payer
      const { blockhash } = await this.config.connection.getLatestBlockhash('finalized');
      closePositionTx.recentBlockhash = blockhash;
      closePositionTx.feePayer = this.config.walletKeypair.publicKey;
      console.log('Assigned Blockhash and Fee Payer to Transaction');

      // Signers for the transaction: the user
      const signers: Signer[] = [this.config.walletKeypair];
      console.log('Assigned Signers:', signers.map((s) => s.publicKey.toBase58()));

      // Send and confirm the transaction
      console.log('Sending Transaction...');
      const signature: TransactionSignature = await sendAndConfirmTransaction(
        this.config.connection,
        closePositionTx,
        signers,
        {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
        }
      );

      console.log(`Position closed successfully with signature: ${signature}`);
      console.log('--- closePosition Completed Successfully ---');
    } catch (error: any) {
      console.error('Error closing position:', error.message || error);
      throw error;
    }
  }

  /**
   * Returns the binStep of the DLMM pool.
   * @returns The binStep as a number.
   */
  public getBinStep(): number {
    if (!this.dlmmPool) {
      throw new Error('DLMM Pool is not initialized.');
    }

    // Even if lbPair is not exposed, dlmmPool might have a method or property to get binStep
    const binStepBN = (this.dlmmPool as any).lbPair.binStep; // Use 'as any' if TypeScript complains
    console.log(`Bin Step: ${binStepBN}`);
    return binStepBN;
  }

  /**
   * Checks if the pool can sync with the given market price.
   * @param marketPrice - The current market price.
   * @returns A Promise that resolves to a boolean indicating if synchronization is possible.
   */
  public async canSyncWithMarketPrice(marketPrice: number): Promise<boolean> {
    if (!this.dlmmPool) {
      throw new Error('DLMM Pool is not initialized.');
    }

    // Use getActiveBin() to get the current active bin
    const activeBin = await this.getActiveBin();
    const activeBinId = activeBin.binId;

    // Use the activeBinId to check if synchronization is possible
    const canSync = this.dlmmPool.canSyncWithMarketPrice(marketPrice, activeBinId);
    console.log(`Can Sync with Market Price: ${canSync}`);
    return canSync;
  }

  /**
   * Synchronizes the pool's active bin with the market price.
   * @param marketPrice - The market price to sync with.
   * @returns A Promise that resolves when the synchronization is complete.
   */
  public async syncWithMarketPrice(marketPrice: number): Promise<void> {
    if (!this.dlmmPool) {
      throw new Error('DLMM Pool is not initialized.');
    }

    const ownerPublicKey = new PublicKey(this.config.publickey);

    // Generate the synchronization transaction
    const syncTransaction = await this.dlmmPool.syncWithMarketPrice(marketPrice, ownerPublicKey);

    // Sign and send the transaction
    const signature = await sendAndConfirmTransaction(
      this.config.connection,
      syncTransaction,
      [this.config.walletKeypair],
      {
        preflightCommitment: 'confirmed',
        skipPreflight: false,
      }
    );

    console.log(`Synchronization transaction signature: ${signature}`);
  }

}



// Conditional IIFE
if (require.main === module) {
  (async () => {
    const config = Config.load();
    const client = new DLMMClient(config);
    console.log('DLMMClient instance created from DLMMClient.ts directly.');
    // ... other initialization logic ...
  })();
}

