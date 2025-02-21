import fs from 'fs/promises';
import path from 'path';
import { PublicKey } from '@solana/web3.js';

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

export class OrderStorage {
  private filePath: string;

  constructor() {
    this.filePath = path.join(__dirname, 'data', 'orders-mainnet.json');
    this.initializeStorage();
  }

  private async initializeStorage() {
    try {
      await fs.access(this.filePath);
    } catch {
      await fs.writeFile(this.filePath, '{}', 'utf-8');
    }
  }

  public async addOrder(order: StoredOrder): Promise<void> {
    const orders = await this.loadOrders();
    orders[order.orderId] = order;
    await this.saveOrders(orders);
  }

  public async deleteOrder(orderId: string): Promise<void> {
    const orders = await this.loadOrders();
    delete orders[orderId];
    await this.saveOrders(orders);
  }

  public async getActiveOrders(): Promise<Record<string, StoredOrder>> {
    return this.loadOrders();
  }

  private async loadOrders(): Promise<Record<string, StoredOrder>> {
    const data = await fs.readFile(this.filePath, 'utf-8');
    return JSON.parse(data);
  }

  private async saveOrders(orders: Record<string, StoredOrder>): Promise<void> {
    await fs.writeFile(this.filePath, JSON.stringify(orders, null, 2), 'utf-8');
  }
} 