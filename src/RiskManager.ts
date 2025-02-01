import { DLMMClient } from './utils/DLMMClient';
import { Connection, PublicKey } from '@solana/web3.js';
import { fetchTokenMetrics } from './utils/token_data';
import { PositionSnapshotService } from './utils/positionSnapshot';
import DLMM from '@meteora-ag/dlmm';
import { FetchPrice } from './utils/fetch_price';

export class RiskManager {
  private snapshotService = new PositionSnapshotService();

  constructor(private dlmmClient: DLMMClient) {}

  public async checkDrawdown(thresholdPercent: number): Promise<boolean> {
    const positions = await this.dlmmClient.getUserPositions();
    if (positions.length === 0) return false;

    // Calculate current USD value using the first user position
    const currentValue = await this.calculatePositionValue(userPositions[0]);

    // Use the pool's key (lbPair) for snapshot storage
    const poolKeyStr = lbPair.toBase58();

    await this.snapshotService.recordSnapshot(poolKeyStr, currentValue);
    const peakValue = await this.snapshotService.getPeakValue(poolKeyStr);
    if (peakValue === 0) return false;

    const drawdown = ((peakValue - currentValue) / peakValue) * 100;
    return drawdown >= thresholdPercent;
  }

  public async adjustPositionSize(bpsToRemove: number): Promise<void> {
    const positions = await this.dlmmClient.getUserPositions();
    if (!positions || positions.length === 0) return;
    const position = positions[0];
    const bins = position.positionData.positionBinData.map(bin => bin.binId);
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
    const tokenMint = positions[0].tokenX.mint || this.dlmmClient.poolAddress.toBase58();
    const metrics = await fetchTokenMetrics('solana', tokenMint);
    const volumeMA = await this.calculateVolumeMA();
    return metrics.volumeMcapRatio < volumeMA * threshold;
  }

  public async closeAllPositions(): Promise<void> {
    const positions = await this.dlmmClient.getUserPositions();
    if (!positions || positions.length === 0) return;
    for (const position of positions) {
      const bins = position.positionData.positionBinData.map(bin => bin.binId);
      const binIdsToRemove = this.getFullBinRange(bins);
      await this.dlmmClient.removeLiquidity(
        position.publicKey,
        10000,
        binIdsToRemove,
        true
      );
    }
  }

  private async calculateVolumeMA(): Promise<number> {
    // Placeholder implementation for the 6-hour moving average.
    return 0;
  }

  private async calculatePositionValue(positionInfo: any): Promise<number> {
    const solPrice = await this.getSOLPrice();
    const activeBin = await this.dlmmClient.getActiveBin();
    // Assume token decimals are available on properties tokenX and tokenY; adjust as needed.
    const xDecimals = positionInfo.tokenX ? positionInfo.tokenX.decimals : 9;
    const yDecimals = positionInfo.tokenY ? positionInfo.tokenY.decimals : 9;
    const pricePerToken = Number(activeBin.price) / Math.pow(10, xDecimals + yDecimals);

    // Using total amounts from positionData; adapt if your structure differs.
    const xAmount = Number(positionInfo.positionData.totalXAmount) / Math.pow(10, xDecimals);
    const yAmount = Number(positionInfo.positionData.totalYAmount) / Math.pow(10, yDecimals);
    const xValue = xAmount * pricePerToken;
    const yValue = yAmount * solPrice;
    return xValue + yValue;
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
