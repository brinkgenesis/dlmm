import { Config } from '../models/Config';
import { PositionStorage } from '../utils/PositionStorage';
import { OrderStorage } from '../utils/OrderStorage';
import { PositionRepository } from '../services/positionRepository';
import { OrderRepository } from '../services/orderRepository';
import { MarketRepository } from '../services/marketRepository';
import fs from 'fs';
import path from 'path';

// Define the order interface matching your JSON structure
interface StoredOrder {
  orderId: string;
  config: {
    orderType: 'LIMIT' | 'TAKE_PROFIT' | 'STOP_LOSS';
    triggerPrice: number;
    orderSize?: number;
    closeBps?: number;
    side?: 'X' | 'Y';
  };
  poolAddress: string;
  createdAt: string;
}

async function migrate() {
  console.log('Starting migration to Supabase...');
  
  // Initialize repositories
  const positionRepo = new PositionRepository();
  const orderRepo = new OrderRepository();
  const marketRepo = new MarketRepository();
  
  // 1. Migrate positions from /data/positions.json (not config.dataDirectory)
  console.log('Migrating positions...');
  const positionsPath = path.join(process.cwd(), 'data', 'positions.json');
  
  if (fs.existsSync(positionsPath)) {
    const positionsData = JSON.parse(fs.readFileSync(positionsPath, 'utf-8'));
    await positionRepo.syncAllPositions(positionsData);
    console.log(`Migrated ${Object.keys(positionsData).length} positions`);
  } else {
    console.log(`No positions file found at ${positionsPath}`);
  }
  
  // 2. Migrate orders from src/utils/data/orders-mainnet.json
  console.log('Migrating orders...');
  const ordersPath = path.join(process.cwd(), 'src', 'utils', 'data', 'orders-mainnet.json');
  
  if (fs.existsSync(ordersPath)) {
    const ordersData = JSON.parse(fs.readFileSync(ordersPath, 'utf-8')) as Record<string, StoredOrder>;
    
    for (const [orderId, order] of Object.entries(ordersData)) {
      try {
        await orderRepo.submitOrder('default-user', {
          poolAddress: order.poolAddress,
          orderType: order.config.orderType,
          triggerPrice: order.config.triggerPrice,
          sizeUSD: order.config.orderSize,
          closeBps: order.config.closeBps,
          side: order.config.side
        });
        console.log(`Migrated order: ${orderId}`);
      } catch (error) {
        console.error(`Error migrating order ${orderId}:`, error);
      }
    }
  } else {
    console.log(`No orders file found at ${ordersPath}`);
  }
  
  // 3. Migrate markets from src/models/marketSelection.json
  console.log('Migrating markets...');
  const marketsPath = path.join(process.cwd(), 'src', 'models', 'marketSelection.json');
  
  if (fs.existsSync(marketsPath)) {
    const marketsData = JSON.parse(fs.readFileSync(marketsPath, 'utf-8'));
    await marketRepo.syncMarkets(marketsData.markets);
    console.log(`Migrated ${marketsData.markets.length} markets`);
  } else {
    console.log(`No markets file found at ${marketsPath}`);
  }
  
  console.log('Migration complete!');
}

migrate().catch(console.error);
