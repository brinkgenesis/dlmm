import express from 'express';
import bodyParser from 'body-parser';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { TradingApp } from './src/app';
import { Dashboard } from './src/dashboard';
import limiter from 'express-rate-limit';
import bs58 from 'bs58';
import * as dotenv from 'dotenv';
import crypto from 'crypto';
import nacl from 'tweetnacl';
import jwt from 'jsonwebtoken';
import { UserConfig } from './frontend/wallet/UserConfig';
import { Config } from './src/models/Config';
dotenv.config();

// Initialize core components
const connection = new Connection(process.env.SOLANA_RPC!);
const wallet = Keypair.fromSecretKey(
  bs58.decode(process.env.PRIVATE_KEY!)
);
const config = Config.loadSync();
const tradingApp = new TradingApp(connection, wallet, config);

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

// Market Selection Endpoints
app.get('/api/markets', async (req, res) => {
  try {
    const marketSelector = tradingApp.getMarketSelector();
    const markets = marketSelector.markets.map(market => ({
      id: market.publicKey, // publicKey is the pool address
      name: market.name,
      risk: market.risk || 'Unknown',
      fee: market.baseFee || 'N/A',
      dailyAPR: market.dailyAPR || 'N/A'
    }));
    
    res.json({ success: true, markets });
  } catch (error) {
    console.error('Error fetching markets:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch markets' });
  }
});

app.post('/api/markets/select', async (req, res) => {
  try {
    const { poolAddress, singleSidedX } = req.body;
    if (!poolAddress) {
      res.status(400).json({ success: false, error: 'Pool address is required' });
      return;
    }
    
    const marketSelector = tradingApp.getMarketSelector();
    
    // Find the market with the given pool address
    const chosenMarket = marketSelector.markets.find(
      market => market.publicKey === poolAddress
    );
    
    if (!chosenMarket) {
      res.status(404).json({ 
        success: false, 
        error: `Market with pool address ${poolAddress} not found`
      });
      return;
    }
    
    // Use the existing methods in sequence
    const dlmm = await marketSelector.initializeSelectedMarket(chosenMarket);
    await marketSelector.createPositionInSelectedMarket(
      dlmm, 
      chosenMarket, 
      singleSidedX === undefined ? true : singleSidedX
    );
    
    res.json({ 
      success: true, 
      message: `Position created successfully in ${chosenMarket.name}`,
      market: chosenMarket.name,
      side: singleSidedX ? 'Token X' : 'Token Y'
    });
  } catch (error) {
    console.error('Error creating position in market:', error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Wallet Connection Endpoints
const challenges: { [key: string]: string } = {};
const userTradingApps: { [key: string]: TradingApp } = {};

app.post('/api/wallet/connect', async (req, res) => {
  try {
    const { publicKey } = req.body;
    if (!publicKey) {
      res.status(400).json({ success: false, error: 'Public key is required' });
      return;
    }
    
    // Generate a random challenge for the user to sign
    const challenge = crypto.randomBytes(32).toString('hex');
    
    // Store the challenge in a session or temporary DB
    // This is a simplified version - you should use proper session management
    challenges[publicKey] = challenge;
    
    res.json({ success: true, challenge });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
    return;
  }
});

app.post('/api/wallet/verify', async (req, res) => {
  try {
    const { publicKey, signature } = req.body;
    if (!publicKey || !signature) {
      res.status(400).json({ 
        success: false, 
        error: 'Public key and signature are required' 
      });
      return;
    }
    
    // Get the challenge from session or DB
    const challenge = challenges[publicKey];
    if (!challenge) {
      res.status(400).json({ 
        success: false, 
        error: 'Challenge not found or expired' 
      });
      return;
    }
    
    // Verify the signature
    const verified = nacl.sign.detached.verify(
      new TextEncoder().encode(challenge),
      bs58.decode(signature),
      new PublicKey(publicKey).toBuffer()
    );
    
    if (!verified) {
      res.status(401).json({ success: false, error: 'Invalid signature' });
      return;
    }
    
    // Generate JWT or session token
    const token = jwt.sign({ publicKey }, process.env.JWT_SECRET!, { expiresIn: '24h' });
    
    // Delete the challenge
    delete challenges[publicKey];
    
    res.json({ success: true, token });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
    return;
  }
});

app.post('/api/wallet/delegate', async (req, res) => {
  try {
    // This endpoint would be called after the user signs a transaction in their wallet
    // to delegate authority to the bot
    const { publicKey, signature, delegation, txId } = req.body;
    
    // Input validation
    if (!publicKey || !txId) {
      res.status(400).json({ 
        success: false, 
        error: 'Missing required parameters: publicKey and txId' 
      });
      return;
    }
    
    // Verify the delegation transaction was successful
    const connection = new Connection(process.env.SOLANA_RPC!);
    try {
      const status = await connection.confirmTransaction(txId);
      
      if (status.value.err) {
        res.status(400).json({ 
          success: false, 
          error: 'Delegation transaction failed on chain',
          details: status.value.err
        });
        return;
      }
    } catch (txError) {
      res.status(400).json({ 
        success: false, 
        error: 'Failed to confirm delegation transaction',
        details: txError instanceof Error ? txError.message : String(txError)
      });
      return;
    }
    
    // Create user config and verify delegation exists
    let userConfig;
    try {
      userConfig = await UserConfig.loadForUser(publicKey);
      
      if (!userConfig.delegationActive) {
        res.status(400).json({ 
          success: false, 
          error: 'Delegation account exists but is not active',
          details: `Expiry: ${userConfig.delegationExpiry}`
        });
        return;
      }
    } catch (configError) {
      res.status(500).json({ 
        success: false, 
        error: 'Failed to load user configuration',
        details: configError instanceof Error ? configError.message : String(configError)
      });
      return;
    }
    
    // Use the server's wallet for signing delegation transactions
    const serverWallet = wallet;
    userTradingApps[publicKey] = userTradingApps[publicKey] || new TradingApp(
      connection,
      serverWallet,
      userConfig
    );
    
    // Initialize user's trading app
    try {
      await userTradingApps[publicKey].initialize();
    } catch (initError) {
      res.status(500).json({ 
        success: false, 
        error: 'Failed to initialize trading app with delegation',
        details: initError instanceof Error ? initError.message : String(initError)
      });
      return;
    }
    
    res.json({ 
      success: true, 
      message: 'Delegation successful',
      expiry: userConfig.delegationExpiry,
      delegationAddress: userConfig.delegationPDA?.toString()
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: 'Unexpected error during delegation setup',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await tradingApp.initialize();
  console.log("TradingApp fully initialized and ready to handle requests");
}); 