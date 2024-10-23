import * as dotenv from 'dotenv';
import { Keypair, Connection } from '@solana/web3.js';
import '@coral-xyz/anchor';
import bs58 from 'bs58';

/**
 * Config class to manage application configuration.
 */
export class Config {
  /**meteoraApiKey: string; */
  publickey: string;
  walletKeypair: Keypair;
  connection: Connection;

  /**
   * Constructs a new Config instance.
   * @param meteoraApiKey - The Meteora API Key for authenticated requests.
   * @param publickey - The public key of the wallet.
   * @param walletKeypair - The wallet keypair for signing transactions.
   * @param connection - The Solana connection object.
   */
  constructor(/**meteoraApiKey: string, */publickey: string, walletKeypair: Keypair, connection: Connection) {
    /** this.meteoraApiKey = meteoraApiKey; */
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
    /**
    const meteoraApiKey = process.env.METEORA_API_KEY!;
    if (!meteoraApiKey) {
      console.error('METEORA_API_KEY is not set in the .env file.');
      process.exit(1);
    }

    */

    const walletKeypair = Config.initializeKeypair();
    const publickey = walletKeypair.publicKey.toString();
    const connection = Config.initializeConnection();

    return new Config(publickey, walletKeypair, connection);
  }

  private static initializeKeypair(): Keypair {
    try {
      const privateKey = new Uint8Array(bs58.decode(process.env.PRIVATE_KEY!));
      const keypair = Keypair.fromSecretKey(privateKey);
      console.log(`Initialized Keypair: Public Key - ${keypair.publicKey.toString()}`);
      return keypair;
    } catch (error: any) {
      console.error('Failed to create Keypair from PRIVATE_KEY:', error.message);
      process.exit(1);
    }
  }

  private static initializeConnection(): Connection {
    const rpcUrl = process.env.SOLANA_RPC!;
    const connection = new Connection(rpcUrl, {
      commitment: "confirmed",
      wsEndpoint: process.env.SOLANA_WSS,
    });
    console.log(`Initialized Connection to Solana RPC: ${rpcUrl.slice(0, -32)}`);
    return connection;
  }
}
