import { DEFAULT_MAX_HISTORY_LENGTH } from '../constants';

export class VolatilityCalculator {
  private priceHistory: number[] = [];
  private maxHistoryLength: number;

  constructor(maxHistoryLength: number = DEFAULT_MAX_HISTORY_LENGTH) {
    this.maxHistoryLength = maxHistoryLength;
  }

  addPrice(price: number): void {
    this.priceHistory.push(price);
    if (this.priceHistory.length > this.maxHistoryLength) {
      this.priceHistory.shift();
    }
  }

  calculateVolatility(): number {
    if (this.priceHistory.length < 2) return 0;
    const returns = this.priceHistory.slice(1).map((price, idx) =>
      Math.log(price / this.priceHistory[idx])
    );
    const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const squaredDiffs = returns.map(r => Math.pow(r - meanReturn, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / (returns.length - 1);
    return Math.sqrt(variance) * Math.sqrt(returns.length);
  }
}
