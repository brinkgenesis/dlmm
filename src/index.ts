import { Config } from './models/Config';
import { DLMMClient } from './utils/DLMMClient';
import { PositionManager } from './PositionManager';
import { PublicKey } from '@solana/web3.js';
import { PositionStorage } from './utils/PositionStorage';
import BN from 'bn.js';
import DLMM, { StrategyType } from '@meteora-ag/dlmm';
import { formatBN } from './utils/formatBN';
import { RiskManager } from './RiskManager';

/**
 * Main execution block
 */
(async () => {
  try {
    // Load your configuration (Singleton)
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
    console.log('PositionStorage instance created.');

    //Risk Managerment Logic here
    
    // Prompt user to select a risk case
    const priceSpread = await RiskManager.promptUserForRiskCase();

    // Assume you get the current price of the token pair from an API or other source
    const currentPrice = /* Fetch current price */ 100; // Example current price

    // Calculate bin parameters based on the selected risk case
    const { lowerPrice, upperPrice } = RiskManager.calculateBinParameters(currentPrice, priceSpread);

    console.log(`Calculated Bin Parameters:`);
    console.log(`Lower Price: $${lowerPrice.toFixed(2)}`);
    console.log(`Upper Price: $${upperPrice.toFixed(2)}`);

    // Proceed with execution logic using the bin parameters


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
