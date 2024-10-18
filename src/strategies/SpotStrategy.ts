import { BaseStrategy } from './BaseStrategy';
import { ApiClient } from '../utils/ApiClient';

export class SpotStrategy extends BaseStrategy {
  private apiClient: ApiClient;

  constructor(params: any) {
    super(params);
    this.apiClient = new ApiClient(params.apiKey);
  }

  async execute(): Promise<void> {
    // Logic to provide liquidity uniformly across the price range
    try {
      console.log('Executing Spot Strategy');
      // Use Meteora SDK to add liquidity
      await this.apiClient.initializePositionAndAddLiquidityByStrategy({
        strategy: 'Spot',
        params: this.params
      });
    } catch (error) {
      console.error('Spot Strategy execution failed:', error);
    }
  }
}
