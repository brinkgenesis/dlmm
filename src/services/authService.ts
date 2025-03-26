import { supabase } from './supabase';
import { PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import crypto from 'crypto';

export class AuthService {
  private challenges: { [key: string]: string } = {};
  
  generateChallenge(publicKey: string): string {
    // Generate a random challenge
    const challenge = crypto.randomBytes(32).toString('hex');
    this.challenges[publicKey] = challenge;
    return challenge;
  }
  
  async verifySignature(publicKey: string, signature: string): Promise<string> {
    const challenge = this.challenges[publicKey];
    if (!challenge) {
      throw new Error('Challenge not found or expired');
    }
    
    // Verify the signature
    const verified = nacl.sign.detached.verify(
      new TextEncoder().encode(challenge),
      bs58.decode(signature),
      new PublicKey(publicKey).toBuffer()
    );
    
    if (!verified) {
      throw new Error('Invalid signature');
    }
    
    // Delete the challenge
    delete this.challenges[publicKey];
    
    // Check if user exists in Supabase
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('wallet_address', publicKey)
      .single();
    
    if (!existingUser) {
      // Create new user if doesn't exist
      await supabase.from('users').insert({ wallet_address: publicKey });
    }
    
    // Update last login
    await supabase
      .from('users')
      .update({ last_login: new Date().toISOString() })
      .eq('wallet_address', publicKey);
    
    // Generate a JWT token
    const { data, error } = await supabase.auth.admin.createUser({
      email: `${publicKey}@web3auth.io`, // Virtual email
      password: crypto.randomBytes(20).toString('hex'), // Random password
      user_metadata: { wallet_address: publicKey }
    });
    
    if (error) throw new Error(`Auth error: ${error.message}`);
    
    return data.user.id;
  }
} 