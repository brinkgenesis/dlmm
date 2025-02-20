import { FetchPrice } from './fetch_price';

export async function getSOLPrice(): Promise<number> {
  const SOL_FEED_ID = process.env.SOL_Price_ID || '0xef0d5b6f4312f347d4789b7093e2b2587ccd7a6369d8493a21ab88d6a0a1ffb5';
  const priceStr = await FetchPrice(SOL_FEED_ID);
  const price = parseFloat(priceStr);
  
  if (isNaN(price)) {
    throw new Error(`Invalid SOL price: ${priceStr}`);
  }
  
  return price;
} 