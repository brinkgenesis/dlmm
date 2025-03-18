/**
 * Validates required environment variables are set
 * @throws Error if required variables are missing
 */
export function validateEnvironmentVariables(delegationEnabled = false): void {
  // Variables required in all modes
  const requiredVars = [
    'SOLANA_RPC',
    'SOLANA_WSS', 
    'PRIVATE_KEY'
  ];
  
  // Variables only required when delegation is enabled
  const delegationVars = delegationEnabled ? [
    'SERVER_SIGNING_KEY',
    'DELEGATION_PROGRAM_ID',
    'JWT_SECRET'
  ] : [];
  
  const allRequired = [...requiredVars, ...delegationVars];
  const missing = allRequired.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  
  // Validate specific format requirements
  if (process.env.DELEGATION_PROGRAM_ID === 'YOUR_DELEGATION_PROGRAM_ID') {
    throw new Error('DELEGATION_PROGRAM_ID has default value. Please set the actual program ID');
  }
  
  console.log('✅ Environment configuration validated successfully');
} 