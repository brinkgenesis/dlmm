/**
 * runImpermanentLossAnalysis.ts
 * 
 * Script to run impermanent loss analysis using Uniswap v3's concentrated liquidity model.
 */

import { performImpermanentLossAnalysis } from './ImpermanentLossCalculator'; // Adjusted import path if necessary

// Initialize parameters
const oldPriceA = 100; // Old price of Asset A (e.g., $100)
const oldPriceB = 250; // Old price of Asset B (e.g., $250)
const newPriceA = 105; // New price of Asset A after the period (e.g., $105)
const newPriceB = 270; // New price of Asset B after the period (e.g., $270)
const period: '1d' | '7d' | '1m' = '1m'; // Analysis period

// Define Uniswap v3 range
const tL = 80;  // Lower bound of price range
const tH = 120; // Upper bound of price range

// Calculate range factor
const rangeFactor = Math.sqrt(tH / tL);

// Optionally, modify the beta value if needed
const beta = 2.5; // Beta of Asset B relative to Asset A

// Run the impermanent loss analysis with all required arguments
performImpermanentLossAnalysis(
  oldPriceA,
  oldPriceB,
  newPriceA,
  newPriceB,
  period,
  beta,
  rangeFactor // Passing the rangeFactor as the seventh argument
);
