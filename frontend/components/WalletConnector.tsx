import { WalletProvider, ConnectionProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider, WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { getPhantomWallet, getSolflareWallet } from '@solana/wallet-adapter-wallets';

const wallets = [getPhantomWallet(), getSolflareWallet()];

export const WalletConnector = ({ children }) => {
  return (
    <ConnectionProvider endpoint={process.env.SOLANA_RPC}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          {children}
          <WalletMultiButton />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};
