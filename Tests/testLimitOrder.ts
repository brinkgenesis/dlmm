async function createLimitOrder() {
  try {
    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        poolAddress: 'Fg6Pa...', // Valid public key
        orderType: 'LIMIT',
        triggerPrice: 150.50,
        sizeUSD: 1000,
        side: 'X'
      })
    });
    
    if (!response.ok) throw new Error('API error');
    const { orderId } = await response.json();
    console.log('Order created:', orderId);
  } catch (error) {
    console.error('Order failed:', error.message);
  }
}
