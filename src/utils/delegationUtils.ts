import { Buffer } from 'buffer';

/**
 * Deserializes account data from a delegation account PDA
 * 
 * @param data Buffer containing the account data
 * @returns Parsed delegation account information
 */
export function deserializeDelegationAccount(data: Buffer): { 
  expiryTimestamp: number, 
  isActive: boolean 
} {
  // Placeholder implementation
  // Replace with actual deserialization logic when your program is ready
  console.warn('Using placeholder deserializer - replace with actual implementation');
  
  // For now, return default values
  return {
    expiryTimestamp: Date.now()/1000 + 86400, // 24 hours from now
    isActive: true
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
