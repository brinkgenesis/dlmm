import { Config } from '../models/Config';
import DLMM, { MAX_CLAIM_ALL_ALLOWED, StrategyType, PositionVersion, StrategyParameters, LbPosition, SwapQuote, computeBudgetIx, PositionInfo } from '@meteora-ag/dlmm';
import { PublicKey } from '@solana/web3.js';
import * as fs from 'fs';
import BN from 'bn.js';

async function GetAllUserPositions() {
  const config = await Config.load();
  const userPubKey = config.walletKeypair.publicKey;

  try {
    const positionMap = await DLMM.getAllLbPairPositionsByUser(
      config.connection,
      userPubKey
    );
    
    console.log('Found positions in', positionMap.size, 'pools');
    
    const outputData = Array.from(positionMap.entries()).map(([poolAddress, positionInfo]) => ({
      poolAddress,
      positionInfo: {
        publicKey: positionInfo.publicKey.toBase58(),
        lbPair: {
          tokenXMint: positionInfo.lbPair.tokenXMint.toBase58(),
          tokenYMint: positionInfo.lbPair.tokenYMint.toBase58(),
          binStep: positionInfo.lbPair.binStep,
    
          protocolFee: positionInfo.lbPair.protocolFee.toString(),
          // ... other LbPair fields as needed
        },
        tokenX: {
          publicKey: positionInfo.tokenX.publicKey.toBase58(),
          reserve: positionInfo.tokenX.reserve.toBase58(),
          amount: positionInfo.tokenX.amount.toString(),
          decimal: positionInfo.tokenX.decimal
        },
        tokenY: {
          publicKey: positionInfo.tokenY.publicKey.toBase58(),
          reserve: positionInfo.tokenY.reserve.toBase58(),
          amount: positionInfo.tokenY.amount.toString(),
          decimal: positionInfo.tokenY.decimal
        },
        lbPairPositionsData: positionInfo.lbPairPositionsData.map(lbPos => ({
          publicKey: lbPos.publicKey.toBase58(),
          version: PositionVersion[lbPos.version],
          positionData: {
            totalXAmount: lbPos.positionData.totalXAmount,
            totalYAmount: lbPos.positionData.totalYAmount,
            positionBinData: lbPos.positionData.positionBinData.map(binData => ({
              binId: binData.binId,
              price: binData.price,
              pricePerToken: binData.pricePerToken,
              binXAmount: binData.binXAmount,
              binYAmount: binData.binYAmount,
              binLiquidity: binData.binLiquidity,
              positionLiquidity: binData.positionLiquidity,
              positionXAmount: binData.positionXAmount,
              positionYAmount: binData.positionYAmount
            })),
            lastUpdatedAt: lbPos.positionData.lastUpdatedAt.toString(),
            upperBinId: lbPos.positionData.upperBinId,
            lowerBinId: lbPos.positionData.lowerBinId,
            feeX: lbPos.positionData.feeX.toString(),
            feeY: lbPos.positionData.feeY.toString(),
            rewardOne: lbPos.positionData.rewardOne.toString(),
            rewardTwo: lbPos.positionData.rewardTwo.toString(),
            feeOwner: lbPos.positionData.feeOwner.toBase58(),
            totalClaimedFeeXAmount: lbPos.positionData.totalClaimedFeeXAmount.toString(),
            totalClaimedFeeYAmount: lbPos.positionData.totalClaimedFeeYAmount.toString()
          }
        }))
      }
    }));

    fs.writeFileSync('user_positions_full.json', JSON.stringify(outputData, null, 2));

    // Log all positions to console
    outputData.forEach((poolData, index) => {
      console.log(`\n=== Pool ${index + 1}/${outputData.length} ===`);
      console.log(`Pool Address: ${poolData.poolAddress}`);
      console.log(`Position Key: ${poolData.positionInfo.publicKey}`);
      console.log(`Token X: ${poolData.positionInfo.tokenX.amount} (${poolData.positionInfo.tokenX.decimal} decimals)`);
      console.log(`Token Y: ${poolData.positionInfo.tokenY.amount} (${poolData.positionInfo.tokenY.decimal} decimals)`);
      
      poolData.positionInfo.lbPairPositionsData.forEach((position, posIndex) => {
        console.log(`\nPosition ${posIndex + 1}:`);
        console.log(JSON.stringify({
          version: position.version,
          feeOwner: position.positionData.feeOwner,
          totalX: position.positionData.totalXAmount,
          totalY: position.positionData.totalYAmount,
          fees: {
            feeX: position.positionData.feeX,
            feeY: position.positionData.feeY,
            claimedX: position.positionData.totalClaimedFeeXAmount,
            claimedY: position.positionData.totalClaimedFeeYAmount
          },
          rewards: {
            rewardOne: position.positionData.rewardOne,
            rewardTwo: position.positionData.rewardTwo
          },
          binRange: {
            lower: position.positionData.lowerBinId,
            upper: position.positionData.upperBinId
          },
          
        }, null, 2));
      });
    });

    console.log(`\n=== Summary ===`);
    console.log(`Total pools with positions: ${outputData.length}`);
    console.log(`Total positions across all pools: ${
      outputData.reduce((sum, pool) => sum + pool.positionInfo.lbPairPositionsData.length, 0)
    }`);

  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  }
}

// Run test if executed directly
if (require.main === module) {
  GetAllUserPositions().then(() => {
    console.log('User positions test completed');
    process.exit(0);
  });
}