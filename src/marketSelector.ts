import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import DLMM, {getTokensMintFromPoolAddress, getTokenDecimals} from '@meteora-ag/dlmm';
import { Config } from './models/Config';
import { createSingleSidePosition } from './utils/createSingleSidePosition';
import { PositionStorage } from './utils/PositionStorage';
import BN from 'bn.js';
import axios from 'axios'; // For Jupiter API calls
import bs58 from 'bs58';
import * as os from 'os';
import { swapTokensWithRetry } from './utils/swapTokens';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { getTokenPricesJupiter, getTokenPriceJupiter } from './utils/fetchPriceJupiter';
import { withSafeKeypair } from './utils/walletHelper';
import { MarketRepository } from './services/marketRepository';

interface MarketInfo {
  name: string;
  publicKey: string;
  defaultDollarAmount?: number;
  binStep?: number;
  baseFee?: string;
  dailyAPR?: number;
  tvl?: number; 
  volumeTvlRatio?: number;
  risk?: string;
  tokenXLogo?: string;
  tokenYLogo?: string;
  tokenXMint?: string;
  tokenYMint?: string;
  tokenXSymbol?: string;
  tokenYSymbol?: string;
}

export class MarketSelector {
  public markets: MarketInfo[] = [];
  private connection: Connection;
  private wallet: Keypair;
  private positionStorage: PositionStorage;
  private config: Config;
  private marketRepository: MarketRepository;
  private supabaseEnabled: boolean = true;
  
  constructor(
    connection: Connection, 
    wallet: Keypair, 
    positionStorage: PositionStorage,
    config: Config
  ) {
    this.connection = connection;
    this.wallet = wallet;
    this.positionStorage = positionStorage;
    this.config = config;
    this.marketRepository = new MarketRepository();
    
    // If Supabase is enabled, try to load markets from there
    if (this.supabaseEnabled) {
      this.loadMarketsFromSupabase().catch(error => {
        console.error('Error loading markets from Supabase:', error);
      });
      
      // No need to sync empty markets array initially
      // We'll load data from Supabase first
    }
  }

  private async loadMarketsFromSupabase(): Promise<void> {
    try {
      const markets = await this.marketRepository.getAllMarkets();
      
      // Only replace markets if we get data from Supabase
      if (markets && markets.length > 0) {
        // Convert from Supabase format to the format expected by MarketSelector
        this.markets = markets.map(market => ({
          name: market.name,
          publicKey: market.public_key,
          binStep: market.bin_step,
          baseFee: market.base_fee,
          dailyAPR: market.daily_apr,
          tvl: market.tvl,
          volumeTvlRatio: market.volume_tvl_ratio,
          risk: market.risk,
          tokenXMint: market.token_x_mint,
          tokenYMint: market.token_y_mint,
          tokenXSymbol: market.token_x_symbol,
          tokenYSymbol: market.token_y_symbol,
          tokenXLogo: market.token_x_logo,
          tokenYLogo: market.token_y_logo
        }));
        
        console.log(`Loaded ${this.markets.length} markets from Supabase`);
      }
    } catch (error) {
      console.error('Error loading markets from Supabase:', error);
      // Continue with markets from JSON file
    }
  }

  public async promptUserForMarketSelection(): Promise<MarketInfo> {
    const marketChoices = this.markets.map((market, index) => ({
      name: `${index + 1}. ${market.name} - ${market.risk || 'Unknown'} Risk | Fee: ${market.baseFee || 'N/A'} | Daily APR: ${market.dailyAPR ? market.dailyAPR + '%' : 'N/A'}`,
      value: market.publicKey
    }));

    const { selectedMarketPublicKey } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedMarketPublicKey',
        message: 'Select a market to use:',
        choices: marketChoices
      }
    ]);

    // Find the chosen market info
    const chosenMarket = this.markets.find(
      market => market.publicKey === selectedMarketPublicKey
    );
    if (!chosenMarket) {
      throw new Error(`Could not find market for PublicKey: ${selectedMarketPublicKey}`);
    }

    return chosenMarket;
  }

  public async initializeSelectedMarket(chosenMarket: MarketInfo): Promise<DLMM> {
    try {
      // Create a new Meteora DLMM instance using the pool address
      const poolPubkey = new PublicKey(chosenMarket.publicKey);
      
      // Initialize DLMM instance correctly
      const dlmm = await DLMM.create(
        this.connection,
        poolPubkey
      );
      
      console.log(`Market "${chosenMarket.name}" initialized at ${chosenMarket.publicKey}`);
      
      // Return the initialized DLMM instance
      return dlmm;
    } catch (error) {
      console.error(`Error initializing market ${chosenMarket.name}:`, error);
      throw error;
    }
  }

  /**
   * Get token balances from the wallet
   */
  private async getTokenBalances(): Promise<Record<string, { balance: number, value: number }>> {
    try {
      // Get token accounts owned by the wallet
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
        this.wallet.publicKey,
        { programId: TOKEN_PROGRAM_ID }
      );
      
      // Extract mint addresses
      const mintAddresses = tokenAccounts.value.map(account => 
        account.account.data.parsed.info.mint
      );
      
      // Add SOL mint address
      const SOL_MINT = 'So11111111111111111111111111111111111111112';
      mintAddresses.push(SOL_MINT);
      
      // Get prices for all tokens at once
      const prices = await getTokenPricesJupiter(mintAddresses);
      
      // Create a map of token mint to balance and value
      const balances: Record<string, { balance: number, value: number }> = {};
      
      // Process each token account
      for (const account of tokenAccounts.value) {
        const parsedInfo = account.account.data.parsed.info;
        const mint = parsedInfo.mint;
        const balance = parsedInfo.tokenAmount.uiAmount;
        
        // Calculate value
        const price = prices[mint] || 0;
        const value = balance * price;
        
        balances[mint] = { balance, value };
      }
      
      // Get SOL balance
      const solBalance = await this.connection.getBalance(this.wallet.publicKey) / 1_000_000_000;
      const solPrice = prices[SOL_MINT] || 0;
      const solValue = solBalance * solPrice;
      
      balances[SOL_MINT] = { balance: solBalance, value: solValue };
      
      return balances;
    } catch (error) {
      console.error('Error getting token balances:', error);
      return {};
    }
  }

  public async createPositionInSelectedMarket(
    dlmm: DLMM,
    chosenMarket: MarketInfo,
    singleSidedX: boolean,
    userDollarAmount?: number
  ): Promise<void> {
    try {
      // Use user-provided amount if present, otherwise use default or fall back to 1
      const dollarAmount = 
        userDollarAmount !== undefined
          ? userDollarAmount
          : (chosenMarket.defaultDollarAmount !== undefined
              ? chosenMarket.defaultDollarAmount
              : 1); // fallback
      
      console.log(`Creating position in ${chosenMarket.name} with $${dollarAmount}`);
      
      // Get token mints from the pool
      const targetTokenMint = singleSidedX ? dlmm.tokenX.publicKey : dlmm.tokenY.publicKey;
      const otherTokenMint = singleSidedX ? dlmm.tokenY.publicKey : dlmm.tokenX.publicKey;
      
      // First check balances
      const balances = await this.getTokenBalances();
      
      // Get the token price using Jupiter
      const prices = await getTokenPricesJupiter([targetTokenMint.toString(), otherTokenMint.toString()]);
      const targetTokenPrice = prices[targetTokenMint.toString()] || 0;
      const otherTokenPrice = prices[otherTokenMint.toString()] || 0;
      
      if (targetTokenPrice === 0) {
        throw new Error(`Failed to get price for token: ${targetTokenMint.toString()}`);
      }
      
      // Calculate current value of target token
      const currentBalance = balances[targetTokenMint.toString()]?.balance || 0;
      const currentValue = currentBalance * targetTokenPrice;
      
      console.log(`Current ${singleSidedX ? 'X' : 'Y'} token balance: $${currentValue.toFixed(2)}`);
      
      // Check if we have enough of the target token
      if (currentValue < dollarAmount) {
        const shortfall = dollarAmount - currentValue;
        console.log(`Insufficient ${singleSidedX ? 'X' : 'Y'} token balance. Need $${shortfall.toFixed(2)} more.`);
        
        // Check if we have enough of the other token
        const otherTokenBalance = balances[otherTokenMint.toString()]?.balance || 0;
        const otherTokenValue = otherTokenBalance * otherTokenPrice;
        
        if (otherTokenValue < shortfall) {
          throw new Error(`Insufficient funds in both tokens. Need $${shortfall.toFixed(2)} more.`);
        }
        
        // Calculate how much of the other token we need to swap
        // Add 1% for transaction fees and slippage
        const swapBuffer = 1.01;
        const otherTokenAmount = (shortfall * swapBuffer) / otherTokenPrice;
        
        // Get token decimals
        const otherTokenDecimals = await getTokenDecimals(this.connection, otherTokenMint);
        
        // Convert to lamports
        const swapAmount = new BN(Math.floor(otherTokenAmount * Math.pow(10, otherTokenDecimals)).toString());
        
        console.log(`Swapping ${otherTokenAmount.toFixed(6)} ${singleSidedX ? 'Y' : 'X'} tokens to get ${(shortfall / targetTokenPrice).toFixed(6)} ${singleSidedX ? 'X' : 'Y'} tokens`);
        
        // Perform the swap - direction parameter is swapYtoX
        // If singleSidedX is true, we need X, so swapYtoX should be true (Y->X)
        // If singleSidedX is false, we need Y, so swapYtoX should be false (X->Y)
        await withSafeKeypair(this.config, async (keypair) => {
          return swapTokensWithRetry(
            this.connection,
            dlmm,
            swapAmount,
            singleSidedX, // This matches our need: true = Y->X, false = X->Y
            keypair
          );
        });
        
        console.log('Swap completed, continuing to position creation');
        
        // Wait a moment for the transaction to be fully processed
        console.log('Waiting for transaction to be confirmed...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      // After getting updated token balances
      const updatedBalances = await this.getTokenBalances();
      const newBalance = updatedBalances[targetTokenMint.toString()]?.balance || 0;
      console.log(`Updated ${singleSidedX ? 'X' : 'Y'} token balance: ${newBalance.toFixed(6)} ($ ${(newBalance * targetTokenPrice).toFixed(2)})`);

      // MODIFY THIS PART: Use actual balance with safety margin instead of dollar amount conversion
      // Calculate token amount as a percentage of actual available balance (use 97% of what's available)
      const safetyFactor = 0.97; // Use only 97% of available balance to account for fees/fluctuations
      const tokenAmount = newBalance * safetyFactor;

      // Convert to lamports
      const tokenDecimals = await getTokenDecimals(this.connection, targetTokenMint);
      console.log(`Token decimals: ${tokenDecimals}`);
      const tokenAmountLamports = Math.floor(tokenAmount * Math.pow(10, tokenDecimals));
      const tokenAmountBN = new BN(tokenAmountLamports.toString());

      console.log(`Using ${tokenAmount.toFixed(6)} tokens (${tokenAmountLamports} lamports) for position creation`);
      
      // Call your existing createSingleSidePosition function with withSafeKeypair
      await withSafeKeypair(this.config, async (keypair) => {
        // Generate a new keypair for the position itself
        const positionKeypair = Keypair.generate();
        console.log(`Generated new keypair for position: ${positionKeypair.publicKey.toString()}`);

        // Call the on-chain function correctly
        return createSingleSidePosition(
          this.connection,
          dlmm,
          keypair, // This is the wallet keypair for fee payment
          positionKeypair, // This is the keypair for the new position
          tokenAmountBN,
          singleSidedX
          // positionStorage argument removed
        );
      });
      
      console.log(`Position creation completed in ${chosenMarket.name}`);
    } catch (error) {
      console.error(`Error creating position in ${chosenMarket.name}:`, error);
      throw error;
    }
  }

  public async getWalletInfo() {
    const balances = await this.getTokenBalances();
    const SOL_MINT = 'So11111111111111111111111111111111111111112';
    
    return {
      solBalance: balances[SOL_MINT]?.balance || 0,
      solValue: balances[SOL_MINT]?.value || 0,
      // You could include other tokens here if needed
      balances
    };
  }
}

// If this file is run directly, execute this code
if (require.main === module) {
  // Import dotenv for loading environment variables
  const dotenv = require('dotenv');
  dotenv.config();
  
  console.log("Starting Market Selector...");
  
  // Standalone execution function
  async function runMarketSelector() {
    try {
      // Load config following your existing pattern
      const config = await Config.load();
      
      // Create connection using config's RPC endpoint with fallback
      const connection = new Connection(process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com', 'confirmed');
      
      // Initialize position storage
      const positionStorage = new PositionStorage(config);
      
      // Load wallet from private key in .env (same approach as testRebalanceManager)
      let walletKeypair: Keypair;
      if (process.env.PRIVATE_KEY) {
        try {
          // Try to decode the private key from base58
          const privateKeyBytes = bs58.decode(process.env.PRIVATE_KEY);
          walletKeypair = Keypair.fromSecretKey(privateKeyBytes);
          console.log(`✅ Wallet loaded from PRIVATE_KEY: ${walletKeypair.publicKey.toString()}`);
        } catch (error) {
          console.error('Error decoding private key:', error);
          throw new Error('Invalid private key format');
        }
      } else {
        // Fallback to file-based wallet
        const walletPath = path.join(os.homedir(), '.config', 'solana', 'id.json');
        console.log(`Loading wallet from file: ${walletPath}`);
        
        if (!fs.existsSync(walletPath)) {
          throw new Error(`Wallet file not found at ${walletPath}`);
        }
        
        const walletKeyData = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
        walletKeypair = Keypair.fromSecretKey(new Uint8Array(walletKeyData));
        console.log(`✅ Wallet loaded from file: ${walletKeypair.publicKey.toString()}`);
      }
      
      // Create the market selector with your connection, wallet and storage
      const marketSelector = new MarketSelector(connection, walletKeypair, positionStorage, config);
      
      // Prompt user to select a market
      console.log("Please select a market:");
      const chosenMarket = await marketSelector.promptUserForMarketSelection();
      console.log(`You selected: ${chosenMarket.name}`);
      
      // Initialize the selected market
      console.log("Initializing market...");
      const dlmm = await marketSelector.initializeSelectedMarket(chosenMarket);
      
      // Ask if user wants single-sided X or Y
      const { singleSidedChoice } = await inquirer.prompt([
        {
          type: 'list',
          name: 'singleSidedChoice',
          message: 'Create single-sided position with:',
          choices: [
            { name: 'Token X', value: true },
            { name: 'Token Y', value: false }
          ]
        }
      ]);
      
      // Create the position
      console.log(`Creating position with ${singleSidedChoice ? 'Token X' : 'Token Y'}...`);
      await marketSelector.createPositionInSelectedMarket(
        dlmm, 
        chosenMarket, 
        singleSidedChoice
      );
      
      console.log('Position creation complete!');
      
    } catch (error) {
      console.error('Error in market selection process:', error);
    }
  }
  
  // Run the standalone function
  runMarketSelector().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
