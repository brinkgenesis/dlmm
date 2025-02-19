import { Config } from '../models/Config';
import DLMM from '@meteora-ag/dlmm';
import { PublicKey, Connection } from '@solana/web3.js';
import type { LbPosition } from '@meteora-ag/dlmm';

export async function initializeUserPools(
  connection: Connection,
  userPubKey: PublicKey
): Promise<{
  initializedPools: DLMM[];
  positionMap: Map<string, { lbPairPositionsData: LbPosition[] }>;
}> {
  const positionMap = await DLMM.getAllLbPairPositionsByUser(connection, userPubKey);

  try {
    // Extract unique pool addresses from position map keys
    const dlmmList = Array.from(positionMap.keys())
      .map(poolAddress => new PublicKey(poolAddress));

    if (dlmmList.length === 0) {
      console.log('No pools found for initialization');
      return {
        initializedPools: [],
        positionMap: new Map<string, { lbPairPositionsData: LbPosition[] }>()
      };
    }

    // Initialize all pools using Meteora SDK
    const initializedPools = await DLMM.createMultiple(
      connection,
      dlmmList
    );

    console.log(`Successfully initialized ${initializedPools.length} pools`);
    console.log('Initialized pools:', initializedPools.map(p => p.pubkey.toBase58()).join('\n'));

    return {
      initializedPools,
      positionMap: positionMap as Map<string, { lbPairPositionsData: LbPosition[] }>
    };

  } catch (error) {
    console.error('Pool initialization failed:', error);
    throw error;
  }
}

// Run directly if executed as script
if (require.main === module) {
  initializeUserPools(Config.load().connection, Config.load().walletKeypair.publicKey).then(() => {
    console.log('Pool initialization completed');
    process.exit(0);
  }).catch(() => process.exit(1));
}
