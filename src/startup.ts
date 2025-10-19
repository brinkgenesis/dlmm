#!/usr/bin/env node

import * as dotenv from 'dotenv';
import { validateAndGetEnv, ensureDataDirectories } from './utils/envValidator';
import { validateEnvironmentVariables } from './utils/configValidator';
import { Connection, PublicKey } from '@solana/web3.js';
import { supabase } from './services/supabase';
import fs from 'fs';
import path from 'path';

/**
 * Comprehensive startup validation and setup
 */
export async function validateSetup(): Promise<boolean> {
  console.log('🚀 Starting DLMM Bot Setup Validation...\n');

  // Check if .env file exists first
  if (!fs.existsSync('.env')) {
    console.error('❌ .env file not found!');
    console.error('Please create a .env file using the template:');
    console.error('   cp .env.example .env');
    console.error('Then edit it with your configuration values.\n');
    return false;
  }

  try {
    // 1. Load and validate environment variables
    console.log('1. Validating environment variables...');
    dotenv.config();
    
    const delegationEnabled = !!process.env.DELEGATION_PROGRAM_ID && process.env.DELEGATION_PROGRAM_ID !== 'YOUR_DELEGATION_PROGRAM_ID';
    validateEnvironmentVariables(delegationEnabled);
    const env = validateAndGetEnv(delegationEnabled);
    console.log('✅ Environment variables validated\n');

    // 2. Test Solana RPC connection
    console.log('2. Testing Solana RPC connection...');
    const connection = new Connection(env.SOLANA_RPC);
    const version = await connection.getVersion();
    console.log(`✅ Connected to Solana RPC: ${env.SOLANA_RPC}`);
    console.log(`   Solana version: ${version['solana-core']}\n`);

    // 3. Test Supabase connection
    console.log('3. Testing Supabase connection...');
    const { error: supabaseError } = await supabase
      .from('markets')
      .select('count(*)')
      .limit(1);
    
    if (supabaseError) {
      throw new Error(`Supabase connection failed: ${supabaseError.message}`);
    }
    console.log('✅ Supabase connection successful\n');

    // 4. Validate wallet configuration
    console.log('4. Validating wallet configuration...');
    const bs58 = require('bs58');
    try {
      const { Keypair } = await import('@solana/web3.js');
      const keypair = Keypair.fromSecretKey(bs58.decode(env.PRIVATE_KEY));
      console.log(`✅ Wallet loaded successfully: ${keypair.publicKey.toString()}`);
      
      // Check wallet balance
      const balance = await connection.getBalance(keypair.publicKey);
      const solBalance = balance / 1_000_000_000;
      console.log(`   SOL Balance: ${solBalance.toFixed(4)} SOL`);
      
      if (solBalance < 0.1) {
        console.warn('⚠️  Low SOL balance - may not be sufficient for transactions');
      }
    } catch (error) {
      throw new Error(`Invalid wallet private key: ${error instanceof Error ? error.message : String(error)}`);
    }
    console.log();

    // 5. Ensure required directories exist
    console.log('5. Creating required directories...');
    ensureDataDirectories(env.DATA_DIRECTORY);
    console.log('✅ Required directories created\n');

    // 6. Check database tables
    console.log('6. Checking database tables...');
    const requiredTables = ['markets', 'positions', 'orders', 'users'];
    for (const table of requiredTables) {
      const { error } = await supabase
        .from(table)
        .select('count(*)')
        .limit(1);
      
      if (error) {
        console.warn(`⚠️  Table '${table}' may not exist or is inaccessible: ${error.message}`);
        console.warn('   Please ensure your Supabase database has all required tables.');
      } else {
        console.log(`✅ Table '${table}' exists`);
      }
    }
    console.log();

    // 7. Check price feed
    console.log('7. Testing price feeds...');
    try {
      const { FetchPrice } = await import('./utils/fetch_price');
      const price = await FetchPrice(env.SOL_Price_ID);
      console.log(`✅ SOL price feed working: $${price}`);
    } catch (error) {
      console.warn(`⚠️  SOL price feed issue: ${error instanceof Error ? error.message : String(error)}`);
    }
    console.log();

    console.log('🎉 Setup validation completed successfully!');
    console.log('\n📋 Summary:');
    console.log(`   RPC: ${env.SOLANA_RPC}`);
    console.log(`   Data Directory: ${env.DATA_DIRECTORY}`);
    console.log(`   Delegation Enabled: ${delegationEnabled}`);
    console.log(`   Port: ${env.PORT || 3001}`);
    
    return true;

  } catch (error) {
    console.error('\n❌ Setup validation failed:');
    console.error(error instanceof Error ? error.message : String(error));
    console.error('\nPlease fix the above issues before starting the bot.');
    return false;
  }
}

/**
 * Run validation if this file is executed directly
 */
if (require.main === module) {
  validateSetup()
    .then((success) => {
      process.exit(success ? 0 : 1);
    })
    .catch((error) => {
      console.error('Validation failed:', error);
      process.exit(1);
    });
}
