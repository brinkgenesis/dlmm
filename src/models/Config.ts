import * as dotenv from 'dotenv';
import { Keypair, Connection } from '@solana/web3.js';
import bs58 from 'bs58';
import fs from 'fs/promises';

/**
 * Config class to manage application configuration.
 * Implements Singleton pattern to prevent multiple initializations.
 */
export class Config {
  public publickey: string;
  public walletKeypair: Keypair;
  public connection: Connection;

  // New properties for configurations
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

  // New configuration flags
  public autoClaimEnabled = false;
  public autoCompoundEnabled = false;

  private _poolPublicKey?: string;

  private static instance: Config | null = null;

  public constructor(
    publickey: string,
    walletKeypair: Keypair,
    connection: Connection
  ) {
    this.publickey = publickey;
    this.walletKeypair = walletKeypair;
    this.connection = connection;

    // Load additional configurations
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
  static async load(): Promise<Config> {
    if (Config.instance) {
      return Config.instance;
    }

    dotenv.config();

    // Validate required environment variables
    const required = [
      'SOLANA_RPC', 'SOLANA_WSS', 'PRIVATE_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY',
      'SOL_Price_ID', 'TOTAL_X_AMOUNT', 'DATA_DIRECTORY', 'METEORA_API_BASE_URL',
      'VOLATILITY_CHECK_INTERVAL', 'PRICE_FEED_URL', 'DEFAULT_MAX_HISTORY_LENGTH',
      'ALLOWED_SLIPPAGE_BPS', 'TOTAL_RANGE_INTERVAL', 'BPS_TO_REMOVE',
      'LIQUIDITY_REMOVAL_UPPER_PERCENT', 'LIQUIDITY_REMOVAL_LOWER_PERCENT'
    ];
    
    const missing = required.filter(varName => !process.env[varName]);
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}\n\nPlease create a .env file with all required variables.`);
    }

    const walletKeypair = Config.initializeKeypair();
    const publickey = walletKeypair.publicKey.toString();
    const connection = Config.initializeConnection();

    Config.instance = new Config(publickey, walletKeypair, connection);

    try {
      const data = await fs.readFile('config.json', 'utf-8');
      return Object.assign(Config.instance, JSON.parse(data));
    } catch {
      return Config.instance;
    }
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

  public static initializeConnection(): Connection {
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

  public set poolPublicKey(value: string) {
    this._poolPublicKey = value;
  }

  public get poolPublicKey(): string {
    if (!this._poolPublicKey) {
      throw new Error('Pool Public Key has not been set.');
    }
    return this._poolPublicKey;
  }

  async save(): Promise<void> {
    await fs.writeFile('config.json', JSON.stringify({
      autoClaimEnabled: this.autoClaimEnabled,
      autoCompoundEnabled: this.autoCompoundEnabled
    }));
  }

  static loadSync(): Config {
    if (!Config.instance) {
      Config.instance = new Config(
        process.env.PUBLIC_KEY!,
        this.initializeKeypair(),
        this.initializeConnection()
      );
    }
    return Config.instance;
  }
}
