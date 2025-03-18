// State structure for delegation account
pub struct DelegationState {
    pub initialized: bool,
    pub owner: Pubkey, // User's wallet
    pub delegate: Pubkey, // Bot's wallet
    pub expiry_timestamp: i64,
    pub max_allowed_amount: u64, // Max amount that can be used
    pub permissions: u32, // Bitmap of allowed operations
}

// Instructions the program will handle
pub enum DelegationInstruction {
    // Create a new delegation
    Create { expiry_timestamp: i64, max_amount: u64, permissions: u32 },
    // Revoke an existing delegation
    Revoke,
    // Verify a transaction is within delegation parameters
    VerifyTransaction { amount: u64, operation_type: u32 },
}