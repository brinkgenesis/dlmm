async function createLimitOrder() {
  try {
    const response = await fetch('http://localhost:3001/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        poolAddress: 'CopraAQegh7HohkLgYayjoRENXsf66eYaDtwFpbr8zRZ', // Valid public key
        orderType: 'LIMIT',
        triggerPrice: 9.34,
        sizeUSD: 10,
        side: 'X'
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log('Order created:', data.orderId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Order failed:', message);
  }
}

// Execute the test
(async () => {
  await createLimitOrder();
})();
