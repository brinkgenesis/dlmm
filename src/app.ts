import { PassiveProcessManager } from './passiveProcess';
import { OrderManager } from './orderManager';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { Config } from './models/Config';
import { PositionStorage } from './utils/PositionStorage';
import { RiskManager } from './riskManager';
import { RebalanceManager } from './rebalanceManager';

export class TradingApp {
  private passiveManager?: PassiveProcessManager;
  private orderManagers = new Map<string, OrderManager>(); // Map of poolAddress to OrderManager
  private config: Config;
  private positionStorage!: PositionStorage;
  private riskManager!: RiskManager;
  private rebalanceManager!: RebalanceManager;
  private riskMonitoringInterval?: NodeJS.Timeout;
  private rebalanceInterval?: NodeJS.Timeout;

  constructor(
    public connection: Connection,
    public wallet: Keypair
  ) {
    console.log('Starting DLMM Manager...');
    this.config = Config.loadSync();
    console.log('Config loaded successfully');
    
    this.positionStorage = new PositionStorage(this.config);
    console.log('Position storage initialized');
    
    // Initialize global risk manager with the updated parameters
    this.riskManager = new RiskManager(this.connection, this.wallet, this.config);
    console.log('Risk manager initialized');
    
    // Initialize rebalance manager
    this.rebalanceManager = new RebalanceManager(this.connection, this.wallet, this.config);
    console.log('Rebalance manager initialized');
  }

  public async initialize() {
    console.log('Initializing All Other Functions..');
    
    // Initialize passive processes for ALL pools
    await this.initializePassiveProcesses();
    
    // Start risk management monitoring
    this.startRiskManagement();
    
    // Start rebalance monitoring
    this.startRebalanceMonitoring();
    
    console.log('✅ DLMM Manager fully initialized with all managers running');
  }

  private async initializePassiveProcesses() {
    console.log('Initializing passive processes...');
    
    this.passiveManager = new PassiveProcessManager(
      this.connection,
      this.wallet
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
    
    // Run an initial check
    this.rebalanceManager.checkAndRebalancePositions();
    
    // Start periodic monitoring
    this.rebalanceInterval = setInterval(() => {
      try {
        console.log('Running scheduled rebalance check...');
        this.rebalanceManager.checkAndRebalancePositions();
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
  
  // If you're using Express.js for your API, add this method:
  private setupEmergencyEndpoints(app: any): void {
    app.post('/api/emergency/close-all-positions', async (req: any, res: any) => {
      try {
        // Optionally add authentication check here
        const result = await this.emergencyCloseAllPositions();
        res.json(result);
      } catch (error) {
        res.status(500).json({ 
          success: false, 
          message: `Server error: ${error instanceof Error ? error.message : String(error)}` 
        });
      }
    });
    
    console.log('Emergency endpoints configured');
  }
  
  // Call this method during app initialization if using Express
  public initializeApi(app: any): void {
    this.setupEmergencyEndpoints(app);
    // Other API setup...
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
} 