import { EventEmitter } from 'events';
import { VolatilityCalculator } from '../utils/VolatilityCalculator';
import { Config } from '../models/Config';
import axios from 'axios';
import { VOLATILITY_CHECK_INTERVAL, PRICE_FEED_URL } from '../constants';

export class MarketMonitor extends EventEmitter {
  private config: Config;
  private volatilityCalculator: VolatilityCalculator;

  constructor(config: Config) {
    super();
    this.config = config;
    this.volatilityCalculator = new VolatilityCalculator();
  }

  async startMonitoring() {
    setInterval(async () => {
      try {
        const price = await this.fetchCurrentPrice();
        this.volatilityCalculator.addPrice(price);
        this.emit('priceUpdate', price);
        const volatility = this.volatilityCalculator.calculateVolatility();
        this.emit('volatilityChange', volatility);
      } catch (error) {
        console.error('Error in market monitoring:', error);
      }
    }, VOLATILITY_CHECK_INTERVAL);
  }

  private async fetchCurrentPrice(): Promise<number> {
    const response = await axios.get(PRICE_FEED_URL);
    return response.data.price;
  }
}
