import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Comprehensive environment variable validation
 */
export interface EnvConfig {
  // Solana Connection (Required)
  SOLANA_RPC: string;
  SOLANA_WSS: string;
  PRIVATE_KEY: string;

  // Supabase Configuration (Required)
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;

  // Price Feed Configuration (Required)
  SOL_Price_ID: string;

  // Bot Configuration (Required)
  TOTAL_X_AMOUNT: number;
  DATA_DIRECTORY: string;
  METEORA_API_BASE_URL: string;
  VOLATILITY_CHECK_INTERVAL: number;
  PRICE_FEED_URL: string;
  DEFAULT_MAX_HISTORY_LENGTH: number;
  ALLOWED_SLIPPAGE_BPS: number;
  TOTAL_RANGE_INTERVAL: number;
  BPS_TO_REMOVE: number;
  LIQUIDITY_REMOVAL_UPPER_PERCENT: number;
  LIQUIDITY_REMOVAL_LOWER_PERCENT: number;

  // Server Configuration (Optional)
  PORT?: number;
  NODE_ENV?: string;

  // Delegation System (Optional)
  SERVER_SIGNING_KEY?: string;
  DELEGATION_PROGRAM_ID?: string;
  JWT_SECRET?: string;

  // Email Configuration (Optional)
  EMAIL_USERNAME?: string;
  EMAIL_PASSWORD?: string;
  METEORA_API_KEY?: string;
}

/**
 * Validates and returns typed environment configuration
 */
export function validateAndGetEnv(delegationEnabled: boolean = false): EnvConfig {
  // Required variables for all modes
  const required = [
    'SOLANA_RPC',
    'SOLANA_WSS',
    'PRIVATE_KEY',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_KEY',
    'SOL_Price_ID',
    'TOTAL_X_AMOUNT',
    'DATA_DIRECTORY',
    'METEORA_API_BASE_URL',
    'VOLATILITY_CHECK_INTERVAL',
    'PRICE_FEED_URL',
    'DEFAULT_MAX_HISTORY_LENGTH',
    'ALLOWED_SLIPPAGE_BPS',
    'TOTAL_RANGE_INTERVAL',
    'BPS_TO_REMOVE',
    'LIQUIDITY_REMOVAL_UPPER_PERCENT',
    'LIQUIDITY_REMOVAL_LOWER_PERCENT'
  ];

  // Variables only required when delegation is enabled
  const delegationRequired = delegationEnabled ? [
    'SERVER_SIGNING_KEY',
    'DELEGATION_PROGRAM_ID',
    'JWT_SECRET'
  ] : [];

  const allRequired = [...required, ...delegationRequired];
  const missing = allRequired.filter(varName => !process.env[varName]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}\n\nPlease check your .env file and ensure all required variables are set.`);
  }

  // Validate format requirements
  if (delegationEnabled && process.env.DELEGATION_PROGRAM_ID === 'YOUR_DELEGATION_PROGRAM_ID') {
    throw new Error('DELEGATION_PROGRAM_ID has placeholder value. Please set a valid program ID.');
  }

  // Validate numeric values
  const numericVars = [
    'TOTAL_X_AMOUNT',
    'VOLATILITY_CHECK_INTERVAL', 
    'DEFAULT_MAX_HISTORY_LENGTH',
    'ALLOWED_SLIPPAGE_BPS',
    'TOTAL_RANGE_INTERVAL',
    'BPS_TO_REMOVE',
    'LIQUIDITY_REMOVAL_UPPER_PERCENT',
    'LIQUIDITY_REMOVAL_LOWER_PERCENT'
  ];

  for (const varName of numericVars) {
    const value = process.env[varName];
    if (value && isNaN(Number(value))) {
      throw new Error(`${varName} must be a valid number. Got: ${value}`);
    }
  }

  // Validate URL formats
  const urlVars = ['SOLANA_RPC', 'SOLANA_WSS', 'SUPABASE_URL', 'METEORA_API_BASE_URL'];
  for (const varName of urlVars) {
    const value = process.env[varName];
    if (value && !isValidUrl(value)) {
      throw new Error(`${varName} must be a valid URL. Got: ${value}`);
    }
  }

  // Validate private key format (should be base58)
  try {
    const bs58 = require('bs58');
    bs58.decode(process.env.PRIVATE_KEY!);
  } catch (error) {
    throw new Error('PRIVATE_KEY must be in base58 format. Array format is not supported.');
  }

  console.log('✅ Environment configuration validated successfully');

  return {
    SOLANA_RPC: process.env.SOLANA_RPC!,
    SOLANA_WSS: process.env.SOLANA_WSS!,
    PRIVATE_KEY: process.env.PRIVATE_KEY!,
    SUPABASE_URL: process.env.SUPABASE_URL!,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY!,
    SOL_Price_ID: process.env.SOL_Price_ID!,
    TOTAL_X_AMOUNT: parseInt(process.env.TOTAL_X_AMOUNT!, 10),
    DATA_DIRECTORY: process.env.DATA_DIRECTORY!,
    METEORA_API_BASE_URL: process.env.METEORA_API_BASE_URL!,
    VOLATILITY_CHECK_INTERVAL: parseInt(process.env.VOLATILITY_CHECK_INTERVAL!, 10),
    PRICE_FEED_URL: process.env.PRICE_FEED_URL!,
    DEFAULT_MAX_HISTORY_LENGTH: parseInt(process.env.DEFAULT_MAX_HISTORY_LENGTH!, 10),
    ALLOWED_SLIPPAGE_BPS: parseInt(process.env.ALLOWED_SLIPPAGE_BPS!, 10),
    TOTAL_RANGE_INTERVAL: parseInt(process.env.TOTAL_RANGE_INTERVAL!, 10),
    BPS_TO_REMOVE: parseInt(process.env.BPS_TO_REMOVE!, 10),
    LIQUIDITY_REMOVAL_UPPER_PERCENT: parseFloat(process.env.LIQUIDITY_REMOVAL_UPPER_PERCENT!),
    LIQUIDITY_REMOVAL_LOWER_PERCENT: parseFloat(process.env.LIQUIDITY_REMOVAL_LOWER_PERCENT!),
    PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : undefined,
    NODE_ENV: process.env.NODE_ENV,
    SERVER_SIGNING_KEY: process.env.SERVER_SIGNING_KEY,
    DELEGATION_PROGRAM_ID: process.env.DELEGATION_PROGRAM_ID,
    JWT_SECRET: process.env.JWT_SECRET,
    EMAIL_USERNAME: process.env.EMAIL_USERNAME,
    EMAIL_PASSWORD: process.env.EMAIL_PASSWORD,
    METEORA_API_KEY: process.env.METEORA_API_KEY
  };
}

/**
 * Simple URL validation helper
 */
function isValidUrl(urlString: string): boolean {
  try {
    new URL(urlString);
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates required data directories if they don't exist
 */
export function ensureDataDirectories(dataDir: string): void {
  const fs = require('fs');
  const path = require('path');
  
  // Create data directory
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log(`Created data directory: ${dataDir}`);
  }

  // Create logs directory
  const logsDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
    console.log(`Created logs directory: ${logsDir}`);
  }

  // Ensure tokenBlacklist.json exists
  const blacklistPath = path.join(dataDir, 'tokenBlacklist.json');
  if (!fs.existsSync(blacklistPath)) {
    fs.writeFileSync(blacklistPath, JSON.stringify([], null, 2));
    console.log(`Created token blacklist: ${blacklistPath}`);
  }
}
