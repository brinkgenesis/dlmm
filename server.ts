import express from 'express';
import bodyParser from 'body-parser';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { TradingApp } from './src/app';
import  limiter  from 'express-rate-limit';

// Initialize core components
const connection = new Connection(process.env.RPC_URL!);
const wallet = Keypair.fromSecretKey(
  Buffer.from(process.env.WALLET_SECRET!.split(',').map(Number))
);
const tradingApp = new TradingApp(connection, wallet);

// Express setup
const app = express();
app.use(bodyParser.json());

// API Endpoints
app.post('/api/orders', async (req, res) => {
  try {
    const { poolAddress, ...orderConfig } = req.body;
    const orderId = await tradingApp.submitOrder(
      new PublicKey(poolAddress),
      orderConfig
    );
    res.json({ success: true, orderId });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/config', async (req, res) => {
  const { autoClaim, autoCompound } = req.body;
  await tradingApp.toggleAutoClaim(autoClaim);
  await tradingApp.toggleAutoCompound(autoCompound);
  res.json({ success: true });
});

// Example using express-rate-limit
app.use('/api/orders', limiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // Limit each IP to 100 orders per window
}));

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  tradingApp.initialize();
}); 