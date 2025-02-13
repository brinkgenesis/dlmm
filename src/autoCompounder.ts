import { PublicKey, Keypair } from '@solana/web3.js';
import { DLMMClient } from './utils/DLMMClient';
import { unpackAccount, getAssociatedTokenAddress } from '@solana/spl-token';

export class AutoCompounder {
  constructor(
    private dlmmClient: DLMMClient,
    private poolAddress: PublicKey,
    private wallet: Keypair
  ) {}

  public async autoCompound() {
    try {
      // 1. Claim rewards
      const claimTxs = await this.dlmmClient.dlmmPool!.claimAllRewards({
        owner: this.wallet.publicKey,
        positions: await this.getUserPositions()
      });

      // Directly send claim transactions using existing client method
      for (const tx of claimTxs) {
        await this.dlmmClient.sendTransactionWithBackoff(tx, [this.wallet]);
      }

      // 2. Get balance and create position
      const tokenXBalance = await this.getTokenXBalance();
      if (tokenXBalance > 0) {
        await this.dlmmClient.createSingleSidePosition(tokenXBalance, true);
      }
    } catch (error) {
      console.error('Auto-compound failed:', error);
    }
  }

  private async getUserPositions() {
    const positions = await this.dlmmClient.getUserPositions();
    return positions.map(p => p.lbPairPositionsData[0]);
  }

  private async getTokenXBalance(): Promise<number> {
    const tokenX = this.dlmmClient.dlmmPool!.tokenX;
    const ataAddress = await getAssociatedTokenAddress(tokenX.publicKey, this.wallet.publicKey);
    
    const accountInfo = await this.dlmmClient.connection.getAccountInfo(ataAddress);
    if (!accountInfo) return 0;
    
    const parsed = unpackAccount(ataAddress, accountInfo);
    return Number(parsed.amount) / Math.pow(10, tokenX.decimal);
  }

  private async createSingleSidePosition(amount: number) {
    const activeBin = await this.dlmmClient.getActiveBin();
    
    return this.dlmmClient.createSingleSidePosition(
      amount,
      true // singleSidedX = true
    );
  }
} 