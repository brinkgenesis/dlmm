import { LiquidityManager } from './services/LiquidityManager';
import { MarketMonitor } from './services/MarketMonitor';
import { NotificationService } from './services/NotificationService';
import { ReportingService } from './services/ReportingService';
import { Config } from './models/Config';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
  try {
    const config = Config.load();
    const notificationService = new NotificationService(config);
    const reportingService = new ReportingService(config);
    const liquidityManager = new LiquidityManager(config, reportingService);
    const marketMonitor = new MarketMonitor(config);

    marketMonitor.on('volatilityChange', async (volatility: number) => {
      await liquidityManager.adjustLiquidity(volatility);
    });

    marketMonitor.on('priceUpdate', async (price: number) => {
      reportingService.updatePrice(price);
    });

    await marketMonitor.startMonitoring();
  } catch (error) {
    console.error('Unhandled error in main:', error);
  }
}

main();
