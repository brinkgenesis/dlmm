import { PublicKey, Keypair } from '@solana/web3.js';
import DLMM from '@meteora-ag/dlmm';
import { Connection } from '@solana/web3.js';
import { BN } from 'bn.js';
import { createSingleSidePosition } from './utils/createSingleSidePosition';
import { PositionStorage } from './utils/PositionStorage';
import { getSOLPrice } from "./utils/getSOLPrice";
import { OrderStorage } from './utils/OrderStorage';
import { Config } from './models/Config';
import { withSafeKeypair } from './utils/walletHelper';

type OrderType = 'LIMIT' | 'TAKE_PROFIT' | 'STOP_LOSS';

interface OrderConfig {
  orderType: OrderType;
  triggerPrice: number;
  closeBps?: number;
  orderSize?: number;
  side?: 'X' | 'Y';
  positionKey?: string; // Added to link TP/SL orders to specific positions
  takeProfitPrice?: number;
  takeProfitCloseBps?: number;
  stopLossPrice?: number;
  stopLossCloseBps?: number;
}

interface RequiredInputs {
  poolAddress: PublicKey; // DLMM pool address
  userKey: PublicKey;      // User's wallet public key
  wallet: Keypair;         // Signing wallet
  positionStorage: PositionStorage; // Position tracking
  orderConfig: {
    orderType: 'LIMIT' | 'TAKE_PROFIT' | 'STOP_LOSS';
    triggerPrice: number;  // In SOL terms
    orderSize?: number;    // USD for LIMIT orders
    closeBps?: number;     // 1-100 for partial closes
    side?: 'X' | 'Y';     // Required for LIMIT orders
  };
}

export class OrderManager {
  private activeOrders = new Map<string, OrderConfig>();
  private dlmm: Promise<DLMM>;
  private orderStorage: OrderStorage;
  private positionStorage: PositionStorage;
  private publicKey: PublicKey;
  private poolAddress: PublicKey;
  
  constructor(
    private connection: Connection,
    poolAddress: PublicKey,
    private wallet: Keypair,
    positionStorage: PositionStorage,
    private config: Config
  ) {
    this.poolAddress = poolAddress;
    this.dlmm = DLMM.create(connection, poolAddress);
    this.orderStorage = new OrderStorage();
    this.positionStorage = positionStorage;
    this.publicKey = wallet.publicKey;
    this.initializeFromStorage();
  }

  private async initializeFromStorage() {
    try {
      // Load orders from Supabase via OrderStorage
      const orders = await this.orderStorage.getActiveOrders();
      
      // Filter to only include orders for this pool
      Object.entries(orders).forEach(([orderId, order]) => {
        if (order.poolAddress === this.poolAddress.toString()) {
          console.log(`Loading order ${orderId} for pool ${this.poolAddress.toString()}`);
          this.activeOrders.set(orderId, order.config);
        }
      });
      
      console.log(`Loaded ${this.activeOrders.size} active orders for pool ${this.poolAddress.toString()}`);
      this.startMonitoring();
    } catch (error) {
      console.error('Error initializing order manager:', error);
      // Still start monitoring even if initial loading fails
      this.startMonitoring();
    }
  }

  public async addOrder(orderId: string, config: OrderConfig) {
    // Validate required parameters
    if (config.orderType === 'LIMIT' && !config.side) {
      throw new Error('LIMIT orders require side (X/Y) specification');
    }
    
    if ((config.orderType === 'TAKE_PROFIT' || config.orderType === 'STOP_LOSS') && !config.closeBps) {
      throw new Error(`${config.orderType} orders require closeBps (1-100)`);
    }
    
    // Save to storage
    await this.orderStorage.addOrder({
      orderId,
      config,
      poolAddress: this.poolAddress.toString(),
      createdAt: new Date().toISOString(),
      positionKey: config.positionKey
    });
    
    // Add to local map
    this.activeOrders.set(orderId, config);
    console.log(`Order ${orderId} added to ${this.poolAddress.toString()}`);
  }

  private startMonitoring() {
    setInterval(async () => {
      if (this.activeOrders.size === 0) return; // Skip if no active orders
      
      try {
        const currentPriceUSD = await this.getCurrentPriceUSD();
        
        // Create a copy of orderId keys to avoid iteration issues during deletion
        const orderIds = Array.from(this.activeOrders.keys());
        
        for (const orderId of orderIds) {
          const config = this.activeOrders.get(orderId);
          if (!config) continue;
          
          if (this.checkTriggerCondition(currentPriceUSD, config)) {
            console.log(`Order ${orderId} triggered at price $${currentPriceUSD.toFixed(4)}`);
            try {
              await this.executeOrder(orderId, config);
              // Remove from local map after successful execution
              this.activeOrders.delete(orderId);
              
              // Update order status to EXECUTED in Supabase
              await this.orderStorage.updateOrderStatus(orderId, 'EXECUTED');
              
            } catch (error) {
              console.error(`Error executing order ${orderId}:`, error);
              
              // Mark as FAILED in Supabase with error reason
              const errorMessage = error instanceof Error ? error.message : String(error);
              await this.orderStorage.updateOrderStatus(orderId, 'FAILED');
              
              // Could be improved with detailed error storage if needed
              
              // Remove from local map after failed execution
              this.activeOrders.delete(orderId);
            }
          }
        }
      } catch (error) {
        console.error('Price monitoring error:', error);
      }
    }, 60_000); // Check every minute
    
    console.log(`Order monitoring started for pool ${this.poolAddress.toString()}`);
  }

  private async getCurrentPriceUSD(): Promise<number> {
    const dlmm = await this.dlmm;
    const activeBin = await dlmm.getActiveBin();
    const solPriceUSD = await getSOLPrice();
    
    // Get token price in SOL terms (1 token = X SOL)
    const pricePerTokenSOL = parseFloat(activeBin.pricePerToken);
    
    // Convert to USD terms (1 token = X SOL * SOL/USD)
    return pricePerTokenSOL * solPriceUSD;
  }

  private checkTriggerCondition(currentPriceUSD: number, config: OrderConfig): boolean {
    const priceThreshold = config.triggerPrice;
    const priceDifference = Math.abs(currentPriceUSD - priceThreshold);
    const isWithinTolerance = priceDifference <= (priceThreshold * 0.01); // 1% tolerance
    
    switch(config.orderType) {
      case 'LIMIT':
        return currentPriceUSD <= priceThreshold && isWithinTolerance;
      case 'TAKE_PROFIT':
        return currentPriceUSD >= priceThreshold;
      case 'STOP_LOSS':
        return currentPriceUSD <= priceThreshold;
      default:
        return false;
    }
  }

  private async executeOrder(orderId: string, config: OrderConfig) {
    console.log(`Executing order ${orderId} (${config.orderType})`);
    
    // Validate order parameters
    if (config.orderType === 'LIMIT' && !config.side) {
      throw new Error('LIMIT orders require side (X/Y) specification');
    }

    switch(config.orderType) {
      case 'LIMIT':
        // Implement LIMIT order execution
        await this.executeLimitOrder(config);
        break;
      case 'TAKE_PROFIT':
      case 'STOP_LOSS':
        // Handle TP/SL order execution
        await this.handlePositionClose(config);
        break;
      default:
        throw new Error(`Unsupported order type: ${config.orderType}`);
    }
    
    // Note: Order status is updated by the calling function, not here
    console.log(`Order ${orderId} execution completed`);
  }
  
  private async executeLimitOrder(config: OrderConfig) {
    const dlmm = await this.dlmm;
    const activeBin = await dlmm.getActiveBin();
    
    // Get pricing data
    const solPrice = await getSOLPrice();
    const pricePerToken = parseFloat(activeBin.pricePerToken);
    const tokenPriceUSD = pricePerToken * solPrice;
    
    // Determine token side based on config.side
    // 'X' side means singleSidedX = true, 'Y' side means singleSidedX = false
    const singleSidedX = config.side === 'X';
    
    console.log(`Executing ${singleSidedX ? 'X' : 'Y'}-sided LIMIT order at price $${tokenPriceUSD.toFixed(4)}`);
    
    // Get token decimals for the selected side
    const tokenDecimals = singleSidedX 
      ? dlmm.tokenX.decimal 
      : dlmm.tokenY.decimal;
        
    console.log(`Token ${singleSidedX ? 'X' : 'Y'} decimals:`, tokenDecimals);
    
    // Convert USD to token amount
    if (!config.orderSize) {
      throw new Error('LIMIT orders require orderSize (USD amount)');
    }
    
    const tokenAmount = config.orderSize / tokenPriceUSD;
    const amountLamports = new BN(
      Math.floor(tokenAmount * 10 ** tokenDecimals)
    );
    
    console.log(`Creating position with ${tokenAmount.toFixed(6)} tokens (${amountLamports.toString()} lamports)`);
    
    // Create the position using withSafeKeypair and createSingleSidePosition
    const positionResult = await withSafeKeypair(this.config, async (keypair) => {
      // Generate a new keypair for the position itself
      const positionKeypair = Keypair.generate();
      console.log(`Generated new keypair for limit order position: ${positionKeypair.publicKey.toString()}`);
      
      // Call the on-chain function correctly
      const result = await createSingleSidePosition(
        this.connection,
        dlmm,
        keypair, // Wallet keypair for fees
        positionKeypair, // New position keypair
        amountLamports,
        singleSidedX // Use the side from config
      );
      
      console.log(`Position created: ${result.positionKey.toString()}`);
      
      // If TP/SL parameters were provided with the LIMIT order, create those orders
      if (config.takeProfitPrice) {
        // Create a TAKE_PROFIT order for this new position
        this.submitOrder({
          orderType: 'TAKE_PROFIT',
          triggerPrice: config.takeProfitPrice,
          closeBps: config.takeProfitCloseBps || 100, // Default to full close
          positionKey: result.positionKey.toString()
        });
      }
      
      if (config.stopLossPrice) {
        // Create a STOP_LOSS order for this new position
        this.submitOrder({
          orderType: 'STOP_LOSS',
          triggerPrice: config.stopLossPrice,
          closeBps: config.stopLossCloseBps || 100, // Default to full close
          positionKey: result.positionKey.toString()
        });
      }
      
      return result;
    });
    
    return positionResult;
  }

  private async handlePositionClose(config: OrderConfig) {
    if (!config.closeBps || config.closeBps < 1 || config.closeBps > 100) {
      throw new Error('closeBps must be between 1 and 100');
    }

    const dlmm = await this.dlmm;
    
    // If positionKey is specified, close only that position
    if (config.positionKey) {
      console.log(`Closing specific position: ${config.positionKey}`);
      
      try {
        // First try to get positions for this pool
        const { userPositions } = await dlmm.getPositionsByUserAndLbPair(this.publicKey);
        
        // Filter for the specific position we want
        const positionToClose = userPositions.find(
          position => position.publicKey.toString() === config.positionKey
        );
        
        if (!positionToClose) {
          throw new Error(`Position ${config.positionKey} not found in pool ${this.poolAddress.toString()}`);
        }
        
        // Determine bin range
        const lowerBinId = positionToClose.positionData.lowerBinId;
        const upperBinId = positionToClose.positionData.upperBinId;
        const binIds = Array.from(
          { length: upperBinId - lowerBinId + 1 },
          (_, i) => lowerBinId + i
        );
        
        // Convert BPS to BN (1-100% → 100-10000 BPS)
        const bpsBN = new BN(config.closeBps * 100);
        const shouldClaimAndClose = config.closeBps === 100;
        
        // Execute the removal
        await dlmm.removeLiquidity({
          user: this.publicKey,
          position: new PublicKey(config.positionKey),
          binIds,
          bps: bpsBN,
          shouldClaimAndClose
        });
        
        console.log(`Position ${config.positionKey} closed successfully`);
      } catch (error) {
        console.error(`Error closing position ${config.positionKey}:`, error);
        throw error;
      }
    } else {
      // If no specific position, close all positions in the pool (original behavior)
      console.log(`Closing all positions in pool ${this.poolAddress.toString()}`);
      
      // Get user positions for this pool
      const { userPositions } = await dlmm.getPositionsByUserAndLbPair(this.publicKey);
      
      if (userPositions.length === 0) {
        console.log('No positions found to close');
        throw new Error('No positions found to close');
      }
      
      // Process each position
      await Promise.all(userPositions.map(async (position) => {
        // Determine bin range
        const lowerBinId = position.positionData.lowerBinId;
        const upperBinId = position.positionData.upperBinId;
        const binIds = Array.from(
          { length: upperBinId - lowerBinId + 1 },
          (_, i) => lowerBinId + i
        );
        
        // Convert BPS to BN (1-100% → 100-10000 BPS)
        const bpsBN = new BN(config.closeBps! * 100);
        const shouldClaimAndClose = config.closeBps === 100;
        
        console.log(`Closing position ${position.publicKey.toString()}, BPS: ${config.closeBps}`);
        
        return dlmm.removeLiquidity({
          user: this.publicKey,
          position: position.publicKey,
          binIds,
          bps: bpsBN,
          shouldClaimAndClose
        });
      }));
      
      console.log('All positions closed successfully');
    }
  }

  public submitOrder(config: OrderConfig): string {
    const orderId = this.generateOrderId();
    this.addOrder(orderId, config);
    return orderId;
  }

  private generateOrderId(): string {
    return Math.random().toString(36).substr(2, 9);
  }
}
