import express from 'express';
import bodyParser from 'body-parser';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { TradingApp } from './src/app';
import { Dashboard } from './src/dashboard';
import limiter from 'express-rate-limit';
import bs58 from 'bs58';
import * as dotenv from 'dotenv';
dotenv.config();

// Initialize core components
const connection = new Connection(process.env.SOLANA_RPC!);
const wallet = Keypair.fromSecretKey(
  bs58.decode(process.env.PRIVATE_KEY!)
);
const tradingApp = new TradingApp(connection, wallet);

// Express setup
const app = express();
app.use(bodyParser.json());

// Set up rate limiting
app.use('/api/orders', limiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // Limit each IP to 100 orders per window
}));

// Order Endpoints
app.post('/api/orders', async (req, res) => {
  try {
    const { poolAddress, ...orderConfig } = req.body;
    const orderId = await tradingApp.submitOrder(
      new PublicKey(poolAddress),
      orderConfig
    );
    res.json({ success: true, orderId });
  } catch (error) {
    const errorMessage = error instanceof Error 
      ? error.message 
      : 'Unknown error occurred';
    res.status(400).json({ error: errorMessage });
  }
});

// Config Endpoints
app.post('/api/config', async (req, res) => {
  const { autoClaim, autoCompound } = req.body;
  await tradingApp.toggleAutoClaim(autoClaim);
  await tradingApp.toggleAutoCompound(autoCompound);
  res.json({ success: true });
});

// Dashboard Endpoints
app.get('/api/positions', async (req, res) => {
  try {
    const dashboard = new Dashboard(tradingApp.getConfig());
    const summary = await dashboard.getPositionsSummary();
    
    // Return JSON response with positions data
    res.json({
      success: true,
      data: {
        totalPositions: summary.totalPositions,
        inRange: summary.inRange,
        outOfRange: summary.outOfRange,
        nearEdge: summary.nearEdge,
        totalValue: summary.totalValue,
        totalChangeValue: summary.totalChangeValue,
        positions: summary.positions
      }
    });
  } catch (error) {
    console.error('Error fetching positions:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch positions' 
    });
  }
});

app.get('/api/positions/summary', async (_: any, res: any) => {
  try {
    const dashboard = new Dashboard(tradingApp.getConfig());
    const summary = await dashboard.getPositionsSummary();
    
    // Return just the summary without positions
    const { positions, ...summaryStats } = summary;
    
    res.json({
      success: true,
      data: summaryStats
    });
  } catch (error) {
    console.error('Error fetching position summary:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch position summary' 
    });
  }
});

// Emergency Endpoint
app.post('/api/emergency/close-all-positions', async (req, res) => {
  try {
    // Optionally add authentication check here
    const result = await tradingApp.emergencyCloseAllPositions();
    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: `Server error: ${error instanceof Error ? error.message : String(error)}` 
    });
  }
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  tradingApp.initialize();
}); 