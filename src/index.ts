import { Config } from './models/Config';
import { DLMMClient } from './utils/DLMMClient';
import { PositionManager } from './PositionManager';
import { PublicKey } from '@solana/web3.js';
import { PositionStorage } from './utils/PositionStorage';
import BN from 'bn.js';
import DLMM, { StrategyType, StrategyParameters } from '@meteora-ag/dlmm';
import { formatBN } from './utils/formatBN';
import { RiskManager } from './RiskManager';
import inquirer from 'inquirer';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Main execution block
 */
(async () => {
  try {
    // Load your configuration (Singleton)
    const config = Config.load();
    console.log('Configuration loaded successfully.');

    // **Read markets.json**
    const marketsPath = path.join(__dirname, 'models', 'markets.json');
    const marketsData = fs.readFileSync(marketsPath, 'utf-8');
    const markets = JSON.parse(marketsData);

    // **Prompt user to select a market**
    const marketChoices = markets.map((market: any, index: number) => ({
      name: `${index + 1}. ${market.name}`,
      value: market.publicKey,
    }));

    const { selectedMarketPublicKey } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedMarketPublicKey',
        message: 'Select a market to use:',
        choices: marketChoices,
      },
    ]);

    // **Set the selected POOL_PUBLIC_KEY in config**
    config['poolPublicKey'] = selectedMarketPublicKey;
    console.log(`Selected Pool Public Key: ${config['poolPublicKey']}`);

    // Create DLMMClient instance
    const client = new DLMMClient(config);
    console.log('DLMMClient instance created.');

    // Define the DLMM pool's public key
    const poolPublicKey = new PublicKey(config['poolPublicKey']);

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
    const positionStorage = new PositionStorage(config);
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

    // **Prompt User for Bin Steps**
    const binStepsAnswer = await inquirer.prompt([
      {
        type: 'input',
        name: 'binSteps',
        message: 'Input Bin Steps (leave empty to use default from config):',
        validate: (input: string) => {
          if (input === '') return true;
          const parsed = parseInt(input, 10);
          return (!isNaN(parsed) && parsed > 0) || 'Please enter a valid positive number';
        },
      },
    ]);

    let totalRangeInterval: number;
    if (binStepsAnswer.binSteps !== '') {
      const binSteps = parseInt(binStepsAnswer.binSteps, 10);
      totalRangeInterval = Math.floor(binSteps / 2);
    } else {
      totalRangeInterval = config.totalRangeInterval;
    }

    console.log(`Using Total Range Interval: ${totalRangeInterval}`);

    // Ensure Pool is Synced Before Creating a Position
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
    const totalXAmount = new BN(config.totalXAmount);
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

    // **Create PositionManager Instance with totalRangeInterval**
    const positionManager = new PositionManager(
      client,
      config,
      positionStorage,
      totalRangeInterval
    );
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
