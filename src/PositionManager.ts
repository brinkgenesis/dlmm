import { PublicKey } from '@solana/web3.js';
import { DLMMClient } from './utils/DLMMClient';
import { Config } from './models/Config';
import BN from 'bn.js';

/**
 * PositionManager is responsible for managing liquidity positions based on market conditions.
 */
export class PositionManager {
  private client: DLMMClient;
  private config: Config;

  /**
   * Constructs a new PositionManager instance.
   * @param client - An instance of DLMMClient.
   * @param config - The configuration object containing necessary settings.
   */
  constructor(client: DLMMClient, config: Config) {
    this.client = client;
    this.config = config;
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

      // Retrieve current active bin
      const activeBinInfo = await this.client.getActiveBin();
      const activeBinId = activeBinInfo.binId;

      console.log(`Current Active Bin ID: ${activeBinId}`);

      for (const position of userPositions) {
        // Use the correct property name 'publicKey'
        const positionPubKey: PublicKey = position.publicKey;
        const positionData = position.positionData;

        // Define original active bin (assuming it's stored or can be derived)
        const originalActiveBin = activeBinId; // This might need to be stored separately if it changes

        // Define position's bin range
        const TOTAL_RANGE_INTERVAL = 10;
        const minBinRange = originalActiveBin - TOTAL_RANGE_INTERVAL;
        const maxBinRange = originalActiveBin + TOTAL_RANGE_INTERVAL;

        // Determine current bin using position data
        const currentBin = this.getCurrentBin(positionData);

        console.log(`Position ${positionPubKey.toBase58()} - Current Bin: ${currentBin}`);

        // Check if the current bin is +/-6 from original active bin or within 4 bins of either end
        if (
          currentBin <= originalActiveBin - 6 ||
          currentBin >= originalActiveBin + 6 ||
          currentBin <= minBinRange + 4 ||
          currentBin >= maxBinRange - 4
        ) {
          console.log(`Criteria met for removing liquidity from position: ${positionPubKey.toBase58()}`);
          await this.client.removeLiquidity(positionPubKey);
          console.log(`Liquidity removal initiated for position: ${positionPubKey.toBase58()}`);
        } else {
          console.log(`No action required for position: ${positionPubKey.toBase58()}`);
        }
      }
    } catch (error: any) {
      console.error('Error managing positions:', error.message || error);
    }
  }

  /**
   * Determines the current bin based on position data.
   * @param positionData - The data of the user position.
   * @returns The current bin ID.
   */
  private getCurrentBin(positionData: any): number {
    // Implement logic to determine the current bin based on positionData
    // This is a placeholder and should be replaced with actual computation
    // For example, based on price movements or other criteria

    // Example logic (to be customized):
    // Calculate the average bin based on position's bin data
    const bins = positionData.positionBinData;
    const binIds = bins.map((bin: any) => bin.binId);
    const averageBin = binIds.reduce((a: number, b: number) => a + b, 0) / binIds.length;

    return Math.round(averageBin);
  }
}
