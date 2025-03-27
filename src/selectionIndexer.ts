import fs from 'fs';
import path from 'path';
import { Connection, PublicKey } from '@solana/web3.js';
import DLMM, { getTokensMintFromPoolAddress } from '@meteora-ag/dlmm';
import { getTokenLogos, getTokenSymbols } from './utils/fetchPriceJupiter';
import * as dotenv from 'dotenv';
import { MarketRepository } from './services/marketRepository';
dotenv.config();

// Define an enhanced market info interface
interface EnhancedMarketInfo {
  name: string;
  publicKey: string;
  binStep?: number;
  baseFee?: string;
  dailyAPR?: number;
  tvl?: number;
  volumeTvlRatio?: number;
  risk?: string;
  tokenXMint?: string;
  tokenYMint?: string;
  tokenXLogo?: string;
  tokenYLogo?: string;
  tokenXSymbol?: string;
  tokenYSymbol?: string;
}

interface MarketSelectionFile {
  markets: EnhancedMarketInfo[];
}

// Add an interface for database market type
interface DbMarket {
  id: string;
  name: string;
  token_x_mint: string;
  token_y_mint: string;
  token_x_symbol?: string | null;
  token_y_symbol?: string | null;
  token_x_logo?: string | null;
  token_y_logo?: string | null;
  // Add other fields as needed
}

class SelectionIndexer {
  private connection: Connection;
  private marketsPath: string;
  
  constructor() {
    // Initialize Solana connection
    this.connection = new Connection(process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com', 'confirmed');
    this.marketsPath = path.join(__dirname, 'models', 'marketSelection.json');
  }
  
  /**
   * Read the marketSelection.json file
   */
  private readMarketSelection(): MarketSelectionFile {
    try {
      const jsonData = fs.readFileSync(this.marketsPath, 'utf-8');
      return JSON.parse(jsonData) as MarketSelectionFile;
    } catch (error) {
      console.error('Error reading marketSelection.json:', error);
      throw error;
    }
  }
  
  /**
   * Write updated market data back to the file
   */
  private writeMarketSelection(data: MarketSelectionFile): void {
    try {
      fs.writeFileSync(this.marketsPath, JSON.stringify(data, null, 2), 'utf-8');
      console.log('marketSelection.json has been updated successfully');
    } catch (error) {
      console.error('Error writing marketSelection.json:', error);
      throw error;
    }
  }
  
  /**
   * Get token mints from a pool address
   */
  private async getTokenMintsFromPool(poolAddress: string): Promise<{ tokenXMint: string, tokenYMint: string }> {
    try {
      // First try using the getTokensMintFromPoolAddress utility function
      const poolPubkey = new PublicKey(poolAddress);
      
      // Initialize DLMM instance
      const dlmm = await DLMM.create(this.connection, poolPubkey);
      
      // Get token mints
      return {
        tokenXMint: dlmm.tokenX.publicKey.toString(),
        tokenYMint: dlmm.tokenY.publicKey.toString()
      };
    } catch (error) {
      console.error(`Error getting token mints for pool ${poolAddress}:`, error);
      return { tokenXMint: '', tokenYMint: '' };
    }
  }
  
  /**
   * Process all markets to add missing information
   */
  public async processMarkets(): Promise<void> {
    try {
      // Read the current market data
      const marketData = this.readMarketSelection();
      let updated = false;
      
      console.log(`Processing ${marketData.markets.length} markets...`);
      
      // Track all mint addresses to batch logo requests
      const allMints: string[] = [];
      const mintToMarketMap: Map<string, EnhancedMarketInfo[]> = new Map();
      
      // First pass: collect all mints
      for (const market of marketData.markets) {
        // Skip markets that already have both token mints and logos
        if (market.tokenXMint && market.tokenYMint && 
            market.tokenXLogo && market.tokenYLogo) {
          console.log(`Market ${market.name} already has complete information.`);
          continue;
        }
        
        console.log(`Getting token mints for ${market.name} (${market.publicKey})...`);
        
        // Get token mints for this market
        const { tokenXMint, tokenYMint } = await this.getTokenMintsFromPool(market.publicKey);
        
        if (!tokenXMint || !tokenYMint) {
          console.warn(`Could not get token mints for ${market.name}, skipping.`);
          continue;
        }
        
        // Update the market object
        market.tokenXMint = tokenXMint;
        market.tokenYMint = tokenYMint;
        updated = true;
        
        // Add to our mint collection for batch processing
        if (!allMints.includes(tokenXMint)) {
          allMints.push(tokenXMint);
        }
        if (!allMints.includes(tokenYMint)) {
          allMints.push(tokenYMint);
        }
        
        // Map these mints back to their markets
        if (!mintToMarketMap.has(tokenXMint)) {
          mintToMarketMap.set(tokenXMint, []);
        }
        mintToMarketMap.get(tokenXMint)!.push(market);
        
        if (!mintToMarketMap.has(tokenYMint)) {
          mintToMarketMap.set(tokenYMint, []);
        }
        mintToMarketMap.get(tokenYMint)!.push(market);
      }
      
      // Fetch all logos in one batch
      if (allMints.length > 0) {
        console.log(`Fetching logos for ${allMints.length} tokens...`);
        const logos = await getTokenLogos(allMints);
        const symbols = await getTokenSymbols(allMints);
        
        // Update all markets with their logos
        for (const [mint, markets] of mintToMarketMap.entries()) {
          const logo = logos[mint];
          const symbol = symbols[mint];
          
          for (const market of markets) {
            if (market.tokenXMint === mint) {
              market.tokenXLogo = logo;
              market.tokenXSymbol = symbol;
              updated = true;
            }
            if (market.tokenYMint === mint) {
              market.tokenYLogo = logo;
              market.tokenYSymbol = symbol;
              updated = true;
            }
          }
        }
      }
      
      // Save the updated data if changes were made
      if (updated) {
        this.writeMarketSelection(marketData);
        console.log('Market data has been enhanced with token information.');
      } else {
        console.log('No updates were needed for market data.');
      }
    } catch (error) {
      console.error('Error processing markets:', error);
      throw error;
    }
  }

  /**
   * Process only markets with missing token data (faster than full processing)
   */
  public async processOnlyMissingTokenData(): Promise<void> {
    try {
      // Get markets from Supabase that need token metadata
      const marketRepository = new MarketRepository();
      const allMarkets = await marketRepository.getAllMarkets();
      
      // Filter markets that need token metadata
      const marketsWithMissingData = allMarkets.filter((market: DbMarket) => {
        return (
          market.token_x_mint && 
          market.token_y_mint && 
          (!market.token_x_symbol || !market.token_y_symbol || !market.token_x_logo || !market.token_y_logo)
        );
      });
      
      if (marketsWithMissingData.length === 0) {
        console.log('No markets need token metadata. Skipping processing.');
        return;
      }
      
      console.log(`Processing ${marketsWithMissingData.length} markets with missing token data...`);
      
      // Track all mint addresses to batch logo requests
      const allMints: string[] = [];
      const mintToMarketMap: Map<string, any[]> = new Map();
      
      // Collect all mints that need data
      for (const market of marketsWithMissingData) {
        // Add token X mint if metadata is missing
        if (!market.token_x_symbol || !market.token_x_logo) {
          if (!allMints.includes(market.token_x_mint)) {
            allMints.push(market.token_x_mint);
          }
          if (!mintToMarketMap.has(market.token_x_mint)) {
            mintToMarketMap.set(market.token_x_mint, []);
          }
          mintToMarketMap.get(market.token_x_mint)!.push(market);
        }
        
        // Add token Y mint if metadata is missing
        if (!market.token_y_symbol || !market.token_y_logo) {
          if (!allMints.includes(market.token_y_mint)) {
            allMints.push(market.token_y_mint);
          }
          if (!mintToMarketMap.has(market.token_y_mint)) {
            mintToMarketMap.set(market.token_y_mint, []);
          }
          mintToMarketMap.get(market.token_y_mint)!.push(market);
        }
      }
      
      // Fetch all logos and symbols in one batch
      if (allMints.length > 0) {
        console.log(`Fetching logos and symbols for ${allMints.length} tokens...`);
        const logos = await getTokenLogos(allMints);
        const symbols = await getTokenSymbols(allMints);
        
        // Update each market with the fetched data
        for (const [mint, markets] of mintToMarketMap.entries()) {
          const logo = logos[mint];
          const symbol = symbols[mint];
          
          if (!logo || !symbol) {
            console.log(`No data found for mint ${mint}`);
            continue;
          }
          
          // Update markets in Supabase
          for (const market of markets) {
            const updates: any = {};
            
            if (market.token_x_mint === mint) {
              if (!market.token_x_logo) updates.token_x_logo = logo;
              if (!market.token_x_symbol) updates.token_x_symbol = symbol;
            }
            
            if (market.token_y_mint === mint) {
              if (!market.token_y_logo) updates.token_y_logo = logo;
              if (!market.token_y_symbol) updates.token_y_symbol = symbol;
            }
            
            if (Object.keys(updates).length > 0) {
              // Update the market in Supabase
              await marketRepository.updateMarketTokenMetadata(market.id, updates);
              console.log(`Updated token metadata for market ${market.name}`);
            }
          }
        }
        
        console.log('Token metadata update complete!');
      } else {
        console.log('No token metadata needed updating.');
      }
    } catch (error) {
      console.error('Error updating token metadata:', error);
    }
  }
}

// Execute if run directly
if (require.main === module) {
  const indexer = new SelectionIndexer();
  indexer.processMarkets()
    .then(() => console.log('Market indexing complete.'))
    .catch(err => {
      console.error('Fatal error during market indexing:', err);
      process.exit(1);
    });
}

export { SelectionIndexer }; 