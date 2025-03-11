import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { RebalanceManager } from '../src/rebalanceManager';
import { Config } from '../src/models/Config';
import { BN } from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as dotenv from 'dotenv';
import DLMM from '@meteora-ag/dlmm';
import bs58 from 'bs58';

// Load environment variables
dotenv.config();

async function main() {
  try {
    console.log('🔄 Starting CreateSingleSidePosition Test');
    
    // Get command line arguments
    const args = process.argv.slice(2);
    if (args.length < 4) {
      console.log('Usage: ts-node testCreateSingleSidePosition.ts <poolAddress> <singleSidedX> <xAmount> <yAmount>');
      console.log('  poolAddress: The address of the DLMM pool');
      console.log('  singleSidedX: true or false (whether to create X-sided or Y-sided position)');
      console.log('  xAmount: Amount of X token (in lamports)');
      console.log('  yAmount: Amount of Y token (in lamports)');
      process.exit(1);
    }

    const poolAddress = new PublicKey(args[0]);
    const singleSidedX = args[1].toLowerCase() === 'true';
    const xAmount = new BN(args[2]);
    const yAmount = new BN(args[3]);

    console.log('Test Parameters:');
    console.log(`Pool Address: ${poolAddress.toString()}`);
    console.log(`Single Sided X: ${singleSidedX}`);
    console.log(`X Amount: ${xAmount.toString()}`);
    console.log(`Y Amount: ${yAmount.toString()}`);
    
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
    
    // Get DLMM instance
    console.log('Initializing DLMM instance for pool:', poolAddress.toString());
    const dlmm = await DLMM.create(connection, poolAddress);
    
    // Get active bin info
    const activeBin = await dlmm.getActiveBin();
    console.log('Active Bin:', activeBin.binId);
    console.log('Price Per Token:', activeBin.pricePerToken);

    // Call createSingleSidePosition
    console.log('Creating single-sided position...');
    try {
      await rebalanceManager.createSingleSidePosition(
        dlmm,
        poolAddress,
        singleSidedX,
        xAmount,
        yAmount
      );
      console.log('Position created successfully');
      console.log('✅ Test completed successfully');
    } catch (error) {
      console.error('❌ Position creation failed:', error);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
