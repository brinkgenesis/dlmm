import fs from 'fs';
import path from 'path';
import { PublicKey, Connection, Keypair } from '@solana/web3.js';
import { Config } from './models/Config';
import DLMM from '@meteora-ag/dlmm';
import { FetchPrice } from './utils/fetch_price';
import bs58 from 'bs58';
import * as dotenv from 'dotenv';

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

  constructor(config: Config) {
    this.config = config;
    this.connection = config.connection;
    this.positionsPath = path.join(process.cwd(), 'positions.json');
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
    
    // Calculate summary statistics
    const totalPositions = positions.length;
    const inRangePositions = positions.filter(p => p.status === 'IN_RANGE').length;
    const outOfRangePositions = positions.filter(p => p.status === 'OUT_OF_RANGE').length;
    const nearEdgePositions = positions.filter(p => p.status === 'NEAR_EDGE').length;
    
    // Calculate total value
    const totalValue = positions.reduce((sum, pos) => sum + (pos.currentValue || 0), 0);
    
    // Calculate performance
    const totalChangeValue = positions.reduce((sum, pos) => {
      if (pos.currentValue && pos.snapshotPositionValue) {
        return sum + (pos.currentValue - pos.snapshotPositionValue);
      }
      return sum;
    }, 0);
    
    return {
      totalPositions,
      inRange: inRangePositions,
      outOfRange: outOfRangePositions,
      nearEdge: nearEdgePositions,
      totalValue,
      totalChangeValue,
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
      
      if (position.currentValue !== undefined) {
        console.log(`   Current Value: $${position.currentValue.toFixed(2)}`);
      }
      
      if (position.percentageChange !== undefined) {
        const changePrefix = position.percentageChange >= 0 ? '+' : '';
        console.log(`   Change: ${changePrefix}${position.percentageChange.toFixed(2)}%`);
      }
      
      console.log("-------------------------------------------");
    }
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