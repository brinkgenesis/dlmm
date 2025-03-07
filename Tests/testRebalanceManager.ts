import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { Config } from '../src/models/Config';
import { RebalanceManager } from '../src/rebalanceManager';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
  try {
    console.log('🔄 Starting RebalanceManager Test');
    
    // Load configuration
    const config = Config.loadSync();
    console.log('✅ Config loaded successfully');
    
    // Load wallet from private key in .env
    let walletKeypair: Keypair;
    if (process.env.PRIVATE_KEY) {
      const privateKeyArray = process.env.PRIVATE_KEY.split(',').map(Number);
      walletKeypair = Keypair.fromSecretKey(new Uint8Array(privateKeyArray));
      console.log(`✅ Wallet loaded from PRIVATE_KEY: ${walletKeypair.publicKey.toString()}`);
    } else {
      // Fallback to file-based wallet
      const walletPath = path.join(os.homedir(), '.config', 'solana', 'id.json');
      console.log(`Loading wallet from file: ${walletPath}`);
      
      if (!fs.existsSync(walletPath)) {
        throw new Error(`Wallet file not found at ${walletPath}`);
      }
      
      const walletKeyData = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
      walletKeypair = Keypair.fromSecretKey(new Uint8Array(walletKeyData));
      console.log(`✅ Wallet loaded from file: ${walletKeypair.publicKey.toString()}`);
    }
    
    // Setup connection using SOLANA_RPC from .env
    const rpcUrl = process.env.SOLANA_RPC || 'https://withered-wild-snowflake.solana-mainnet.quiknode.pro/a1d7f0f489259367148eef8ae06627b19fdb9651';
    console.log(`Connecting to Solana network at: ${rpcUrl}`);
    const connection = new Connection(rpcUrl, 'confirmed');
    
    // Initialize RebalanceManager
    console.log('Initializing RebalanceManager...');
    const rebalanceManager = new RebalanceManager(connection, walletKeypair, config);
    
    // Get all user positions
    console.log('Fetching user positions...');
    const positions = await rebalanceManager.getUserPositions();
    console.log(`Found ${positions.size} positions`);
    
    // Display position details
    if (positions.size > 0) {
      console.log('\nPosition Details:');
      for (const [key, position] of positions.entries()) {
        console.log(`\nPosition: ${key}`);
        console.log(`Pool: ${position.publicKey.toString()}`);
        
        if (position.lbPairPositionsData.length > 0) {
          const posData = position.lbPairPositionsData[0].positionData;
          console.log(`X Amount: ${posData.totalXAmount.toString()}`);
          console.log(`Y Amount: ${posData.totalYAmount.toString()}`);
          
          // Calculate position value
          const value = await rebalanceManager.calculatePositionValue(position);
          console.log(`Estimated Value: $${value.toFixed(2)}`);
        }
      }
    }
    
    // Run rebalance check
    console.log('\n🔄 Running rebalance check...');
    await rebalanceManager.checkAndRebalancePositions();
    
    console.log('\n✅ RebalanceManager test completed');
    
  } catch (error) {
    console.error('❌ Error in RebalanceManager test:', error);
  }
}

// Make calculatePositionValue public for testing
RebalanceManager.prototype.calculatePositionValue = function(position) {
  return this['calculatePositionValue'](position);
};

// Run the main function
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
