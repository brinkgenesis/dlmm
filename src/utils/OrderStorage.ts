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
  positionKey?: string; // Optional field for linking TP/SL orders to specific positions
}

export class OrderStorage {
  private orderRepository: OrderRepository;
  private defaultUserId: string = 'default-user'; // Using a default user until auth is implemented

  constructor() {
    this.orderRepository = new OrderRepository();
    console.log('OrderStorage initialized with Supabase repository');
  }

  public async addOrder(order: StoredOrder): Promise<void> {
    try {
      await this.orderRepository.submitOrder(
        this.defaultUserId,
        {
          poolAddress: order.poolAddress,
          orderType: order.config.orderType,
          triggerPrice: order.config.triggerPrice,
          sizeUSD: order.config.orderSize,
          closeBps: order.config.closeBps,
          side: order.config.side,
          positionKey: order.positionKey // Pass through positionKey if defined
        }
      );
      console.log(`Order ${order.orderId} saved to Supabase`);
    } catch (error) {
      console.error('Error saving order to Supabase:', error);
      throw new Error('Failed to save order to database');
    }
  }

  public async deleteOrder(orderId: string): Promise<void> {
    try {
      // Instead of deleting, mark as cancelled
      await this.orderRepository.updateOrderStatus(orderId, 'CANCELLED');
      console.log(`Order ${orderId} marked as cancelled in Supabase`);
    } catch (error) {
      console.error('Error updating order status:', error);
      throw new Error('Failed to update order status');
    }
  }

  public async getActiveOrders(): Promise<Record<string, StoredOrder>> {
    try {
      // Get all pending orders
      const pendingOrders = await this.orderRepository.getPendingOrders();
      
      // Convert to StoredOrder format
      const activeOrders: Record<string, StoredOrder> = {};
      
      pendingOrders.forEach(order => {
        activeOrders[order.id] = {
          orderId: order.id,
          config: {
            orderType: order.order_type,
            triggerPrice: order.trigger_price,
            orderSize: order.size_usd,
            closeBps: order.close_bps,
            side: order.side
          },
          poolAddress: order.pool_address,
          createdAt: order.created_at,
          positionKey: order.position_key
        };
      });
      
      console.log(`Loaded ${Object.keys(activeOrders).length} active orders from Supabase`);
      return activeOrders;
    } catch (error) {
      console.error('Error loading orders from Supabase:', error);
      return {};
    }
  }
  
  public async updateOrderStatus(orderId: string, status: 'EXECUTED' | 'FAILED' | 'CANCELLED'): Promise<void> {
    try {
      await this.orderRepository.updateOrderStatus(orderId, status === 'FAILED' ? 'CANCELLED' : status);
      console.log(`Order ${orderId} status updated to ${status} in Supabase`);
    } catch (error) {
      console.error(`Error updating order ${orderId} status to ${status}:`, error);
      throw new Error('Failed to update order status');
    }
  }
} 