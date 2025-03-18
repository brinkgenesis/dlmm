import { 
  PublicKey, 
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY
} from '@solana/web3.js';

/**
 * Creates an instruction to create a delegation
 */
export function createDelegationInstruction(
  ownerPubkey: PublicKey,
  delegatePubkey: PublicKey,
  delegationPDA: PublicKey,
  expiryTimestamp: number,
  maxAmount: number,
  permissions: number
): TransactionInstruction {
  // Build instruction data for creating a delegation
  // [0] = instruction index for Create
  const instructionData = Buffer.from([
    0, // Create instruction index
    ...new Uint8Array(new BigInt64Array([BigInt(expiryTimestamp)]).buffer),
    ...new Uint8Array(new BigUint64Array([BigInt(maxAmount)]).buffer),
    ...new Uint8Array(new Uint32Array([permissions]).buffer),
  ]);
  
  return new TransactionInstruction({
    keys: [
      { pubkey: ownerPubkey, isSigner: true, isWritable: true },
      { pubkey: delegationPDA, isSigner: false, isWritable: true },
      { pubkey: delegatePubkey, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    programId: new PublicKey(process.env.DELEGATION_PROGRAM_ID!),
    data: instructionData
  });
}

/**
 * Creates an instruction to revoke a delegation
 */
export function createRevokeDelegationInstruction(
  ownerPubkey: PublicKey,
  delegationPDA: PublicKey
): TransactionInstruction {
  // [1] = instruction index for Revoke
  const instructionData = Buffer.from([1]);
  
  return new TransactionInstruction({
    keys: [
      { pubkey: ownerPubkey, isSigner: true, isWritable: false },
      { pubkey: delegationPDA, isSigner: false, isWritable: true },
    ],
    programId: new PublicKey(process.env.DELEGATION_PROGRAM_ID!),
    data: instructionData
  });
}
