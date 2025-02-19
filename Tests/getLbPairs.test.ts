import { Config } from '../src/models/Config';
import DLMM, { MAX_CLAIM_ALL_ALLOWED, StrategyType, PositionVersion, StrategyParameters, LbPosition, SwapQuote, computeBudgetIx, PositionInfo } from '@meteora-ag/dlmm';
import { PublicKey, Connection } from '@solana/web3.js';
import * as fs from 'fs';
import { getTokenBalance } from '@meteora-ag/dlmm';
import type { LbPairAccount } from '@meteora-ag/dlmm';

async function testGetLbPairs() {
  const config = Config.load();
  const SOL_MINT = 'So11111111111111111111111111111111111111112';

  try {
    // Get all pairs and filter for SOL pairs
    const lbPairs = (await DLMM.getLbPairs(config.connection))
      .filter(pair => 
        pair.account.tokenYMint.toBase58() === SOL_MINT
      )
      .slice(0, 25); // First 25 SOL pairs

    // Only fetch reward vault balances
    const rewardVaults = lbPairs.flatMap(pair => 
      pair.account.rewardInfos.map(reward => reward.vault)
    );

    const rewardVaultBalances = await Promise.all(
      rewardVaults.map(async vault => {
        try {
          return await getTokenBalance(config.connection, vault);
        } catch {
          return BigInt(0);
        }
      })
    );

    const rewardBalanceMap = new Map(
      rewardVaults.map((vault, index) => [
        vault.toBase58(), 
        rewardVaultBalances[index].toString()
      ])
    );

    const serializedPairs = lbPairs.map(pair => ({
      publicKey: pair.publicKey.toBase58(),
      lbPair: {
        tokenXMint: pair.account.tokenXMint.toBase58(),
        tokenYMint: pair.account.tokenYMint.toBase58(),
        reserveX: pair.account.reserveX.toBase58(), // Simple address
        reserveY: pair.account.reserveY.toBase58(), // Simple address
        protocolFee: {
          amountX: pair.account.protocolFee.amountX.toString(),
          amountY: pair.account.protocolFee.amountY.toString()
        },
        binStep: pair.account.binStep,
        activeId: pair.account.activeId,
        status: pair.account.status,
        pairType: pair.account.pairType,
        rewardInfos: pair.account.rewardInfos.map(reward => ({
          mint: reward.mint.toBase58(),
          vault: {
            address: reward.vault.toBase58(),
            balance: rewardBalanceMap.get(reward.vault.toBase58()) || '0'
          },
          funder: reward.funder.toBase58(),
          rewardRate: reward.rewardRate.toString(),
          rewardDuration: reward.rewardDuration.toString(),
          rewardDurationEnd: reward.rewardDurationEnd.toString(),
          lastUpdateTime: reward.lastUpdateTime.toString(),
          cumulativeSecondsWithEmptyLiquidityReward: 
            reward.cumulativeSecondsWithEmptyLiquidityReward.toString()
        })),
        oracle: pair.account.oracle.toBase58(),
        parameters: {
          baseFactor: pair.account.parameters.baseFactor,
          filterPeriod: pair.account.parameters.filterPeriod,
          decayPeriod: pair.account.parameters.decayPeriod,
          reductionFactor: pair.account.parameters.reductionFactor,
          variableFeeControl: pair.account.parameters.variableFeeControl,
          maxVolatilityAccumulator: pair.account.parameters.maxVolatilityAccumulator
        },
        vParameters: {
          volatilityAccumulator: pair.account.vParameters.volatilityAccumulator,
          volatilityReference: pair.account.vParameters.volatilityReference,
          indexReference: pair.account.vParameters.indexReference,
          lastUpdateTimestamp: pair.account.vParameters.lastUpdateTimestamp.toString()
        },
        binArrayBitmap: pair.account.binArrayBitmap.map(bn => bn.toString())
      }
    }));

    console.log(`Found ${lbPairs.length} SOL pairs`);
    serializedPairs.forEach((pair, index) => {
      console.log(`\n=== Pair ${index + 1}/${serializedPairs.length} ===`);
      console.log(`PublicKey: ${pair.publicKey}`);
      console.log(JSON.stringify(pair.lbPair, null, 2));
    });

    // Save raw data
    fs.writeFileSync('lb_pairs_dump.json', JSON.stringify(serializedPairs, null, 2));

  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  }
}

// Run test if executed directly
if (require.main === module) {
  testGetLbPairs().then(() => {
    console.log('\nLB pairs dump completed');
    process.exit(0);
  });
} 