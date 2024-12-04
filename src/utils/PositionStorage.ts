import fs from 'fs';
import path from 'path';
import { PublicKey } from '@solana/web3.js';
import { Config } from '../models/Config';

interface PositionRange {
  originalActiveBin: number;
  minBinId: number;
  maxBinId: number;
}

interface PositionsMapping {
  [positionPubKey: string]: PositionRange;
}

/**
 * PositionStorage manages the storage of user positions and their associated bin ranges.
 */
export class PositionStorage {
  private filePath: string;
  private positions: PositionsMapping = {};

  /**
   * Constructs a new PositionStorage instance.
   * @param config - The configuration object containing necessary settings.
   * @param fileName - The name of the file to store positions.
   */
  constructor(private config: Config, fileName: string = 'positions.json') {
    this.filePath = path.resolve(this.config.dataDirectory, fileName);
    this.load();
  }

  /**
   * Loads the positions mapping from the JSON file.
   */
  private load(): void {
    try {
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
    } catch (error: any) {
      console.error('Error loading positions:', error.message || error);
      this.positions = {};
    }
  }

  /**
   * Saves the current positions mapping to the JSON file.
   */
  private save(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.positions, null, 2), 'utf-8');
      console.log(`Saved positions to ${this.filePath}`);
    } catch (error: any) {
      console.error('Error saving positions:', error.message || error);
    }
  }

  /**
   * Adds a new position with its bin ranges.
   * @param positionPubKey - The public key of the position.
   * @param range - The bin range details.
   */
  public addPosition(positionPubKey: PublicKey, range: PositionRange): void {
    this.positions[positionPubKey.toBase58()] = range;
    this.save();
  }

  /**
   * Retrieves the bin range for a given position.
   * @param positionPubKey - The public key of the position.
   * @returns The bin range details or undefined if not found.
   */
  public getPositionRange(positionPubKey: PublicKey): PositionRange | undefined {
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
    delete this.positions[positionPubKey.toBase58()];
    this.save();
  }
}

