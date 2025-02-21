import { DLMMClient } from "./utils/DLMMClient";
import { PublicKey, Keypair } from '@solana/web3.js';
import  DLMM  from '@meteora-ag/dlmm';
import { Connection } from '@solana/web3.js';
import { BN } from 'bn.js';
import { createSingleSidePosition } from './utils/createSingleSidePosition';
import { PositionStorage } from './utils/PositionStorage';
import { getSOLPrice } from "./utils/getSOLPrice";
import { OrderStorage } from './utils/OrderStorage';


type OrderType = 'LIMIT' | 'TAKE_PROFIT' | 'STOP_LOSS';

interface OrderConfig {
  orderType: OrderType;
  triggerPrice: number;
  closeBps?: number; // For partial closes (1-100)
  orderSize?: number; // Added for USD-based order sizing
  side?: 'X' | 'Y';     // Required for LIMIT orders
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
  
  constructor(
    private connection: Connection,
    private poolAddress: PublicKey,
    private userPublicKey: PublicKey,
    private wallet: Keypair,
    positionStorage: PositionStorage,
  ) {
    this.dlmm = DLMM.create(connection, poolAddress);
    this.orderStorage = new OrderStorage();
    this.positionStorage = positionStorage;
    this.initializeFromStorage();
  }

  private async initializeFromStorage() {
    const orders = await this.orderStorage.getActiveOrders();
    Object.entries(orders).forEach(([orderId, order]) => {
      if (order.poolAddress === this.poolAddress.toString()) {
        this.activeOrders.set(orderId, order.config);
      }
    });
    this.startMonitoring();
  }

  public async addOrder(orderId: string, config: OrderConfig) {
    await this.orderStorage.addOrder({
      orderId,
      config,
      poolAddress: this.poolAddress.toString(),
      createdAt: new Date().toISOString()
    });
    this.activeOrders.set(orderId, config);
  }

  private startMonitoring() {
    setInterval(async () => {
      try {
        const currentPriceUSD = await this.getCurrentPriceUSD();
        
        for (const [orderId, config] of this.activeOrders) {
          if (this.checkTriggerCondition(currentPriceUSD, config)) {
            await this.executeOrder(orderId, config);
            this.activeOrders.delete(orderId);
          }
        }
      } catch (error) {
        console.error('Price monitoring error:', error);
      }
    }, 60_000);
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
    if (config.orderType === 'LIMIT' && !config.side) {
      throw new Error('Limit orders require side (X/Y) specification');
    }

    switch(config.orderType) {
      case 'LIMIT':
        const dlmm = await this.dlmm;
        const activeBin = await dlmm.getActiveBin();
        
        // Get pricing data
        const solPrice = await getSOLPrice();
        const pricePerToken = parseFloat(activeBin.pricePerToken);
        const tokenPriceUSD = pricePerToken * solPrice;

        // Determine token decimals
        const singleSidedX = true; // Set based on your logic
        const tokenDecimals = singleSidedX 
          ? dlmm.tokenX.decimal 
          : dlmm.tokenY.decimal;

        console.log(`Token ${singleSidedX ? 'X' : 'Y'} decimals:`, tokenDecimals); //Decimal verification

        // Convert USD to token amount
        const tokenAmount = config.orderSize! / tokenPriceUSD;
        const amountLamports = new BN(
          tokenAmount * 10 ** tokenDecimals
        );

        await createSingleSidePosition(
          this.connection,
          dlmm,
          this.wallet,
          amountLamports,
          singleSidedX,
          this.positionStorage
        );
        break;
      case 'TAKE_PROFIT':
        await this.handlePositionClose(config);
        break;
      case 'STOP_LOSS':
        await this.handlePositionClose(config);
        break;
    }
    await this.orderStorage.deleteOrder(orderId);
  }

  private async handlePositionClose(config: OrderConfig) {
    if (config.closeBps && (config.closeBps < 1 || config.closeBps > 100)) {
      throw new Error('closeBps must be between 1 and 100');
    }

    const dlmm = await this.dlmm;
    
    // Get user positions for this pool
    const { userPositions } = await dlmm.getPositionsByUserAndLbPair(this.userPublicKey);
    
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

      return dlmm.removeLiquidity({
        user: this.userPublicKey,
        position: position.publicKey,
        binIds,
        bps: bpsBN,
        shouldClaimAndClose
      });
    }));
  }

}
