import { Config } from './models/Config';
import { DLMMClient } from './utils/DLMMClient';
import { Connection } from '@solana/web3.js';
import * as fs from 'fs';

async function fetchAllMarkets() {
  const config = await Config.load();
  const client = new DLMMClient(config);
  
}
// Run directly when executed
if (require.main === module) {
  fetchAllMarkets().then(() => {
    console.log('Market data written to raw_markets.json');
    process.exit(0);
  });
} 