import BN from 'bn.js';

export function calculateTokenAmounts(
  userDollarAmount: number,     // e.g. 10
  activeBinPriceNumber: number,       // e.g. 0.003
  SolPriceNumber: number,       // e.g. 232
  decimalsX = 9,                // number of decimals for token X
  decimalsY = 9                 // number of decimals for token Y
): { totalXAmount: BN; totalYAmount: BN } {
  // Split the user's total dollars evenly between token X and token Y
  const halfAmount = userDollarAmount / 2;

  // Calculate how many "whole" tokens of X this buys (e.g. 1666.6667 if user spends $5 at $0.003)
  const xTokens = halfAmount / activeBinPriceNumber;
  // Convert tokens to lamports (or the smallest atomic unit for your token)
  const xLamports = new BN(Math.round(xTokens * 10 ** decimalsX));

  // Calculate how many "whole" tokens of Y (e.g. if Y is SOL at $232, then spending $5 yields ~0.02155 SOL)
  const yTokens = halfAmount / SolPriceNumber;
  // Convert to lamports (or smallest atomic unit)
  const yLamports = new BN(Math.round(yTokens * 10 ** decimalsY));

  return {
    totalXAmount: xLamports,
    totalYAmount: yLamports,
  };
}
