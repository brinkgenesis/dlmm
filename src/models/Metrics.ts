export interface Metrics {
  feesCollected: number;
  impermanentLossAvoided: number;
  totalLiquidityProvided: number;
  totalLiquidityRemoved: number;
  performanceReports: any[];
}

export class PerformanceMetrics implements Metrics {
  feesCollected = 0;
  impermanentLossAvoided = 0;
  totalLiquidityProvided = 0;
  totalLiquidityRemoved = 0;
  performanceReports: any[] = [];
}
