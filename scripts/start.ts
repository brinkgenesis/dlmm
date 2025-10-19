#!/usr/bin/env node

/**
 * Production startup script for DLMM Bot
 * Validates setup and starts the appropriate service
 */

import * as dotenv from 'dotenv';
import { validateSetup } from '../src/startup';

// Load environment variables first
dotenv.config();

async function startBot() {
  console.log('🤖 DLMM Bot Starting...\n');
  
  // Run comprehensive setup validation
  const isValid = await validateSetup();
  
  if (!isValid) {
    console.error('❌ Setup validation failed. Bot cannot start.');
    process.exit(1);
  }

  console.log('\n🚀 Starting bot components...\n');

  // Determine which mode to run in
  const mode = process.argv[2] || 'server';
  
  switch (mode) {
    case 'server':
      console.log('Starting in server mode...');
      // Dynamic import to avoid loading issues if setup fails
      const serverModule = await import('../server');
      break;
      
    case 'cli':
      console.log('Starting in CLI mode...');
      const cliModule = await import('../src/index');
      break;
      
    case 'dashboard':
      console.log('Starting dashboard...');
      const { Config } = await import('../src/models/Config');
      const { Dashboard } = await import('../src/dashboard');
      const config = await Config.load();
      const dashboard = new Dashboard(config);
      await dashboard.printDashboard();
      process.exit(0);
      
    case 'rebalance':
      console.log('Running rebalance check...');
      const { TradingApp } = await import('../src/app');
      const { Config: ConfigRebalance } = await import('../src/models/Config');
      const { Connection, Keypair } = await import('@solana/web3.js');
      const bs58 = require('bs58');
      
      const config = await ConfigRebalance.load();
      const connection = new Connection(process.env.SOLANA_RPC!);
      const wallet = Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY!));
      const app = new TradingApp(connection, wallet, config);
      
      await app.initialize();
      await app.triggerRebalanceCheck();
      console.log('Rebalance check completed');
      process.exit(0);
      
    default:
      console.error('❌ Invalid mode. Available modes: server, cli, dashboard, rebalance');
      process.exit(1);
  }
}

// Handle process termination gracefully
process.on('SIGINT', () => {
  console.log('\n🛑 Bot shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Bot shutting down gracefully...');
  process.exit(0);
});

// Start the bot
startBot().catch((error) => {
  console.error('❌ Failed to start bot:', error);
  process.exit(1);
});
