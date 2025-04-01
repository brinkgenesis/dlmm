import { PassiveProcessManager } from './passiveProcess';
import { OrderManager } from './orderManager';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { Config } from './models/Config';
import { PositionStorage } from './utils/PositionStorage';
import { PositionRepository } from './services/positionRepository';
import { RiskManager } from './riskManager';
import { RebalanceManager } from './rebalanceManager';
import { Dashboard, PositionData } from './dashboard';
import { MarketSelector } from './marketSelector';
import { UserConfig } from '../frontend/wallet/UserConfig';
import bs58 from 'bs58';
import DLMM, { LbPosition, LbPair, PositionInfo } from '@meteora-ag/dlmm';
import { PositionTriggerMonitor } from './positionTriggerMonitor';

export class TradingApp {
  private passiveManager?: PassiveProcessManager;
  private orderManagers = new Map<string, OrderManager>();
  private config: Config;
  private positionStorage: PositionStorage;
  private positionRepository: PositionRepository;
  private riskManager!: RiskManager;
  private rebalanceManager!: RebalanceManager;
  private riskMonitoringInterval?: NodeJS.Timeout;
  private rebalanceInterval?: NodeJS.Timeout;
  private marketSelector: MarketSelector;
  private delegationPDA?: PublicKey;
  private userPublicKey?: PublicKey;
  private positionTriggerMonitor: PositionTriggerMonitor;

  constructor(
    public connection: Connection,
    public wallet: Keypair,
    config: Config,
    positionRepository?: PositionRepository
  ) {
    console.log('Starting DLMM Manager...');
    this.config = config;
    console.log('Config loaded successfully');
    
    this.positionStorage = new PositionStorage(this.config);
    console.log('Position storage initialized');
    
    this.positionRepository = positionRepository || new PositionRepository();
    console.log('Position repository initialized');
    
    this.riskManager = new RiskManager(this.connection, this.wallet, this.config, this.positionStorage);
    console.log('Risk manager initialized');
    
    this.rebalanceManager = new RebalanceManager(this.connection, this.wallet, this.config, this.positionStorage);
    console.log('Rebalance manager initialized');

    this.marketSelector = new MarketSelector(
      this.connection,
      this.wallet,
      this.positionStorage,
      this.config
    );

    this.positionTriggerMonitor = new PositionTriggerMonitor(
      this.connection,
      this.wallet,
      this.config,
      this.positionRepository
    );
  }

  public async initialize() {
    console.log('Initializing TradingApp...');
    
    // Sync positions with chain first
    await this.syncPositionsState();
    
    // Initialize passive processes
    await this.initializePassiveProcesses();
    
    // Start all monitoring processes
    if (this.passiveManager) {
      await this.passiveManager.startAll();
    }
    this.positionTriggerMonitor.startMonitoring();
    this.startRiskManagement();
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

  private async syncPositionsState() {
    console.log('Syncing position state: Fetching on-chain and DB positions...');

    let onChainPositionsData: { positionKey: string, poolAddress: string }[] = [];
    try {
      onChainPositionsData = await this.fetchOnChainPositionsWithPools(this.wallet.publicKey);
    } catch (error) {
      console.error("Error fetching on-chain positions via SDK:", error);
      console.warn("Proceeding with position sync despite on-chain fetch error.");
    }
    const onChainPositionKeys = new Set(onChainPositionsData.map(p => p.positionKey));
    const onChainKeyToPoolMap = new Map(onChainPositionsData.map(p => [p.positionKey, p.poolAddress]));
    console.log(`Found ${onChainPositionKeys.size} active position key(s) for wallet ${this.wallet.publicKey.toString()} on-chain via SDK.`);

    const dbPositionsMap = await this.positionRepository.loadPositions();
    const dbPositionKeys = new Set(Object.keys(dbPositionsMap));
    console.log(`Loaded ${dbPositionKeys.size} position record(s) from database.`);

    const positionsToRemove: string[] = [];

    for (const onChainKey of onChainPositionKeys) {
      const poolAddress = onChainKeyToPoolMap.get(onChainKey);
      if (!poolAddress) {
        console.warn(`Could not determine pool address for on-chain position ${onChainKey}. Skipping.`);
        continue;
      }

      if (dbPositionsMap[onChainKey]) {
        const dataToStore = { ...dbPositionsMap[onChainKey], poolAddress: poolAddress };
        await this.positionStorage.addPosition(new PublicKey(onChainKey), dataToStore);
      } else {
        console.warn(`Position ${onChainKey} (Pool: ${poolAddress}) found on-chain but NOT in DB load. Adding minimal info locally & marking for sync.`);

        const minimalLocalData = {
          poolAddress: poolAddress,
          originalActiveBin: 0,
          minBinId: 0,
          maxBinId: 0,
          snapshotPositionValue: 0,
          startingPositionValue: 0,
          lastFeeTimestamp: Date.now(),
          lastFeeX: '0',
          lastFeeY: '0',
          lastFeesUSD: 0,
          lastPositionValue: 0,
          dailyAPR: 0,
          feeHistory: [],
          originalStartDate: Date.now(),
          rebalanceCount: 0,
          totalClaimedFeeX: '0',
          totalClaimedFeeY: '0',
          totalFeeUsdClaimed: 0,
          tokenXMint: '',
          tokenYMint: '',
        };
        await this.positionStorage.addPosition(new PublicKey(onChainKey), minimalLocalData);

        this.ensurePositionSyncedToDb(onChainKey, minimalLocalData);
      }
    }

    for (const dbKey of dbPositionKeys) {
      if (!onChainPositionKeys.has(dbKey)) {
        console.log(`Position ${dbKey} found in DB but NOT on-chain. Scheduling for removal (stale).`);
        positionsToRemove.push(dbKey);
      }
    }

    for (const keyToRemove of positionsToRemove) {
      await this.positionStorage.removePosition(new PublicKey(keyToRemove));
      console.log(`Removed stale position ${keyToRemove}`);
    }

    console.log('Position state sync complete. Current local positions:', Object.keys(this.positionStorage.getAllPositions()).length);
  }

  private async fetchOnChainPositionsWithPools(walletPubkey: PublicKey): Promise<{ positionKey: string, poolAddress: string }[]> {
    console.log(`Fetching on-chain positions for wallet ${walletPubkey.toBase58()} using DLMM SDK...`);

    const positionsMapByPool = await DLMM.getAllLbPairPositionsByUser(
      this.connection,
      walletPubkey
    );

    const results: { positionKey: string, poolAddress: string }[] = [];

    for (const [poolAddress, positionInfo] of positionsMapByPool.entries()) {
      if (positionInfo && positionInfo.lbPairPositionsData) {
        for (const lbPosition of positionInfo.lbPairPositionsData) {
          results.push({
            positionKey: lbPosition.publicKey.toBase58(),
            poolAddress: poolAddress
          });
        }
      }
    }

    console.log(`SDK returned ${results.length} positions.`);
    return results;
  }

  private async ensurePositionSyncedToDb(positionKey: string, localData: any) {
    try {
      console.log(`Background syncing data for newly detected position ${positionKey} to DB...`);

      let dataToSync = { ...localData };
      if (!dataToSync.tokenXMint || !dataToSync.tokenYMint) {
        try {
          const dlmm = await DLMM.create(this.connection, new PublicKey(dataToSync.poolAddress));
          dataToSync.tokenXMint = dlmm.tokenX.publicKey.toBase58();
          dataToSync.tokenYMint = dlmm.tokenY.publicKey.toBase58();
        } catch (dlmmError) {
          console.error(`Failed to get DLMM instance for pool ${dataToSync.poolAddress} during background sync:`, dlmmError);
        }
      }

      await this.positionRepository.syncPosition(positionKey, dataToSync);
      console.log(`Background sync for position ${positionKey} completed.`);

    } catch (error) {
      console.error(`Error during background sync for position ${positionKey}:`, error);
    }
  }

  /**
   * Starts the risk management system to monitor and protect positions
   */
  private startRiskManagement() {
    console.log('Initializing risk management system...');
    
    if (this.riskMonitoringInterval) {
      clearInterval(this.riskMonitoringInterval);
      console.log('Cleared existing risk monitoring interval');
    }
    
    this.riskMonitoringInterval = setInterval(async () => {
      try {
        console.log('Running scheduled risk management check...');
        
        await this.riskManager.enforceAllCircuitBreakers();
        
        const volumeDropDetected = await this.riskManager.checkVolumeDrop(0.5);
        if (volumeDropDetected) {
          console.warn("⚠️ Volume drop detected! Reducing position sizes by 25%");
          await this.riskManager.adjustPositionSize(2500);
        }
        
        console.log('Risk management check completed');
      } catch (error) {
        console.error('Risk management monitoring error:', error);
      }
    }, 15 * 60 * 1000);
    
    console.log('✅ Risk management system initialized and monitoring started (15-minute intervals)');
  }

  /**
   * Starts the rebalance monitoring system
   */
  private startRebalanceMonitoring() {
    console.log('Initializing rebalance monitoring system...');
    
    if (this.rebalanceInterval) {
      clearInterval(this.rebalanceInterval);
      console.log('Cleared existing rebalance monitoring interval');
    }
    
    console.log('Running initial rebalance check...');
    
    try {
      this.rebalanceManager.checkAndRebalancePositions();
      console.log('Initial rebalance check initiated');
    } catch (error) {
      console.error('Error initiating initial rebalance check:', error);
    }
    
    this.rebalanceInterval = setInterval(async () => {
      try {
        console.log('Running scheduled rebalance check...');
        await this.rebalanceManager.checkAndRebalancePositions();
        console.log('Scheduled rebalance check completed at', new Date().toISOString());
      } catch (error) {
        console.error('Rebalance monitoring error:', error);
      }
    }, 30 * 60 * 1000);
    
    console.log('✅ Rebalance monitoring system initialized (30-minute intervals)');
  }

  // Frontend Controls
  public async toggleAutoClaim(enabled: boolean) {
    this.config.autoClaimEnabled = enabled;
    await this.config.save();
    await this.restartPassiveProcesses();
  }

  public async toggleAutoCompound(enabled: boolean) {
    this.config.autoCompoundEnabled = enabled;
    await this.config.save();
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
    const poolKey = poolAddress.toString();
    if (!this.orderManagers.has(poolKey)) {
      this.initializeOrderManager(poolAddress);
    }
    const orderManager = this.orderManagers.get(poolKey)!;
    
    return await orderManager.submitOrder(orderConfig);
  }

  /**
   * Emergency method to close all positions
   * This will be called from the frontend
   */
  public async emergencyCloseAllPositions(): Promise<{ success: boolean; message: string }> {
    try {
      console.log('🚨 EMERGENCY: Closing all positions...');
      
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
    
    if (this.riskMonitoringInterval) {
      clearInterval(this.riskMonitoringInterval);
      this.riskMonitoringInterval = undefined;
    }
    
    if (this.rebalanceInterval) {
      clearInterval(this.rebalanceInterval);
      this.rebalanceInterval = undefined;
    }
    
    this.passiveManager?.stopAll();
    
    console.log('TradingApp shutdown complete');
  }

  public getConfig(): Config {
    return this.config;
  }

  public getMarketSelector(): MarketSelector {
    return this.marketSelector;
  }

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
      console.log("Syncing positions state before manual check...");
      await this.syncPositionsState();

      await this.rebalanceManager.checkAndRebalancePositions();
      console.log('Manual rebalance check completed successfully');
    } catch (error) {
      console.error('Error during manual rebalance check:', error);
      throw error;
    }
  }

  /**
   * Initializes TradingApp with a delegated user wallet
   */
  public static async createForDelegatedUser(
    connection: Connection,
    userWalletPublicKey: PublicKey
  ): Promise<TradingApp> {
    const userConfig = await UserConfig.loadForUser(userWalletPublicKey.toString());
    
    const serverWallet = Keypair.fromSecretKey(
      bs58.decode(process.env.SERVER_SIGNING_KEY!)
    );
    
    const app = new TradingApp(connection, serverWallet, userConfig);
    return app;
  }

  // Add a helper method to sign transactions based on mode
  private async signTransaction(transaction: Transaction): Promise<Transaction> {
    if (this.isDelegationConfig(this.config)) {
      return await this.signWithDelegation(transaction);
    } else {
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
    
    const operationType = 1;
    const amount = 1000000;
    
    const instructionData = Buffer.from([
      2,
      ...new Uint8Array(new BigUint64Array([BigInt(amount)]).buffer),
      ...new Uint8Array(new Uint32Array([operationType]).buffer),
    ]);
    
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
    
    transaction.sign(this.wallet);
    
    return transaction;
  }

  // Add helper method to check if config is a UserConfig with delegation
  private isDelegationConfig(config: Config): boolean {
    return typeof config === 'object' && config !== null && 'delegationMode' in config && (config as any).delegationMode === true;
  }

  // Replace direct delegation property access with type-safe methods
  private getUserPublicKey(): PublicKey | undefined {
    if (this.isDelegationConfig(this.config)) {
      return (this.config as UserConfig).userWalletPublicKey;
    }
    return undefined;
  }

  private getDelegationPDA(): PublicKey | undefined {
    if (this.isDelegationConfig(this.config)) {
      return (this.config as UserConfig).delegationPDA;
    }
    return undefined;
  }

  // Static factory method for creating user-specific instance
  public static async createForUser(
    userPublicKey: PublicKey,
    connection: Connection
  ): Promise<TradingApp> {
    const config = await UserConfig.loadForUser(userPublicKey.toString());
    
    const serverWallet = Keypair.fromSecretKey(
      bs58.decode(process.env.SERVER_SIGNING_KEY!)
    );
    
    const app = new TradingApp(connection, serverWallet, config);
    return app;
  }
} 