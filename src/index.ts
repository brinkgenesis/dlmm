import { Config } from './models/Config';
import { DLMMClient } from './utils/DLMMClient';
import { PublicKey, SendTransactionError } from '@solana/web3.js';
import { PositionStorage } from './utils/PositionStorage';
import BN from 'bn.js';
import DLMM, { StrategyType, StrategyParameters } from '@meteora-ag/dlmm';
import { formatBN } from './utils/formatBN';
import { RiskManager } from './RiskManager';
import inquirer from 'inquirer';
import * as fs from 'fs';
import * as path from 'path';
import { calculateTokenAmounts } from './utils/calculateAmounts';

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

    // **Prompt user for the dollar amount they want to use**
    const { userDollarAmount } = await inquirer.prompt([
      {
        type: 'number',
        name: 'userDollarAmount',
        message: 'Enter the dollar amount you want to use:',
        validate: (value: number) => {
          if (value > 0) {
            return true;
          }
          return 'Please enter a valid amount greater than 0.';
        }
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

    const currentActiveBinId = activeBin.binId;
    console.log(`Fetched Price: ${currentActiveBinId}`);

    // Get binStep using the new method
    const binStep = client.getBinStep();
    console.log(`Fetched binStep: ${binStep}`);

    // Initialize PositionStorage
    const positionStorage = new PositionStorage(config);
    console.log('PositionStorage instance created.');


    let totalRangeInterval: number;
    const bins = 66;
    totalRangeInterval = Math.floor(bins / 2);

    const minBinId = currentActiveBinId - totalRangeInterval;
    const maxBinId = currentActiveBinId + totalRangeInterval;


    console.log(`Using Total Range Interval: ${totalRangeInterval}`);


    // Proceed to create the position without totalYAmount
    const strategy: StrategyParameters = {
      minBinId,
      maxBinId,
      strategyType: StrategyType.SpotBalanced, // Use the enum value
      singleSidedX: false, // Set based on your strategy
    };


    // Ensure Pool is Synced Before Creating a Position
    if (await client.canSyncWithMarketPrice(currentPrice)) {
      await client.syncWithMarketPrice(currentPrice);
      console.log('Pool synchronized before creating position.');
    }

    // Create new Position

    const strategyType = StrategyType.SpotBalanced;

    // New pubkey for position
    const positionPubKey: PublicKey = await client.createPosition(
      userDollarAmount,
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
   // const positionManager = new PositionManager(
    //  client,
     //config,
     // positionStorage,
     // totalRangeInterval
   // );
   // console.log('PositionManager instance created.');

    // Ensure Associated Token Accounts exist
   // await client.ensureATAs();
  //  console.log('ATA (Associated Token Accounts) ensured.');

    // Manage Positions Based on Market Conditions
  //  await positionManager.managePositions();
   // console.log('Position management executed.');

  } catch (error: any) {
    if (error instanceof SendTransactionError) {
      console.error('Error creating position: Simulation failed.');
      console.error('Message:', error.message);
      console.error('Transaction Logs:', error.logs || 'No logs available');
    } else {
      console.error('Error running DLMMClient:', error.message || error);
    }
  }
})();
