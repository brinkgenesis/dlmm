interface TokenData {
  pairCreatedAt: number;
  marketCap: number;
  volume24h: number;
  liquidity: number;
  fdv: number;
  priceUSD: number;
  timestamp: number;
}

interface TokenMetrics {
  tokenAgeHours: number;
  marketCap: number;
  volumeMcapRatio: number;
  top10HolderPercentage: number; // Placeholder until chain analysis
  volatilityScore: number;       // Placeholder until volatility data
  dataAgeMinutes: number;
}

export async function fetchTokenMetrics(
  chainId: string,
  tokenAddress: string
): Promise<TokenMetrics> {
  const DEXSCREENER_API = 'https://api.dexscreener.com/tokens/v1';
  
  try {
    const response = await fetch(
      `${DEXSCREENER_API}/${chainId}/${tokenAddress}`
    );
    
    if (!response.ok) throw new Error(`API Error: ${response.statusText}`);
    
    const data = await response.json();
    const tokenData = parseTokenData(data);
    
    return convertToTokenMetrics(tokenData);
    
  } catch (error) {
    console.error('Failed to fetch token metrics:', error);
    throw new Error('Token data unavailable');
  }
}

// Helper function to parse API response
function parseTokenData(apiData: any): TokenData {
  const pair = apiData?.pairs?.[0];
  if (!pair) throw new Error('No pair data available');

  return {
    pairCreatedAt: pair.pairCreatedAt || Date.now(),
    marketCap: pair.marketCap || 0,
    volume24h: pair.volume?.h24 || 0,
    liquidity: pair.liquidity?.usd || 0,
    fdv: pair.fdv || 0,
    priceUSD: parseFloat(pair.priceUsd) || 0,
    timestamp: Date.now()
  };
}

// Convert raw data to our metrics format
function convertToTokenMetrics(data: TokenData): TokenMetrics {
  const currentTime = Date.now();
  const ageHours = (currentTime - data.pairCreatedAt) / (1000 * 60 * 60);
  
  return {
    tokenAgeHours: ageHours,
    marketCap: data.marketCap,
    volumeMcapRatio: data.marketCap > 0 
      ? data.volume24h / data.marketCap
      : 0,
    top10HolderPercentage: 0, // Requires blockchain analysis
    volatilityScore: 1.0,      // Placeholder for volatility data
    dataAgeMinutes: (currentTime - data.timestamp) / (1000 * 60)
  };
}
