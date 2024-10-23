import * as dotenv from 'dotenv';
import { Keypair, Connection } from '@solana/web3.js';
import '@coral-xyz/anchor';

/**
 * Config class to manage application configuration.
 */
export class Config {
  meteoraApiKey: string;
  publickey: string;
  walletKeypair: Keypair;
  connection: Connection;

  /**
   * Constructs a new Config instance.
   * @param meteoraApiKey - The Meteora API Key for authenticated requests.
   * @param walletKeypair - The wallet keypair for signing transactions.
   * @param connection - The Solana connection object.
   */
  constructor(meteoraApiKey: string, publickey: string, walletKeypair: Keypair, connection: Connection) {
    this.meteoraApiKey = meteoraApiKey;
    this.publickey = publickey;
    this.walletKeypair = walletKeypair;
    this.connection = connection;
  }

  /**
   * Loads configuration from environment variables.
   * Exits the process if critical configurations are missing or invalid.
   */
  static load(): Config {
    dotenv.config();

    // Load and assign Meteora API Key
    const meteoraApiKey = process.env.METEORA_API_KEY;
    if (!meteoraApiKey) {
      console.error('METEORA_API_KEY is not set in the .env file.');
      process.exit(1);
    }

    // Load and assign Wallet Private Key
    let walletSecretKey: number[];
    try {
      walletSecretKey = JSON.parse(process.env.WALLET_PRIVATE_KEY || '[]');
      if (!Array.isArray(walletSecretKey) || walletSecretKey.length === 0) {
        throw new Error('WALLET_PRIVATE_KEY must be a non-empty JSON array of numbers.');
      }
    } catch (error: any) {
      console.error('Invalid WALLET_PRIVATE_KEY in .env file:', error.message);
      process.exit(1);
    }

        // Load and assign Wallet Private Key
    let publickey: string;
    try {
      publickey = JSON.parse(process.env.WALLET_PUBLIC_KEY || 'string');
    } catch (error: any) {
      console.error('Invalid WALLET_PRIVATE_KEY in .env file:', error.message);
      process.exit(1);
    }

    // Initialize Keypair from Secret Key
    let walletKeypair: Keypair;
    try {
      walletKeypair = Keypair.fromSecretKey(new Uint8Array(walletSecretKey));
    } catch (error: any) {
      console.error('Failed to create Keypair from WALLET_PRIVATE_KEY:', error.message);
      process.exit(1);
    }

    // Initialize Connection
    const solanaRpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(solanaRpcUrl, 'confirmed');

    return new Config(meteoraApiKey, publickey, walletKeypair, connection);
  }
}
