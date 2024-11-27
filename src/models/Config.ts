import * as dotenv from 'dotenv';
import { Keypair, Connection } from '@solana/web3.js';
import bs58 from 'bs58';

/**
 * Config class to manage application configuration.
 * Implements Singleton pattern to prevent multiple initializations.
 */
export class Config {
  public publickey: string;
  public walletKeypair: Keypair;
  public connection: Connection;

  // New properties for configurations
  public poolPublicKey: string;
  public totalXAmount: number;
  public dataDirectory: string;
  public meteoraApiBaseUrl: string;
  public volatilityCheckInterval: number;
  public priceFeedUrl: string;
  public defaultMaxHistoryLength: number;
  public allowedSlippageBps: number;
  public totalRangeInterval: number;
  public bpsToRemove: number;

  // New percentage-based thresholds
  public liquidityRemovalUpperPercent: number;
  public liquidityRemovalLowerPercent: number;

  private static instance: Config | null = null;

  private constructor(
    publickey: string,
    walletKeypair: Keypair,
    connection: Connection
  ) {
    this.publickey = publickey;
    this.walletKeypair = walletKeypair;
    this.connection = connection;

    // Load additional configurations
    this.poolPublicKey = process.env.POOL_PUBLIC_KEY!;
    this.totalXAmount = parseInt(process.env.TOTAL_X_AMOUNT!, 10);
    this.dataDirectory = process.env.DATA_DIRECTORY!;
    this.meteoraApiBaseUrl = process.env.METEORA_API_BASE_URL!;
    this.volatilityCheckInterval = parseInt(process.env.VOLATILITY_CHECK_INTERVAL!, 10);
    this.priceFeedUrl = process.env.PRICE_FEED_URL!;
    this.defaultMaxHistoryLength = parseInt(process.env.DEFAULT_MAX_HISTORY_LENGTH!, 10);
    this.allowedSlippageBps = parseInt(process.env.ALLOWED_SLIPPAGE_BPS!, 10);
    this.totalRangeInterval = parseInt(process.env.TOTAL_RANGE_INTERVAL!, 10);
    this.bpsToRemove = parseInt(process.env.BPS_TO_REMOVE!, 10);

    // Load percentage-based thresholds
    this.liquidityRemovalUpperPercent = parseFloat(process.env.LIQUIDITY_REMOVAL_UPPER_PERCENT!);
    this.liquidityRemovalLowerPercent = parseFloat(process.env.LIQUIDITY_REMOVAL_LOWER_PERCENT!);
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
