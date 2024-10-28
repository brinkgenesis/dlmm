import { PublicKey } from '@solana/web3.js';
import { DLMMClient } from './utils/DLMMClient';
import { Config } from './models/Config';
import BN from 'bn.js';
import { PositionStorage } from './utils/PositionStorage';

/**
 * PositionManager is responsible for managing liquidity positions based on market conditions.
 */
export class PositionManager {
  private client: DLMMClient;
  private config: Config;
  private positionStorage: PositionStorage;

  /**
   * Constructs a new PositionManager instance.
   * @param client - An instance of DLMMClient.
   * @param config - The configuration object containing necessary settings.
   * @param positionStorage - An instance of PositionStorage.
   */
  constructor(client: DLMMClient, config: Config, positionStorage: PositionStorage) {
    this.client = client;
    this.config = config;
    this.positionStorage = positionStorage;
  }

  /**
   * Evaluates all user positions and manages liquidity based on bin range criteria.
   */
  async managePositions(): Promise<void> {
    try {
      // Retrieve all user positions
      const userPositions = await this.client.getUserPositions();

      if (userPositions.length === 0) {
        console.log('No user positions found to manage.');
        return;
      }

      console.log(`Managing ${userPositions.length} positions.`);

      for (const position of userPositions) {
        const positionPubKey: PublicKey = position.publicKey;
        const positionData = position.positionData;

        // Retrieve stored bin ranges
        const storedRange = this.positionStorage.getPositionRange(positionPubKey);

        if (!storedRange) {
          console.warn(`No stored bin range for position ${positionPubKey.toBase58()}. Skipping management.`);
          continue;
        }

        const { originalActiveBin, minBinRange, maxBinRange } = storedRange;

        // Determine current active bin from the latest market data
        const currentActiveBinInfo = await this.client.getActiveBin();
        const currentActiveBinId = currentActiveBinInfo.binId;

        // Optionally, you can update min and max bin ranges if needed
        // For this example, we'll keep them static based on the original active bin

        console.log(`Position: ${positionPubKey.toBase58()}`);
        console.log(`Original Active Bin: ${originalActiveBin}`);
        console.log(`Min Bin Range: ${minBinRange}`);
        console.log(`Max Bin Range: ${maxBinRange}`);
        console.log(`Current Active Bin: ${currentActiveBinId}`);

        // Determine if currentActiveBinId has moved sufficiently to warrant liquidity removal
        const shouldRemoveLiquidity =
          currentActiveBinId <= originalActiveBin - 6 ||
          currentActiveBinId >= originalActiveBin + 6 ||
          currentActiveBinId <= minBinRange + 4 ||
          currentActiveBinId >= maxBinRange - 4;

        if (shouldRemoveLiquidity) {
          console.log(`Criteria met for removing liquidity from position: ${positionPubKey.toBase58()}`);
          await this.client.removeLiquidity(positionPubKey);
          console.log(`Liquidity removal initiated for position: ${positionPubKey.toBase58()}`);

          // Optionally, remove the position from storage if it's closed
          this.positionStorage.removePosition(positionPubKey);
          console.log(`Position ${positionPubKey.toBase58()} removed from storage.`);
        } else {
          console.log(`No action required for position: ${positionPubKey.toBase58()}`);
        }
      }
    } catch (error: any) {
      console.error('Error managing positions:', error.message || error);
    }
  }
}
