import * as dotenv from 'dotenv';
import { Keypair, Connection } from '@solana/web3.js';
import bs58 from 'bs58';

/**
 * Config class to manage application configuration.
 * Implements Singleton pattern to prevent multiple initializations.
 */
export class Config {
  publickey: string;
  walletKeypair: Keypair;
  connection: Connection;

  private static instance: Config | null = null;

  /**
   * Private constructor to restrict instantiation.
   * @param publickey - The public key of the wallet.
   * @param walletKeypair - The wallet keypair for signing transactions.
   * @param connection - The Solana connection object.
   */
  private constructor(publickey: string, walletKeypair: Keypair, connection: Connection) {
    this.publickey = publickey;
    this.walletKeypair = walletKeypair;
    this.connection = connection;
  }

  /**
   * Provides a single instance of Config.
   * Initializes the instance if it doesn't exist.
   */
  static load(): Config {
    if (Config.instance) {
      return Config.instance;
    }

    dotenv.config();

    const walletKeypair = Config.initializeKeypair();
    const publickey = walletKeypair.publicKey.toString();
    const connection = Config.initializeConnection();

    Config.instance = new Config(publickey, walletKeypair, connection);
    return Config.instance;
  }

  private static initializeKeypair(): Keypair {
    try {
      const privateKeyString = process.env.PRIVATE_KEY!;
      console.log(`PRIVATE_KEY loaded: ${privateKeyString.substring(0, 10)}...`); // Debug
      const privateKey = new Uint8Array(bs58.decode(privateKeyString));
      const keypair = Keypair.fromSecretKey(privateKey);
      console.log(`Initialized Keypair: Public Key - ${keypair.publicKey.toString()}`);
      return keypair;
    } catch (error: any) {
      console.error('Failed to create Keypair from PRIVATE_KEY:', error.message);
      process.exit(1);
    }
  }

  private static initializeConnection(): Connection {
    try {
      const rpcUrl = process.env.SOLANA_RPC!;
      const wsEndpoint = process.env.SOLANA_WSS!;
      const connection = new Connection(rpcUrl, {
        commitment: 'confirmed',
        wsEndpoint: wsEndpoint,
      });
      console.log(`Initialized Connection to Solana RPC: ${rpcUrl}`);
      return connection;
    } catch (error: any) {
      console.error('Failed to initialize Solana Connection:', error.message);
      process.exit(1);
    }
  }
}
