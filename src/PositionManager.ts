import { PublicKey } from '@solana/web3.js';
import { DLMMClient } from './utils/DLMMClient';
import { Config } from './models/Config';
import BN from 'bn.js';
import { PositionStorage } from './utils/PositionStorage';
import { StrategyType, StrategyParameters } from '@meteora-ag/dlmm';
import Decimal from 'decimal.js';

/**
 * PositionManager is responsible for managing liquidity positions based on market conditions.
 */
export class PositionManager {
  private client: DLMMClient;
  private config: Config;
  private positionStorage: PositionStorage;

  /**
   * Constructs a new PositionManager instance.
   * @param client - An instance of DLMMClient.
   * @param config - The configuration object containing necessary settings.
   * @param positionStorage - An instance of PositionStorage.
   */
  constructor(client: DLMMClient, config: Config, positionStorage: PositionStorage) {
    this.client = client;
    this.config = config;
    this.positionStorage = positionStorage;
  }

  /**
   * Evaluates all user positions and manages liquidity based on bin range criteria.
   */
  async managePositions(): Promise<void> {
    try {
      // Retrieve all user positions
      const userPositions = await this.client.getUserPositions();

      if (userPositions.length === 0) {
        console.log('No user positions found to manage.');
        return;
      }

      console.log(`Managing ${userPositions.length} positions.`);

      for (const position of userPositions) {
        const positionPubKey: PublicKey = position.publicKey;
        const positionData = position.positionData;

        // Retrieve stored bin ranges
        const storedRange = this.positionStorage.getPositionRange(positionPubKey);

        if (!storedRange) {
          console.warn(`No stored bin range for position ${positionPubKey.toBase58()}. Skipping management.`);
          continue;
        }

        const { originalActiveBin, minBinId, maxBinId } = storedRange;

        // Determine current active bin from the latest market data
        const currentActiveBinInfo = await this.client.getActiveBin();
        const currentActiveBinId = currentActiveBinInfo.binId;

        // Optionally, you can update min and max bin ranges if needed
        // For this example, we'll keep them static based on the original active bin

        console.log(`Position: ${positionPubKey.toBase58()}`);
        console.log(`Original Active Bin: ${originalActiveBin}`);
        console.log(`Min Bin ID: ${minBinId}`);
        console.log(`Max Bin ID: ${maxBinId}`);
        console.log(`Current Active Bin: ${currentActiveBinId}`);

        // Determine if currentActiveBinId has moved sufficiently to warrant liquidity removal
        const shouldRemoveLiquidity =
          currentActiveBinId <= originalActiveBin - 6 ||
          currentActiveBinId >= originalActiveBin + 6 ||
          currentActiveBinId <= minBinId + 4 ||
          currentActiveBinId >= maxBinId - 4;

        if (shouldRemoveLiquidity) {
          console.log(`Criteria met for removing liquidity from position: ${positionPubKey.toBase58()}`);
          await this.client.removeLiquidity(positionPubKey);
          console.log(`Liquidity removal initiated for position: ${positionPubKey.toBase58()}`);

          // Remove the position from storage
          this.positionStorage.removePosition(positionPubKey);
          console.log(`Position ${positionPubKey.toBase58()} removed from storage.`);

          // Balance token amounts before re-creating the position
          await this.balanceTokenAmounts();

          // Recreate the position with updated bin ranges
          await this.createNewPosition();
        } else {
          console.log(`No action required for position: ${positionPubKey.toBase58()}`);
        }
      }
    } catch (error: any) {
      console.error('Error managing positions:', error.message || error);
    }
  }

  /**
   * Balances the token amounts to achieve a 50/50 balance before creating a new position.
   */
  private async balanceTokenAmounts(): Promise<void> {
    try {
      console.log('--- Balancing Token Amounts ---');

      // Fetch the latest token balances and convert to Decimal
      const tokenBalances = await this.client.checkTokenBalances();
      const xTokenBalance = new Decimal(tokenBalances.xTokenBalance.toString());
      const yTokenBalance = new Decimal(tokenBalances.yTokenBalance.toString());

      console.log(
        `Current Token Balances: X - ${xTokenBalance.toString()}, Y - ${yTokenBalance.toString()}`
      );

      // Fetch the latest market price of Token X in terms of Token Y
      const activeBin = await this.client.getActiveBin();
      const marketPrice = new Decimal(activeBin.price.toString());

      console.log(`Market Price of Token X in Token Y: ${marketPrice.toString()}`);

      // Normalize token balances to Token Y
      const xValueInY = xTokenBalance.mul(marketPrice);
      const yValueInY = yTokenBalance;

      console.log(`Value of Token X in Y: ${xValueInY.toString()}`);
      console.log(`Value of Token Y: ${yValueInY.toString()}`);

      // Calculate total value and target value per token
      const totalValueInY = xValueInY.add(yValueInY);
      const targetValuePerToken = totalValueInY.dividedBy(2);

      console.log(`Total Value in Y: ${totalValueInY.toString()}`);
      console.log(`Target Value per Token: ${targetValuePerToken.toString()}`);

      // Determine which token has excess value
      let differenceInY = new Decimal(0);
      let swapFromXToY = false;

      if (xValueInY.gt(yValueInY)) {
        differenceInY = xValueInY.minus(targetValuePerToken);
        swapFromXToY = true;
        console.log(`Excess in Token X: Need to swap ${differenceInY.toString()} worth from X to Y`);
      } else if (yValueInY.gt(xValueInY)) {
        differenceInY = yValueInY.minus(targetValuePerToken);
        swapFromXToY = false;
        console.log(`Excess in Token Y: Need to swap ${differenceInY.toString()} worth from Y to X`);
      } else {
        console.log('Token balances are already balanced.');
        return;
      }

      // Calculate the amount to swap in terms of the token to swap
      let amountToSwap: BN;

      if (swapFromXToY) {
        // Swap Token X to Token Y
        const amountToSwapX = differenceInY.dividedBy(marketPrice);
        amountToSwap = new BN(amountToSwapX.toFixed(0, Decimal.ROUND_DOWN));
        console.log(`Amount of Token X to Swap: ${amountToSwap.toString()}`);

        // Perform the swap
        const allowedSlippageBps = new BN(50); // e.g., 0.5% slippage
        await this.client.swapTokens(amountToSwap, false, allowedSlippageBps); // Swap X to Y
        console.log(`Swapped ${amountToSwap.toString()} of Token X to Token Y`);
      } else {
        // Swap Token Y to Token X
        amountToSwap = new BN(differenceInY.toFixed(0, Decimal.ROUND_DOWN));
        console.log(`Amount of Token Y to Swap: ${amountToSwap.toString()}`);

        // Perform the swap
        const allowedSlippageBps = new BN(50); // e.g., 0.5% slippage
        await this.client.swapTokens(amountToSwap, true, allowedSlippageBps); // Swap Y to X
        console.log(`Swapped ${amountToSwap.toString()} of Token Y to Token X`);
      }

    } catch (error: any) {
      console.error('Error balancing token amounts:', error.message || error);
      throw error;
    }
  }

  /**
   * Creates a new position with updated bin ranges based on the current active bin.
   */
  private async createNewPosition(): Promise<void> {
    try {
      console.log('--- Creating New Position ---');

      // Get the active bin
      const activeBin = await this.client.getActiveBin();
      console.log('Current Active Bin:', activeBin);

      const activeBinId = activeBin.binId;

      // Define new bin ranges
      const TOTAL_RANGE_INTERVAL = 10;
      const minBinId = activeBinId - TOTAL_RANGE_INTERVAL;
      const maxBinId = activeBinId + TOTAL_RANGE_INTERVAL;

      // Create strategy parameters
      const strategy: StrategyParameters = {
        minBinId: minBinId,
        maxBinId: maxBinId,
        strategyType: StrategyType.SpotBalanced,
        singleSidedX: false,
      };

      // Fetch updated token balances after balancing
      const tokenBalances = await this.client.checkTokenBalances();
      const totalXAmount = tokenBalances.xTokenBalance;
      const totalYAmount = tokenBalances.yTokenBalance;

      console.log(`Total X Amount for Position: ${totalXAmount.toString()}`);
      console.log(`Total Y Amount for Position: ${totalYAmount.toString()}`);

      // Create the new position, passing both totalXAmount and totalYAmount
      const positionPubKey: PublicKey = await this.client.createPosition(
        totalXAmount,
        StrategyType.SpotBalanced,
        strategy,
        totalYAmount  // Pass totalYAmount here
      );
      console.log(`New position created with Public Key: ${positionPubKey.toBase58()}`);

      // Store the new position's bin ranges
      this.positionStorage.addPosition(positionPubKey, {
        originalActiveBin: activeBinId,
        minBinId: minBinId,
        maxBinId: maxBinId,
      });
      console.log(`Stored bin ranges for new position ${positionPubKey.toBase58()}`);
    } catch (error: any) {
      console.error('Error creating new position:', error.message || error);
      throw error;
    }
  }
}
