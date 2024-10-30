/**
 * ImpermanentLossCalculator.ts
 * 
 * Updated to align with Uniswap v3's concentrated liquidity model.
 * 
 * Reference: [Calculating the Expected Value of the Impermanent Loss in Uniswap](https://lambert-guillaume.medium.com/an-analysis-of-the-expected-value-of-the-impermanent-loss-in-uniswap-bfbfebbefed2)
 */

import BN from 'bn.js';
import * as math from 'mathjs';

/**
 * Calculates the Impermanent Loss (IL) for Uniswap V3 based on the relative price change (alpha) and range factor (r).
 * Handles three cases based on the value of alpha relative to 1/r and r.
 * 
 * @param alpha - The relative price change of the asset pair (P'/P)
 * @param rangeFactor - The range factor (r = sqrt(tH / tL))
 * @returns The Impermanent Loss as a decimal (e.g., 0.05 for 5%)
 * 
 * @throws Will throw an error if alpha or rangeFactor is less than or equal to 0.
 */
export function calculateImpermanentLoss(alpha: number, rangeFactor: number): number {
  if (alpha <= 0) {
    throw new Error('Alpha must be greater than 0.');
  }

  if (rangeFactor <= 0) {
    throw new Error('Range factor must be greater than 0.');
  }

  const inverseR = 1 / rangeFactor;
  const sqrtR = Math.sqrt(rangeFactor);
  let il: number;

  if (alpha < inverseR) {
    // Case 1: alpha < 1 / r
    il = (Math.sqrt(rangeFactor * alpha) - 1) / (alpha + 1);
  } else if (alpha >= inverseR && alpha <= rangeFactor) {
    // Case 2: 1 / r ≤ alpha ≤ r
    il = sqrtR / (sqrtR - 1) * ((2 * rangeFactor * Math.sqrt(alpha)) / (alpha + 1) - 1);
  } else {
    // Case 3: alpha > r
    il = (sqrtR - alpha) / (alpha + 1);
  }

  return il;
}

/**
 * Calculates the expected Impermanent Loss (E[IL]) based on the assets' volatilities (sigma) and drifts (mu).
 * 
 * The formula is illustrative and inspired by Geometric Brownian Motion (GBM).
 * 
 * @param sigmaA - The volatility of Asset A (as a decimal, e.g., 0.05 for 5%)
 * @param muA - The drift of Asset A's price (as a decimal, e.g., 0.05 for 5%)
 * @param sigmaB - The volatility of Asset B (as a decimal)
 * @param muB - The drift of Asset B's price (as a decimal)
 * @param rho - The correlation coefficient between Asset A and Asset B's returns (fixed at 0.77)
 * @returns The expected Impermanent Loss as a decimal (e.g., 0.05 for 5%)
 * 
 * @throws Will throw an error if any sigma is negative or if rho is out of bounds.
 */
export function calculateExpectedImpermanentLoss(
  sigmaA: number,
  muA: number,
  sigmaB: number,
  muB: number,
  rho: number = 0.77
): number {
  if (sigmaA < 0 || sigmaB < 0) {
    throw new Error('Volatilities (sigmaA and sigmaB) must be non-negative.');
  }
  
  if (rho < -1 || rho > 1) {
    throw new Error('Correlation coefficient (rho) must be between -1 and 1.');
  }

  // Illustrative Expected IL formula
  const expectedIL = muA + muB - 0.5 * (Math.pow(sigmaA, 2) + Math.pow(sigmaB, 2) + 2 * rho * sigmaA * sigmaB);
  
  return expectedIL;
}

/**
 * ImpermanentLossModel for Uniswap v3 without internal rangeFactor calculations.
 */
const ImpermanentLossModel = {
  calculate1Day(
    oldPriceA: number,
    oldPriceB: number,
    newPriceA: number,
    newPriceB: number,
    period: '1d' | '7d' | '1m'
  ): { alpha: number; muA: number; muB: number; muCombined: number } {
    const alpha = newPriceA / oldPriceA;
    const returnA = calculateReturn(oldPriceA, newPriceA);
    const returnB = calculateReturn(oldPriceB, newPriceB);
    const muA = returnA; // Per-period drift
    const muB = returnB; // Per-period drift
    const muCombined = muA + muB;

    return { alpha, muA, muB, muCombined };
  },
  
  calculate7Days(
    oldPriceA: number,
    oldPriceB: number,
    newPriceA: number,
    newPriceB: number,
    period: '1d' | '7d' | '1m'
  ): { alpha: number; muA: number; muB: number; muCombined: number } {
    const alpha = newPriceA / oldPriceA;
    const returnA = calculateReturn(oldPriceA, newPriceA);
    const returnB = calculateReturn(oldPriceB, newPriceB);
    const muA = returnA; // Per-period drift
    const muB = returnB; // Per-period drift
    const muCombined = muA + muB;

    return { alpha, muA, muB, muCombined };
  },

  calculate1Month(
    oldPriceA: number,
    oldPriceB: number,
    newPriceA: number,
    newPriceB: number,
    period: '1d' | '7d' | '1m'
  ): { alpha: number; muA: number; muB: number; muCombined: number } {
    const alpha = newPriceA / oldPriceA;
    const returnA = calculateReturn(oldPriceA, newPriceA);
    const returnB = calculateReturn(oldPriceB, newPriceB);
    const muA = returnA; // Per-period drift
    const muB = returnB; // Per-period drift
    const muCombined = muA + muB;

    return { alpha, muA, muB, muCombined };
  }
};

/**
 * Calculates the return based on old and new prices.
 * 
 * @param oldPrice - The old price of the asset
 * @param newPrice - The new price of the asset
 * @returns The return as a decimal (e.g., 0.05 for 5%)
 * 
 * @throws Will throw an error if oldPrice is less than or equal to 0.
 */
function calculateReturn(oldPrice: number, newPrice: number): number {
  if (oldPrice <= 0) {
    throw new Error('Old price must be greater than 0.');
  }
  return (newPrice - oldPrice) / oldPrice;
}

/**
 * Performs the Impermanent Loss Analysis.
 * 
 * @param oldPriceA - Old price of Asset A
 * @param oldPriceB - Old price of Asset B
 * @param newPriceA - New price of Asset A
 * @param newPriceB - New price of Asset B
 * @param period - Analysis period ('1d', '7d', '1m')
 * @param beta - Beta of Asset B relative to Asset A
 * @param rangeFactor - Range factor calculated based on price bounds
 * 
 * @throws Will throw an error if an unsupported period is provided or if required parameters are missing.
 */
export function performImpermanentLossAnalysis(
  oldPriceA: number,
  oldPriceB: number,
  newPriceA: number,
  newPriceB: number,
  period: '1d' | '7d' | '1m',
  beta: number,
  rangeFactor: number
): void {
  // Fixed correlation coefficient
  const rho: number = 0.77;

  // Determine the period label for logging
  const periodLabel = period.toUpperCase();

  // Initialize variables to hold computation results
  let alpha: number;
  let muA: number;
  let muB: number;
  let muCombined: number;

  // Select the appropriate calculation method based on the period
  switch (period) {
    case '1d':
      ({ alpha, muA, muB, muCombined } = ImpermanentLossModel.calculate1Day(
        oldPriceA,
        oldPriceB,
        newPriceA,
        newPriceB,
        period
      ));
      break;
    case '7d':
      ({ alpha, muA, muB, muCombined } = ImpermanentLossModel.calculate7Days(
        oldPriceA,
        oldPriceB,
        newPriceA,
        newPriceB,
        period
      ));
      break;
    case '1m':
      ({ alpha, muA, muB, muCombined } = ImpermanentLossModel.calculate1Month(
        oldPriceA,
        oldPriceB,
        newPriceA,
        newPriceB,
        period
      ));
      break;
    default:
      throw new Error('Unsupported period. Choose from "1d", "7d", or "1m".');
  }

  // Estimate volatilities based on the observed returns and beta
  const returnA = calculateReturn(oldPriceA, newPriceA);
  const returnB = calculateReturn(oldPriceB, newPriceB);

  // Simplified volatility estimation without historical data
  const sigmaA = Math.abs(returnA); // Per-period volatility estimate
  const sigmaB = beta * sigmaA;     // Derived from beta relationship

  // Calculate Impermanent Loss using Uniswap v3 formula
  const il = calculateImpermanentLoss(alpha, rangeFactor);

  // Calculate Expected Impermanent Loss
  const expectedIL = calculateExpectedImpermanentLoss(sigmaA, muA, sigmaB, muB, rho);

  // Log input variables
  console.log(`${periodLabel} Period Analysis:`);
  console.log(`Old Price of Asset A: $${oldPriceA}`);
  console.log(`Old Price of Asset B: $${oldPriceB}`);
  console.log(`New Price of Asset A: $${newPriceA}`);
  console.log(`New Price of Asset B: $${newPriceB}`);
  console.log(`Period: ${period}`);
  console.log(`Beta: ${beta}`);
  console.log(`Range Factor (r): ${rangeFactor.toFixed(4)}`);
  console.log(`Sigma A (Volatility): ${(sigmaA * 100).toFixed(2)}%`);
  console.log(`Mu A (Drift): ${(muA * 100).toFixed(2)}%`);
  console.log(`Sigma B (Volatility): ${(sigmaB * 100).toFixed(2)}%`);
  console.log(`Mu B (Drift): ${(muB * 100).toFixed(2)}%`);
  console.log(`Rho (Correlation Coefficient): ${rho.toFixed(2)}`);

  // Log calculation results
  console.log(`Calculated Alpha: ${alpha.toFixed(4)}`);
  console.log(`Impermanent Loss: ${(il * 100).toFixed(2)}%`);
  console.log(`Expected Impermanent Loss: ${(expectedIL * 100).toFixed(2)}%\n`);
}

/**
 * Calculates the range factor based on upper and lower bounds.
 * 
 * @param tH - Upper bound of the price range
 * @param tL - Lower bound of the price range
 * @returns The range factor as a decimal
 * 
 * @throws Will throw an error if tH or tL is less than or equal to 0.
 */

function calculateRangeFactor(tH: number, tL: number): number {
  if (tL <= 0 || tH <= 0) {
    throw new Error('Upper and lower bounds must be greater than 0.');
  }
  return Math.sqrt(tH / tL);
}

/**
 * ImpermanentLossCalculator.ts - End of File
 */
