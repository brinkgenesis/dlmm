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
  public markets: MarketInfo[];
  private connection: Connection;
  private wallet: Keypair;
  private positionStorage: PositionStorage;
  private config: Config;
  
  constructor(
    connection: Connection, 
    wallet: Keypair, 
    positionStorage: PositionStorage,
    config: Config
  ) {
    // Get market data from JSON file
    const marketsPath = path.join(__dirname, 'models', 'marketSelection.json');
    const jsonData = fs.readFileSync(marketsPath, 'utf-8');
    const parsed = JSON.parse(jsonData);

    this.markets = parsed.markets;
    this.connection = connection;
    this.wallet = wallet;
    this.positionStorage = positionStorage;
    this.config = config;
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
    singleSidedX: boolean
  ): Promise<void> {
    try {
      // Use defaultDollarAmount if present, or prompt the user
      const dollarAmount = 
        chosenMarket.defaultDollarAmount !== undefined
          ? chosenMarket.defaultDollarAmount
          : 1; // fallback
      
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
        
        // Refresh token balances after swap
        const updatedBalances = await this.getTokenBalances();
        const newBalance = updatedBalances[targetTokenMint.toString()]?.balance || 0;
        console.log(`Updated ${singleSidedX ? 'X' : 'Y'} token balance: ${newBalance.toFixed(6)} ($ ${(newBalance * targetTokenPrice).toFixed(2)})`);
      }
      
      // Refresh prices again to be safe
      const updatedPrices = await getTokenPricesJupiter([targetTokenMint.toString()]);
      const tokenPrice = updatedPrices[targetTokenMint.toString()] || targetTokenPrice;
      
      console.log(`Token price: $${tokenPrice}`);
      
      // Get token decimals 
      const tokenDecimals = await getTokenDecimals(this.connection, targetTokenMint);
      console.log(`Token decimals: ${tokenDecimals}`);
      
      // Calculate token amount from dollar amount (with 1% buffer to account for slippage)
      const tokenAmount = (dollarAmount * 0.99) / tokenPrice;
      
      // Convert to lamports (multiply by 10^decimals)
      const tokenAmountLamports = Math.floor(tokenAmount * Math.pow(10, tokenDecimals));
      
      // Convert to BN
      const tokenAmountBN = new BN(tokenAmountLamports.toString());
      
      console.log(`Converting $${dollarAmount} to ${tokenAmount} tokens (${tokenAmountLamports} lamports)`);
      
      // Call your existing createSingleSidePosition function with withSafeKeypair
      await withSafeKeypair(this.config, async (keypair) => {
        return createSingleSidePosition(
          this.connection,
          dlmm,
          keypair,
          tokenAmountBN,
          singleSidedX,
          this.positionStorage
        );
      });
      
      console.log(`Position creation completed in ${chosenMarket.name}`);
    } catch (error) {
      console.error(`Error creating position in ${chosenMarket.name}:`, error);
      throw error;
    }
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
