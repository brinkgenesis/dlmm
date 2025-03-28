this is from our backend API server

interface MarketData {
  // Basic identification
  id: string;               // Market's public key
  address: string;          // Same as id (pool address)
  name: string;             // Human-readable name (e.g., "SOL-USDC")
  risk: string;             // Risk level: "Low", "Medium", "High"
  
  // Fee structure
  fee: string;                      // Legacy fee format with % symbol
  baseFeePercentage: string;        // Base fee percentage
  maxFeePercentage: string;         // Maximum fee percentage
  protocolFeePercentage: string;    // Protocol fee percentage
  
  // Performance metrics
  dailyAPR: number;                 // Daily APR (%)
  apy: number;                      // Annual percentage yield
  tvl: number;                      // Total value locked
  volumeTvlRatio: number;           // Volume to TVL ratio
  volume24h: number;                // 24-hour trading volume
  fees24h: number;                  // 24-hour fees earned
  
  // Technical details
  binStep: number;                  // Bin step size
  currentPrice: number;             // Current price
  isBlacklisted: boolean;           // Whether market is blacklisted
  
  // Token information
  tokenXMint: string;               // Token X mint address
  tokenYMint: string;               // Token Y mint address
  tokenXSymbol: string;             // Token X symbol (e.g., "SOL")
  tokenYSymbol: string;             // Token Y symbol (e.g., "USDC") 
  tokenXLogo: string;               // Token X logo URL
  tokenYLogo: string;               // Token Y logo URL
  
  // Reserve information
  reserveX: string;                 // Reserve X address
  reserveY: string;                 // Reserve Y address
  reserveXAmount: number;           // Reserve X amount
  reserveYAmount: number;           // Reserve Y amount
  
  // Historical data
  cumulativeTradeVolume: string;    // Total trade volume
  cumulativeFeeVolume: string;      // Total fee volume
  
  // Time-based metrics
  feesByTimeframe: {                // Fees by timeframe
    min_30: number;
    hour_1: number;
    hour_2: number;
    hour_4: number;
    hour_12: number;
    hour_24: number;
  };
  volumeByTimeframe: {              // Volume by timeframe
    min_30: number;
    hour_1: number;
    hour_2: number;
    hour_4: number;
    hour_12: number;
    hour_24: number;
  };
  feeVolumeRatios: {                // Fee/volume ratios by timeframe
    min_30: number;
    hour_1: number;
    hour_2: number;
    hour_4: number;
    hour_12: number;
    hour_24: number;
  };
  
  // Metadata
  tags: string[];                   // Market tags
  lastUpdated: string;              // Last updated timestamp
}


endpoints

GET /api/markets

GET /api/markets/filtered?minLiquidity=30000&minApr=5&minVolume=100000&minFeeTvlRatio=5&limit=25

GET /api/markets/refresh?sortKey=feetvlratio&orderBy=desc&hideLowTvl=30000&hideLowApr=true&limit=25

POST /api/markets/select