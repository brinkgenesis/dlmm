import { Connection, Keypair } from '@solana/web3.js';
import { Config } from '../src/models/Config';
import { RiskManager } from '../src/riskManager';
import * as fs from 'fs';

/**
 * Standalone script to test the RiskManager in production
 * 
 * Usage:
 * ts-node Tests/testRiskManager.ts [command]
 * 
 * Commands:
 * - check: Run circuit breaker checks on all positions
 * - sync: Synchronize positions with the chain
 * - volume: Check for volume drops
 * - reduce: Reduce all positions by 25%
 * - close: Close all positions (EMERGENCY)
 */

async function main() {
  try {
    console.log('🚀 Starting RiskManager standalone test...');
    
    // Load config using the singleton pattern
    const config = await Config.load();
    console.log('✅ Config loaded successfully');
    
    // Get connection from config
    const connection = config.connection;
    console.log(`✅ Connected to Solana RPC`);
    
    // Get wallet from config
    const wallet = config.walletKeypair;
    console.log(`✅ Using wallet: ${wallet.publicKey.toString()}`);
    
    // Initialize RiskManager
    const riskManager = new RiskManager(connection, wallet, config);
    console.log('✅ RiskManager initialized');
    
    // Get command from command line arguments
    const command = process.argv[2] || 'check';
    
    // Execute requested command
    switch (command) {
      case 'check':
        console.log('Running circuit breaker checks...');
        await riskManager.enforceAllCircuitBreakers();
        break;
        
      case 'sync':
        console.log('Synchronizing positions with chain...');
        await riskManager.syncPositionsWithChain();
        break;
        
      case 'volume':
        console.log('Checking for volume drops...');
        const volumeDropDetected = await riskManager.checkVolumeDrop(0.5);
        console.log(`Volume drop detected: ${volumeDropDetected}`);
        break;
        
      case 'reduce':
        console.log('Reducing all positions by 25%...');
        await riskManager.adjustPositionSize(2500);
        break;
        
      case 'close':
        console.log('⚠️ EMERGENCY: Closing all positions...');
        await riskManager.closeAllPositions();
        break;
        
      default:
        console.log(`Unknown command: ${command}`);
        console.log('Available commands: check, sync, volume, reduce, close');
    }
    
    console.log('✅ RiskManager test completed');
    
  } catch (error) {
    console.error('❌ Error running RiskManager test:', error);
  }
}

// Run the main function
main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
