import { BaseStrategy } from './BaseStrategy';
import { ApiClient } from '../utils/ApiClient';

export class CurveStrategy extends BaseStrategy {
  private apiClient: ApiClient;

  constructor(params: any) {
    super(params);
    this.apiClient = new ApiClient(params.apiKey);
  }

  async execute(): Promise<void> {
    // Logic to concentrate liquidity around the current price
    try {
      console.log('Executing Curve Strategy');
      // Use Meteora SDK to add liquidity
      await this.apiClient.initializePositionAndAddLiquidityByStrategy({
        strategy: 'Curve',
        params: this.params
      });
    } catch (error) {
      console.error('Curve Strategy execution failed:', error);
    }
  }
}
