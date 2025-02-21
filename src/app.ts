import { PassiveProcessManager } from './passiveProcess';
import { OrderManager } from './orderManager';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { Config } from './models/Config';
import { PositionStorage } from './utils/PositionStorage';

export class TradingApp {
  private passiveManager?: PassiveProcessManager;
  private orderManager?: OrderManager;
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

  public async initialize(poolAddress: PublicKey) {
    await this.initializePassiveProcesses();
    this.initializeOrderManager(poolAddress);
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
    this.orderManager = new OrderManager(
      this.connection,
      poolAddress,
      this.wallet,
      this.positionStorage,
      this.config
    );
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
  public async submitOrder(orderConfig: {
    type: 'LIMIT' | 'TAKE_PROFIT' | 'STOP_LOSS';
    triggerPrice: number;
    sizeUSD?: number;
    closeBps?: number;
    side?: 'X' | 'Y';
  }): Promise<string> {
    if (!this.orderManager) throw new Error('Order manager not initialized');
    
    const orderId = crypto.randomUUID();
    await this.orderManager.addOrder(orderId, {
      orderType: orderConfig.type,
      triggerPrice: orderConfig.triggerPrice,
      orderSize: orderConfig.sizeUSD,
      closeBps: orderConfig.closeBps,
      side: orderConfig.side
    });
    
    return orderId;
  }
} 