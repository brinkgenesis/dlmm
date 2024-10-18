export interface Position {
  tokenPair: string;
  liquidityAmount: number;
  strategyName: string;
  entryPrice: number;
  volatilityAtEntry: number;
  timestamp: Date;
}
