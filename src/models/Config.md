    
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
    