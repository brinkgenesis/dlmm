import { Config } from './models/Config';
import { DLMMClient } from './utils/DLMMClient';
import { PositionManager } from './PositionManager';
import { PublicKey } from '@solana/web3.js';
import { PositionStorage } from './utils/PositionStorage';
import BN from 'bn.js';
import DLMM, { StrategyType } from '@meteora-ag/dlmm';

/**
 * Main execution block
 */
(async () => {
  try {
    // Load your configuration
    const config = Config.load();
    console.log('Configuration loaded successfully.');

    // Create DLMMClient instance
    const client = new DLMMClient(config);
    console.log('DLMMClient instance created.');

    // Define the DLMM pool's public key
    const poolPublicKey = new PublicKey('ARwi1S4DaiTG5DX7S4M4ZsrXqpMD1MrTmbu9ue2tpmEq'); // Replace with your actual pool public key

    // Initialize the DLMM Pool
    await client.initializeDLMMPool(poolPublicKey);
    console.log('DLMM Pool initialized.');

    // Initialize PositionStorage
    const positionStorage = new PositionStorage();

    // Example: Creating a new position
    const totalXAmount = new BN(10000); // Replace with actual amount
    const strategyType = StrategyType.SpotBalanced; // SpotBalanced Strategy default


    // Create the position and retrieve its PublicKey
    const positionPubKey: PublicKey = await client.createPosition(totalXAmount, strategyType);
    console.log(`Position created with Public Key: ${positionPubKey.toBase58()}`);

    // Retrieve the Active Bin after position creation
    const activeBinInfo = await client.getActiveBin();
    const activeBinId = activeBinInfo.binId;
    console.log(`Active Bin ID at Position Creation: ${activeBinId}`);

    // Calculate bin ranges based on active bin
    const TOTAL_RANGE_INTERVAL = 10;
    const minBinRange = activeBinId - TOTAL_RANGE_INTERVAL;
    const maxBinRange = activeBinId + TOTAL_RANGE_INTERVAL;
    console.log(`Calculated Bin Ranges - Min: ${minBinRange}, Max: ${maxBinRange}`);

    // Store the position's bin ranges
    positionStorage.addPosition(positionPubKey, {
      originalActiveBin: activeBinId,
      minBinRange,
      maxBinRange,
    });
    console.log(`Stored bin ranges for position ${positionPubKey.toBase58()}`);

    // Create PositionManager instance
    const positionManager = new PositionManager(client, config, positionStorage);
    console.log('PositionManager instance created.');

    // Ensure Associated Token Accounts exist
    await client.ensureATAs();
    console.log('ATA (Associated Token Accounts) ensured.');

    // Manage Positions Based on Market Conditions
    await positionManager.managePositions();
    console.log('Position management executed.');

  } catch (error: any) {
    console.error('Error running DLMMClient:', error.message || error);
  }
})();
