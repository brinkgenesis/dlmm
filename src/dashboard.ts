import fs from 'fs';
import path from 'path';
import { PublicKey, Connection, Keypair } from '@solana/web3.js';
import { Config } from './models/Config';
import DLMM from '@meteora-ag/dlmm';
import { FetchPrice } from './utils/fetch_price';
import bs58 from 'bs58';
import * as dotenv from 'dotenv';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import axios from 'axios';
import { BN } from '@coral-xyz/anchor';
import { Decimal } from 'decimal.js';
import { PositionStorage } from './utils/PositionStorage';

export interface PositionData {
  publicKey: string;
  minBinId: number;
  maxBinId: number;
  originalActiveBin: number;
  snapshotPositionValue: number;
  currentValue?: number;
  percentageChange?: number;
  currentActiveBin?: number;
  percentageThroughRange?: number;
  status?: 'IN_RANGE' | 'OUT_OF_RANGE' | 'NEAR_EDGE';
  poolAddress?: string;
  tokenXSymbol?: string;
  tokenYSymbol?: string;
  lastUpdated?: string;
  pendingFees?: number;
  currentPrice?: number;
  tokenXAmount?: number;
  tokenYAmount?: number;
  tokenXValue?: number;
  tokenYValue?: number;
  baseFeeRate?: number;
  feeX?: string;
  feeY?: string;
  totalClaimedFeeX?: string;
  totalClaimedFeeY?: string;
  pendingFeesUSD?: number;
  feeXAmount?: number;
  feeYAmount?: number;
  dailyAPR?: number;
  lastFeeUpdate?: number;
}

interface StoredPositionData {
  originalActiveBin: number;
  minBinId: number;
  maxBinId: number;
  snapshotPositionValue: number;
}

export class Dashboard {
  private config: Config;
  private connection: Connection;
  private positionsPath: string;
  private tokenPrices: Record<string, number> = {};
  private positionStorage: PositionStorage;

  constructor(config: Config) {
    this.config = config;
    this.connection = config.connection;
    this.positionsPath = path.join(process.cwd(), 'positions.json');
    this.positionStorage = new PositionStorage(config);
  }

  /**
   * Get all positions from positions.json
   */
  public async getAllPositions(): Promise<PositionData[]> {
    try {
      // Get positions from chain first
      console.log("Fetching positions from blockchain...");
      let userPubkey: PublicKey;
      
      // Read private key from environment variable
      if (process.env.PRIVATE_KEY) {
        // Check if the key is a base58 string or array format
        let keypair: Keypair;
        
        try {
          // Try parsing as base58 string
          keypair = Keypair.fromSecretKey(
            Buffer.from(bs58.decode(process.env.PRIVATE_KEY))
          );
        } catch (e) {
          // Try parsing as array of numbers
          try {
            const privateKeyArray = JSON.parse(process.env.PRIVATE_KEY);
            keypair = Keypair.fromSecretKey(
              Uint8Array.from(privateKeyArray)
            );
          } catch (e2) {
            throw new Error("Invalid PRIVATE_KEY format in environment variables");
          }
        }
        
        userPubkey = keypair.publicKey;
        console.log(`Using wallet: ${userPubkey.toString()}`);
      } else {
        throw new Error("No PRIVATE_KEY provided in environment variables");
      }
      
      console.log(`Fetching positions for wallet: ${userPubkey.toString()}`);
      const positionsMap = await DLMM.getAllLbPairPositionsByUser(
        this.connection,
        userPubkey
      );
      
      console.log(`Found ${positionsMap.size} positions on-chain`);
      
      // Load positions.json for additional data
      let storedPositions: {[key: string]: StoredPositionData} = {};
      if (fs.existsSync(this.positionsPath)) {
        const positionsJson = fs.readFileSync(this.positionsPath, 'utf-8');
        storedPositions = JSON.parse(positionsJson);
      }
      
      // Create array of enriched position data
      const enrichedPositions: PositionData[] = [];
      
      // Process on-chain positions
      for (const [poolAddress, position] of positionsMap.entries()) {
        // For each position in this pool
        for (const lbPosition of position.lbPairPositionsData) {
          const positionKey = lbPosition.publicKey.toString();
          const posData = lbPosition.positionData;
          
          // Try to get stored data
          const storedPosition = storedPositions[positionKey];
          
          // Create position data object
          const positionData: PositionData = {
            publicKey: positionKey,
            minBinId: posData.lowerBinId,
            maxBinId: posData.upperBinId,
            // Use stored data if available, otherwise use current
            originalActiveBin: storedPosition?.originalActiveBin || posData.lowerBinId,
            snapshotPositionValue: storedPosition?.snapshotPositionValue || 0,
            lastUpdated: new Date().toISOString()
          };
          
          try {
            // Get pool and DLMM instance
            const pool = position.lbPair;
            const dlmm = await DLMM.create(this.connection, new PublicKey(poolAddress));
            
            // Use FetchPrice correctly as shown in RebalanceManager
            // For token values calculation
            const SOL_MINT = 'So11111111111111111111111111111111111111112';
            const solPriceStr = await FetchPrice(process.env.SOL_Price_ID as string);
            const solPrice = parseFloat(solPriceStr);
            
            let xValue = 0;
            let yValue = 0;
            const totalXAmount = Number(posData.totalXAmount) / 10 ** position.tokenX.decimal;
            const totalYAmount = Number(posData.totalYAmount) / 10 ** position.tokenY.decimal;
            
            // Calculate value based on which token is SOL
            if (position.tokenY.publicKey.toString() === SOL_MINT) {
              // Y is SOL
              const activeBin = await dlmm.getActiveBin();
              const pricePerToken = Number(activeBin.pricePerToken);
              
              // X value in USD = X amount * price per token * SOL price in USD
              xValue = totalXAmount * pricePerToken * solPrice;
              // Y value in USD = Y amount * SOL price in USD
              yValue = totalYAmount * solPrice;
            } 
            else if (position.tokenX.publicKey.toString() === SOL_MINT) {
              // X is SOL
              const activeBin = await dlmm.getActiveBin();
              const pricePerToken = Number(activeBin.pricePerToken);
              
              // X value in USD = X amount * SOL price in USD
              xValue = totalXAmount * solPrice;
              // Y value in USD = Y amount / price per token * SOL price in USD
              yValue = totalYAmount / pricePerToken * solPrice;
            } 
            else {
              console.log(`Non-SOL pair detected for ${positionKey}. Cannot calculate value.`);
            }
            
            // Total value
            positionData.currentValue = xValue + yValue;
            
            // Calculate percentage change
            if (positionData.snapshotPositionValue > 0) {
              positionData.percentageChange = ((positionData.currentValue - positionData.snapshotPositionValue) / positionData.snapshotPositionValue) * 100;
            }
            
            // Get active bin
            const activeBinId = (await dlmm.getActiveBin()).binId;
            positionData.currentActiveBin = activeBinId;
            
            // Calculate percentage through range
            const totalRange = positionData.maxBinId - positionData.minBinId;
            const distanceFromMin = activeBinId - positionData.minBinId;
            positionData.percentageThroughRange = (distanceFromMin / totalRange) * 100;
            
            // Determine status
            if (activeBinId < positionData.minBinId || activeBinId > positionData.maxBinId) {
              positionData.status = 'OUT_OF_RANGE';
            } else if (positionData.percentageThroughRange <= 30 || positionData.percentageThroughRange >= 70) {
              positionData.status = 'NEAR_EDGE';
            } else {
              positionData.status = 'IN_RANGE';
            }
            
            // Add pool data
            positionData.poolAddress = poolAddress;
            
            // Try to get token names/symbols correctly
            positionData.tokenXSymbol = position.tokenX.publicKey.toString();
            positionData.tokenYSymbol = position.tokenY.publicKey.toString();
            
            // In getAllPositions() after calculating totalXAmount and totalYAmount:
            positionData.tokenXAmount = totalXAmount; // Example value: 5.25 BONK
            positionData.tokenYAmount = totalYAmount; // Example value: 0.4 SOL
            positionData.tokenXValue = xValue; // Example value: $3.15 USD
            positionData.tokenYValue = yValue; // Example value: $8.25 USD
            
            // Add fee information
            try {
              // Get fee info
              const feeInfo = await dlmm.getFeeInfo();
              if (feeInfo) {
                // The value is already a percentage
                const baseFeePercentage = feeInfo.baseFeeRatePercentage.toNumber();
                positionData.baseFeeRate = baseFeePercentage;
              }
              
              // Get pending rewards/fees
              if (lbPosition.positionData) {
                // Get the raw BN values
                const rawFeeX = lbPosition.positionData.feeX;
                const rawFeeY = lbPosition.positionData.feeY;
                
                // Store raw values
                positionData.feeX = rawFeeX ? rawFeeX.toString() : "0";
                positionData.feeY = rawFeeY ? rawFeeY.toString() : "0";
                
                // Convert to actual token amounts
                const tokenXDecimals = position.tokenX.decimal;
                const tokenYDecimals = position.tokenY.decimal;
                
                // Convert raw fee amounts to actual token amounts
                const feeXAmount = rawFeeX ? new Decimal(rawFeeX.toString()).div(new Decimal(10).pow(tokenXDecimals)) : new Decimal(0);
                const feeYAmount = rawFeeY ? new Decimal(rawFeeY.toString()).div(new Decimal(10).pow(tokenYDecimals)) : new Decimal(0);
                
                // Fetch and use token prices
                try {
                  // Ensure token prices are fetched
                  if (!this.tokenPrices[position.tokenX.publicKey.toString()]) {
                    // If not already fetched, get prices for this pair
                    const mintAddresses = [
                      position.tokenX.publicKey.toString(),
                      position.tokenY.publicKey.toString()
                    ];
                    this.tokenPrices = {
                      ...this.tokenPrices,
                      ...(await this.getTokenPricesJupiter(mintAddresses))
                    };
                  }
                  
                  // Now use the tokenPrices map directly
                  const tokenXPrice = this.tokenPrices[position.tokenX.publicKey.toString()] || 0;
                  const tokenYPrice = this.tokenPrices[position.tokenY.publicKey.toString()] || 0;
                  
                  // Calculate USD values
                  const feeXValue = feeXAmount.times(tokenXPrice);
                  const feeYValue = feeYAmount.times(tokenYPrice);
                  
                  // Total fees in USD
                  const totalPendingFeesUSD = feeXValue.plus(feeYValue);
                  positionData.pendingFeesUSD = totalPendingFeesUSD.toNumber();
                } catch (error) {
                  console.error(`Error calculating USD values for fees:`, error);
                }
                
                // Store the amounts for display
                positionData.feeXAmount = feeXAmount.toNumber();
                positionData.feeYAmount = feeYAmount.toNumber();
              }
            } catch (error) {
              console.error(`Error getting fee info for position ${positionKey}:`, error);
            }

            // After we've calculated all the fee data for a position
            if (lbPosition.positionData && positionData.pendingFeesUSD !== undefined) {
              try {
                // Use the position key, not pool address
                console.log(`Processing position: ${positionKey}`);
                
                // Always use current time instead of lastUpdatedAt from Meteora
                const currentTime = Date.now();
                
                // Get any existing data for time comparison
                const existingData = this.positionStorage.getPositionAPRData(lbPosition.publicKey);
                if (existingData && existingData.lastUpdated) {
                  const lastTime = existingData.lastUpdated;
                  const timeDiffMs = currentTime - lastTime;
                  const minutesDiff = Math.floor(timeDiffMs / (1000 * 60));
                  
                  // Format time difference
                  let timeDiffString = '';
                  if (minutesDiff < 60) {
                    timeDiffString = `${minutesDiff} minute${minutesDiff !== 1 ? 's' : ''}`;
                  } else {
                    const hoursDiff = Math.floor(minutesDiff / 60);
                    const remainingMinutes = minutesDiff % 60;
                    timeDiffString = `${hoursDiff} hour${hoursDiff !== 1 ? 's' : ''}`;
                    if (remainingMinutes > 0) {
                      timeDiffString += ` ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}`;
                    }
                  }
                  
                  console.log(`Time since last update: ${timeDiffString} (${new Date(lastTime).toLocaleString()} → ${new Date(currentTime).toLocaleString()})`);
                } else {
                  console.log(`First update for this position at: ${new Date(currentTime).toLocaleString()}`);
                }
                
                // Update the position storage with fee data using position public key
                this.positionStorage.updatePositionFeeData(
                  lbPosition.publicKey,
                  {
                    feeX: positionData.feeX || "0",
                    feeY: positionData.feeY || "0",
                    feesUSD: positionData.pendingFeesUSD,
                    positionValue: positionData.currentValue || 0,
                    timestamp: currentTime
                  }
                );
                
                console.log(`Updated fee data for position ${positionKey}`);
                console.log(`Current fees: $${positionData.pendingFeesUSD}`);

                // Get the APR data
                const aprData = this.positionStorage.getPositionAPRData(lbPosition.publicKey);
                console.log(`APR data retrieved for ${positionKey}:`, aprData);

                if (aprData) {
                  positionData.dailyAPR = aprData.dailyAPR;
                  positionData.lastFeeUpdate = aprData.lastUpdated;
                  console.log(`Added APR data to position: dailyAPR=${positionData.dailyAPR}, lastUpdated=${positionData.lastFeeUpdate}`);
                } else {
                  console.log(`No APR data available yet - waiting for next run to calculate.`);
                }
              } catch (error) {
                console.error(`Error calculating APR for position ${lbPosition.publicKey.toString()}:`, error);
              }
            }
          } catch (error) {
            console.error(`Error processing on-chain data for position ${positionKey}:`, error);
          }
          
          enrichedPositions.push(positionData);
        }
      }
      
      return enrichedPositions;
    } catch (error) {
      console.error('Error getting positions:', error);
      return [];
    }
  }

  /**
   * Get summary statistics for all positions
   */
  public async getPositionsSummary() {
    const positions = await this.getAllPositions();
    const walletInfo = await this.getWalletInfo();
    
    // Calculate totals and summaries
    let totalPositions = positions.length;
    let inRange = 0;
    let outOfRange = 0;
    let nearEdge = 0;
    let totalValue = 0;
    let totalChangeValue = 0;
    let totalPendingFees = 0;
    
    // Process positions to calculate statistics
    for (const position of positions) {
      // Status counting
      if (position.status === 'IN_RANGE') inRange++;
      else if (position.status === 'OUT_OF_RANGE') outOfRange++;
      else if (position.status === 'NEAR_EDGE') nearEdge++;
      
      // Value calculations
      totalValue += position.currentValue || 0;
      totalChangeValue += position.percentageChange || 0;
      totalPendingFees += position.pendingFees || 0;
    }
    
    return {
      // Position summary
      totalPositions,
      inRange,
      outOfRange,
      nearEdge,
      totalValue,
      totalChangeValue,
      totalPendingFees,
      
      // Wallet info
      walletValue: walletInfo,
      totalCapital: totalValue + walletInfo.totalValue,
      
      // Position details
      positions
    };
  }

  /**
   * Print position information to console (useful for CLI dashboard)
   */
  public async printDashboard() {
    const summary = await this.getPositionsSummary();
    const positions = summary.positions;
    
    console.log("\n===========================================");
    console.log("           POSITION DASHBOARD              ");
    console.log("===========================================\n");
    
    console.log(`Total Positions: ${summary.totalPositions}`);
    console.log(`In Range: ${summary.inRange}`);
    console.log(`Near Edge: ${summary.nearEdge}`);
    console.log(`Out of Range: ${summary.outOfRange}`);
    console.log(`Total Value: $${summary.totalValue.toFixed(2)}`);
    
    // Calculate and display Liquidity Allocated percentage
    const liquidityAllocated = (summary.totalValue / summary.totalCapital) * 100;
    console.log(`Liquidity Allocated: ${liquidityAllocated.toFixed(2)}%`);
    
    console.log(`Total P&L: $${summary.totalChangeValue.toFixed(2)} (${summary.totalChangeValue > 0 ? '+' : ''}${(summary.totalChangeValue / (summary.totalValue - summary.totalChangeValue) * 100).toFixed(2)}%)`);
    
    console.log("\n-------------------------------------------");
    console.log("               POSITIONS                   ");
    console.log("-------------------------------------------\n");
    
    // Display each position
    for (const position of positions) {
      const statusEmoji = position.status === 'IN_RANGE' ? '✅' : 
                         position.status === 'NEAR_EDGE' ? '⚠️' : '❌';
      
      console.log(`${statusEmoji} Position: ${position.publicKey.slice(0, 8)}...`);
      console.log(`   Pool: ${position.poolAddress ? position.poolAddress.slice(0, 8) + '...' : 'Unknown'}`);
      
      if (position.tokenXSymbol && position.tokenYSymbol) {
        console.log(`   Pair: ${position.tokenXSymbol.slice(0, 6)}.../${position.tokenYSymbol.slice(0, 6)}...`);
      }
      
      console.log(`   Range: [${position.minBinId}, ${position.maxBinId}]`);
      
      if (position.currentActiveBin !== undefined) {
        console.log(`   Active Bin: ${position.currentActiveBin} (${position.percentageThroughRange?.toFixed(2)}% through range)`);
      }
      
      console.log(`   Current Value: $${position.currentValue?.toFixed(2) || 'Unknown'}`);
      
      if (position.percentageChange !== undefined) {
        const changePrefix = position.percentageChange >= 0 ? '+' : '';
        console.log(`   Change: ${changePrefix}${position.percentageChange.toFixed(2)}%`);
      }
      
      if (position.feeXAmount !== undefined && position.feeYAmount !== undefined) {
        console.log(`   Pending Fees: ${position.feeXAmount.toFixed(6)} tokens + ${position.feeYAmount.toFixed(6)} SOL ($${position.pendingFeesUSD?.toFixed(2) || '0.00'})`);
      }
      
      if (position.baseFeeRate !== undefined) {
        console.log(`   Base Fee Rate: ${position.baseFeeRate.toFixed(4)}%`);
      }
      
      if (position.dailyAPR !== undefined) {
        console.log(`   Daily APR: ${position.dailyAPR.toFixed(2)}%`);
        console.log(`   Projected Annual: ${(position.dailyAPR * 365).toFixed(2)}%`);
        
        // Get the APR history for additional context
        const aprHistory = this.positionStorage.getPositionAPRHistory(new PublicKey(position.publicKey));
        if (aprHistory) {
          console.log(`   Calculation: $${aprHistory.aprCalculation.feeChange.toFixed(4)} fees over ${Math.round(aprHistory.aprCalculation.timeSpan)} minutes`);
          console.log(`   Data points: ${aprHistory.history.length} snapshots`);
        }
        
        if (position.lastFeeUpdate) {
          const lastUpdateTime = new Date(position.lastFeeUpdate).toLocaleString();
          const currentTime = Date.now();
          const timeDiffMs = currentTime - position.lastFeeUpdate;
          
          // Calculate time difference in a human-readable format
          const minutesDiff = Math.floor(timeDiffMs / (1000 * 60));
          let timeDiffString = '';
          
          if (minutesDiff < 60) {
            timeDiffString = `${minutesDiff} minute${minutesDiff !== 1 ? 's' : ''}`;
          } else {
            const hoursDiff = Math.floor(minutesDiff / 60);
            const remainingMinutes = minutesDiff % 60;
            timeDiffString = `${hoursDiff} hour${hoursDiff !== 1 ? 's' : ''}`;
            if (remainingMinutes > 0) {
              timeDiffString += ` ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}`;
            }
          }
          
          console.log(`   Last Fee Update: ${lastUpdateTime} (${timeDiffString} ago)`);
        }
      }
      
      console.log("-------------------------------------------");
    }
    
    // Add wallet section
    console.log("\n-------------------------------------------");
    console.log("                 WALLET                   ");
    console.log("-------------------------------------------\n");
    
    // Display SOL balance
    console.log(`SOL Balance: ${summary.walletValue.solBalance.toFixed(4)} SOL`);
    
    // Display token balances
    if (summary.walletValue.tokens && summary.walletValue.tokens.length > 0) {
      console.log("\nToken Balances:");
      for (const token of summary.walletValue.tokens) {
        const valueStr = token.value !== undefined ? 
          `($${token.value.toFixed(2)})` : '';
        console.log(`  ${token.mint.slice(0, 6)}... : ${token.balance} ${valueStr}`);
      }
    } else {
      console.log("No token balances found");
    }
    
    console.log(`\nTotal Wallet Value: $${summary.walletValue.totalValue.toFixed(2)}`);
    console.log(`Total Capital: $${summary.totalCapital.toFixed(2)}`);
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

  private async getWalletInfo() {
    // Get wallet address from environment variable (same as in getAllPositions)
    let walletAddress: PublicKey;
    
    if (process.env.PRIVATE_KEY) {
      // Parse private key from environment
      try {
        // Try parsing as base58 string
        const keypair = Keypair.fromSecretKey(
          Buffer.from(bs58.decode(process.env.PRIVATE_KEY))
        );
        walletAddress = keypair.publicKey;
      } catch (e) {
        // Try parsing as array
        const privateKeyArray = JSON.parse(process.env.PRIVATE_KEY);
        const keypair = Keypair.fromSecretKey(
          Uint8Array.from(privateKeyArray)
        );
        walletAddress = keypair.publicKey;
      }
    } else {
      throw new Error("No wallet address available");
    }
    
    // Get token accounts owned by the wallet
    const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
      walletAddress,
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
    
    let totalValue = 0;
    const balances = [];
    
    // Process each token account
    for (const account of tokenAccounts.value) {
      const parsedInfo = account.account.data.parsed.info;
      const mint = parsedInfo.mint;
      const balance = parsedInfo.tokenAmount.uiAmount;
      
      // Calculate value
      const price = prices[mint] || 0;
      const value = balance * price;
      totalValue += value;
      
      balances.push({
        mint,
        balance,
        value
      });
    }
    
    // Get SOL balance
    const solBalance = await this.connection.getBalance(walletAddress) / 1_000_000_000;
    const solPrice = prices[SOL_MINT] || 0;
    const solValue = solBalance * solPrice;
    
    totalValue += solValue;
    
    return {
      totalValue,
      solBalance,
      solValue,
      tokens: balances
    };
  }
}

// Example usage (if run directly)
if (require.main === module) {
  dotenv.config();
  Config.load().then(config => {
    const dashboard = new Dashboard(config);
    dashboard.printDashboard().catch(console.error);
  }).catch(console.error);
} 