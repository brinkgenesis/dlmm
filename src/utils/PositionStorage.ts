import fs from 'fs';
import path from 'path';
import { PublicKey } from '@solana/web3.js';
import { Config } from '../models/Config';
import { PositionRepository } from '../services/positionRepository';
import { Decimal } from 'decimal.js'; // Ensure Decimal is imported

// Interface for basic position data stored locally or fetched
// Removed FeeSnapshot and related fields
interface PositionRange {
  originalActiveBin: number;
  minBinId: number;
  maxBinId: number;
  snapshotPositionValue: number; // Value at creation/rebalance
}

// Remove PositionFeeData interface as it's no longer needed
// interface PositionFeeData extends PositionRange { ... }

// Remove PositionsMapping as it used PositionFeeData
// interface PositionsMapping { ... }


// Updated interface for data needed when adding/updating a position in storage
// Removed fields related to snapshot APR calculation:
// dailyAPR, lastFeeTimestamp, feeHistory, lastFeeX, lastFeeY, lastFeesUSD, lastPositionValue
interface PositionStorageData {
  originalActiveBin: number; // Bin ID at time of creation/rebalance
  minBinId: number;
  maxBinId: number;
  snapshotPositionValue: number; // Value at time of creation/rebalance (for drawdown)
  currentValue?: number; // Current value (updated frequently, maybe from dashboard calc)
  startingPositionValue?: number; // The VERY original value (persistent)
  originalStartDate?: number; // The VERY original date (persistent)
  rebalanceCount?: number;
  poolAddress?: string;
  // Accumulated claimed fees (passed during transfer)
  totalClaimedFeeX?: string;
  totalClaimedFeeY?: string;
  totalFeeUsdClaimed?: number;
  // Optional fields loaded from DB or calculated elsewhere
  previousPositionKey?: string;
  tokenXMint?: string;
  tokenYMint?: string;
  // --- REMOVED ---
  // dailyAPR?: number;
  // lastFeeTimestamp?: number;
  // feeHistory?: FeeSnapshot[];
  // lastFeeX?: string; // Pending raw X
  // lastFeeY?: string; // Pending raw Y
  // lastFeesUSD?: number; // Pending USD
  // lastPositionValue?: number; // Alias for currentValue
  // --- END REMOVED ---
}

/**
 * PositionStorage manages the storage of user positions and their associated bin ranges.
 */
export class PositionStorage {
  private filePath: string;
  // Use PositionStorageData for the internal cache type
  private positions: { [positionPubKey: string]: PositionStorageData } = {};
  private positionRepository: PositionRepository;
  private supabaseEnabled: boolean = true; // Flag to enable/disable Supabase integration
  private config: Config; // Store config

  /**
   * Constructs a new PositionStorage instance.
   * @param config - The configuration object containing necessary settings.
   * @param fileName - The name of the file to store positions.
   */
  constructor(config: Config, fileName: string = 'positions.json') {
    this.config = config; // Assign config
    this.filePath = path.resolve(this.config.dataDirectory, fileName);
    this.positionRepository = new PositionRepository();
    this.load();
  }

  /**
   * Loads the positions mapping from the JSON file and Supabase.
   */
  private async load(): Promise<void> {
    try {
      // If Supabase is enabled, try to load exclusively from there
      if (this.supabaseEnabled) {
        try {
          const supabasePositions = await this.positionRepository.loadPositions();

          // Use Supabase as the only source of truth
          this.positions = supabasePositions;

          console.log(`Loaded ${Object.keys(this.positions).length} positions from Supabase`);
          return;
        } catch (error) {
          console.error('Error loading positions from Supabase:', error);
          // Initialize empty positions object if Supabase fails
          this.positions = {};
        }
      } else {
        // If Supabase is disabled, keep the JSON file as fallback
        if (fs.existsSync(this.filePath)) {
          const data = fs.readFileSync(this.filePath, 'utf-8');
          this.positions = JSON.parse(data);
          console.log(`Loaded positions from ${this.filePath}`);
        } else {
          this.positions = {};
        }
      }
    } catch (error: any) {
      console.error('Error loading positions:', error.message || error);
      this.positions = {};
    }
  }

  /**
   * Adds or updates a position in local storage and syncs to DB.
   * Handles both new positions and updates after rebalancing.
   */
  public addPosition(
    positionKey: PublicKey,
    data: PositionStorageData
  ): void {
    const positionId = positionKey.toString();

    // Determine persistent values (only set initially or transferred)
    const existingEntry = this.positions[positionId];
    const startingValue = data.startingPositionValue ?? existingEntry?.startingPositionValue ?? data.snapshotPositionValue;
    const startDate = data.originalStartDate ?? existingEntry?.originalStartDate ?? Date.now();

    // Construct the full data, prioritizing incoming data but keeping history if needed
    const positionData: PositionStorageData = {
      // Removed references to feeHistory etc.
      ...existingEntry,
      ...data,
      startingPositionValue: startingValue,
      originalStartDate: startDate,
      // Ensure claimed fees are correctly assigned
      totalClaimedFeeX: data.totalClaimedFeeX ?? existingEntry?.totalClaimedFeeX ?? '0',
      totalClaimedFeeY: data.totalClaimedFeeY ?? existingEntry?.totalClaimedFeeY ?? '0',
      totalFeeUsdClaimed: data.totalFeeUsdClaimed ?? existingEntry?.totalFeeUsdClaimed ?? 0,
    };

    // Update local cache
    this.positions[positionId] = positionData;
    console.log(`Added/Updated position ${positionId} in local storage. StartVal: ${startingValue}, SnapshotVal: ${positionData.snapshotPositionValue}, ClaimedUSD: ${positionData.totalFeeUsdClaimed}`);

    // Sync to Supabase
    if (this.supabaseEnabled) {
      this.positionRepository.syncPosition(
        positionId,
        positionData // Pass the complete, merged data
      ).catch(error => console.error(`Error syncing position ${positionId} to Supabase:`, error));
    }
  }

  /**
   * Retrieves the bin range for a given position.
   * @param positionPubKey - The public key of the position.
   * @returns The bin range details or undefined if not found.
   */
  public getPositionRange(positionPubKey: PublicKey): PositionStorageData | undefined {
    return this.positions[positionPubKey.toBase58()];
  }

  /**
   * Retrieves all stored position mappings.
   * @returns The complete positions mapping.
   */
  public getAllPositions(): { [positionPubKey: string]: PositionStorageData } { // Update return type
    return this.positions;
  }

  /**
   * Removes position from local cache AND database.
   */
  public async removePosition(positionPubKey: PublicKey): Promise<void> {
    const positionKey = positionPubKey.toBase58();
    if (this.positions[positionKey]) {
        delete this.positions[positionKey];
        console.log(`Removed position ${positionKey} from local storage.`);
    } else {
        console.warn(`Attempted to remove position ${positionKey} not found in local storage.`);
    }

    // Remove from database via repository
    if (this.supabaseEnabled) {
        await this.positionRepository.removePosition(positionKey);
    }
  }

  /**
   * Cleans up the positions storage by removing any positions that don't exist on-chain
   * @param activePositionKeys - Array of position public keys currently active on-chain
   */
  public async cleanupStalePositions(activePositionKeys: PublicKey[]): Promise<void> {
    console.log(`Cleaning up stale positions in storage...`);
    const activeKeyStrings = activePositionKeys.map(key => key.toString());

    // Get all stored position keys
    const storedKeys = Object.keys(this.positions);

    // Find keys that exist in storage but not on-chain
    const staleKeys = storedKeys.filter(key => !activeKeyStrings.includes(key));

    // Remove stale positions
    if (staleKeys.length > 0) {
      console.log(`Found ${staleKeys.length} stale positions to remove`);
      for (const key of staleKeys) {
        console.log(`Removing stale position: ${key}`);
        // Use the new removePosition method which handles both local and DB
        await this.removePosition(new PublicKey(key));
      }
      console.log('Stale positions cleanup complete.');
    } else {
      console.log(`No stale positions found`);
    }
  }

  /**
   * Transfers history from the old position to the new one and updates storage.
   * Assumes the new position is already created on-chain.
   * Triggers DB sync for the new position.
   */
   public transferPositionHistory(
     oldPositionPubKey: PublicKey,
     newPositionPubKey: PublicKey,
     newPositionSnapshotData: { // Data about the NEW position's state *now*
       originalActiveBin: number;
       minBinId: number;
       maxBinId: number;
       snapshotPositionValue: number; // Current value of the NEW position
       poolAddress?: string;
     },
     accumulatedFees: { // Total fees accumulated up to point of closing OLD position
       totalClaimedFeeX: string;
       totalClaimedFeeY: string;
       totalFeeUsdClaimed: number;
     }
   ): void {
     const oldPositionKey = oldPositionPubKey.toBase58();
     const oldPosition = this.positions[oldPositionKey]; // Get data from local cache

     if (!oldPosition) {
       console.warn(`Old position ${oldPositionKey} not found in local storage for history transfer. Creating new entry.`);
       // Create a new entry using addPosition, treating it as a fresh start but with claimed fees
       this.addPosition(newPositionPubKey, {
         ...newPositionSnapshotData,
         startingPositionValue: newPositionSnapshotData.snapshotPositionValue, // Use current value as starting point
         originalStartDate: Date.now(),
         rebalanceCount: 0,
         totalClaimedFeeX: accumulatedFees.totalClaimedFeeX,
         totalClaimedFeeY: accumulatedFees.totalClaimedFeeY,
         totalFeeUsdClaimed: accumulatedFees.totalFeeUsdClaimed,
       });
       return;
     }

     // Prepare data for the new position entry, inheriting history
     const newPositionDataForStorage: PositionStorageData = {
       ...newPositionSnapshotData,
       // Inherit persistent historical data
       startingPositionValue: oldPosition.startingPositionValue,
       originalStartDate: oldPosition.originalStartDate,
       rebalanceCount: (oldPosition.rebalanceCount || 0) + 1,
       // --- ADD MINTS ---
       tokenXMint: oldPosition.tokenXMint, // Carry over mints
       tokenYMint: oldPosition.tokenYMint, // Carry over mints
       // --- END MINTS ---
       // Store accumulated claimed fees
       totalClaimedFeeX: accumulatedFees.totalClaimedFeeX,
       totalClaimedFeeY: accumulatedFees.totalClaimedFeeY,
       totalFeeUsdClaimed: accumulatedFees.totalFeeUsdClaimed,
       previousPositionKey: oldPositionKey, // Link lineage
     };

     // Use addPosition to create/update the new position's entry (triggers DB sync)
     this.addPosition(newPositionPubKey, newPositionDataForStorage);

     console.log(`Transferred history from ${oldPositionKey} to ${newPositionPubKey.toString()}.`);
     console.log(`  Original Start Value: ${newPositionDataForStorage.startingPositionValue?.toFixed(4)}`);
     console.log(`  New Snapshot Value: ${newPositionDataForStorage.snapshotPositionValue.toFixed(4)}`);
     console.log(`  Accumulated Claimed Fees (USD): ${newPositionDataForStorage.totalFeeUsdClaimed?.toFixed(4)}`);
     console.log(`  Rebalance Count: ${newPositionDataForStorage.rebalanceCount}`);
   }
}

