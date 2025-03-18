import { Config } from '../models/Config';
import { Keypair, Transaction } from '@solana/web3.js';

/**
 * Safely gets the wallet keypair, checking if in delegation mode
 * @param config The configuration object
 * @returns The wallet keypair or throws if in delegation mode
 */
export function getSigningKeypair(config: Config): Keypair {
  if ('delegationMode' in config && (config as any).delegationMode === true) {
    throw new Error('Cannot use keypair directly in delegation mode');
  }
  return config.walletKeypair;
}

/**
 * Wraps existing methods that use walletKeypair directly
 * @param config The configuration object
 * @param method The method that uses keypair
 */
export async function withSafeKeypair<T>(
  config: Config, 
  method: (keypair: Keypair) => Promise<T>
): Promise<T> {
  const keypair = getSigningKeypair(config);
  return method(keypair);
}
