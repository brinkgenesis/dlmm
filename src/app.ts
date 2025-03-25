import { PassiveProcessManager } from './passiveProcess';
import { OrderManager } from './orderManager';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { Config } from './models/Config';
import { PositionStorage } from './utils/PositionStorage';
import { RiskManager } from './riskManager';
import { RebalanceManager } from './rebalanceManager';
import { Dashboard, PositionData } from './dashboard';
import { MarketSelector } from './marketSelector';
import { UserConfig } from '../frontend/wallet/UserConfig';
import bs58 from 'bs58';


export class TradingApp {
  private passiveManager?: PassiveProcessManager;
  private orderManagers = new Map<string, OrderManager>(); // Map of poolAddress to OrderManager
  private config: Config;
  private positionStorage: PositionStorage;
  private riskManager!: RiskManager;
  private rebalanceManager!: RebalanceManager;
  private riskMonitoringInterval?: NodeJS.Timeout;
  private rebalanceInterval?: NodeJS.Timeout;
  private marketSelector: MarketSelector;
  private delegationPDA?: PublicKey;
  private userPublicKey?: PublicKey;

  constructor(
    public connection: Connection,
    public wallet: Keypair,
    config: Config
  ) {
    console.log('Starting DLMM Manager...');
    this.config = config;
    console.log('Config loaded successfully');
    
    // Initialize once
    this.positionStorage = new PositionStorage(this.config);
    console.log('Position storage initialized');
    
    // Initialize global risk manager with the updated parameters
    this.riskManager = new RiskManager(this.connection, this.wallet, this.config, this.positionStorage);
    console.log('Risk manager initialized');
    
    // Initialize rebalance manager
    this.rebalanceManager = new RebalanceManager(this.connection, this.wallet, this.config, this.positionStorage);
    console.log('Rebalance manager initialized');

    // Initialize market selector
    this.marketSelector = new MarketSelector(
      this.connection,
      this.wallet,
      this.positionStorage,
      this.config
    );
  }

  public async initialize() {
    console.log('Initializing All Other Functions..');
    
    // Initialize passive processes for ALL pools
    await this.initializePassiveProcesses();
    
    // Start risk management monitoring
    this.startRiskManagement();
    
    // Start rebalance monitoring
    this.startRebalanceMonitoring();
    
    console.log(`Markets loaded: ${this.marketSelector.markets.length} available markets`);
    
    console.log('✅ DLMM Manager fully initialized with all managers running');
  }

  private async initializePassiveProcesses() {
    console.log('Initializing passive processes...');
    
    this.passiveManager = new PassiveProcessManager(
      this.connection,
      this.wallet,
      this.config,
      this.positionStorage
    );
    console.log('Passive process manager created');
    
    if (this.isAnyPassiveEnabled) {
      console.log('Auto-claim or auto-compound enabled, starting passive processes...');
      await this.passiveManager.startAll();
      console.log('✅ Passive processes started successfully');
    } else {
      console.log('No passive processes enabled in config');
    }
  }

  private initializeOrderManager(poolAddress: PublicKey) {
    const orderManager = new OrderManager(
      this.connection,
      poolAddress,
      this.wallet,
      this.positionStorage,
      this.config
    );
    this.orderManagers.set(poolAddress.toString(), orderManager);
  }

  /**
   * Starts the risk management system to monitor and protect positions
   */
  private startRiskManagement() {
    console.log('Initializing risk management system...');
    
    // Clear any existing interval
    if (this.riskMonitoringInterval) {
      clearInterval(this.riskMonitoringInterval);
      console.log('Cleared existing risk monitoring interval');
    }
    
    // Start global monitoring for all positions
    this.riskMonitoringInterval = setInterval(async () => {
      try {
        console.log('Running scheduled risk management check...');
        
        // Enforce circuit breakers across all pools
        await this.riskManager.enforceAllCircuitBreakers();
        
        // Also check for volume drops across all positions
        const volumeDropDetected = await this.riskManager.checkVolumeDrop(0.5);
        if (volumeDropDetected) {
          console.warn("⚠️ Volume drop detected! Reducing position sizes by 25%");
          await this.riskManager.adjustPositionSize(2500); // 25% reduction
        }
        
        console.log('Risk management check completed');
      } catch (error) {
        console.error('Risk management monitoring error:', error);
      }
    }, 15 * 60 * 1000); // 15 minute interval
    
    console.log('✅ Risk management system initialized and monitoring started (15-minute intervals)');
  }

  /**
   * Starts the rebalance monitoring system
   */
  private startRebalanceMonitoring() {
    console.log('Initializing rebalance monitoring system...');
    
    // Clear any existing interval
    if (this.rebalanceInterval) {
      clearInterval(this.rebalanceInterval);
      console.log('Cleared existing rebalance monitoring interval');
    }
    
    // Add debug log before initial check
    console.log('Running initial rebalance check...');
    
    // Run an initial check
    try {
      this.rebalanceManager.checkAndRebalancePositions();
      console.log('Initial rebalance check completed');
    } catch (error) {
      console.error('Error during initial rebalance check:', error);
    }
    
    // Start periodic monitoring with additional logging
    this.rebalanceInterval = setInterval(() => {
      try {
        console.log('Running scheduled rebalance check...');
        this.rebalanceManager.checkAndRebalancePositions();
        console.log('Scheduled rebalance check completed at', new Date().toISOString());
      } catch (error) {
        console.error('Rebalance monitoring error:', error);
      }
    }, 30 * 60 * 1000); // 30 minute interval
    
    console.log('✅ Rebalance monitoring system initialized (30-minute intervals)');
  }

  // Frontend Controls
  public async toggleAutoClaim(enabled: boolean) {
    const config = await this.config;
    config.autoClaimEnabled = enabled;
    await config.save();
    await this.restartPassiveProcesses();
  }

  public async toggleAutoCompound(enabled: boolean) {
    const config = await this.config;
    config.autoCompoundEnabled = enabled;
    await config.save();
    await this.restartPassiveProcesses();
  }

  private async restartPassiveProcesses() {
    this.passiveManager?.stopAll();
    await this.initializePassiveProcesses();
  }

  private get isAnyPassiveEnabled(): boolean {
    return this.config.autoClaimEnabled || this.config.autoCompoundEnabled;
  }

  // Order Submission
  public async submitOrder(poolAddress: PublicKey, orderConfig: {
    orderType: 'LIMIT' | 'TAKE_PROFIT' | 'STOP_LOSS';
    triggerPrice: number;
    sizeUSD?: number;
    closeBps?: number;
    side?: 'X' | 'Y';
  }): Promise<string> {
    // Get or create OrderManager for this pool
    const poolKey = poolAddress.toString();
    if (!this.orderManagers.has(poolKey)) {
      this.initializeOrderManager(poolAddress);
    }
    const orderManager = this.orderManagers.get(poolKey)!;
    
    return orderManager.submitOrder(orderConfig);
  }
  /**
   * Emergency method to close all positions
   * This will be called from the frontend
   */
  public async emergencyCloseAllPositions(): Promise<{ success: boolean; message: string }> {
    try {
      console.log('🚨 EMERGENCY: Closing all positions...');
      
      // Call the RiskManager's closeAllPositions method
      await this.riskManager.closeAllPositions();
      
      console.log('✅ All positions closed successfully');
      return { 
        success: true, 
        message: 'All positions closed successfully' 
      };
    } catch (error) {
      console.error('❌ Error closing all positions:', error);
      return { 
        success: false, 
        message: `Error closing positions: ${error instanceof Error ? error.message : String(error)}` 
      };
    }
  }
  

  

  
  // Method to stop all monitoring and processes
  public shutdown() {
    console.log('Shutting down TradingApp...');
    
    // Clear risk monitoring interval
    if (this.riskMonitoringInterval) {
      clearInterval(this.riskMonitoringInterval);
      this.riskMonitoringInterval = undefined;
    }
    
    // Clear rebalance monitoring interval
    if (this.rebalanceInterval) {
      clearInterval(this.rebalanceInterval);
      this.rebalanceInterval = undefined;
    }
    
    // Stop passive processes
    this.passiveManager?.stopAll();
    
    console.log('TradingApp shutdown complete');
  }

  public getConfig(): Config {
    return this.config;
  }

  // Add getter method for marketSelector
  public getMarketSelector(): MarketSelector {
    return this.marketSelector;
  }

  /**
   * Initializes TradingApp with a delegated user wallet
   */
  public static async createForDelegatedUser(
    connection: Connection,
    userWalletPublicKey: PublicKey
  ): Promise<TradingApp> {
    const userConfig = await UserConfig.loadForUser(userWalletPublicKey.toString());
    
    // Create instance with server wallet
    const serverWallet = Keypair.fromSecretKey(
      bs58.decode(process.env.SERVER_SIGNING_KEY!)
    );
    
    const app = new TradingApp(connection, serverWallet, userConfig);
    return app;
  }

  // Add a helper method to sign transactions based on mode
  private async signTransaction(transaction: Transaction): Promise<Transaction> {
    // Check for delegation mode
    if (this.isDelegationConfig(this.config)) {
      return this.signWithDelegation(transaction);
    } else {
      // Original signing with wallet keypair
      transaction.feePayer = this.wallet.publicKey;
      transaction.recentBlockhash = (
        await this.connection.getRecentBlockhash()
      ).blockhash;
      transaction.sign(this.wallet);
      return transaction;
    }
  }

  // Add delegation signing method
  private async signWithDelegation(transaction: Transaction): Promise<Transaction> {
    const userWalletPublicKey = this.getUserPublicKey();
    const delegationPDA = this.getDelegationPDA();
    
    if (!userWalletPublicKey || !delegationPDA) {
      throw new Error('Delegation information missing');
    }
    
    // Calculate operations to verify based on what's in the transaction
    // This is a simplified version - you'll need logic to determine operations
    const operationType = 1; // Example: 1 = create position, 2 = close position, etc.
    const amount = 1000000; // Example amount in lamports/smallest units
    
    // Build verification instruction data
    // This follows the VerifyTransaction variant in the Rust enum
    // [2] = instruction index for VerifyTransaction
    // Then encode the parameters
    const instructionData = Buffer.from([
      2, // Instruction index for VerifyTransaction
      ...new Uint8Array(new BigUint64Array([BigInt(amount)]).buffer), // amount as u64
      ...new Uint8Array(new Uint32Array([operationType]).buffer), // operation_type as u32
    ]);
    
    // Add delegation verification instruction
    const delegationInstruction = new TransactionInstruction({
      keys: [
        { pubkey: userWalletPublicKey, isSigner: false, isWritable: false },
        { pubkey: delegationPDA, isSigner: false, isWritable: false },
        { pubkey: this.wallet.publicKey, isSigner: true, isWritable: false },
      ],
      programId: new PublicKey(process.env.DELEGATION_PROGRAM_ID!),
      data: instructionData
    });
    
    transaction.add(delegationInstruction);
    transaction.feePayer = userWalletPublicKey;
    
    // In this mode, server would sign the transaction with its key
    transaction.sign(this.wallet);
    
    return transaction;
  }

  // Add helper method to check if config is a UserConfig with delegation
  private isDelegationConfig(config: Config): boolean {
    return 'delegationMode' in config && (config as any).delegationMode === true;
  }

  // Replace direct delegation property access with type-safe methods
  private getUserPublicKey(): PublicKey | undefined {
    if (this.isDelegationConfig(this.config)) {
      return (this.config as any).userWalletPublicKey;
    }
    return undefined;
  }

  private getDelegationPDA(): PublicKey | undefined {
    if (this.isDelegationConfig(this.config)) {
      return (this.config as any).delegationPDA;
    }
    return undefined;
  }

  // Static factory method for creating user-specific instance
  public static async createForUser(
    userPublicKey: PublicKey,
    connection: Connection
  ): Promise<TradingApp> {
    // Create delegated config
    const config = await UserConfig.loadForUser(userPublicKey.toString());
    
    // Create app with the server's signing wallet
    const serverWallet = Keypair.fromSecretKey(
      bs58.decode(process.env.SERVER_SIGNING_KEY!)
    );
    
    const app = new TradingApp(connection, serverWallet, config);
    return app;
  }

  // Add a getter
  public getPositionStorage(): PositionStorage {
    return this.positionStorage;
  }

  /**
   * Triggers a manual rebalance check
   * Provides public access to the private rebalanceManager
   */
  public async triggerRebalanceCheck(): Promise<void> {
    console.log('Manual rebalance check triggered');
    try {
      await this.rebalanceManager.checkAndRebalancePositions();
      console.log('Manual rebalance check completed successfully');
    } catch (error) {
      console.error('Error during manual rebalance check:', error);
      throw error; // Re-throw to let the caller handle it
    }
  }
} 