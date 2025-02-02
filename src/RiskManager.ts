import { DLMMClient } from './utils/DLMMClient';
import { Connection, PublicKey } from '@solana/web3.js';
import { fetchTokenMetrics } from './utils/token_data';
import { PositionSnapshotService } from './utils/positionSnapshot';
import DLMM, { PositionInfo, BinLiquidity, StrategyType, PositionVersion, StrategyParameters, LbPosition, SwapQuote, computeBudgetIx } from '@meteora-ag/dlmm';
import { FetchPrice } from './utils/fetch_price';
import { VolumeData } from './utils/data/marketData';



// Mock data generator for testing
const MOCK_VOLUME_DATA: VolumeData[] = [
  { timestamp: Date.now() - 5*3600*1000, volume: 150000 },
  { timestamp: Date.now() - 4*3600*1000, volume: 175000 },
  { timestamp: Date.now() - 3*3600*1000, volume: 130000 },
  { timestamp: Date.now() - 2*3600*1000, volume: 190000 },
  { timestamp: Date.now() - 1*3600*1000, volume: 165000 },
  { timestamp: Date.now(), volume: 140000 }
];

export class RiskManager {
  private snapshotService  = new PositionSnapshotService();
  private lastAdjustmentTime: number = 0;
  private readonly COOLDOWN_PERIOD = 30 * 60 * 1000; // 30 minutes in ms

  constructor(private dlmmClient: DLMMClient) {}

  public async checkDrawdown(poolAddress: PublicKey, thresholdPercent: number): Promise<boolean> {
    const positions = await this.dlmmClient.getUserPositions();
    const poolKeyStr = poolAddress.toBase58();
    
    let anyTriggered = false;
    
    for (const position of positions) {
      // Verify position belongs to target pool
      
      const currentValue = await this.calculatePositionValue(position);
      const positionKey = position.publicKey.toBase58();

      // Record per-position snapshot
      await this.snapshotService.recordSnapshot(positionKey, {
        value: currentValue,
        timestamp: Date.now()
      });

      // Check individual position drawdown
      const peakValue = await this.snapshotService.getPeakValue(
        positionKey,
        Date.now() - 30 * 60 * 1000
      );

      if (peakValue > 0 && 
        ((peakValue - currentValue) / peakValue) * 100 >= thresholdPercent) {
        anyTriggered = true;
        await this.adjustSinglePosition(position, 5000); // 50% reduction
      }
    }

    return anyTriggered;
  }

  private async adjustSinglePosition(position: PositionInfo, bpsToRemove: number): Promise<void> {
    const bins = position.lbPairPositionsData[0].positionData.positionBinData.map(b => 
      Number(b.binId)
    );
    const binIdsToRemove = this.getFullBinRange(bins);
    
    await this.dlmmClient.removeLiquidity(
      position.publicKey,
      bpsToRemove,
      binIdsToRemove,
      false
    );
  }

  public async enforceCircuitBreaker(poolAddress: PublicKey): Promise<void> {
    const now = Date.now();
    if (now - this.lastAdjustmentTime < this.COOLDOWN_PERIOD) return;

    const triggered = await this.checkDrawdown(
      poolAddress,
      15
    );

    if (triggered) {
      this.lastAdjustmentTime = Date.now();
    }
  }

  public async adjustPositionSize(bpsToRemove: number): Promise<void> {
    const positions = await this.dlmmClient.getUserPositions();
    if (!positions.length) return;
    
    const position = positions[0];
    const bins = position.lbPairPositionsData[0].positionData.positionBinData.map(b => 
      Number(b.binId)
    );
    const binIdsToRemove = this.getFullBinRange(bins);
    
    await this.dlmmClient.removeLiquidity(
      position.publicKey,
      bpsToRemove,
      binIdsToRemove,
      false
    );
  }

  public async checkVolumeDrop(threshold: number): Promise<boolean> {
    const positions = await this.dlmmClient.getUserPositions();
    if (!positions || positions.length === 0) return false;
    const tokenMint = positions[0].tokenX.publicKey.toBase58();
    const metrics = await fetchTokenMetrics('solana', tokenMint);
    const volumeMA = await this.calculateVolumeMA(tokenMint);
    return metrics.volumeMcapRatio < volumeMA * threshold;
  }

  public async closeAllPositions(): Promise<void> {
    const positions = await this.dlmmClient.getUserPositions();
    if (!positions || positions.length === 0) return;
    for (const position of positions) {
      const bins = position.lbPairPositionsData[0].positionData.positionBinData.map(b => 
        Number(b.binId)
      );
      const binIdsToRemove = this.getFullBinRange(bins);
      await this.dlmmClient.removeLiquidity(
        position.publicKey,
        10000,
        binIdsToRemove,
        true
      );
    }
  }

  private async calculateVolumeMA(tokenMint: string): Promise<number> {
    try {
      // Get last 6 hours of data
      const endTime = Date.now();
      const startTime = endTime - 6 * 3600 * 1000;
      
      // Real implementation would call:
      // const history = await fetchVolumeHistory(tokenMint, startTime, endTime);
      const history = MOCK_VOLUME_DATA; // Remove for production
      
      if (history.length === 0) {
        console.warn('No volume data available');
        return 0;
      }

      // Calculate simple moving average
      const sum = history.reduce((acc, entry) => acc + entry.volume, 0);
      return sum / history.length;
      
    } catch (error) {
      console.error('Volume MA calculation failed:', error);
      return 0; // Fail-safe return
    }
  }

  private async calculatePositionValue(position: PositionInfo): Promise<number> {
    const [solPrice, activeBin] = await Promise.all([
      this.getSOLPrice(),
      this.dlmmClient.getActiveBin()
    ]);

    const lbPosition = position.lbPairPositionsData[0];
    const { tokenX, tokenY } = position;

    // Convert amounts using token decimals
    const xAmount = Number(lbPosition.positionData.totalXAmount) / 10 ** tokenX.decimal;
    const yAmount = Number(lbPosition.positionData.totalYAmount) / 10 ** tokenY.decimal;
     
    // Convert price from BN to number
    const pricePerToken = Number(activeBin.price) / 
      (10 ** (tokenX.decimal + tokenY.decimal));

    return (xAmount * pricePerToken) + (yAmount * solPrice);
  }

  private async getSOLPrice(): Promise<number> {
    const solPriceStr = await FetchPrice(process.env.SOL_Price_ID as string);
    const solPriceNumber = parseFloat(solPriceStr);
    console.log(`Fetched current Solana Price: ${solPriceStr}`);
    return solPriceNumber;
  }

  private getFullBinRange(bins: number[]): number[] {
    const min = Math.min(...bins);
    const max = Math.max(...bins);
    const fullRange: number[] = [];
    for (let i = min; i <= max; i++) {
      fullRange.push(i);
    }
    return fullRange;
  }
}
