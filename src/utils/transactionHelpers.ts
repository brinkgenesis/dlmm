import { ComputeBudgetProgram, Transaction, TransactionInstruction } from '@solana/web3.js';

/**
 * Adds or modifies Compute Budget instructions for priority fees in a transaction.
 * @param transaction - The Solana Transaction object to modify.
 * @param units - The compute unit limit (default: 1000000).
 * @param microLamports - The priority fee in micro-lamports per compute unit (default: 50000).
 */
export function addOrModifyPriorityFees(
  transaction: Transaction,
  units: number = 3000000,
  microLamports: number = 50000
): void {
  // Find existing compute budget instructions
  const existingComputeUnitLimitIx = transaction.instructions.find(
    (ix) => ix.programId.toBase58() === ComputeBudgetProgram.programId.toBase58() && ix.data[0] === 2
  );

  const existingComputeUnitPriceIx = transaction.instructions.find(
    (ix) => ix.programId.toBase58() === ComputeBudgetProgram.programId.toBase58() && ix.data[0] === 3
  );

  // Modify existing instructions if they exist
  if (existingComputeUnitLimitIx) {
    existingComputeUnitLimitIx.data = ComputeBudgetProgram.setComputeUnitLimit({ units }).data;
  } else {
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({ units });
    transaction.add(modifyComputeUnits);
  }

  if (existingComputeUnitPriceIx) {
    existingComputeUnitPriceIx.data = ComputeBudgetProgram.setComputeUnitPrice({ microLamports }).data;
  } else {
    const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({ microLamports });
    transaction.add(addPriorityFee);
  }
} 