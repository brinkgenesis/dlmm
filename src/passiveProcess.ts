import { ComputeBudgetProgram, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { DLMMClient } from "./utils/DLMMClient";
import { AutoCompounder } from './autoCompounder';

export class PassiveProcessManager {
  private intervalIds: NodeJS.Timeout[] = [];
  
  constructor(
    private dlmmClient: DLMMClient,
    private wallet: Keypair,
    private poolAddress: PublicKey
  ) {}

  public startAll() {
    this.scheduleRewardClaims();
    this.scheduleAutoCompound();
  }

  private scheduleRewardClaims() {
    if (!this.dlmmClient.dlmmPool) {
      throw new Error('DLMM Pool is not initialized. Call initializeDLMMPool() first.');
    }
    const interval = setInterval(async () => {
      try {
        const positions = await this.dlmmClient.getUserPositions();
        if (!positions.length) return;
        
        for (const position of positions) {
          try {
            const claimTxs = await this.dlmmClient.dlmmPool!.claimAllRewards({
              owner: this.wallet.publicKey,
              positions: [position.lbPairPositionsData[0]]
            });
            
            const transactions = claimTxs.map(tx => {
              const feeInstruction = ComputeBudgetProgram.setComputeUnitPrice({
                microLamports: 30000
              });
              return new Transaction().add(feeInstruction).add(...tx.instructions);
            });
        
            for (const tx of transactions){
            const signature = await this.dlmmClient.sendTransactionWithBackoff(tx, [this.wallet]);
            console.log(`Claimed rewards for ${position.publicKey.toBase58()}: ${signature}`);
          } }catch (positionError) {
            console.error(`Failed to claim for ${position.publicKey.toBase58()}:`,
              positionError instanceof Error ? positionError.message : positionError);
          }
        }
      } catch (error) {
        console.error('Reward claim cycle failed:', error);
      }
    }, 3 * 3600 * 1000);
    
    this.intervalIds.push(interval);
  }

  private scheduleAutoCompound() {
    const interval = setInterval(async () => {
      const compounder = new AutoCompounder(
        this.dlmmClient,
        this.poolAddress,
        this.wallet
      );
      await compounder.autoCompound();
    }, 60 * 60 * 1000); // 1 hour
    
    this.intervalIds.push(interval);
  }

  public stopAll() {
    this.intervalIds.forEach(clearInterval);
  }
} 