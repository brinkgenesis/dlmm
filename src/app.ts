import { PassiveProcessManager } from './passiveProcess';
import { OrderManager } from './orderManager';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { Config } from './models/Config';
import { PositionStorage } from './utils/PositionStorage';
import { RiskManager } from './riskManager';

export class TradingApp {
  private passiveManager?: PassiveProcessManager;
  private orderManagers = new Map<string, OrderManager>(); // Map of poolAddress to OrderManager
  private config: Config;
  private positionStorage!: PositionStorage;
  private riskManager!: RiskManager;

  constructor(
    public connection: Connection,
    public wallet: Keypair
  ) {
    this.config = Config.loadSync();
    this.positionStorage = new PositionStorage(this.config);
    // Initialize global risk manager with the updated parameters
    this.riskManager = new RiskManager(this.connection, this.wallet, this.config);
  }

  public async initialize() {
    // Initialize passive processes for ALL pools
    await this.initializePassiveProcesses();
    
    // Start position safety monitoring
    await this.startPositionSafetyMonitoring();
  }

  private async initializePassiveProcesses() {
    this.passiveManager = new PassiveProcessManager(
      this.connection,
      this.wallet
    );
    
    if (this.isAnyPassiveEnabled) {
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

  private async startPositionSafetyMonitoring() {
    // Start global monitoring for all positions
    setInterval(async () => {
      try {
        // Use the new enforceAllCircuitBreakers method
        await this.riskManager.enforceAllCircuitBreakers();
        
        // Also check for volume drops across all positions
        const volumeDropDetected = await this.riskManager.checkVolumeDrop(0.5);
        if (volumeDropDetected) {
          console.warn("Volume drop detected! Consider reducing position sizes.");
          // Could trigger automatic reduction here if desired
          // await this.riskManager.adjustPositionSize(5000); // 50% reduction
        }
        
      } catch (error) {
        console.error('Position safety monitoring error:', error);
      }
    }, 15 * 60 * 1000); // 15 minute interval
    
    console.log('Position safety monitoring started');
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

  // Method to manually trigger risk assessment
  public async assessRisk(poolAddress?: PublicKey): Promise<boolean> {
    if (poolAddress) {
      // Check specific pool
      return this.riskManager.checkDrawdown(poolAddress, 15);
    } else {
      // Use the new enforceAllCircuitBreakers method
      await this.riskManager.enforceAllCircuitBreakers();
      return false; // We don't know if any were triggered, so return false
    }
  }
  
  // Method to check volume drops across all positions
  public async checkVolumeDrops(threshold: number = 0.5): Promise<boolean> {
    return this.riskManager.checkVolumeDrop(threshold);
  }
  
  // Emergency method to close all positions
  public async emergencyCloseAll(): Promise<void> {
    return this.riskManager.closeAllPositions();
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
} 