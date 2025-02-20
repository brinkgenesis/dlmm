#!/usr/bin/env ts-node
import inquirer from 'inquirer';
import { PublicKey, Connection } from '@solana/web3.js';
import { Config } from '../src/models/Config';
import  DLMM  from '@meteora-ag/dlmm';
import { FetchPrice } from '../src/utils/fetch_price';
import { getTokenDecimals } from '@meteora-ag/dlmm';

async function getSOLPrice(): Promise<number> {
  const solPriceStr = await FetchPrice(process.env.SOL_Price_ID as string);
  const solPriceNumber = parseFloat(solPriceStr);
  console.log(`Fetched current Solana Price: ${solPriceStr}`);
  return solPriceNumber;
}

(async () => {
  try {
    const config = Config.load();
    const connection = config.connection;

    const { poolAddress } = await inquirer.prompt([{
      type: 'input',
      name: 'poolAddress',
      message: 'Enter DLMM pool address:',
      validate: input => {
        try {
          new PublicKey(input);
          return true;
        } catch {
          return 'Invalid public key format';
        }
      }
    }]);

    console.log(`\n🔍 Loading pool ${poolAddress}...`);
    const dlmm = await DLMM.create(connection, new PublicKey(poolAddress));
    
    const activeBin = await dlmm.getActiveBin();
    console.log('\n🔍 Raw Active Bin Data:');
    console.log(activeBin);

    const tokenXDecimals = dlmm.tokenX.decimal;
    const tokenYDecimals = dlmm.tokenY.decimal;
    const tokenXMint = dlmm.lbPair.tokenXMint.toBase58();
    const tokenYMint = dlmm.lbPair.tokenYMint.toBase58();

    console.log('\n🔢 Token Details:');
    console.log(`Token X Mint: ${tokenXMint} (${tokenXDecimals} decimals)`);
    console.log(`Token Y Mint: ${tokenYMint} (${tokenYDecimals} decimals)`);
    console.log(`Raw Active Bin Price: ${activeBin.price}`);

    const decimalAdjustment = 10 ** (tokenXDecimals + tokenYDecimals);
    console.log(`Decimal Adjustment Factor: 10^${tokenXDecimals + tokenYDecimals} = ${decimalAdjustment}`);

    // Determine which token is SOL
    const SOL_MINT = 'So11111111111111111111111111111111111111112';
    const isTokenYSOL = tokenYMint === SOL_MINT;

    // Calculate price based on SOL position
    let tokenPriceInSOL: number;
    if (isTokenYSOL) {
      // Token X priced in SOL (tokenY is SOL)
      tokenPriceInSOL = Number(activeBin.price) / 10 ** (tokenXDecimals + tokenYDecimals);
    } else {
      // Token Y priced in SOL (tokenX is SOL)
      tokenPriceInSOL = 1 / (Number(activeBin.price) / 10 ** (tokenXDecimals + tokenYDecimals));
    }

    const solPrice = await getSOLPrice();

    // Directly use the SDK's pre-calculated price
    const pricePerToken = parseFloat(activeBin.pricePerToken);
    const tokenPriceUSD = pricePerToken * solPrice;

    console.log('\n💎 Accurate Pricing:');
    console.log('───────────────────');
    console.log(`1 Token = ${pricePerToken.toFixed(6)} SOL`);
    console.log(`1 Token = $${tokenPriceUSD.toFixed(4)}`);
    console.log(`SOL/USD Price: $${solPrice.toFixed(4)}`);

  } catch (error) {
    console.error('Test failed:', error);
  }
})(); 