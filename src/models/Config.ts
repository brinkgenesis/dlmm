import * as dotenv from 'dotenv';
import * as fs from 'fs';

export interface StrategyConfig {
  name: string;
  params: any;
}

export class Config {
  meteoraApiKey: string;
  walletPrivateKey: string;
  volatilityThreshold: number;
  strategies: StrategyConfig[];
  emailSettings: {
    username: string;
    password: string;
    recipients: string[];
  };

  static load(): Config {
    dotenv.config();
    const configData = JSON.parse(fs.readFileSync('config/default.json', 'utf-8'));
    configData.meteoraApiKey = process.env.METEORA_API_KEY || '';
    configData.walletPrivateKey = process.env.WALLET_PRIVATE_KEY || '';
    configData.emailSettings.username = process.env.EMAIL_USERNAME || '';
    configData.emailSettings.password = process.env.EMAIL_PASSWORD || '';
    return Object.assign(new Config(), configData);
  }
}
