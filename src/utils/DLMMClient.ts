import { PublicKey, Connection, sendAndConfirmTransaction, Transaction, Signer, Keypair, TransactionSignature, ComputeBudgetProgram } from '@solana/web3.js';
import DLMM, { StrategyType, StrategyParameters, LbPosition, SwapQuote, computeBudgetIx } from '@meteora-ag/dlmm';
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

/**
 * Represents a user's position.
 */
interface UserPosition {
    publicKey: PublicKey;
    positionData: PositionData;
    version: PositionVersion;
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
  
interface PositionVersion {
    // Define based on SDK specifications
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
      console.log('Active Bin:', formatBN(activeBin));

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
   * @param strategyType - The strategy type to use for adding liquidity (as defined in the DLMM SDK).
   * @returns
   */
  async createPosition(
    totalXAmount: BN,
    strategyType: StrategyType,
  ): Promise<PublicKey> {
    try {
      console.log('--- Initiating createPosition ---');
      console.log(`Strategy Type: ${StrategyType[strategyType]}`);


      if (!this.dlmmPool) {
        throw new Error('DLMM Pool is not initialized. Call initializeDLMMPool() first.');
      }

      // Retrieve active bin information
      const { activeBin } = await this.dlmmPool.getPositionsByUserAndLbPair(this.config.walletKeypair.publicKey);
      console.log('Retrieved Active Bin:', formatBN(activeBin));

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

      // **Debugging: Log Instructions**
      console.log('Transaction Instructions:', createPositionTx.instructions.map((ix, idx) => ({
        index: idx,
        programId: ix.programId.toBase58(),
        dataLength: ix.data.length,
        keys: ix.keys.map(key => key.pubkey.toBase58()),
      })));

      // Send and confirm the transaction using Solana's sendAndConfirmTransaction method
      const signature = await sendAndConfirmTransaction(
        this.config.connection,
        createPositionTx,
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
      console.log('--- createPosition Completed Successfully ---');

      // Return the positionPubKey upon successful creation
      return positionPubKey;
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
      // Re-throw the error to ensure the caller is aware of the failure
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

      // Define the basis points to remove, e.g., 10000 BPS = 100%
      const bpsToRemove: BN = new BN(10000);

      console.log(`Bin IDs to Remove: ${binIdsToRemove.join(', ')}`);
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

}

/**
 * Main execution block

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
    console.log('ATA (Associated Token Accounts) ensured.');

    // Check token balances before proceeding
    await client.checkTokenBalances();
    console.log('Token balances checked.');

    // Get the active bin
    const activeBin = await client.getActiveBin();
    console.log('Active Bin:', activeBin);

    // Get user positions
    const userPositions = await client.getUserPositions();
    console.log('User Positions:', userPositions);


       /** 
    // Example Swap Operation
    const swapAmount = new BN(10000);
    const swapYtoX = false; //Set logic where if swapping Y to X set true, otherwise false
    const allowedSlippageBps = new BN(50); // 0.1% slippage, set dynamic slippage based on success rate of transaction

    await client.swapTokens(swapAmount, swapYtoX, allowedSlippageBps);

    */
    // -------------------------------
    // Commenting Out Create Position
    // -------------------------------
    /*
    // Example Create Position Operation
    const totalXAmount = new BN(500000); // Adjust as needed
    const strategyType = StrategyType.SpotBalanced; // Example strategy type as defined in DLMM SDK

    await client.createPosition(totalXAmount, strategyType);
    console.log('Position created successfully.');
    */

    // ----------------------------------------
    // Adding Remove Liquidity Functionality
    // ----------------------------------------

    /** 
    if (userPositions.length === 0) {
      console.log('No user positions found to remove liquidity from.');
    } else {
      // Select the position to remove liquidity from
      // For example, selecting the first position. Adjust this to only remove positions for a pair that meet certain conditions. Or remove all positions and recreate
      const positionToRemove = userPositions[0].publicKey; 
      console.log(`Selected Position for Liquidity Removal: ${positionToRemove.toBase58()}`);

      // Remove Liquidity from the selected position
      await client.removeLiquidity(positionToRemove);
      console.log('Liquidity removal process initiated.');
    }

  } catch (error: any) {
    console.error('Error running DLMMClient:', error.message || error);
  }
})();
 */

// Conditional IIFE
if (require.main === module) {
  (async () => {
    const config = Config.load();
    const client = new DLMMClient(config);
    console.log('DLMMClient instance created from DLMMClient.ts directly.');
    // ... other initialization logic ...
  })();
}

