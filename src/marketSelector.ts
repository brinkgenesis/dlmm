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
}

export class MarketSelector {
  private markets: MarketInfo[];
  private connection: Connection;
  private wallet: Keypair;
  private positionStorage: PositionStorage;
  
  constructor(
    connection: Connection, 
    wallet: Keypair, 
    positionStorage: PositionStorage
  ) {
    // Get market data from JSON file
    const marketsPath = path.join(__dirname, 'models', 'marketSelection.json');
    const jsonData = fs.readFileSync(marketsPath, 'utf-8');
    const parsed = JSON.parse(jsonData);

    this.markets = parsed.markets;
    this.connection = connection;
    this.wallet = wallet;
    this.positionStorage = positionStorage;
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

  private async getTokenPricesJupiter(mintAddresses: string[]): Promise<Record<string, number>> {
    try {
      // Format mint addresses as a comma-separated list
      const mintIds = mintAddresses.join(',');
      
      // Use the v2 Jupiter price API endpoint
      const endpoint = `https://api.jup.ag/price/v2?ids=${mintIds}`;
      console.log(`Fetching prices from Jupiter...`);
      
      // Call Jupiter API
      const response = await axios.get(endpoint, {
        timeout: 10000, // 10 second timeout
      });
      
      // Correct parsing for the nested data structure
      const apiData = response.data.data as Record<string, { price: string } | null>;
      
      // Create a map of mint address to price
      const prices: Record<string, number> = {};
      let priceCount = 0;
      
      for (const mintAddress of mintAddresses) {
        const priceData = apiData[mintAddress];
        if (priceData && priceData.price) {
          prices[mintAddress] = parseFloat(priceData.price);
          priceCount++;
        } else {
          console.warn(`No price found for token: ${mintAddress}`);
          prices[mintAddress] = 0;
        }
      }
      
      console.log(`Successfully fetched ${priceCount} token prices`);
      return prices;
    } catch (error) {
      console.error('Error fetching Jupiter prices:', error instanceof Error ? error.message : String(error));
      // Return empty prices on error
      return mintAddresses.reduce((prices, mint) => {
        prices[mint] = 0;
        return prices;
      }, {} as Record<string, number>);
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
      const prices = await this.getTokenPricesJupiter(mintAddresses);
      
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
      
      // Get the token mints from the pool address using the utility function
      const { tokenXMint, tokenYMint } = await getTokensMintFromPoolAddress(
        this.connection, 
        chosenMarket.publicKey
      );
      
      // Get the token mint address we need to price (X or Y depending on singleSidedX flag)
      const targetTokenMint = singleSidedX ? tokenXMint : tokenYMint;
      const otherTokenMint = singleSidedX ? tokenYMint : tokenXMint;
      
      // Get our wallet token balances
      const balances = await this.getTokenBalances();
      
      // Check if we have the target token and enough value
      const targetTokenBalance = balances[targetTokenMint.toString()];
      const targetTokenValue = targetTokenBalance?.value || 0;
      
      console.log(`Current ${singleSidedX ? 'X' : 'Y'} token balance: $${targetTokenValue.toFixed(2)}`);
      
      // Check if we need to swap tokens
      if (targetTokenValue < dollarAmount) {
        const shortfall = dollarAmount - targetTokenValue;
        console.log(`Insufficient ${singleSidedX ? 'X' : 'Y'} token balance. Need $${shortfall.toFixed(2)} more.`);
        
        // Check if we have enough of the other token
        const otherTokenBalance = balances[otherTokenMint.toString()];
        const otherTokenValue = otherTokenBalance?.value || 0;
        
        if (otherTokenValue < shortfall) {
          throw new Error(`Insufficient funds. Need $${shortfall.toFixed(2)} more but only have $${otherTokenValue.toFixed(2)} in other token.`);
        }
        
        // Get token prices
        const prices = await this.getTokenPricesJupiter([targetTokenMint.toString(), otherTokenMint.toString()]);
        const targetTokenPrice = prices[targetTokenMint.toString()] || 0;
        const otherTokenPrice = prices[otherTokenMint.toString()] || 0;
        
        if (targetTokenPrice === 0 || otherTokenPrice === 0) {
          throw new Error('Failed to get token prices for swap');
        }
        
        // Calculate how much of the other token we need to swap
        const otherTokenAmount = shortfall / otherTokenPrice;
        
        // Get token decimals
        const otherTokenDecimals = await getTokenDecimals(this.connection, otherTokenMint);
        
        // Convert to lamports
        const swapAmount = new BN(Math.floor(otherTokenAmount * Math.pow(10, otherTokenDecimals)).toString());
        
        console.log(`Swapping ${otherTokenAmount.toFixed(6)} ${singleSidedX ? 'Y' : 'X'} tokens to get ${(shortfall / targetTokenPrice).toFixed(6)} ${singleSidedX ? 'X' : 'Y'} tokens`);
        
        // Perform the swap - note the swapYtoX parameter is !singleSidedX because:
        // If singleSidedX is true, we need token X, so we're swapping Y to X (swapYtoX = true)
        // If singleSidedX is false, we need token Y, so we're swapping X to Y (swapYtoX = false)
        await swapTokensWithRetry(
          this.connection,
          dlmm,
          swapAmount,
          !singleSidedX, // This is correct - if we need X, we swap Y->X
          this.wallet
        );
        
        console.log('Swap completed, continuing to position creation');
      }
      
      // Get the token price using your Jupiter utility
      const prices = await this.getTokenPricesJupiter([targetTokenMint.toString()]);
      const tokenPrice = prices[targetTokenMint.toString()] || 0;
      
      if (tokenPrice === 0) {
        throw new Error(`Failed to get price for token: ${targetTokenMint.toString()}`);
      }
      
      console.log(`Token price: $${tokenPrice}`);
      
      // Get token decimals using the getTokenDecimals function from Meteora SDK
      const tokenDecimals = await getTokenDecimals(this.connection, targetTokenMint);
      console.log(`Token decimals: ${tokenDecimals}`);
      
      // Calculate token amount from dollar amount
      // tokenAmount = dollarAmount / tokenPrice
      const tokenAmount = dollarAmount / tokenPrice;
      
      // Convert to lamports (multiply by 10^decimals)
      const tokenAmountLamports = Math.floor(tokenAmount * Math.pow(10, tokenDecimals));
      
      // Convert to BN
      const tokenAmountBN = new BN(tokenAmountLamports.toString());
      
      console.log(`Converting $${dollarAmount} to ${tokenAmount} tokens (${tokenAmountLamports} lamports)`);
      
      // Call your existing createSingleSidePosition function
      // Pass the token amount in BN format
      await createSingleSidePosition(
        this.connection,
        dlmm,
        this.wallet,
        tokenAmountBN,
        singleSidedX,
        this.positionStorage
      );
      
      console.log(`Position creation initiated in ${chosenMarket.name}`);
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
      const marketSelector = new MarketSelector(connection, walletKeypair, positionStorage);
      
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
