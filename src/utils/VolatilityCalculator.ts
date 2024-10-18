import DLMM from '@meteora-ag/dlmm';

export class VolatilityCalculator {
  private dlmm: DLMM;

  constructor(dlmm: DLMM) {
    this.dlmm = dlmm;
  }

  async getVolatility(): Promise<number> {
    const volatilityData = await this.dlmm.getVolatilityData();
    // Process and return the volatility value
    return volatilityData.volatility;
  }
}
