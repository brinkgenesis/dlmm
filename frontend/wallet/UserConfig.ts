import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { Config } from '../../src/models/Config';
import { deserializeDelegationAccount } from '../../src/utils/delegationUtils';



export class UserConfig extends Config {
  public userWalletPublicKey: PublicKey;
  public delegationPDA?: PublicKey;
  public delegationExpiry?: number;
  public delegationActive: boolean = false;
  public delegationMode: boolean = false;

  constructor(
    userWalletPublicKey: PublicKey,
    connection: Connection
  ) {
    // Create a dummy keypair for Config constructor compatibility
    // This keypair will never be used for signing
    const dummyKeypair = Keypair.generate(); 
    
    super(
      userWalletPublicKey.toString(),
      dummyKeypair,  // Satisfy the Config constructor requirement
      connection
    );
    
    this.userWalletPublicKey = userWalletPublicKey;
    // Set a flag to indicate we're in delegation mode
    this.delegationMode = true;
  }

  // Override any methods that would use the keypair
  // For example:
  async signTransaction(transaction: any): Promise<any> {
    throw new Error("Cannot sign transactions with UserConfig - must use delegation");
  }

  static async loadForUser(userPublicKey: string): Promise<UserConfig> {
    const connection = Config.initializeConnection();
    const publicKey = new PublicKey(userPublicKey);
    
    const config = new UserConfig(publicKey, connection);
    
    // Load delegation status from on-chain PDA
    await config.loadDelegationStatus();
    
    return config;
  }

  async loadDelegationStatus(): Promise<void> {
    // Make sure userWalletPublicKey is defined
    if (!this.userWalletPublicKey) {
      throw new Error("User wallet public key not initialized");
    }
    
    // Use findProgramAddressSync instead
    [this.delegationPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('delegation'), this.userWalletPublicKey.toBuffer()],
      new PublicKey(process.env.DELEGATION_PROGRAM_ID || 'YOUR_DELEGATION_PROGRAM_ID')
    );
    
    // Fetch the delegation account data
    const accountInfo = await this.connection.getAccountInfo(this.delegationPDA);
    if (accountInfo) {
      // Parse the account data to get delegation status
      // This requires implementing a deserializer for your program's data structure
      const { expiryTimestamp, isActive } = deserializeDelegationAccount(accountInfo.data);
      this.delegationExpiry = expiryTimestamp;
      this.delegationActive = isActive && (Date.now() / 1000 < expiryTimestamp);
    } else {
      this.delegationActive = false;
    }
  }
}