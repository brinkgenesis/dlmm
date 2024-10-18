import { BaseStrategy } from './BaseStrategy';
import { ApiClient } from '../utils/ApiClient';

export class BidAskStrategy extends BaseStrategy {
  private apiClient: ApiClient;

  constructor(params: any) {
    super(params);
    this.apiClient = new ApiClient(params.apiKey);
  }

  async execute(): Promise<void> {
    // Logic to allocate liquidity at both ends of the price range
    try {
      console.log('Executing Bid-Ask Strategy');
      // Use Meteora SDK to add liquidity
      await this.apiClient.initializePositionAndAddLiquidityByStrategy({
        strategy: 'BidAsk',
        params: this.params
      });
    } catch (error) {
      console.error('Bid-Ask Strategy execution failed:', error);
    }
  }
}
