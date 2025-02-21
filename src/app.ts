import { PassiveProcessManager } from './passiveProcess';
import { OrderManager } from './orderManager';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { Config } from './models/Config';
import { PositionStorage } from './utils/PositionStorage';

export class TradingApp {
  private passiveManager?: PassiveProcessManager;
  private orderManagers = new Map<string, OrderManager>(); // Map of poolAddress to OrderManager
  private config!: Config;
  private positionStorage!: PositionStorage;

  constructor(
    private connection: Connection,
    private wallet: Keypair
  ) {
    this.initializeConfig();
  }

  private async initializeConfig() {
    this.config = await Config.load();
    this.positionStorage = new PositionStorage(this.config);
  }

  public async initialize() {
    // Initialize passive processes for ALL pools
    await this.initializePassiveProcesses();
  }

  private async initializePassiveProcesses() {
    this.passiveManager = new PassiveProcessManager(
      this.connection,
      this.wallet
    );
    
    if (this.isAnyPassiveEnabled()) {
      await this.passiveManager.startAll();
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

  private isAnyPassiveEnabled(): boolean {
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
} 