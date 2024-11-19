/**
 * RiskManager class handles the risk settings and bin parameter calculations based on user input.
 */

import readline from 'readline';
import DLMM from '@meteora-ag/dlmm';

/**
 * Represents a price spread with upper and lower percentage bounds.
 */
interface PriceSpread {
  upperPercentage: number;
  lowerPercentage: number;
}

/**
 * Enum for the different risk cases.
 */
enum RiskCase {
  High = 'High Risk (+5% / -5%)',
  Medium = 'Medium Risk (+10% / -10%)',
  Low = 'Low Risk (+15% / -15%)',
}

/**
 * RiskManager class provides methods to prompt user input and calculate bin parameters.
 */
export class RiskManager {
  /**
   * Map of risk cases to their corresponding price spreads.
   */
  private static riskCases: { [key: string]: PriceSpread } = {
    High: { upperPercentage: 0.05, lowerPercentage: 0.05 },
    Medium: { upperPercentage: 0.10, lowerPercentage: 0.10 },
    Low: { upperPercentage: 0.15, lowerPercentage: 0.15 },
  };

  /**
   * Prompts the user to select a risk case and returns the corresponding price spread.
   * @returns {Promise<PriceSpread>} The selected price spread.
   */
  public static async promptUserForRiskCase(): Promise<PriceSpread> {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const options = Object.values(RiskCase);
      console.log('\nPlease select a risk case:');
      options.forEach((option, index) => {
        console.log(`${index + 1}. ${option}`);
      });

      rl.question('\nEnter the number corresponding to your choice: ', (answer) => {
        const choice = parseInt(answer.trim(), 10);
        if (choice >= 1 && choice <= options.length) {
          const selectedRisk = options[choice - 1];
          console.log(`\nYou have selected: ${selectedRisk}\n`);
          let riskKey: keyof typeof RiskManager.riskCases;

          switch (selectedRisk) {
            case RiskCase.High:
              riskKey = 'High';
              break;
            case RiskCase.Medium:
              riskKey = 'Medium';
              break;
            case RiskCase.Low:
              riskKey = 'Low';
              break;
            default:
              riskKey = 'Medium'; // Default to Medium Risk if something goes wrong
          }

          rl.close();
          resolve(RiskManager.riskCases[riskKey]);
        } else {
          console.log('\nInvalid choice. Please run the program again.\n');
          rl.close();
          process.exit(1);
        }
      });
    });
  }

  /**
   * Calculates the bin parameters based on the current price and selected price spread.
   * @param currentPrice The current price of the token pair.
   * @param priceSpread The selected price spread.
   * @returns An object containing the lower and upper bin prices.
   */
  public static calculateBinParameters(
    currentPrice: number,
    priceSpread: PriceSpread
  ): { lowerPrice: number; upperPrice: number } {
    const lowerPrice = currentPrice * (1 - priceSpread.lowerPercentage);
    const upperPrice = currentPrice * (1 + priceSpread.upperPercentage);

    return { lowerPrice, upperPrice };
  }

  /**
   * Calculates the bin IDs based on the price range and DLMM parameters.
   * @param lowerPrice The lower bound price.
   * @param upperPrice The upper bound price.
   * @param binStep The bin step of the LP pair.
   * @returns An object containing the lower and upper bin IDs.
   */
  public static calculateBinIds(
    lowerPrice: number,
    upperPrice: number,
    binStep: number
  ): { lowerBinId: number; upperBinId: number } {
    // Calculate bin IDs
    const lowerBinId = DLMM.getBinIdFromPrice(lowerPrice, binStep, true);  // Rounds down
    const upperBinId = DLMM.getBinIdFromPrice(upperPrice, binStep, false); // Rounds up

    return { lowerBinId, upperBinId };
  }
}
