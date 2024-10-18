import * as dotenv from 'dotenv';
import * as fs from 'fs';
import { Keypair, Connection } from '@solana/web3.js';

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
  connection: Connection;
  wallet: Keypair;

  static load(): Config {
    dotenv.config();
    const configData = JSON.parse(fs.readFileSync('config/default.json', 'utf-8'));

    const walletPrivateKey = process.env.WALLET_PRIVATE_KEY || '';
    const wallet = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(walletPrivateKey))
    );

    const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');

    configData.meteoraApiKey = process.env.METEORA_API_KEY || '';
    configData.emailSettings.username = process.env.EMAIL_USERNAME || '';
    configData.emailSettings.password = process.env.EMAIL_PASSWORD || '';

    return Object.assign(new Config(), configData, {
      wallet,
      connection,
    });
  }
}
