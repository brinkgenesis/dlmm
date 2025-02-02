import { Config } from './models/Config';
import { DLMMClient } from './utils/DLMMClient';
import { PublicKey, SendTransactionError } from '@solana/web3.js';
import { PositionStorage } from './utils/PositionStorage';
import BN from 'bn.js';
import DLMM, { StrategyType, StrategyParameters } from '@meteora-ag/dlmm';
import { formatBN } from './utils/formatBN';
import inquirer from 'inquirer';
import * as fs from 'fs';
import * as path from 'path';
import { calculateTokenAmounts } from './utils/calculateAmounts';
import { PositionManager } from './managePosition';
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

    // Prompt user for strategy type
    const { strategyOption } = await inquirer.prompt([
      {
        type: 'list',
        name: 'strategyOption',
        message: 'Which strategy would you like to use?',
        choices: [
          { name: 'Spot Balanced', value: 'spotBalanced' },
          { name: 'Single Sided (BidAskImBalanced)', value: 'singleSide' },
        ],
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


    // Assume you get the current price of the token pair from an API or other source

    // Initialize PositionStorage
    const positionStorage = new PositionStorage(config);
    console.log('PositionStorage instance created.');

  

    // Create new Position
    
    if (strategyOption === 'spotBalanced') {
      const { positionPubKey, minBinId, maxBinId } = await client.createPosition(userDollarAmount);
      console.log(`Spot Balanced Position Created: ${positionPubKey.toBase58()}`);
      positionStorage.addPosition(positionPubKey,{
        originalActiveBin: activeBin.binId,
        minBinId,
        maxBinId,
        snapshotPositionValue: userDollarAmount
      });
    } else {
      const { singleSideChoice } = await inquirer.prompt([
        {
          type: 'list',
          name: 'singleSideChoice',
          message: 'Which token do you want to use for the single-sided position?',
          choices: [
            { name: 'Token X', value: true },
            { name: 'Token Y (Sol)', value: false },
          ],
        },
      ]);
      const singleSidedX = singleSideChoice;
      const { positionPubKey, minBinId, maxBinId } = await client.createSingleSidePosition(
        userDollarAmount,
        singleSidedX
      );
      console.log(`Single Sided Position Created: ${positionPubKey.toBase58()}`);
      positionStorage.addPosition(positionPubKey,{
        originalActiveBin: activeBin.binId,
        minBinId,
        maxBinId,
        snapshotPositionValue: userDollarAmount
      });
    }
  
      //start Position Manager
      console.log(`Starting Position Manager`);
      const positionManager = new PositionManager(client, poolPublicKey);
      positionManager.monitorAndAdjust(); // Starts 30m interval
   
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
