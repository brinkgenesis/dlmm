import { PublicKey, Connection, sendAndConfirmTransaction, Transaction, Signer, Keypair, TransactionSignature } from '@solana/web3.js';
import DLMM, { StrategyType, StrategyParameters, LbPosition, SwapQuote } from '@meteora-ag/dlmm';
import { Config } from '../models/Config';
import '@coral-xyz/anchor';
import BN from 'bn.js';
import { 
  getAssociatedTokenAddress, 
  getAccount, 
  createAssociatedTokenAccountInstruction 
} from '@solana/spl-token';
import { SendTransactionError } from '@solana/web3.js';

/**
 * Represents a user's position.
 */
interface UserPosition {
  positionData: {
    positionBinData: any; // Replace with the actual type
  };
  // Add other relevant fields here
}

/**
 * DLMMClient is responsible for initializing the Meteora DLMM SDK and retrieving active bins.
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
  async getActiveBin(): Promise<{ binId: number; price: string }> {
    try {
      if (!this.dlmmPool) {
        throw new Error('DLMM Pool is not initialized. Call initializeDLMMPool() first.');
      }

      const activeBin = await this.dlmmPool.getActiveBin();
      console.log('Active Bin:', activeBin);

      const activeBinPriceLamport = activeBin.price;
      const activeBinPricePerToken = this.dlmmPool.fromPricePerLamport(Number(activeBin.price));

      console.log(`Active Bin Price (Lamport): ${activeBinPriceLamport}`);
      console.log(`Active Bin Price per Token: ${activeBinPricePerToken}`);

      return {
        binId: activeBin.binId,
        price: activeBinPricePerToken.toString(),
      };
    } catch (error: any) {
      console.error('Error retrieving active bin:', error.message || error);
      throw error;
    }
  }

  /**
   * Retrieves user positions from the initialized DLMM pool.
   */
  async getUserPositions(): Promise<void> {
    try {
      if (!this.dlmmPool) {
        throw new Error('DLMM Pool is not initialized. Call initializeDLMMPool() first.');
      }

      const userPublicKey = new PublicKey(this.config.publickey); // Ensure 'publickey' is correct
      console.log(`Fetching positions for user: ${userPublicKey.toBase58()}`);

      // Fetch user positions using the initialized dlmmPool
      const { userPositions } = await this.dlmmPool.getPositionsByUserAndLbPair(userPublicKey);

      if (!userPositions || userPositions.length === 0) {
        console.log('No positions found for the user.');
        return;
      }

      // Extract and log bin data from each position
      userPositions.forEach((position: UserPosition, index: number) => {
        const binData = position.positionData.positionBinData;
        console.log(`Position ${index + 1}:`, position);
        console.log(`Bin Data ${index + 1}:`, binData);
      });
    } catch (error: any) {
      console.error('Error fetching user positions:', error.message || error);
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
   * Retrieves and logs the balances of Token X and Token Y for the user.
   */
  async checkTokenBalances(): Promise<void> {
    try {
      if (!this.dlmmPool) {
        throw new Error('DLMM Pool is not initialized. Call initializeDLMMPool() first.');
      }

      const userPublicKey = new PublicKey(this.config.publickey);
      const tokenXMint = this.dlmmPool.tokenX.publicKey;
      const tokenYMint = this.dlmmPool.tokenY.publicKey;

      const ataTokenX = await getAssociatedTokenAddress(tokenXMint, userPublicKey);
      const ataTokenY = await getAssociatedTokenAddress(tokenYMint, userPublicKey);

      // Fetch account info
      const tokenXAccount = await getAccount(this.config.connection, ataTokenX);
      const tokenYAccount = await getAccount(this.config.connection, ataTokenY);

      console.log(`Token X Balance: ${tokenXAccount.amount.toString()} tokens`);
      console.log(`Token Y Balance: ${tokenYAccount.amount.toString()} tokens`);
    } catch (error: any) {
      console.error('Error checking token balances:', error.message || error);
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
        lbPair: this.dlmmPool.pubkey,
        user: this.config.walletKeypair.publicKey,
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
   * @param strategyType - The strategy type to use for adding liquidity (as defined in the DLMM SDK).
   * @param slippage - The slippage percentage to be used for the liquidity pool (in BPS).
   */
  async createPosition(
    totalXAmount: BN,
    strategyType: StrategyType,
  ): Promise<void> {
    try {
      console.log('--- Initiating createPosition ---');
      console.log(`Strategy Type: ${StrategyType[strategyType]}`);


      if (!this.dlmmPool) {
        throw new Error('DLMM Pool is not initialized. Call initializeDLMMPool() first.');
      }

      // Retrieve active bin information
      const { activeBin } = await this.dlmmPool.getPositionsByUserAndLbPair(this.config.walletKeypair.publicKey);
      console.log('Retrieved Active Bin:', activeBin);

      if (!activeBin) {
        throw new Error('Active bin not found. Ensure the pool has active bins.');
      }

      // Calculate min and max bin IDs based on active bin
      const TOTAL_RANGE_INTERVAL = 10; // 10 bins on each side of the active bin
      const minBinId = activeBin.binId - TOTAL_RANGE_INTERVAL;
      const maxBinId = activeBin.binId + TOTAL_RANGE_INTERVAL;

      // Validate bin IDs against DLMM SDK constraints (if any)
      // Example:
      // const MIN_BIN_ID = -443636;
      // const MAX_BIN_ID = 443636;
      // if (minBinId < MIN_BIN_ID || maxBinId > MAX_BIN_ID) {
      //   throw new Error(`Bin IDs must be between ${MIN_BIN_ID} and ${MAX_BIN_ID}.`);
      // }

      // Convert price per lamport to real price
      const activeBinPricePerTokenStr = this.dlmmPool.fromPricePerLamport(Number(activeBin.price));
      console.log(`Active Bin Price per Token (String): ${activeBinPricePerTokenStr}`);

      const activeBinPricePerToken = parseFloat(activeBinPricePerTokenStr);
      console.log(`Active Bin Price per Token (Number): ${activeBinPricePerToken}`);

      // Calculate totalYAmount based on activeBinPricePerToken
      const totalYAmount = totalXAmount.mul(new BN(Math.floor(activeBinPricePerToken)));

      console.log(`Total Bin Spread: ${TOTAL_RANGE_INTERVAL}`);
      console.log(`Smallest Bin ID: ${minBinId}`);
      console.log(`Largest Bin ID: ${maxBinId}`);
      console.log(`Total Token X Size: ${totalXAmount.toString()}`);
      console.log(`Total Token Y Size: ${totalYAmount.toString()}`);

      // Generate a new Keypair for the position
      const positionKeypair = Keypair.generate();
      const positionPubKey = positionKeypair.publicKey;
      console.log(`Generated Position Keypair: ${positionPubKey.toBase58()}`);

      // Define the strategy parameters as per DLMM SDK documentation
      const strategy: StrategyParameters = {
        minBinId,
        maxBinId,
        strategyType,
        // singleSidedX: false, // Optional: Uncomment and set if needed
      };
      console.log('Strategy Parameters:', strategy);

      // Fetch the latest blockhash
      const { blockhash } = await this.config.connection.getLatestBlockhash('finalized');
      console.log(`Fetched Latest Blockhash: ${blockhash}`);

      // Prepare the transaction using the DLMM SDK's initializePositionAndAddLiquidityByStrategy method
      const createPositionTx = await this.dlmmPool.initializePositionAndAddLiquidityByStrategy({
        positionPubKey,
        user: this.config.walletKeypair.publicKey,
        totalXAmount,
        totalYAmount,
        strategy,
      });

      // Signers for the transaction: the user and the new position keypair
      const signers: Signer[] = [this.config.walletKeypair, positionKeypair];

      // Send and confirm the transaction using Solana's sendAndConfirmTransaction method
      const signature = await sendAndConfirmTransaction(
        this.config.connection,
        createPositionTx,
        signers,
        {
          skipPreflight: false,
          preflightCommitment: 'confirmed'
        }
      );
      console.log(`Transaction Signature: ${signature}`);
      console.log(`Position created successfully with signature: ${signature}`);
      console.log(`Position Public Key: ${positionPubKey.toBase58()}`);
      console.log('--- createPosition Completed Successfully ---');
    } catch (error: any) {
      if (error instanceof SendTransactionError) {
        console.error('Transaction Logs:', error.logs);
        console.error('Transaction Error:', error.message);
        // Optionally, retrieve detailed logs
        try {
          const detailedLogs = await error.getLogs(this.config.connection);
          console.error('Detailed Transaction Logs:', detailedLogs);
        } catch (logError) {
          console.error('Failed to retrieve detailed logs:', logError);
        }
      } else {
        console.error('Error creating position:', error.message || error);
      }
      console.log('--- createPosition Encountered an Error ---');
    }
  }
}

/**
 * Main execution block
 */
(async () => {
  try {
    // Load your configuration
    const config = Config.load();
    console.log('Configuration loaded successfully.');

    // Create DLMMClient instance
    const client = new DLMMClient(config);
    console.log('DLMMClient instance created.');

    // Define the DLMM pool's public key
    const poolPublicKey = new PublicKey('ARwi1S4DaiTG5DX7S4M4ZsrXqpMD1MrTmbu9ue2tpmEq'); // Replace with your actual pool public key

    // Initialize the DLMM Pool
    await client.initializeDLMMPool(poolPublicKey);
    console.log('DLMM Pool initialized.');

    // Ensure ATAs are initialized
    await client.ensureATAs();

    // Check token balances before proceeding
    await client.checkTokenBalances();

    // Get the active bin
    const activeBin = await client.getActiveBin();
    console.log('Active Bin:', activeBin);

    // Get user positions
    await client.getUserPositions();

    /** 
    // Example Swap Operation
    const swapAmount = new BN(10000);
    const swapYtoX = false;
    const allowedSlippageBps = new BN(50); // 0.1% slippage

    await client.swapTokens(swapAmount, swapYtoX, allowedSlippageBps);

    */

    // Example Create Position Operation
    const totalXAmount = new BN(500000); // Adjust as needed
    const strategyType = StrategyType.SpotBalanced; // Example strategy type as defined in DLMM SDK

    await client.createPosition(totalXAmount, strategyType);
  } catch (error: any) {
    console.error('Error running DLMMClient:', error.message || error);
  }
})();
