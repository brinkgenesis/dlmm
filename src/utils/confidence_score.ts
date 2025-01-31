interface TokenMetrics {
  tokenAgeHours: number;
  marketCap: number;
  volumeMcapRatio: number;
  top10HolderPercentage: number;
  volatilityScore: number;
  dataAgeMinutes: number;
}

export function calculateConfidenceScore(metrics: TokenMetrics): number {
  // Weightings from strategy doc
  const WEIGHTS = {
    age: 0.2,
    mcap: 0.25,
    volumeRatio: 0.3,
    holders: 0.15,
    volatility: 0.1
  };

  // Calculate individual components with freshness decay
  const ageScore = Math.min(metrics.tokenAgeHours / 5, 1) * 
                  Math.pow(0.8, metrics.dataAgeMinutes/60);
  
  const mcapScore = (metrics.marketCap >= 10e6 && metrics.marketCap <= 100e6) ? 
                   1 : 0;
  
  const volumeRatioScore = Math.min(metrics.volumeMcapRatio / 2, 1) * 
                          Math.pow(0.9, metrics.dataAgeMinutes/60);
  
  const holderScore = Math.max(0, 1 - (metrics.top10HolderPercentage / 30)) * 
                     Math.pow(0.95, metrics.dataAgeMinutes/5);
  
  const volatilityScore = Math.min(
    Math.max(metrics.volatilityScore, 0.7), 
    1.3
  ) / 1.3;

  // Weighted sum
  const rawScore = 
    ageScore * WEIGHTS.age +
    mcapScore * WEIGHTS.mcap +
    volumeRatioScore * WEIGHTS.volumeRatio +
    holderScore * WEIGHTS.holders +
    volatilityScore * WEIGHTS.volatility;

  // Clamp to 0-1 range
  return Math.min(Math.max(rawScore, 0), 1);
}

// Temporary stub until metrics data sources are implemented
export function calculateConfidenceScoreStub(): number {
  return 1.0; // Default full confidence
}
