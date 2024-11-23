import { Config } from './models/Config';
import { DLMMClient } from './utils/DLMMClient';
import { PositionManager } from './PositionManager';
import { PublicKey } from '@solana/web3.js';
import { PositionStorage } from './utils/PositionStorage';
import BN from 'bn.js';
import DLMM, { StrategyType, StrategyParameters } from '@meteora-ag/dlmm';
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

    // Get the active bin
    const activeBin = await client.getActiveBin();
    console.log('Active Bin:', activeBin);

    // Assume you get the current price of the token pair from an API or other source
    const currentPrice = activeBin.price;
    console.log(`Fetched Price: ${currentPrice}`);


    // Get binStep using the new method
    const binStep = client.getBinStep();
    console.log(`Fetched binStep: ${binStep}`);

    // Initialize PositionStorage
    const positionStorage = new PositionStorage();
    console.log('PositionStorage instance created.');

    // Prompt user to select a risk case
    const priceSpread = await RiskManager.promptUserForRiskCase();

    
    // Calculate bin parameters based on the selected risk case
    const { lowerPrice, upperPrice } = RiskManager.calculateBinParameters(currentPrice, priceSpread);

    console.log(`Calculated Bin Parameters:`);
    console.log(`Lower Price: $${lowerPrice.toFixed(2)}`);
    console.log(`Upper Price: $${upperPrice.toFixed(2)}`);

    // Calculate bin IDs using RiskManager and the fetched binStep
    const { lowerBinId, upperBinId } = RiskManager.calculateBinIds(lowerPrice, upperPrice, binStep);

    console.log(`Calculated Bin IDs:`);
    console.log(`Lower Bin ID: ${lowerBinId}`);
    console.log(`Upper Bin ID: ${upperBinId}`);

    // Proceed with execution logic using the bin IDs
    
    // **Ensuring Pool is Synced Before Creating a Position**
    if (await client.canSyncWithMarketPrice(currentPrice)) {
      await client.syncWithMarketPrice(currentPrice);
      console.log('Pool synchronized before creating position.');
    }

    // Proceed to create the position without totalYAmount
    const strategy: StrategyParameters = {
      minBinId: lowerBinId,
      maxBinId: upperBinId,
      strategyType: StrategyType.SpotBalanced, // Use the enum value
      singleSidedX: false, // Set based on your strategy
    };

    // Create new Position
    const totalXAmount = new BN(10000); // Replace with actual amount
    const strategyType = StrategyType.SpotBalanced;

    // New pubkey for position
    const positionPubKey: PublicKey = await client.createPosition(
      totalXAmount,
      strategyType,
      strategy
    );
    console.log(`Position created with Public Key: ${positionPubKey.toBase58()}`);

    // Store the position's bin ranges using strategy parameters
    positionStorage.addPosition(positionPubKey, {
      originalActiveBin: activeBin.binId,
      minBinId: strategy.minBinId,
      maxBinId: strategy.maxBinId,
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
