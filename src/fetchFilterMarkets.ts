import { Config } from './models/Config';
import { DLMMClient } from './utils/DLMMClient';
import { Connection } from '@solana/web3.js';
import * as fs from 'fs';

async function fetchAllMarkets() {
  const config = Config.load();
  const client = new DLMMClient(config);
  
  try {
    // Fetch all LB pairs without filters
    const lbPairs = await client.getLbPairs();
    
    // Raw data dump for analysis
    console.log('Fetched', lbPairs.length, 'markets');
    fs.writeFileSync('raw_markets.json', JSON.stringify(lbPairs, null, 2));
    
    return lbPairs;
  } catch (error) {
    console.error('Failed to fetch markets:', error);
    process.exit(1);
  }
}

// Run directly when executed
if (require.main === module) {
  fetchAllMarkets().then(() => {
    console.log('Market data written to raw_markets.json');
    process.exit(0);
  });
} 