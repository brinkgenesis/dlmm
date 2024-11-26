    
    try {
      config.walletPrivateKey = JSON.parse(process.env.WALLET_PRIVATE_KEY || '[]');
      if (!Array.isArray(config.walletPrivateKey)) {
        throw new Error('WALLET_PRIVATE_KEY must be a JSON array of numbers.');
      }
    } catch (error: any) {
      console.error('Invalid WALLET_PRIVATE_KEY in .env file:', error.message);
      process.exit(1); // Exit the application if wallet key is invalid
    }

    // Initialize Keypair from Private Key
    try {
      Keypair.fromSecretKey(new Uint8Array(config.walletPrivateKey));
    } catch (error: any) {
      console.error('Failed to create Keypair from WALLET_PRIVATE_KEY:', error.message);
      process.exit(1);
    }
    

    /**
 * Main execution block

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

    // Ensure ATAs are initialized
    await client.ensureATAs();
    console.log('ATA (Associated Token Accounts) ensured.');

    // Check token balances before proceeding
    await client.checkTokenBalances();
    console.log('Token balances checked.');

    // Get the active bin
    const activeBin = await client.getActiveBin();
    console.log('Active Bin:', activeBin);

    // Get user positions
    const userPositions = await client.getUserPositions();
    console.log('User Positions:', userPositions);


       /** 
    // Example Swap Operation
    const swapAmount = new BN(10000);
    const swapYtoX = false; //Set logic where if swapping Y to X set true, otherwise false
    const allowedSlippageBps = new BN(50); // 0.1% slippage, set dynamic slippage based on success rate of transaction

    await client.swapTokens(swapAmount, swapYtoX, allowedSlippageBps);

    */
    // -------------------------------
    // Commenting Out Create Position
    // -------------------------------
    /*
    // Example Create Position Operation
    const totalXAmount = new BN(500000); // Adjust as needed
    const strategyType = StrategyType.SpotBalanced; // Example strategy type as defined in DLMM SDK

    await client.createPosition(totalXAmount, strategyType);
    console.log('Position created successfully.');
    */

    // ----------------------------------------
    // Adding Remove Liquidity Functionality
    // ----------------------------------------

    /** 
    if (userPositions.length === 0) {
      console.log('No user positions found to remove liquidity from.');
    } else {
      // Select the position to remove liquidity from
      // For example, selecting the first position. Adjust this to only remove positions for a pair that meet certain conditions. Or remove all positions and recreate
      const positionToRemove = userPositions[0].publicKey; 
      console.log(`Selected Position for Liquidity Removal: ${positionToRemove.toBase58()}`);

      // Remove Liquidity from the selected position
      await client.removeLiquidity(positionToRemove);
      console.log('Liquidity removal process initiated.');
    }

  } catch (error: any) {
    console.error('Error running DLMMClient:', error.message || error);
  }
})();
 */


POOL_PUBLIC_KEY=your_pool_public_key
TOTAL_X_AMOUNT=10000
DATA_DIRECTORY=./data
METEORA_API_BASE_URL=https://dlmm-api.meteora.ag
VOLATILITY_CHECK_INTERVAL=60000
PRICE_FEED_URL=https://api.exchange.com/current-price
DEFAULT_MAX_HISTORY_LENGTH=100
ALLOWED_SLIPPAGE_BPS=50
TOTAL_RANGE_INTERVAL=10
BPS_TO_REMOVE=10000