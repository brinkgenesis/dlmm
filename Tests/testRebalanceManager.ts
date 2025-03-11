import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { Config } from '../src/models/Config';
import { RebalanceManager } from '../src/rebalanceManager';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as dotenv from 'dotenv';
import bs58 from 'bs58';

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
      try {
        // Try to decode the private key from base58
        const privateKeyBytes = bs58.decode(process.env.PRIVATE_KEY);
        walletKeypair = Keypair.fromSecretKey(privateKeyBytes);
        console.log(`✅ Wallet loaded from PRIVATE_KEY: ${walletKeypair.publicKey.toString()}`);
      } catch (error) {
        console.error('Error decoding private key:', error);
        throw new Error('Invalid private key format');
      }
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
    const rpcUrl = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
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
          
          // Calculate position value now that recursion issue is fixed
          try {
            const positionValue = await rebalanceManager.calculatePositionValue(position);
            console.log(`Position Value: $${positionValue.toFixed(2)}`);
          } catch (error) {
            console.error(`Error calculating position value: ${error}`);
          }
        }
      }
    }
    
    // Add this to your test script to debug
    for (const [key, position] of positions.entries()) {
      console.log(`Position ${key} details:`);
      console.log(`- Public key: ${position.publicKey.toString()}`);
      console.log(`- LB pair: ${position.lbPair?.toString() || 'unknown'}`);
      
      // Log the first few properties to see the structure
      const props = Object.keys(position).slice(0, 5);
      console.log(`- First properties: ${props.join(', ')}`);
    }
    
    // Run rebalance check
    console.log('\n🔄 Running rebalance check...');
    await rebalanceManager.checkAndRebalancePositions();
    
    console.log('\n✅ RebalanceManager test completed');
    
  } catch (error) {
    console.error('❌ Error in RebalanceManager test:', error);
  }
}

// Don't modify the prototype - it's causing infinite recursion
// RebalanceManager.prototype.calculatePositionValue = function(position) {
//   return this['calculatePositionValue'](position);
// };

// Run the main function
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
