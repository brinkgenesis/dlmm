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
import cors from 'cors'; // Add this import
import { Config } from './src/models/Config';
import { OrderRepository } from './src/services/orderRepository';
import { MarketRepository } from './src/services/marketRepository';
import { SelectionIndexer } from './src/SelectionIndexer';
dotenv.config();

// Initialize core components
const connection = new Connection(process.env.SOLANA_RPC!);
const wallet = Keypair.fromSecretKey(
  bs58.decode(process.env.PRIVATE_KEY!)
);
const config = Config.loadSync();
const tradingApp = new TradingApp(connection, wallet, config);
const orderRepository = new OrderRepository();
const marketRepository = new MarketRepository();

// Express setup
const app = express();
app.use(bodyParser.json());

// Add CORS configuration
app.use(cors({
  origin: function(origin, callback) {
    const allowedOrigins = ['http://localhost:8080', 'http://localhost:3000','http://localhost:3001'];
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Set up rate limiting
app.use('/api/orders', limiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // Limit each IP to 100 orders per window
}));

// Order Endpoints
app.post('/api/orders', async (req, res) => {
  try {
    // Use default user ID since auth is not required yet
    const userId = 'default-user'; // This replaces req.user.id
    
    const { poolAddress, ...orderConfig } = req.body;
    
    // Store in Supabase
    const orderId = await orderRepository.submitOrder(
      userId,
      {
        poolAddress,
        ...orderConfig
      }
    );
    
    // Execute the order logic through trading app
    await tradingApp.submitOrder(
      new PublicKey(poolAddress),
      orderConfig
    );
    
    // Update the order status in Supabase
    await orderRepository.updateOrderStatus(orderId, 'EXECUTED');
    
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
    const dashboard = new Dashboard(
      tradingApp.getConfig(), 
      tradingApp.getPositionStorage()
    );
    const summary = await dashboard.getPositionsSummary();
    
    // Return JSON response with position data including age information
    res.json({
      success: true,
      data: {
        totalPositions: summary.totalPositions,
        inRange: summary.inRange,
        outOfRange: summary.outOfRange,
        nearEdge: summary.nearEdge,
        totalValue: summary.totalValue,
        totalChangeValue: summary.totalChangeValue,
        totalPendingFees: summary.totalPendingFees,
        walletValue: summary.walletValue,
        totalCapital: summary.totalCapital,
        liquidityAllocated: (summary.totalValue / summary.totalCapital) * 100,
        positions: summary.positions.map(position => ({
          ...position,
          // Keep existing fields
          publicKey: position.publicKey,
          minBinId: position.minBinId,
          maxBinId: position.maxBinId,
          currentPrice: position.currentPrice,       
          currentPriceUSD: position.currentPriceUSD,
          
          // Fee data - combining both pending and claimed fees
          // Pending fees (current unclaimed fees)
          pendingFeesUSD: position.pendingFeesUSD,
          pendingFeeX: position.pendingFeeX,
          pendingFeeY: position.pendingFeeY,
          feeXValuePending: position.feeXValuePending,
          feeYValuePending: position.feeYValuePending,
          feeXAmount: position.feeXAmount,
          feeYAmount: position.feeYAmount,
          
          // Claimed fees (historical claimed fees from Meteora API)
          totalClaimedFeeX: position.totalClaimedFeeX,
          totalClaimedFeeY: position.totalClaimedFeeY,
          totalFeeUsdClaimed: position.totalFeeUsdClaimed,
          
          // APR and value data
          dailyAPR: position.dailyAPR,
          startingPositionValue: position.startingPositionValue,
          currentValue: position.currentValue,
          
          // Token identification fields
          tokenXSymbol: position.tokenXSymbol,
          tokenYSymbol: position.tokenYSymbol,
          tokenXMint: position.tokenXMint,
          tokenYMint: position.tokenYMint, 
          tokenXLogo: position.tokenXLogo,
          tokenYLogo: position.tokenYLogo,
          tokenXAmount: position.tokenXAmount,
          tokenYAmount: position.tokenYAmount,
          tokenXValue: position.tokenXValue,
          tokenYValue: position.tokenYValue,
          
          // Pool and status information
          poolAddress: position.poolAddress,
          status: position.status,
          percentageThroughRange: position.percentageThroughRange,
          currentActiveBin: position.currentActiveBin,
          baseFeeRate: position.baseFeeRate,
          
          // Add per-position liquidity allocation
          liquidityAllocation: summary.totalValue > 0 
            ? ((position.currentValue ?? 0) / summary.totalValue) * 100 
            : 0,
            
          // Include both raw and formatted age data
          originalStartDate: position.originalStartDate || null,
          positionAge: position.positionAge || 0,
          positionAgeFormatted: position.positionAgeFormatted || 'New position',
          rebalanceCount: position.rebalanceCount || 0,
          lastUpdated: position.lastUpdated
        }))
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
    
    // Calculate liquidity allocation percentage
    const liquidityAllocated = (summary.totalValue / summary.totalCapital) * 100;
    
    // Return just the summary without positions
    const { positions, ...summaryStats } = summary;
    
    res.json({
      success: true,
      data: {
        ...summaryStats,
        liquidityAllocated,
        totalPendingFees: summary.totalPendingFees
      }
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
    const marketRepository = new MarketRepository();
    
    // You can keep the marketSelector for wallet info
    const marketSelector = tradingApp.getMarketSelector();
    const walletInfo = await marketSelector.getWalletInfo();
    
    // NEW: Run the SelectionIndexer to ensure token metadata is populated
    console.log('Running SelectionIndexer to ensure token metadata is available...');
    const indexer = new SelectionIndexer();
    await indexer.processOnlyMissingTokenData();
    
    // Get markets from database (already filtered for better performance)
    const marketsData = await marketRepository.getFilteredMarkets({ 
      minLiquidity: 10000,
      limit: 25 
    });
    
    const markets = marketsData.map(market => ({
      // Basic identification
      id: market.public_key,
      address: market.address,
      name: market.name,
      risk: market.risk || 'Unknown',
      
      // Fee structure
      fee: market.base_fee || market.base_fee_percentage + '%',
      baseFeePercentage: market.base_fee_percentage,
      maxFeePercentage: market.max_fee_percentage,
      protocolFeePercentage: market.protocol_fee_percentage,
      
      // Performance metrics
      dailyAPR: market.apr,
      apy: market.apy,
      tvl: parseFloat(market.liquidity),
      volumeTvlRatio: market.volume_tvl_ratio,
      volume24h: market.trade_volume_24h,
      fees24h: market.fees_24h,
      
      // Technical details
      binStep: market.bin_step,
      currentPrice: market.current_price,
      isBlacklisted: market.is_blacklisted || false,
      
      // Token information
      tokenXMint: market.token_x_mint || market.mint_x,
      tokenYMint: market.token_y_mint || market.mint_y,
      tokenXSymbol: market.token_x_symbol,
      tokenYSymbol: market.token_y_symbol,
      tokenXLogo: market.token_x_logo,
      tokenYLogo: market.token_y_logo,
      
      // Reserve information
      reserveX: market.reserve_x,
      reserveY: market.reserve_y,
      reserveXAmount: market.reserve_x_amount,
      reserveYAmount: market.reserve_y_amount,
      
      // Historical data
      cumulativeTradeVolume: market.cumulative_trade_volume,
      cumulativeFeeVolume: market.cumulative_fee_volume,
      
      // Time-based metrics
      feesByTimeframe: market.fees_by_timeframe,
      volumeByTimeframe: market.volume_by_timeframe,
      feeVolumeRatios: market.fee_volume_ratios,
      
      // Metadata
      tags: market.tags || [],
      lastUpdated: market.last_updated,
      
      // Add token age info
      tokenXCreatedAt: market.token_x_created_at,
      tokenYCreatedAt: market.token_y_created_at,
      tokensOldEnough: market.tokens_old_enough,
      
      // Calculate token age in days for display
      tokenXAgeDays: market.token_x_created_at ? 
        Math.floor((Date.now() - new Date(market.token_x_created_at).getTime()) / (1000 * 60 * 60 * 24)) : 
        null,
      tokenYAgeDays: market.token_y_created_at ? 
        Math.floor((Date.now() - new Date(market.token_y_created_at).getTime()) / (1000 * 60 * 60 * 24)) : 
        null,
    }));
    
    // Include wallet information in the response
    res.json({ 
      success: true, 
      markets,
      wallet: {
        solBalance: walletInfo.solBalance,
        solValue: walletInfo.solValue
      }
    });
  } catch (error) {
    console.error('Error fetching markets:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch markets' });
  }
});

app.post('/api/markets/select', async (req, res) => {
  try {
    const { poolAddress, singleSidedX, dollarAmount } = req.body;
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
    
    // Pass the dollarAmount parameter to createPositionInSelectedMarket
    // If not provided, it will use the default value in the method
    await marketSelector.createPositionInSelectedMarket(
      dlmm, 
      chosenMarket, 
      singleSidedX === undefined ? true : singleSidedX,
      dollarAmount // Pass the user-specified dollar amount
    );
    
    res.json({ 
      success: true, 
      message: `Position created successfully in ${chosenMarket.name}`,
      market: chosenMarket.name,
      side: singleSidedX ? 'Token X' : 'Token Y',
      amount: `$${dollarAmount || chosenMarket.defaultDollarAmount || 1}`
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

// Add this endpoint for manual rebalance checks
app.get('/api/rebalance/check', async (req, res) => {
  try {
    console.log("Manual rebalance check triggered from API");
    await tradingApp.triggerRebalanceCheck();
    res.json({ 
      success: true, 
      message: "Rebalance check completed. Check server logs for details."
    });
  } catch (error) {
    console.error("Error during manual rebalance check:", error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

// Market fetching endpoint
app.get('/api/markets/refresh', async (req, res) => {
  try {
    // Get optional query parameters and map them correctly
    const sortKey = req.query.sortKey as string;
    const orderBy = req.query.orderBy as string;
    const hideLowTvl = req.query.hideLowTvl ? parseInt(req.query.hideLowTvl as string) : 30000;
    const hideLowApr = req.query.hideLowApr === 'true';
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 25;
    
    console.log(`Starting market refresh with parameters: 
      sortKey: ${sortKey || 'default'}
      orderBy: ${orderBy || 'default'}
      hideLowTvl: ${hideLowTvl}
      hideLowApr: ${hideLowApr}
      limit: ${limit}
    `);
    
    // Fetch and sync markets from Meteora API
    const marketRepository = new MarketRepository();
    const pairs = await marketRepository.fetchAndSyncMeteoraPairs({
      sortKey: sortKey as any,
      orderBy: orderBy as any,
      hideLowTvl,
      hideLowApr,
      limit
    });
    
    // CHANGE HERE: Use processOnlyMissingTokenData instead of processMarkets
    console.log('Running SelectionIndexer to populate missing token metadata in database...');
    const indexer = new SelectionIndexer();
    await indexer.processOnlyMissingTokenData();
    
    res.json({ 
      success: true, 
      message: `Markets refreshed successfully. Synced ${pairs.length} pairs.` 
    });
  } catch (error) {
    console.error('Error refreshing markets:', error);
    
    // Send more detailed error message
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      stack: process.env.NODE_ENV === 'development' && error instanceof Error ? error.stack : undefined
    });
  }
});

// Enhanced markets endpoint with filtering
app.get('/api/markets/filtered', async (req, res) => {
  try {
    // Get filter parameters
    const minLiquidity = req.query.minLiquidity ? parseFloat(req.query.minLiquidity as string) : undefined;
    const minVolume = req.query.minVolume ? parseFloat(req.query.minVolume as string) : undefined;
    const minApr = req.query.minApr ? parseFloat(req.query.minApr as string) : undefined;
    const minFeeTvlRatio = req.query.minFeeTvlRatio ? parseFloat(req.query.minFeeTvlRatio as string) : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 25;
    
    // NEW: Run the SelectionIndexer to ensure token metadata is populated
    console.log('Running SelectionIndexer to ensure token metadata is available...');
    const indexer = new SelectionIndexer();
    await indexer.processOnlyMissingTokenData();
    
    // Get filtered markets
    const markets = await marketRepository.getFilteredMarkets({
      minLiquidity,
      minVolume,
      minApr,
      minFeeTvlRatio,
      limit
    });
    
    res.json({ 
      success: true, 
      markets: markets.map(market => ({
        // Basic identification
        id: market.public_key,
        address: market.address,
        name: market.name,
        risk: market.risk || 'Unknown',
        
        // Fee structure
        fee: market.base_fee || market.base_fee_percentage + '%',
        baseFeePercentage: market.base_fee_percentage,
        maxFeePercentage: market.max_fee_percentage,
        protocolFeePercentage: market.protocol_fee_percentage,
        
        // Performance metrics
        dailyAPR: market.apr,
        apy: market.apy,
        tvl: parseFloat(market.liquidity),
        volumeTvlRatio: market.volume_tvl_ratio,
        volume24h: market.trade_volume_24h,
        fees24h: market.fees_24h,
        
        // Technical details
        binStep: market.bin_step,
        currentPrice: market.current_price,
        isBlacklisted: market.is_blacklisted || false,
        
        // Token information
        tokenXMint: market.token_x_mint || market.mint_x,
        tokenYMint: market.token_y_mint || market.mint_y,
        tokenXSymbol: market.token_x_symbol,
        tokenYSymbol: market.token_y_symbol,
        tokenXLogo: market.token_x_logo,
        tokenYLogo: market.token_y_logo,
        
        // Reserve information
        reserveX: market.reserve_x,
        reserveY: market.reserve_y,
        reserveXAmount: market.reserve_x_amount,
        reserveYAmount: market.reserve_y_amount,
        
        // Historical data
        cumulativeTradeVolume: market.cumulative_trade_volume,
        cumulativeFeeVolume: market.cumulative_fee_volume,
        
        // Time-based metrics
        feesByTimeframe: market.fees_by_timeframe,
        volumeByTimeframe: market.volume_by_timeframe,
        feeVolumeRatios: market.fee_volume_ratios,
        
        // Metadata
        tags: market.tags || [],
        lastUpdated: market.last_updated,
        
        // Add token age info
        tokenXCreatedAt: market.token_x_created_at,
        tokenYCreatedAt: market.token_y_created_at,
        tokensOldEnough: market.tokens_old_enough,
        
        // Calculate token age in days for display
        tokenXAgeDays: market.token_x_created_at ? 
          Math.floor((Date.now() - new Date(market.token_x_created_at).getTime()) / (1000 * 60 * 60 * 24)) : 
          null,
        tokenYAgeDays: market.token_y_created_at ? 
          Math.floor((Date.now() - new Date(market.token_y_created_at).getTime()) / (1000 * 60 * 60 * 24)) : 
          null,
      }))
    });
  } catch (error) {
    console.error('Error fetching filtered markets:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch markets' });
  }
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await tradingApp.initialize();
  console.log("TradingApp fully initialized and ready to handle requests");

  // Schedule market refresh every hour
  setInterval(async () => {
    try {
      const marketRepository = new MarketRepository();
      await marketRepository.fetchAndSyncMeteoraPairs();
      console.log('Markets refreshed in background job');
    } catch (error) {
      console.error('Error in background market refresh:', error);
    }
  }, 60 * 60 * 1000); // 1 hour
}); 
