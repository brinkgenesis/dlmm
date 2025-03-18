import { Buffer } from 'buffer';

/**
 * Deserializes account data from a delegation account PDA
 * 
 * @param data Buffer containing the account data
 * @returns Parsed delegation account information
 */
export function deserializeDelegationAccount(data: Buffer): { 
  expiryTimestamp: number, 
  isActive: boolean,
  permissions: number,
  maxAllowedAmount: bigint,
  owner: Uint8Array,
  delegate: Uint8Array
} {
  // Match the Rust struct layout from lib.rs
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  
  // First byte is initialized flag
  const initialized = view.getUint8(0) === 1;
  
  // Extract owner public key (32 bytes)
  const owner = new Uint8Array(data.slice(1, 33));
  
  // Extract delegate public key (32 bytes)
  const delegate = new Uint8Array(data.slice(33, 65));
  
  // Extract expiry timestamp (i64 = 8 bytes)
  // Note: getBigInt64 needs little-endian (true) for Solana
  const expiryTimestamp = Number(view.getBigInt64(65, true));
  
  // Extract max allowed amount (u64 = 8 bytes)
  const maxAllowedAmount = view.getBigUint64(73, true);
  
  // Extract permissions (u32 = 4 bytes)
  const permissions = view.getUint32(81, true);
  
  return {
    expiryTimestamp,
    isActive: initialized && (Date.now()/1000 < expiryTimestamp),
    permissions,
    maxAllowedAmount,
    owner,
    delegate
  };
}

/**
 * Validates if a delegation is still active based on its expiry
 * 
 * @param expiryTimestamp Unix timestamp when delegation expires
 * @returns Boolean indicating if delegation is still active
 */
export function isDelegationActive(expiryTimestamp: number): boolean {
  return Date.now()/1000 < expiryTimestamp;
}
