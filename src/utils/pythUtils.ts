import { Connection, PublicKey } from '@solana/web3.js';
import { PriceFeed } from '@pythnetwork/price-service-client';
import { parseProductData } from '@pythnetwork/client';

const PYTH_MAPPING_ACCOUNT = new PublicKey(
  'AHtgzX45WTKfkPG53L6WYhGEXwQkN1BVknET3sVsLL8J'
);

export async function getFeedIdForMint(
  mint: string,
  connection: Connection
): Promise<string | null> {
  try {
    // Derive Pyth product address from mint
    const productAddress = PublicKey.findProgramAddressSync(
      [Buffer.from(mint, 'utf-8')],
      PYTH_MAPPING_ACCOUNT
    )[0];

    const productAccount = await connection.getAccountInfo(productAddress);
    
    if (!productAccount) {
      console.error('No Pyth product account found for mint:', mint);
      return null;
    }

    // Parse product data to get price feed ID
    const parsedData = parseProductData(productAccount.data);
    if (!parsedData.priceAccountKey) {
      console.error('No price account linked to product for mint:', mint);
      return null;
    }
    return parsedData.priceAccountKey.toString();
  } catch (error) {
    console.error(`Failed to find Pyth feed for ${mint}:`, error);
    return null;
  }
} 