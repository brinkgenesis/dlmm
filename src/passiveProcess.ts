import { ComputeBudgetProgram, Keypair, PublicKey, Transaction, Connection } from "@solana/web3.js";
import DLMM, { LbPosition } from '@meteora-ag/dlmm';
import { initializeUserPools } from './utils/createMultiplePools';
import { AutoCompounder } from './autoCompounder';
import { Config } from './models/Config';
import { sendAndConfirmTransaction } from '@solana/web3.js';
import { withSafeKeypair } from './utils/walletHelper';
import { PositionStorage } from './utils/PositionStorage';
import path from 'path';

export class PassiveProcessManager {
  private intervalIds: NodeJS.Timeout[] = [];
  private initializedPools: DLMM[] = [];
  public config!: Config;
  public positionStorage: PositionStorage;
  
  constructor(
    private connection: Connection,
    private wallet: Keypair,
    config: Config,
    positionStorage?: PositionStorage
  ) {
    this.config = config;
    this.positionStorage = positionStorage || new PositionStorage(config);
  }

  public async startAll() {
    this.config = await Config.load();
    const { initializedPools, positionMap } = await initializeUserPools(
        this.connection,
        this.wallet.publicKey
    );
    this.initializedPools = initializedPools;
    
    if (this.config.autoClaimEnabled) {
        this.scheduleRewardClaims(positionMap);
    }
    if (this.config.autoCompoundEnabled) {
        this.scheduleAutoCompound();
    }
  }

  private scheduleRewardClaims(positionMap: Map<string, { lbPairPositionsData: LbPosition[] }>) {
    const interval = setInterval(async () => {
      try {
        for (const pool of this.initializedPools) {
          const poolKey = pool.pubkey.toBase58();
          const positions = positionMap.get(poolKey)?.lbPairPositionsData || [];
          
          if (positions.length === 0) continue;

          try {
            const claimTxs = await pool.claimAllRewards({
              owner: this.wallet.publicKey,
              positions: positions
            });

            for (const tx of claimTxs) {
              const feeInstruction = ComputeBudgetProgram.setComputeUnitPrice({
                microLamports: 30000
              });
              const transaction = new Transaction().add(feeInstruction).add(...tx.instructions);
              const signature = await this.sendTransactionWithBackoff(transaction);
              console.log(`Claimed rewards for pool ${poolKey}: ${signature}`);
            }
          } catch (error) {
            console.error(`Failed to claim rewards for pool ${poolKey}:`, error);
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
      for (const pool of this.initializedPools) {
        const compounder = new AutoCompounder(
          this.connection,
          pool,
          this.wallet,
          this.config,
          this.positionStorage
        );
        await compounder.autoCompound();
      }
    }, 60 * 60 * 1000);
    
    this.intervalIds.push(interval);
  }

  private async sendTransactionWithBackoff(tx: Transaction) {
    return withSafeKeypair(this.config, async (keypair) => {
      return sendAndConfirmTransaction(
        this.connection,
        tx,
        [keypair],
        { commitment: 'confirmed' }
      );
    });
  }

  public stopAll() {
    this.intervalIds.forEach(clearInterval);
  }
} 