import { RiskManager } from './riskManager';
import {DLMMClient} from './utils/DLMMClient';
import { Connection, PublicKey } from '@solana/web3.js';

export class PositionManager {
  private riskManager: RiskManager;
  
  constructor(
    private dlmmClient: DLMMClient,
    public poolAddress: PublicKey
  ) {
    this.riskManager = new RiskManager(dlmmClient);
  }

  public async monitorAndAdjust() {
    // Check risk parameters every 5 minutes
    setInterval(async () => {
      try {
        const drawdownTriggered = await this.riskManager.checkDrawdown(
          this.poolAddress,
          15
        );
        
        if (drawdownTriggered) {
          await this.riskManager.adjustPositionSize(0.5);
        }

        const volumeDrop = await this.riskManager.checkVolumeDrop(0.5);
        
        if (volumeDrop) {
          await this.riskManager.closeAllPositions();
        }
      } catch (error) {
        console.error('Risk monitoring error:', error);
      }
    }, 300_000); // 5 minute intervals
  }
}
