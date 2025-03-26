import fs from 'fs/promises';
import path from 'path';
import { PublicKey } from '@solana/web3.js';
import { OrderRepository } from '../services/orderRepository';

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
  private orderRepository: OrderRepository;
  private supabaseEnabled: boolean = true;

  constructor() {
    this.filePath = path.join(__dirname, 'data', 'orders-mainnet.json');
    this.orderRepository = new OrderRepository();
    console.log('OrderStorage initialized at:', this.filePath);
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
    console.log('Saving order:', order.orderId);
    await this.saveOrders(orders);
    
    // Also save to Supabase if enabled
    if (this.supabaseEnabled) {
      try {
        // Use a default userId since auth is not required yet
        await this.orderRepository.submitOrder('default-user', {
          poolAddress: order.poolAddress,
          orderType: order.config.orderType,
          triggerPrice: order.config.triggerPrice,
          sizeUSD: order.config.orderSize,
          closeBps: order.config.closeBps,
          side: order.config.side
        });
      } catch (error) {
        console.error('Error saving order to Supabase:', error);
        // Continue with normal operation
      }
    }
  }

  public async deleteOrder(orderId: string): Promise<void> {
    const orders = await this.loadOrders();
    if (orders[orderId]) {
      console.log('Deleting order:', orderId);
      delete orders[orderId];
      await this.saveOrders(orders);
    }
  }

  public async getActiveOrders(): Promise<Record<string, StoredOrder>> {
    return this.loadOrders();
  }

  private async loadOrders(): Promise<Record<string, StoredOrder>> {
    try {
      const data = await fs.readFile(this.filePath, 'utf-8');
      console.log('Loaded orders from:', this.filePath);
      return JSON.parse(data);
    } catch (error) {
      console.error('Error loading orders:', error);
      return {};
    }
  }

  private async saveOrders(orders: Record<string, StoredOrder>): Promise<void> {
    try {
      await fs.writeFile(this.filePath, JSON.stringify(orders, null, 2), 'utf-8');
      console.log('Successfully saved orders to:', this.filePath);
    } catch (error) {
      console.error('Failed to save orders:', error);
      throw new Error('Failed to persist orders to storage');
    }
  }
} 