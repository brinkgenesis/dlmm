import { Connection } from '@solana/web3.js';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

// Token information interfaces
interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
  tags?: string[];
  extensions?: Record<string, any>;
  chainId?: number;
  coingeckoId?: string;
}

interface TokenResponse {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
  tags?: string[];
  extensions?: Record<string, any>;
  // Other fields that Jupiter API might return
}

/**
 * Fetches token information for a single token from Jupiter
 * @param mintAddress - Token mint address
 * @returns Token information including symbol, name, etc.
 */
export async function getTokenInfo(mintAddress: string): Promise<TokenInfo | null> {
  try {
    // Use the Jupiter Token API endpoint
    const endpoint = `https://api.jup.ag/tokens/v1/token/${mintAddress}`;
    
    const response = await axios.get(endpoint, {
      timeout: 10000, // 10 second timeout
    });
    
    if (response.data) {
      const tokenData: TokenResponse = response.data;
      return {
        address: tokenData.address,
        symbol: tokenData.symbol,
        name: tokenData.name,
        decimals: tokenData.decimals,
        logoURI: tokenData.logoURI,
        tags: tokenData.tags,
        extensions: tokenData.extensions,
      };
    }
    
    console.warn(`No token info found for: ${mintAddress}`);
    return null;
  } catch (error) {
    console.error(`Error fetching token info for ${mintAddress}:`, 
      error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * Fetches token information for multiple tokens from Jupiter
 * @param mintAddresses - Array of token mint addresses
 * @returns Map of mint addresses to their token information
 */
export async function getTokensInfo(mintAddresses: string[]): Promise<Record<string, TokenInfo>> {
  const result: Record<string, TokenInfo> = {};
  
  // Fetch information for each token sequentially
  // Could be optimized with Promise.all for parallel requests if needed
  for (const mintAddress of mintAddresses) {
    const tokenInfo = await getTokenInfo(mintAddress);
    if (tokenInfo) {
      result[mintAddress] = tokenInfo;
    }
  }
  
  return result;
}

/**
 * Gets token symbols for multiple tokens
 * @param mintAddresses - Array of token mint addresses
 * @returns Map of mint addresses to their symbols
 */
export async function getTokenSymbols(mintAddresses: string[]): Promise<Record<string, string>> {
  const tokensInfo = await getTokensInfo(mintAddresses);
  
  // Extract just the symbols
  const symbols: Record<string, string> = {};
  
  for (const [mintAddress, info] of Object.entries(tokensInfo)) {
    symbols[mintAddress] = info.symbol;
  }
  
  return symbols;
}

/**
 * Gets token logo URLs for multiple tokens
 * @param mintAddresses - Array of token mint addresses
 * @returns Map of mint addresses to their logo URIs
 */
export async function getTokenLogos(mintAddresses: string[]): Promise<Record<string, string>> {
  const tokensInfo = await getTokensInfo(mintAddresses);
  
  // Extract just the logo URIs
  const logos: Record<string, string> = {};
  
  for (const [mintAddress, info] of Object.entries(tokensInfo)) {
    // Only add if logoURI exists
    if (info.logoURI) {
      logos[mintAddress] = info.logoURI;
    }
  }
  
  return logos;
}

/**
 * Gets token display information (symbols and logos) for multiple tokens
 * @param mintAddresses - Array of token mint addresses
 * @returns Object with symbols and logos maps
 */
export async function getTokenDisplayInfo(mintAddresses: string[]): Promise<{
  symbols: Record<string, string>;
  logos: Record<string, string>;
}> {
  const tokensInfo = await getTokensInfo(mintAddresses);
  
  const symbols: Record<string, string> = {};
  const logos: Record<string, string> = {};
  
  for (const [mintAddress, info] of Object.entries(tokensInfo)) {
    symbols[mintAddress] = info.symbol;
    
    if (info.logoURI) {
      logos[mintAddress] = info.logoURI;
    }
  }
  
  return { symbols, logos };
}

// Load token blacklist
let tokenBlacklist: string[] = [];
try {
  const blacklistPath = path.join(__dirname, '../../data/tokenBlacklist.json');
  if (fs.existsSync(blacklistPath)) {
    tokenBlacklist = JSON.parse(fs.readFileSync(blacklistPath, 'utf-8'));
    console.log(`Loaded ${tokenBlacklist.length} tokens in blacklist`);
  } else {
    console.warn('Token blacklist file not found, creating empty blacklist');
    fs.writeFileSync(blacklistPath, JSON.stringify([], null, 2));
  }
} catch (error) {
  console.error('Error loading token blacklist:', error);
}

/**
 * Fetches token prices from Jupiter API with exponential backoff
 * 
 * @param mintAddresses - Array of token mint addresses to fetch prices for
 * @param connection - Optional Solana connection (for future expansion)
 * @returns Object mapping token mint addresses to their USD prices
 */
export async function getTokenPricesJupiter(
  mintAddresses: string[],
  connection?: Connection
): Promise<Record<string, number>> {
  try {
    // Filter out blacklisted tokens
    const filteredMints = mintAddresses.filter(mint => !tokenBlacklist.includes(mint));
    
    if (filteredMints.length === 0) {
      console.warn('All requested tokens are blacklisted');
      return {};
    }
    
    if (filteredMints.length < mintAddresses.length) {
      console.log(`Skipped ${mintAddresses.length - filteredMints.length} blacklisted tokens`);
    }
    
    // Format mint addresses as a comma-separated list exactly as in marketSelector.ts
    const mintIds = filteredMints.join(',');
    
    // Use the v2 Jupiter price API endpoint as in marketSelector.ts
    const endpoint = `https://api.jup.ag/price/v2?ids=${mintIds}`;
    console.log(`Fetching prices from Jupiter...`);
    
    // Implement exponential backoff
    const maxRetries = 3;
    let retryCount = 0;
    let lastError: any;
    let baseDelay = 500; // 500ms initial delay
    
    while (retryCount < maxRetries) {
      try {
        // Call Jupiter API
        const response = await axios.get(endpoint, {
          timeout: 10000, // 10 second timeout
        });
        
        // Correct parsing for the nested data structure
        const apiData = response.data.data as Record<string, { price: string } | null>;
        
        // Create a map of mint address to price
        const prices: Record<string, number> = {};
        let priceCount = 0;
        
        for (const mintAddress of filteredMints) {
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
        lastError = error;
        retryCount++;
        
        // Only retry on network errors or 5xx status codes
        if (axios.isAxiosError(error)) {
          if (!error.response || error.response.status >= 500) {
            const delay = baseDelay * Math.pow(2, retryCount - 1);
            console.warn(`Jupiter API request failed (attempt ${retryCount}/${maxRetries}), retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }
        
        // Non-retryable error
        break;
      }
    }
    
    // If we got here, all retries failed
    console.error('Error fetching Jupiter prices after retries:', lastError instanceof Error ? lastError.message : String(lastError));
    
    // Return zeros for all requested mints, same as marketSelector.ts
    return filteredMints.reduce((prices, mint) => {
      prices[mint] = 0;
      return prices;
    }, {} as Record<string, number>);
    
  } catch (error) {
    console.error('Error fetching Jupiter prices:', error instanceof Error ? error.message : String(error));
    
    // Return zeros for all requested mints, same as marketSelector.ts
    return mintAddresses.reduce((prices, mint) => {
      prices[mint] = 0;
      return prices;
    }, {} as Record<string, number>);
  }
}

/**
 * Gets the USD price for a single token
 * 
 * @param mintAddress - Token mint address
 * @param connection - Optional Solana connection
 * @returns Token price in USD or 0 if not found
 */
export async function getTokenPriceJupiter(
  mintAddress: string,
  connection?: Connection
): Promise<number> {
  const prices = await getTokenPricesJupiter([mintAddress], connection);
  return prices[mintAddress] || 0;
}

/**
 * Helper to add a token to the blacklist
 */
export async function addToTokenBlacklist(mintAddress: string): Promise<void> {
  try {
    if (!tokenBlacklist.includes(mintAddress)) {
      tokenBlacklist.push(mintAddress);
      const blacklistPath = path.join(__dirname, '../../data/tokenBlacklist.json');
      fs.writeFileSync(blacklistPath, JSON.stringify(tokenBlacklist, null, 2));
      console.log(`Added ${mintAddress} to token blacklist`);
    }
  } catch (error) {
    console.error('Error updating token blacklist:', error);
  }
}

/**
 * Converts USD amount to token amount using Jupiter prices
 * 
 * @param usdAmount - Amount in USD
 * @param mintAddress - Token mint address
 * @param tokenDecimals - Number of token decimals
 * @param connection - Optional Solana connection
 * @returns Token amount as a string with proper decimal places or null if price not found
 */
export async function usdToTokenAmount(
  usdAmount: number,
  mintAddress: string,
  tokenDecimals: number,
  connection?: Connection
): Promise<string | null> {
  const price = await getTokenPriceJupiter(mintAddress, connection);
  
  if (price <= 0) return null;
  
  const tokenAmount = usdAmount / price;
  return tokenAmount.toFixed(tokenDecimals);
}

/**
 * Converts token amount to USD value using Jupiter prices
 * 
 * @param tokenAmount - Amount of tokens
 * @param mintAddress - Token mint address
 * @param connection - Optional Solana connection
 * @returns USD value or null if price not found
 */
export async function tokenAmountToUsd(
  tokenAmount: number,
  mintAddress: string,
  connection?: Connection
): Promise<number | null> {
  const price = await getTokenPriceJupiter(mintAddress, connection);
  
  if (price <= 0) return null;
  
  return tokenAmount * price;
} 