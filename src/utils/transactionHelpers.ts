import { ComputeBudgetProgram, Transaction } from '@solana/web3.js';

/**
 * Adds Compute Budget instructions for priority fees to a transaction.
 * @param transaction - The Solana Transaction object to modify.
 * @param units - The compute unit limit (default: 300).
 * @param microLamports - The priority fee in micro-lamports per compute unit (default: 20000).
 */
export function addPriorityFees(
  transaction: Transaction,
  units: number = 300,
  microLamports: number = 20000
): void {
  const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({ units });
  const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({ microLamports });

  transaction.add(modifyComputeUnits).add(addPriorityFee);
} 