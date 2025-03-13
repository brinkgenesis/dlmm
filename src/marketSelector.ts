import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';
import { Connection, PublicKey } from '@solana/web3.js';
import DLMM, {getTokensMintFromPoolAddress, getTokenDecimals} from '@meteora-ag/dlmm';
import { Config } from './models/Config';
import { createSingleSidePosition } from './utils/createSingleSidePosition';
import { PositionStorage } from './utils/PositionStorage';
import BN from 'bn.js';
import axios from 'axios'; // For Jupiter API calls

interface MarketInfo {
  name: string;
  publicKey: string;
  description?: string;
  defaultDollarAmount?: number;
}

export class MarketSelector {
  private markets: MarketInfo[];
  private connection: Connection;
  private wallet: any; // Using 'any' to match whatever wallet type your app is using
  private positionStorage: PositionStorage;
  
  constructor(
    connection: Connection, 
    wallet: any, 
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
      name: `${index + 1}. ${market.name} — ${market.description || ''}`,
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
          : 100; // fallback
      
      console.log(`Creating position in ${chosenMarket.name} with $${dollarAmount}`);
      
      // Get the token mints from the pool address using the utility function
      const { tokenXMint, tokenYMint } = await getTokensMintFromPoolAddress(
        this.connection, 
        chosenMarket.publicKey
      );
      
      // Get the token mint address we need to price (X or Y depending on singleSidedX flag)
      const targetTokenMint = singleSidedX ? tokenXMint : tokenYMint;
      
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
