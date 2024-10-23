import { PublicKey, Cluster } from '@solana/web3.js';
import DLMM from '@meteora-ag/dlmm';
import { Config } from '../models/Config';
import '@coral-xyz/anchor';

/**
 * DLMMClient is responsible for initializing the Meteora DLMM SDK and retrieving active bins.
 */
export class DLMMClient {
  private dlmmPool?: DLMM;
  private config: Config;

  /**
   * Constructs a new DLMMClient instance.
   * @param config - The configuration object containing necessary settings.
   */
  constructor(config: Config) {
    this.config = config;
  }

  /**
   * Initializes the DLMM SDK with a single pool.
   * @param pubkey - The public key of the DLMM pool.
   */
  async initializeDLMMPool(pubkey: PublicKey): Promise<void> {
    try {
      // Initialize DLMM Pool using Connection, API Key, and Wallet Keypair from Config
      this.dlmmPool = await DLMM.create(this.config.connection, pubkey, {
        programId: new PublicKey(this.config.publickey),
        cluster: "mainnet-beta",
      });

      console.log('DLMM SDK initialized successfully with pool:', pubkey.toBase58());
    } catch (error: any) {
      console.error('Error initializing DLMM SDK:', error.message || error);
      throw error;
    }
  }

  /**
   * Retrieves the active bin from the initialized DLMM pool.
   * @returns The active bin details.
   */
  async getActiveBin(): Promise<{ binId: number; price: string }> {
    try {
      if (!this.dlmmPool) {
        throw new Error('DLMM Pool is not initialized. Call initializeDLMMPool() first.');
      }

      const activeBin = await this.dlmmPool.getActiveBin();
      console.log('Active Bin:', activeBin);

      const activeBinPriceLamport = activeBin.price;
      const activeBinPricePerToken = this.dlmmPool.fromPricePerLamport(Number(activeBin.price));

      console.log(`Active Bin Price (Lamport): ${activeBinPriceLamport}`);
      console.log(`Active Bin Price per Token: ${activeBinPricePerToken}`);

      return {
        binId: activeBin.binId,
        price: activeBinPricePerToken.toString(),
      };
    } catch (error: any) {
      console.error('Error retrieving active bin:', error.message || error);
      throw error;
    }
  }
}

/**
 * Main execution block
 */
(async () => {
  try {
    // Load your configuration
    const config = Config.load();
    console.log('Configuration loaded successfully.');

    // Create DLMMClient instance
    const client = new DLMMClient(config);
    console.log('DLMMClient instance created.');

    // Define the DLMM pool's public key
    const poolPublicKey = new PublicKey('ARwi1S4DaiTG5DX7S4M4ZsrXqpMD1MrTmbu9ue2tpmEq'); // Replace with your actual pool public key

    // Initialize the DLMM Pool
    await client.initializeDLMMPool(poolPublicKey);
    console.log('DLMM Pool initialized.');

    // Get the active bin
    const activeBin = await client.getActiveBin();
    console.log('Active Bin:', activeBin);
  } catch (error: any) {
    console.error('Error running DLMMClient:', error.message || error);
  }
})();
