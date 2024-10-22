import * as dotenv from 'dotenv';
import { Connection } from '@solana/web3.js';

/**
 * Config class to manage application configuration.
 */
export class Config {
  // meteoraApiKey: string;
  // walletKeypair: Keypair;
  connection: Connection;

  /**
   * Constructs a new Config instance.
   * @param connection - The Solana connection object.
   */
  constructor(connection: Connection) {
    this.connection = connection;
    // this.meteoraApiKey = meteoraApiKey;
    // this.walletKeypair = walletKeypair;
  }

  /**
   * Loads configuration from environment variables.
   * Exits the process if critical configurations are missing or invalid.
   */
  static load(): Config {
    dotenv.config();

    // Initialize Connection
    const solanaRpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(solanaRpcUrl, 'confirmed');

    return new Config(connection);
  }
}
