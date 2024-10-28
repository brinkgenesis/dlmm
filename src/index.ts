import { Config } from './models/Config';
import { DLMMClient } from './utils/DLMMClient';
import { PositionManager } from './PositionManager';
import { PublicKey } from '@solana/web3.js';

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

    // Initialize DLMM Pool (ensure you provide the correct pool public key)
    const poolPublicKey = new PublicKey('ARwi1S4DaiTG5DX7S4M4ZsrXqpMD1MrTmbu9ue2tpmEq'); // Replace with your actual pool public key
    await client.initializeDLMMPool(poolPublicKey);
    console.log('DLMM Pool initialized.');

    // Create PositionManager instance
    const positionManager = new PositionManager(client, config);
    console.log('PositionManager instance created.');

    // Ensure Associated Token Accounts exist
    await client.ensureATAs();

    // Manage Positions Based on Market Conditions
    await positionManager.managePositions();

  } catch (error: any) {
    console.error('Error running DLMMClient:', error.message || error);
  }
})();
