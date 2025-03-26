import { supabase } from './supabase';

export class OrderRepository {
  async submitOrder(userId: string, orderData: {
    poolAddress: string;
    orderType: 'LIMIT' | 'TAKE_PROFIT' | 'STOP_LOSS';
    triggerPrice: number;
    sizeUSD?: number;
    closeBps?: number;
    side?: 'X' | 'Y';
  }) {
    const { data, error } = await supabase
      .from('orders')
      .insert({
        user_id: userId,
        pool_address: orderData.poolAddress,
        order_type: orderData.orderType,
        trigger_price: orderData.triggerPrice,
        size_usd: orderData.sizeUSD,
        close_bps: orderData.closeBps,
        side: orderData.side,
        status: 'PENDING'
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to submit order: ${error.message}`);
    return data.id;
  }

  async getOrderById(orderId: string) {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (error) throw new Error(`Failed to retrieve order: ${error.message}`);
    return data;
  }

  async updateOrderStatus(orderId: string, status: 'EXECUTED' | 'CANCELLED') {
    const updates = {
      status,
      ...(status === 'EXECUTED' ? { executed_at: new Date().toISOString() } : {})
    };

    const { error } = await supabase
      .from('orders')
      .update(updates)
      .eq('id', orderId);

    if (error) throw new Error(`Failed to update order: ${error.message}`);
    return true;
  }

  async getOrdersByUserId(userId: string) {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to retrieve orders: ${error.message}`);
    return data;
  }

  async getPendingOrders() {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('status', 'PENDING');

    if (error) throw new Error(`Failed to retrieve pending orders: ${error.message}`);
    return data;
  }
} 