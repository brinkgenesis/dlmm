#!/usr/bin/env ts-node
import inquirer from 'inquirer';
import { PublicKey } from '@solana/web3.js';
import { Config } from '../src/models/Config';
import { getFeedIdForMint } from '../src/utils/pythUtils';
import { FetchPrice } from '../src/utils/fetch_price';

(async () => {
  try {
    // Load config and initialize connection
    const config = await Config.load();
    const connection = config.connection;

    // Get user input
    const { mintAddress } = await inquirer.prompt([
      {
        type: 'input',
        name: 'mintAddress',
        message: 'Enter token mint address:',
        validate: input => {
          try {
            new PublicKey(input);
            return true;
          } catch {
            return 'Invalid public key format';
          }
        }
      }
    ]);

    console.log(`\n🔍 Looking up price feed for mint: ${mintAddress}`);

    // Get Pyth price feed ID
    const feedId = await getFeedIdForMint(mintAddress, connection);
    
    if (!feedId) {
      console.log('❌ No Pyth price feed found for this mint');
      return;
    }

    console.log(`✅ Found Pyth price feed ID:\n${feedId}`);

    // Fetch current price
    console.log('\n📈 Fetching current price...');
    const price = await FetchPrice(feedId);
    
    console.log('\n💎 Price Results:');
    console.log('────────────────');
    console.log(`Token Mint: ${mintAddress}`);
    console.log(`Pyth Feed: ${feedId}`);
    console.log(`Current Price: $${parseFloat(price).toFixed(4)}`);

  } catch (error) {
    console.error('Test failed:', error);
  }
})(); 