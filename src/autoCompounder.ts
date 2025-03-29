import { PublicKey, Keypair, Connection } from '@solana/web3.js';
import DLMM from '@meteora-ag/dlmm';
import { unpackAccount, getAssociatedTokenAddress } from '@solana/spl-token';
import { PositionStorage } from './utils/PositionStorage';
import { createSingleSidePosition } from './utils/createSingleSidePosition';
import { BN } from '@coral-xyz/anchor';
import { sendAndConfirmTransaction } from '@solana/web3.js';
import { Config } from './models/Config';
import { withSafeKeypair } from './utils/walletHelper';

export class AutoCompounder {
  private positionStorage: PositionStorage;

  constructor(
    private connection: Connection,
    private pool: DLMM,
    private wallet: Keypair,
    private config: Config,
    positionStorage?: PositionStorage
  ) {
    this.positionStorage = positionStorage || new PositionStorage(config);
  }

  public async autoCompound() {
    try {
      // 1. Claim rewards
      const claimTxs = await this.pool.claimAllRewards({
        owner: this.wallet.publicKey,
        positions: await this.getUserPositions()
      });

      // Send and confirm transactions using withSafeKeypair
      for (const tx of claimTxs) {
        const signature = await withSafeKeypair(this.config, async (keypair) => {
          return sendAndConfirmTransaction(
            this.connection,
            tx,
            [keypair], // Use keypair from withSafeKeypair
            { commitment: 'confirmed' }
          );
        });
        console.log('✅ Rewards claimed:', signature);
      }

      // 2. Create new position with balance
      const tokenXBalance = await this.getTokenXBalance();
      if (tokenXBalance > 0) {
        await withSafeKeypair(this.config, async (keypair) => {
          // Generate a new keypair for the position itself
          const positionKeypair = Keypair.generate();
          console.log(`Generated new keypair for auto-compounded position: ${positionKeypair.publicKey.toString()}`);

          // Call the on-chain function correctly
          return createSingleSidePosition(
            this.connection,
            this.pool,
            keypair, // Wallet keypair for fees
            positionKeypair, // New position keypair
            new BN(tokenXBalance), // Amount might need adjustment based on actual balance representation
            true // Assuming compounding X token, adjust if needed
          );
        });
      }
    } catch (error) {
      console.error('Auto-compound failed:', error);
    }
  }

  private async getUserPositions() {
    const positionMap = await DLMM.getAllLbPairPositionsByUser(
      this.connection,
      this.wallet.publicKey
    );
    return positionMap.get(this.pool.pubkey.toBase58())?.lbPairPositionsData || [];
  }

  private async getTokenXBalance(): Promise<number> {
    const tokenX = this.pool.tokenX;
    const ataAddress = await getAssociatedTokenAddress(tokenX.publicKey, this.wallet.publicKey);
    
    const accountInfo = await this.connection.getAccountInfo(ataAddress);
    if (!accountInfo) return 0;
    
    const parsed = unpackAccount(ataAddress, accountInfo);
    return Number(parsed.amount) / Math.pow(10, tokenX.decimal);
  }
} 