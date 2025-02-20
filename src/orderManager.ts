import { DLMMClient } from "./utils/DLMMClient";
import { PublicKey, Keypair } from '@solana/web3.js';
import  DLMM  from '@meteora-ag/dlmm';
import { Connection } from '@solana/web3.js';
import { BN } from 'bn.js';
import { createSingleSidePosition } from './utils/createSingleSidePosition';
import { PositionStorage } from './utils/PositionStorage';
import { getSOLPrice } from "./utils/getSOLPrice";


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
  
  constructor(
    private connection: Connection,
    private poolAddress: PublicKey,
    private userPublicKey: PublicKey,
    private wallet: Keypair,
    private positionStorage: PositionStorage
  ) {
    this.dlmm = DLMM.create(connection, poolAddress);
  }

  public addOrder(orderId: string, config: OrderConfig) {
    this.activeOrders.set(orderId, config);
    this.startMonitoring();
  }

  private startMonitoring() {
    setInterval(async () => {
      const currentPrice = await this.getCurrentPrice();
      
      for (const [orderId, config] of this.activeOrders) {
        if (this.checkTriggerCondition(currentPrice, config)) {
          await this.executeOrder(config);
          this.activeOrders.delete(orderId);
        }
      }
    }, 60_000); // Check every minute
  }

  private async getCurrentPrice(): Promise<number> {
    const dlmm = await this.dlmm;
    const activeBin = await dlmm.getActiveBin();
    return Number(activeBin.price);
  }

  private checkTriggerCondition(currentPrice: number, config: OrderConfig): boolean {
    // Implementation placeholder - add your trigger logic
    return currentPrice >= config.triggerPrice;
  }

  private async executeOrder(config: OrderConfig) {
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
      case 'STOP_LOSS':
        await this.handlePositionClose(config);
        break;
    }
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
