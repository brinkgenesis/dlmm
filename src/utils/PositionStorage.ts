import fs from 'fs';
import path from 'path';
import { PublicKey } from '@solana/web3.js';
import { Config } from '../models/Config';
import { PositionRepository } from '../services/positionRepository';

interface PositionRange {
  originalActiveBin: number;
  minBinId: number;
  maxBinId: number;
  snapshotPositionValue: number;
}

// Extend the PositionFeeData interface with fee history
interface FeeSnapshot {
  timestamp: number;
  feesUSD: number;
  positionValue: number;
}

// Extended interface to track fee data for APR calculations
interface PositionFeeData extends PositionRange {
  // Timestamp when fees were last recorded
  lastFeeTimestamp?: number; // Unix timestamp in milliseconds
  
  // Last recorded fee amounts
  lastFeeX?: string;
  lastFeeY?: string;
  
  // Last recorded USD value of fees
  lastFeesUSD?: number;
  
  // Position value at last fee recording
  lastPositionValue?: number;
  
  // Calculated APR (if available)
  dailyAPR?: number;
  
  // Add fee history for moving average
  feeHistory?: FeeSnapshot[];
}

interface PositionsMapping {
  [positionPubKey: string]: PositionFeeData;
}

// Add startingPositionValue to the interface
export interface PositionData {
  originalActiveBin: number;
  minBinId: number;
  maxBinId: number;
  snapshotPositionValue: number;
  startingPositionValue?: number;
  dailyAPR?: number;
  lastFeeTimestamp?: number;
  originalStartDate?: number;
  rebalanceCount?: number;
  previousPositionKey?: string;
  feeHistory?: FeeSnapshot[];
  lastFeeX?: string;
  lastFeeY?: string;
  lastFeesUSD?: number;
  lastPositionValue?: number;
}

/**
 * PositionStorage manages the storage of user positions and their associated bin ranges.
 */
export class PositionStorage {
  private filePath: string;
  private positions: { [positionPubKey: string]: PositionData } = {};
  private positionRepository: PositionRepository;
  private supabaseEnabled: boolean = true; // Flag to enable/disable Supabase integration

  /**
   * Constructs a new PositionStorage instance.
   * @param config - The configuration object containing necessary settings.
   * @param fileName - The name of the file to store positions.
   */
  constructor(private config: Config, fileName: string = 'positions.json') {
    this.filePath = path.resolve(this.config.dataDirectory, fileName);
    this.positionRepository = new PositionRepository();
    this.load();
  }

  /**
   * Loads the positions mapping from the JSON file and Supabase.
   */
  private async load(): Promise<void> {
    try {
      // First, try to load from local file
      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, 'utf-8');
        this.positions = JSON.parse(data);
        console.log(`Loaded positions from ${this.filePath}`);
      } else {
        // Ensure the directory exists
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        fs.writeFileSync(this.filePath, JSON.stringify({}), 'utf-8');
        console.log(`Created new positions file at ${this.filePath}`);
      }

      // Then, if Supabase is enabled, try to load from there and merge
      if (this.supabaseEnabled) {
        try {
          const supabasePositions = await this.positionRepository.loadPositions();
          
          // Merge Supabase positions with local positions
          // Local positions take precedence in case of conflict
          this.positions = {
            ...supabasePositions,
            ...this.positions
          };
          
          console.log(`Merged positions from Supabase with local positions`);
        } catch (error) {
          console.error('Error loading positions from Supabase:', error);
          // Continue with local positions
        }
      }
    } catch (error: any) {
      console.error('Error loading positions:', error.message || error);
      this.positions = {};
    }
  }

  /**
   * Saves the current positions mapping to the JSON file and Supabase.
   */
  private save(): void {
    try {
      // Save to local file
      fs.writeFileSync(this.filePath, JSON.stringify(this.positions, null, 2), 'utf-8');
      console.log(`Saved positions to ${this.filePath}`);
      
      // If Supabase is enabled, sync data there too
      if (this.supabaseEnabled) {
        this.positionRepository.syncAllPositions(this.positions)
          .catch(error => console.error('Error syncing positions to Supabase:', error));
      }
    } catch (error: any) {
      console.error('Error saving positions:', error.message || error);
    }
  }

  /**
   * Adds a new position with its bin ranges.
   * @param positionKey - The public key of the position.
   * @param data - The position data.
   */
  public addPosition(
    positionKey: PublicKey, 
    data: {
      originalActiveBin: number;
      minBinId: number;
      maxBinId: number;
      snapshotPositionValue: number;
      startingPositionValue?: number;
      originalStartDate?: number;
      rebalanceCount?: number;
    }
  ): void {
    const positionId = positionKey.toString();
    
    // Use snapshotPositionValue as the starting value if not explicitly provided
    const positionData: PositionData = {
      ...data,
      startingPositionValue: data.startingPositionValue ?? data.snapshotPositionValue
    };
    
    this.positions[positionId] = positionData;
    this.save(); // This will handle both local save and Supabase sync
  }

  /**
   * Retrieves the bin range for a given position.
   * @param positionPubKey - The public key of the position.
   * @returns The bin range details or undefined if not found.
   */
  public getPositionRange(positionPubKey: PublicKey): PositionData | undefined {
    return this.positions[positionPubKey.toBase58()];
  }

  /**
   * Retrieves all stored position mappings.
   * @returns The complete positions mapping.
   */
  public getAllPositions(): PositionsMapping {
    return this.positions;
  }

  /**
   * Removes a position from the storage.
   * @param positionPubKey - The public key of the position.
   */
  public removePosition(positionPubKey: PublicKey): void {
    const positionKey = positionPubKey.toBase58();
    delete this.positions[positionKey];
    
    // Also remove from Supabase if enabled
    if (this.supabaseEnabled) {
      this.positionRepository.removePosition(positionKey)
        .catch(error => console.error(`Error removing position ${positionKey} from Supabase:`, error));
    }
    
    this.save();
  }

  /**
   * Updates fee data for APR calculations for a specific position
   * @param positionPubKey - The public key of the position
   * @param feeData - The fee data to update
   */
  public updatePositionFeeData(
    positionPubKey: PublicKey, 
    feeData: {
      feeX: string;
      feeY: string;
      feesUSD: number;
      positionValue: number;
      timestamp: number;
    }
  ): void {
    const positionKey = positionPubKey.toBase58();
    let position = this.positions[positionKey];
    
    if (!position) {
      console.log(`Position ${positionKey} not found in storage`);
      return;
    }
    
    // Create new snapshot
    const newSnapshot: FeeSnapshot = {
      timestamp: feeData.timestamp,
      feesUSD: feeData.feesUSD,
      positionValue: feeData.positionValue
    };
    
    // Check for fee claim event (significant fee decrease)
    let feeClaimDetected = false;
    if (position.lastFeesUSD && position.lastFeesUSD > 0) {
      // If current fees are much lower than last recorded fees, 
      // it likely means fees were claimed
      if (feeData.feesUSD < position.lastFeesUSD * 0.8) { // 20% drop threshold
        console.log(`Fee claim detected for position ${positionKey}: ${position.lastFeesUSD.toFixed(4)} → ${feeData.feesUSD.toFixed(4)}`);
        feeClaimDetected = true;
      }
    }
    
    // Also check for very low fee amounts (another indicator of claiming or reset)
    const minimumFeeThreshold = 0.0001; // $0.0001 - reduced from 0.05 to allow low fee positions
    if (feeData.feesUSD < minimumFeeThreshold) {
      console.log(`Low fee amount detected (${feeData.feesUSD.toFixed(4)} < ${minimumFeeThreshold}) - possible fee claim`);
      feeClaimDetected = true;
    }
    
    // Reset history if fees were claimed
    if (feeClaimDetected) {
      // Only reset if this isn't a brand new position (allow at least 1 hour to accumulate fees)
      const hasExistingHistory = position.feeHistory && position.feeHistory.length > 0;
      const oldestSnapshot = hasExistingHistory && position.feeHistory ? position.feeHistory[0] : null;
      const isNewPosition = oldestSnapshot && (feeData.timestamp - oldestSnapshot.timestamp < 60 * 60 * 1000); // 1 hour
      
      if (isNewPosition) {
        console.log(`Low fees detected but position is new (< 1 hour), preserving history`);
        // Add new snapshot without resetting
        if (!position.feeHistory) {
          position.feeHistory = [newSnapshot];
        } else {
          position.feeHistory.push(newSnapshot);
          if (position.feeHistory.length > 24) {
            position.feeHistory.shift(); // Remove oldest
          }
        }
      } else {
        console.log(`Resetting fee history for position ${positionKey} due to likely fee claim`);
        position.feeHistory = [newSnapshot]; // Start fresh
      }
    } else {
      // Normal update - initialize or update fee history
      if (!position.feeHistory) {
        position.feeHistory = [newSnapshot];
      } else {
        // Add new snapshot, limit to last 24 snapshots
        position.feeHistory.push(newSnapshot);
        if (position.feeHistory.length > 24) {
          position.feeHistory.shift(); // Remove oldest
        }
      }
    }
    
    // Only calculate APR if we have at least 2 snapshots and no fee claim
    let dailyAPR: number | undefined = undefined;
    
    if (position.feeHistory.length >= 2 && !feeClaimDetected) {
      // Get the oldest and newest snapshots
      const oldestSnapshot = position.feeHistory[0];
      const newestSnapshot = position.feeHistory[position.feeHistory.length - 1];
      
      // Calculate time difference in minutes
      const timeDiffMinutes = (newestSnapshot.timestamp - oldestSnapshot.timestamp) / (1000 * 60);
      
      if (timeDiffMinutes > 15) { // Minimum 15 minutes for calculation
        // Calculate fee difference
        const feeDiff = newestSnapshot.feesUSD - oldestSnapshot.feesUSD;
        
        // Only calculate if fees increased (this is a safety check)
        if (feeDiff > 0) {
          // Project to daily rate (1440 minutes in a day)
          const projectedDailyFees = feeDiff * (1440 / timeDiffMinutes);
          
          // Use average position value
          const avgPositionValue = position.feeHistory.reduce((sum, snapshot) => 
            sum + snapshot.positionValue, 0) / position.feeHistory.length;
          
          // Calculate daily APR as percentage
          dailyAPR = (projectedDailyFees / avgPositionValue) * 100;
          
          // Apply reasonable cap (e.g., 50% daily APR)
          if (dailyAPR > 50) {
            console.log(`Capping calculated APR from ${dailyAPR.toFixed(2)}% to 50%`);
            dailyAPR = 50;
          }
          
          console.log(`Calculated daily APR for ${positionKey} using ${position.feeHistory.length} snapshots over ${Math.round(timeDiffMinutes)} minutes: ${dailyAPR.toFixed(2)}%`);
        } else {
          console.log(`No fee increase detected for position ${positionKey}: ${feeDiff.toFixed(4)}`);
        }
      } else {
        console.log(`Not enough time elapsed for reliable APR calculation (${Math.round(timeDiffMinutes)} minutes)`);
      }
    }
    
    // Update position data
    this.positions[positionKey] = {
      ...position,
      lastFeeTimestamp: feeData.timestamp,
      lastFeeX: feeData.feeX,
      lastFeeY: feeData.feeY,
      lastFeesUSD: feeData.feesUSD,
      lastPositionValue: feeData.positionValue,
      ...(dailyAPR !== undefined ? { dailyAPR } : {}),
      feeHistory: position.feeHistory // Save history
    };
    
    this.save();
  }

  /**
   * Gets APR data for a position
   * @param positionPubKey - The public key of the position
   * @returns APR data or undefined if not available
   */
  public getPositionAPRData(positionPubKey: PublicKey): {
    dailyAPR?: number;
    lastUpdated?: number;
  } | undefined {
    const position = this.positions[positionPubKey.toBase58()];
    
    if (!position) {
      return undefined;
    }
    
    return {
      dailyAPR: position.dailyAPR,
      lastUpdated: position.lastFeeTimestamp
    };
  }

  /**
   * Cleans up the positions storage by removing any positions that don't exist on-chain
   * @param activePositionKeys - Array of position public keys currently active on-chain
   */
  public cleanupStalePositions(activePositionKeys: PublicKey[]): void {
    console.log(`Cleaning up stale positions in storage...`);
    const activeKeyStrings = activePositionKeys.map(key => key.toString());
    
    // Get all stored position keys
    const storedKeys = Object.keys(this.positions);
    
    // Find keys that exist in storage but not on-chain
    const staleKeys = storedKeys.filter(key => !activeKeyStrings.includes(key));
    
    // Remove stale positions
    if (staleKeys.length > 0) {
      console.log(`Found ${staleKeys.length} stale positions to remove`);
      staleKeys.forEach(key => {
        delete this.positions[key];
        console.log(`Removed stale position: ${key}`);
      });
      
      // Save the cleaned up positions
      this.save();
    } else {
      console.log(`No stale positions found`);
    }
  }

  // Add method to get APR history
  public getPositionAPRHistory(positionPubKey: PublicKey): {
    history: FeeSnapshot[];
    aprCalculation: {
      timeSpan: number; // minutes
      feeChange: number;
      dailyProjection: number;
    };
  } | undefined {
    const position = this.positions[positionPubKey.toBase58()];
    
    if (!position || !position.feeHistory || position.feeHistory.length < 2) {
      return undefined;
    }
    
    const oldestSnapshot = position.feeHistory[0];
    const newestSnapshot = position.feeHistory[position.feeHistory.length - 1];
    const timeDiffMinutes = (newestSnapshot.timestamp - oldestSnapshot.timestamp) / (1000 * 60);
    const feeChange = newestSnapshot.feesUSD - oldestSnapshot.feesUSD;
    const dailyProjection = feeChange * (1440 / timeDiffMinutes);
    
    return {
      history: position.feeHistory,
      aprCalculation: {
        timeSpan: timeDiffMinutes,
        feeChange,
        dailyProjection
      }
    };
  }

  /**
   * Transfers position history during rebalance instead of removing old position
   * @param oldPositionPubKey - Original position being closed
   * @param newPositionPubKey - New position being created
   * @param newPositionData - Data for the new position
   */
  public transferPositionHistory(
    oldPositionPubKey: PublicKey,
    newPositionPubKey: PublicKey,
    newPositionData: {
      originalActiveBin: number;
      minBinId: number;
      maxBinId: number;
      snapshotPositionValue: number;
    }
  ): void {
    const oldPositionKey = oldPositionPubKey.toBase58();
    const oldPosition = this.positions[oldPositionKey];
    
    if (!oldPosition) {
      console.log(`Old position ${oldPositionKey} not found, creating new entry without history`);
      this.addPosition(newPositionPubKey, newPositionData);
      return;
    }
    
    // Transfer history to new position
    const newPositionKey = newPositionPubKey.toBase58();
    this.positions[newPositionKey] = {
      ...newPositionData,
      // Preserve the original starting value
      startingPositionValue: oldPosition.startingPositionValue,
      // Preserve or set the original start date
      originalStartDate: oldPosition.originalStartDate || Date.now(),
      // Increment rebalance count
      rebalanceCount: (oldPosition.rebalanceCount || 0) + 1,
      // Reference to old position for tracking lineage
      previousPositionKey: oldPositionKey
    };
    
    console.log(`Transferred history from position ${oldPositionKey} to ${newPositionKey}`);
    console.log(`Starting value preserved: ${oldPosition.startingPositionValue}`);
    
    // Remove old position entry
    delete this.positions[oldPositionKey];
    
    console.log(`HISTORY TRANSFER - Details:
      Old position: ${oldPositionKey}
      New position: ${newPositionKey}
      Starting value: ${oldPosition.startingPositionValue}
      Original date: ${oldPosition.originalStartDate || Date.now()}
      Rebalance count: ${(oldPosition.rebalanceCount || 0) + 1}
    `);
    
    this.save();
  }
}

