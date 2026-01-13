import React, { 
  createContext, 
  useContext, 
  useState, 
  useEffect, 
  useMemo,
  ReactNode,
  FC,
  useCallback
} from 'react';
import { 
  Connection, 
  PublicKey, 
  Transaction, 
  VersionedTransaction,
  clusterApiUrl,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import { 
  CheckCircle, 
  Copy, 
  X, 
  Wallet, 
  ChevronDown,
  ExternalLink,
  AlertCircle,
  Shield,
  Globe,
  RefreshCw,
  Loader2,
  LogOut,
  Network,
  Smartphone,
  Monitor,
  Cpu,
  ShieldCheck
} from 'lucide-react';

// Import from @solana/wallet-adapter-wallets (the official package)
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
  // LedgerWalletAdapter,
  TrustWalletAdapter,
  // SafePalWalletAdapter,
  // Coin98WalletAdapter,
  // CloverWalletAdapter,
  // CoinbaseWalletAdapter,
  // NightlyWalletAdapter,
  // SolongWalletAdapter,
  // TokenPocketWalletAdapter,
  // XDEFIWalletAdapter,
  // MathWalletAdapter,
  // TorusWalletAdapter,
  // WalletConnectWalletAdapter,
  // TrezorWalletAdapter,
  // NekoWalletAdapter,
  // AlphaWalletAdapter,
  // AvanaWalletAdapter,
  // BitKeepWalletAdapter,
  // BitpieWalletAdapter,
  // CoinhubWalletAdapter,
  // FractalWalletAdapter,
  // HuobiWalletAdapter,
  // HyperPayWalletAdapter,
  // KeystoneWalletAdapter,
  // KrystalWalletAdapter,
  // NufiWalletAdapter,
  // OntoWalletAdapter,
  // ParticleAdapter,
  // SaifuWalletAdapter,
  // SalmonWalletAdapter,
  // SkyWalletAdapter,
  // SpotWalletAdapter,
  // TokenaryWalletAdapter,
  // UnsafeBurnerWalletAdapter
} from '@solana/wallet-adapter-wallets';

// Solana Wallet Adapter Core
import { 
  ConnectionProvider, 
  WalletProvider as SolanaWalletProvider,
  useConnection,
  useWallet as useSolanaWallet
} from '@solana/wallet-adapter-react';
import { 
  WalletAdapterNetwork,
  WalletReadyState,
  BaseWalletAdapter,
  WalletError
} from '@solana/wallet-adapter-base';
import { 
  useWalletModal,
  WalletModalContext,
  WalletModalProvider,
  WalletMultiButton
} from '@solana/wallet-adapter-react-ui';
import '@solana/wallet-adapter-react-ui/styles.css';

// Mobile Wallet Support
import { 
  SolanaMobileWalletAdapter,
  createDefaultAddressSelector,
  createDefaultAuthorizationResultCache,
} from '@solana-mobile/wallet-adapter-mobile';

// Types
interface WalletContextType {
  connected: boolean;
  publicKey: PublicKey | null;
  connecting: boolean;
  disconnecting: boolean;
  walletName: string | null;
  walletIcon: string | null;
  connect: (walletName?: string) => Promise<void>;
  disconnect: () => Promise<void>;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
  signVersionedTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
  signAllTransactions: (txs: Transaction[]) => Promise<Transaction[]>;
  sendTransaction: (tx: Transaction | VersionedTransaction) => Promise<string>;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
  balance: number | null;
  balanceLoading: boolean;
  network: WalletAdapterNetwork;
  availableWallets: Array<{
    name: string; 
    adapter: BaseWalletAdapter;
    icon?: string;
    readyState: WalletReadyState;
    category: 'popular' | 'mobile' | 'browser' | 'hardware' | 'web3';
  }>;
  switchNetwork: (network: WalletAdapterNetwork) => void;
  refreshBalance: () => Promise<void>;
  error: string | null;
  clearError: () => void;
  isMobile: boolean;
}

const WalletContext = createContext<WalletContextType>({
  connected: false,
  publicKey: null,
  connecting: false,
  disconnecting: false,
  walletName: null,
  walletIcon: null,
  connect: async () => {},
  disconnect: async () => {},
  signTransaction: async (tx) => tx,
  signVersionedTransaction: async (tx) => tx,
  signAllTransactions: async (txs) => txs,
  sendTransaction: async () => '',
  signMessage: async (msg) => msg,
  balance: null,
  balanceLoading: false,
  network: WalletAdapterNetwork.Mainnet,
  availableWallets: [],
  switchNetwork: () => {},
  refreshBalance: async () => {},
  error: null,
  clearError: () => {},
  isMobile: false,
});

export const useWallet = () => useContext(WalletContext);

// Detect mobile device
const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(
        /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
          navigator.userAgent
        ) || window.innerWidth < 768
      );
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return isMobile;
};


const CustomWalletModal: FC = () => {
  const { wallets, select } = useSolanaWallet();
  const { visible, setVisible } = useWalletModal();
  
  const handleClose = () => setVisible(false);
  
  const handleWalletClick = (walletName: string, readyState: WalletReadyState) => {
    if (readyState === WalletReadyState.NotDetected) {
      // Show installation instructions instead of throwing error
      const walletLower = walletName.toLowerCase();
      let installUrl = '';
      
      if (walletLower.includes('phantom')) {
        installUrl = 'https://phantom.app/download';
      } else if (walletLower.includes('solflare')) {
        installUrl = 'https://solflare.com/download';
      } else if (walletLower.includes('trust')) {
        installUrl = 'https://trustwallet.com/solana-wallet';
      }
      
      if (installUrl && window.confirm(`${walletName} is not installed. Would you like to visit the download page?`)) {
        window.open(installUrl, '_blank');
      }
      return;
    }
    
    select(walletName as any);
    handleClose();
  };
  
  if (!visible) return null;
  
  // Group wallets by readiness
  const installedWallets = wallets.filter(w => w.readyState === WalletReadyState.Installed);
  const notInstalledWallets = wallets.filter(w => w.readyState === WalletReadyState.NotDetected);
  const loadableWallets = wallets.filter(w => w.readyState === WalletReadyState.Loadable);
  
  const allWallets = [
    ...installedWallets,
    ...loadableWallets,
    ...notInstalledWallets
  ];
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-900 rounded-xl p-6 max-w-md w-full border border-gray-700 shadow-2xl">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold text-white">Connect Wallet</h2>
          <button 
            onClick={handleClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
          {allWallets.map((wallet) => {
            const isInstalled = wallet.readyState === WalletReadyState.Installed;
            const isLoadable = wallet.readyState === WalletReadyState.Loadable;
            const isNotDetected = wallet.readyState === WalletReadyState.NotDetected;
            
            return (
              <button
                key={wallet.adapter.name as string}
                onClick={() => handleWalletClick(wallet.adapter.name as string, wallet.readyState)}
                disabled={isNotDetected}
                className={`
                  flex items-center gap-3 p-3 w-full rounded-lg transition-all duration-200
                  ${isNotDetected 
                    ? 'opacity-60 cursor-not-allowed bg-gray-800/30' 
                    : 'hover:bg-gray-800/50 bg-gray-800/30'
                  }
                  ${isInstalled ? 'border border-green-500/30' : ''}
                  ${isLoadable ? 'border border-blue-500/30' : ''}
                `}
              >
                {wallet.adapter.icon && (
                  <img 
                    src={wallet.adapter.icon} 
                    alt={wallet.adapter.name as string}
                    className="w-8 h-8 rounded"
                  />
                )}
                <div className="flex-1 text-left">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-medium">
                      {wallet.adapter.name as string}
                    </span>
                    {isInstalled && (
                      <span className="text-xs px-2 py-0.5 rounded bg-green-900/30 text-green-400 border border-green-700/50">
                        Installed
                      </span>
                    )}
                    {isLoadable && (
                      <span className="text-xs px-2 py-0.5 rounded bg-blue-900/30 text-blue-400 border border-blue-700/50">
                        Available
                      </span>
                    )}
                    {isNotDetected && (
                      <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700/50">
                        Not Installed
                      </span>
                    )}
                  </div>
                  {isNotDetected && (
                    <p className="text-xs text-gray-400 mt-1">
                      Click for installation instructions
                    </p>
                  )}
                </div>
                <ChevronDown className="w-4 h-4 text-gray-400 transform -rotate-90" />
              </button>
            );
          })}
        </div>
        
        <div className="mt-6 pt-4 border-t border-gray-800/50">
          <p className="text-xs text-gray-500 text-center">
            Don't have a wallet? Try <a href="https://phantom.app/download" target="_blank" className="text-cyan-400 hover:text-cyan-300">Phantom</a> or <a href="https://solflare.com/download" target="_blank" className="text-cyan-400 hover:text-cyan-300">Solflare</a>
          </p>
        </div>
      </div>
    </div>
  );
};

// Main Wallet Provider Component
export const WalletProvider: FC<{ 
  children: ReactNode;
  autoConnect?: boolean;
  network?: WalletAdapterNetwork;
  endpoint?: string;
}> = ({ 
  children, 
  autoConnect = true,
  network = WalletAdapterNetwork.Mainnet,
  endpoint: customEndpoint
}) => {
  const [currentNetwork, setCurrentNetwork] = useState<WalletAdapterNetwork>(network);
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMobile = useIsMobile();
  
  // Clear error helper
  const clearError = useCallback(() => setError(null), []);
  
  // Initialize ONLY the wallets we need
  const wallets = useMemo(() => {
    try {
      const walletAdaptersList: BaseWalletAdapter[] = [];
      
      // ALWAYS add all wallet adapters - let them handle their own detection
      walletAdaptersList.push(new PhantomWalletAdapter());
      walletAdaptersList.push(new SolflareWalletAdapter({ network: currentNetwork }));
      walletAdaptersList.push(new TrustWalletAdapter());
      
      // Add mobile wallet adapter if on mobile
      if (isMobile) {
        const mobileAdapter = new SolanaMobileWalletAdapter({
          addressSelector: createDefaultAddressSelector(),
          appIdentity: {
            name: 'SLICEOF MANGO',
            uri: 'https://sliceofmango.com',
            icon: '/logo.png'
          },
          authorizationResultCache: createDefaultAuthorizationResultCache(),
          cluster: currentNetwork,
          onWalletNotFound: async () => {
            console.log('Mobile wallet not found');
          },
        });
        walletAdaptersList.push(mobileAdapter);
      }
      
      console.log(`✅ Initialized ${walletAdaptersList.length} wallet adapters`);
      return walletAdaptersList;
      
    } catch (error) {
      console.error('❌ Error initializing wallet adapters:', error);
      setError('Failed to initialize wallet adapters. Please refresh the page.');
      return [];
    }
  }, [currentNetwork, isMobile]);

  const CustomModalProvider: FC<{ children: ReactNode }> = useCallback(({ children }) => {
    const [visible, setVisible] = useState(false);
    
    return (
      <WalletModalContext.Provider value={{ visible, setVisible }}>
        {children}
        <CustomWalletModal />
      </WalletModalContext.Provider>
    );
  }, []);

  
  // Endpoint configuration with intelligent fallback
  const endpoint = useMemo(() => {
    if (customEndpoint) return customEndpoint;
    
    const rpcUrls: Record<WalletAdapterNetwork, string> = {
      [WalletAdapterNetwork.Mainnet]: 
        import.meta.env.VITE_SHFYT_RPC || "https://api.mainnet-beta.solana.com",
      [WalletAdapterNetwork.Testnet]: 
        process.env.NEXT_PUBLIC_TESTNET_RPC || 
        clusterApiUrl(WalletAdapterNetwork.Testnet),
      [WalletAdapterNetwork.Devnet]: 
        process.env.NEXT_PUBLIC_DEVNET_RPC || 
        clusterApiUrl(WalletAdapterNetwork.Devnet),
    };
    
    const selectedUrl = rpcUrls[currentNetwork] || rpcUrls[WalletAdapterNetwork.Mainnet];
    return selectedUrl;
  }, [currentNetwork, customEndpoint]);
  
  // Network switch handler
  const switchNetwork = useCallback((newNetwork: WalletAdapterNetwork) => {
    console.log(`🔄 Switching to ${newNetwork} network`);
    setCurrentNetwork(newNetwork);
  }, []);

  return (
   <ConnectionProvider endpoint={endpoint}>
    <SolanaWalletProvider 
      wallets={wallets} 
      autoConnect={autoConnect}
      onError={(error: WalletError) => {
        console.error('🔴 Wallet provider error:', error);
        setError(error.message || 'An unknown wallet error occurred');
      }}
    >
      <CustomModalProvider>
        <WalletContextInner 
          balance={balance}
          setBalance={setBalance}
          balanceLoading={balanceLoading}
          setBalanceLoading={setBalanceLoading}
          network={currentNetwork}
          switchNetwork={switchNetwork}
          error={error}
          setError={setError}
          clearError={clearError}
          isMobile={isMobile}
        >
          {children}
        </WalletContextInner>
      </CustomModalProvider>
    </SolanaWalletProvider>
  </ConnectionProvider>
);

};

// Add this custom provider component
const DuplicateSafeWalletModalProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [visible, setVisible] = useState(false);
  const { wallets, select } = useSolanaWallet();
  
  // Filter out duplicate wallets
  const uniqueWallets = useMemo(() => {
    const seen = new Set<string>();
    return wallets.filter(wallet => {
      const name = wallet.adapter.name as string;
      if (seen.has(name)) {
        console.warn(`Filtering out duplicate wallet: ${name}`);
        return false;
      }
      seen.add(name);
      return true;
    });
  }, [wallets]);
  
  // Create a custom modal that uses unique wallets
  const CustomModal: FC = () => {
    if (!visible) return null;
    
    const handleClose = () => setVisible(false);
    const handleWalletClick = (walletName: string) => {
      // Cast to WalletName type
      select(walletName as any);
      handleClose();
    };
    
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
        <div className="bg-gray-900 rounded-xl p-6 max-w-md w-full border border-gray-700">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-white">Connect Wallet</h2>
            <button 
              onClick={handleClose}
              className="text-gray-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          
          <div className="space-y-2">
            {uniqueWallets.map((wallet) => (
              <button
                key={wallet.adapter.name as string} // Cast to string for key
                onClick={() => handleWalletClick(wallet.adapter.name as string)}
                className="flex items-center gap-3 p-3 w-full hover:bg-gray-800 rounded-lg transition-colors"
              >
                {wallet.adapter.icon && (
                  <img 
                    src={wallet.adapter.icon} 
                    alt={wallet.adapter.name as string}
                    className="w-8 h-8 rounded"
                  />
                )}
                <span className="text-white">{wallet.adapter.name as string}</span>
                <span className="ml-auto text-xs px-2 py-1 rounded bg-gray-800 text-gray-300">
                  {wallet.readyState === WalletReadyState.Installed ? 'Installed' : 'Not Installed'}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  };
  
  return (
    <WalletModalContext.Provider value={{ visible, setVisible }}>
      {children}
      <CustomModal />
    </WalletModalContext.Provider>
  );
};



// Inner component to access wallet context
const WalletContextInner: FC<{
  children: ReactNode;
  balance: number | null;
  setBalance: (balance: number | null) => void;
  balanceLoading: boolean;
  setBalanceLoading: (loading: boolean) => void;
  network: WalletAdapterNetwork;
  switchNetwork: (network: WalletAdapterNetwork) => void;
  error: string | null;
  setError: (error: string | null) => void;
  clearError: () => void;
  isMobile: boolean;
}> = ({ 
  children, 
  balance,
  setBalance,
  balanceLoading,
  setBalanceLoading,
  network,
  switchNetwork,
  error,
  setError,
  clearError,
  isMobile
}) => {
  const { connection } = useConnection();
  const solanaWallet = useSolanaWallet();
  const {
    connected,
    connecting,
    disconnecting,
    publicKey,
    wallet,
    disconnect: solanaDisconnect,
    signTransaction: solanaSignTransaction,
    signAllTransactions: solanaSignAllTransactions,
    sendTransaction: solanaSendTransaction,
    signMessage: solanaSignMessage,
    select,
    wallets: availableWallets
  } = solanaWallet;
  
  const [walletName, setWalletName] = useState<string | null>(null);
  const [walletIcon, setWalletIcon] = useState<string | null>(null);
  const [lastActivity, setLastActivity] = useState<number>(Date.now());

  // Then in WalletContextInner, add this useEffect to patch the modal:
  useEffect(() => {
    // This runs when wallets change
    const fixModalDuplicateKeys = () => {
      // Wait for modal to render
      setTimeout(() => {
        const modal = document.querySelector('.wallet-adapter-modal');
        if (!modal) return;
        
        const listItems = modal.querySelectorAll('.wallet-adapter-modal-list-item');
        const seen = new Set<string>();
        
        listItems.forEach((item, index) => {
          const span = item.querySelector('span');
          if (span) {
            const text = span.textContent || '';
            if (text.includes('MetaMask')) {
              if (seen.has('MetaMask')) {
                // This is a duplicate, rename it
                span.textContent = 'MetaMask (Solana)';
                // Also update the key attribute if possible
                item.setAttribute('data-unique-key', `MetaMask_${index}`);
              }
              seen.add('MetaMask');
            }
          }
        });
      }, 100); // Small delay to ensure modal is rendered
    };
    
    // Set up a mutation observer to watch for modal changes
    const observer = new MutationObserver(fixModalDuplicateKeys);
    observer.observe(document.body, { childList: true, subtree: true });
    
    return () => observer.disconnect();
  }, [availableWallets]);

  useEffect(() => {
    console.log('Available wallets:', availableWallets.map(w => ({
      name: w.adapter.name,
      readyState: w.readyState,
      icon: w.adapter.icon
    })));
  }, [availableWallets]);

  // Update wallet info when connected
  useEffect(() => {
    if (wallet?.adapter) {
      setWalletName(wallet.adapter.name || 'Unknown Wallet');
      setWalletIcon(wallet.adapter.icon || null);
      console.log(`🔗 Connected to ${wallet.adapter.name}`);
    } else {
      setWalletName(null);
      setWalletIcon(null);
    }
  }, [wallet]);

  // Track user activity for auto-refresh
  useEffect(() => {
    const handleActivity = () => setLastActivity(Date.now());
    window.addEventListener('click', handleActivity);
    window.addEventListener('keypress', handleActivity);
    return () => {
      window.removeEventListener('click', handleActivity);
      window.removeEventListener('keypress', handleActivity);
    };
  }, []);

  const clearWalletCache = useCallback(() => {
    // Clear any cached wallet data
    if (typeof window !== 'undefined') {
      try {
        // Clear localStorage wallet cache
        localStorage.removeItem('solana-wallet-adapter:cache');
        localStorage.removeItem('wallet-adapter:cache');
        
        // Clear session storage
        sessionStorage.removeItem('solana-wallet-adapter:cache');
        
        console.log('✅ Cleared wallet cache');
      } catch (error) {
        console.error('❌ Error clearing wallet cache:', error);
      }
    }
  }, []);


  // Fetch wallet balance with error handling
  const fetchBalance = useCallback(async (forceRefresh = false) => {
    if (publicKey && connected) {
      setBalanceLoading(true);
      try {
        const balanceLamports = await connection.getBalance(publicKey);
        const balanceSOL = balanceLamports / LAMPORTS_PER_SOL;
        setBalance(balanceSOL);
      } catch (error) {
        console.error('❌ Error fetching balance:', error);
        setError('Failed to fetch balance. Check your connection.');
        setBalance(null);
      } finally {
        setBalanceLoading(false);
      }
    } else {
      setBalance(null);
    }
  }, [publicKey, connected, connection, setError]);

  // Fetch balance on connection change
  useEffect(() => {
    fetchBalance(true);
  }, [fetchBalance]);

  // Auto-refresh balance every 60 seconds when connected
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (connected) {
      interval = setInterval(() => fetchBalance(false), 60000);
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [connected, fetchBalance]);

  const checkWalletAvailability = useCallback((walletName: string): { 
    available: boolean; 
    installUrl?: string; 
    message: string 
  } => {
    const wallet = availableWallets.find(w => 
      w.adapter.name.toLowerCase() === walletName.toLowerCase()
    );
    
    if (!wallet) {
      return { 
        available: false, 
        message: `Wallet "${walletName}" not found.` 
      };
    }
    
    const name = wallet.adapter.name.toLowerCase();
    const installUrls: Record<string, string> = {
      'phantom': 'https://phantom.app/download',
      'solflare': 'https://solflare.com/download',
      'trust': 'https://trustwallet.com/solana-wallet',
      'metamask': 'https://metamask.io/download',
    };
    
    let installUrl = '';
    for (const [key, url] of Object.entries(installUrls)) {
      if (name.includes(key)) {
        installUrl = url;
        break;
      }
    }
    
    if (wallet.readyState === WalletReadyState.NotDetected) {
      return { 
        available: false, 
        installUrl,
        message: `${wallet.adapter.name} is not installed. Please install it first.`
      };
    }
    
    return { 
      available: true, 
      installUrl,
      message: `${wallet.adapter.name} is available for connection.`
    };
  }, [availableWallets]);

  // In your WalletContextInner component, update the connect function:
  const connect = useCallback(async (walletName?: string) => {
    try {
      clearError();
      
      if (walletName) {
        // Find the wallet
        const targetWallet = availableWallets.find(w => 
          w.adapter.name.toLowerCase() === walletName.toLowerCase() ||
          w.adapter.name.toLowerCase().includes(walletName.toLowerCase())
        );
        
        if (targetWallet) {
          console.log(`🔌 Attempting to connect to ${targetWallet.adapter.name} (state: ${targetWallet.readyState})`);
          
          // Check if wallet is detected
          if (targetWallet.readyState === WalletReadyState.NotDetected) {
            // Provide helpful message
            const walletLower = targetWallet.adapter.name.toLowerCase();
            let installMessage = `${targetWallet.adapter.name} is not installed.`;
            let installUrl = '';
            
            if (walletLower.includes('phantom')) {
              installUrl = 'https://phantom.app/download';
              installMessage += ' Visit phantom.app to install it.';
            } else if (walletLower.includes('solflare')) {
              installUrl = 'https://solflare.com/download';
              installMessage += ' Visit solflare.com to install it.';
            } else if (walletLower.includes('trust')) {
              installUrl = 'https://trustwallet.com/solana-wallet';
              installMessage += ' Visit trustwallet.com to install it.';
            }
            
            setError(installMessage);
            
            // Optionally open install link
            if (installUrl && window.confirm(`${installMessage}\n\nWould you like to visit the download page?`)) {
              window.open(installUrl, '_blank');
            }
            return;
          }
          
          // Select and connect if wallet is available
          select(targetWallet.adapter.name);
        } else {
          setError(`Wallet "${walletName}" not found. Try using the wallet selector.`);
        }
      } else {
        // If no wallet specified, the modal will handle selection
        // This triggers the default wallet modal
        console.log('Opening wallet modal for selection');
        // You need to access the modal context here
        const { setVisible } = useWalletModal();
        setVisible(true);
      }
    } catch (error: any) {
      console.error('❌ Connection error:', error);
      setError(error.message || 'Failed to connect wallet. Please try again.');
    }
  }, [availableWallets, select, setError, clearError]);

  // Disconnect wallet with cleanup
  const disconnect = useCallback(async () => {
    try {
      clearError();
      console.log('🔌 Disconnecting wallet...');
      await solanaDisconnect();
      clearWalletCache(); // Clear cache on disconnect
      setWalletName(null);
      setWalletIcon(null);
      setBalance(null);
      console.log('✅ Wallet disconnected');
    } catch (error: any) {
      console.error('❌ Error disconnecting:', error);
      setError(error.message || 'Failed to disconnect. Please try again.');
    }
  }, [solanaDisconnect, setError, clearError]);

  // Enhanced sign transaction with validation
  const signTransaction = useCallback(async (transaction: Transaction): Promise<Transaction> => {
    try {
      clearError();
      if (!connected || !solanaSignTransaction) {
        throw new Error('Wallet not connected or signing not supported');
      }
      
      // Validate transaction before signing
      if (!transaction.recentBlockhash) {
        throw new Error('Transaction missing recent blockhash');
      }
      
      console.log('✍️ Signing transaction...');
      const signedTx = await solanaSignTransaction(transaction);
      console.log('✅ Transaction signed successfully');
      return signedTx;
    } catch (error: any) {
      console.error('❌ Failed to sign transaction:', error);
      setError(error.message || 'Failed to sign transaction. Please try again.');
      throw error;
    }
  }, [connected, solanaSignTransaction, setError, clearError]);


  // Sign versioned transaction
  const signVersionedTransaction = useCallback(async (transaction: VersionedTransaction): Promise<VersionedTransaction> => {
    try {
      clearError();
      if (!connected || !wallet?.adapter) {
        throw new Error('Wallet not connected or versioned transactions not supported');
      }
      
      console.log('✍️ Signing versioned transaction...');
      
      // Check if the adapter supports versioned transactions
      const adapter = wallet.adapter;
      if ('signTransaction' in adapter) {
        const signedTx = await (adapter as any).signTransaction(transaction);
        console.log('✅ Versioned transaction signed successfully');
        return signedTx;
      } else {
        throw new Error('Wallet does not support versioned transactions');
      }
    } catch (error: any) {
      console.error('❌ Failed to sign versioned transaction:', error);
      setError(error.message || 'Failed to sign versioned transaction. Please try again.');
      throw error;
    }
  }, [connected, wallet, setError, clearError]);


  // Sign all transactions
  const signAllTransactions = useCallback(async (transactions: Transaction[]): Promise<Transaction[]> => {
    try {
      clearError();
      if (!connected || !solanaSignAllTransactions) {
        throw new Error('Wallet not connected or batch signing not supported');
      }
      
      if (transactions.length === 0) {
        throw new Error('No transactions to sign');
      }
      
      console.log(`✍️ Signing ${transactions.length} transactions...`);
      const signedTxs = await solanaSignAllTransactions(transactions);
      console.log(`✅ ${signedTxs.length} transactions signed successfully`);
      return signedTxs;
    } catch (error: any) {
      console.error('❌ Failed to sign transactions:', error);
      setError(error.message || 'Failed to sign transactions. Please try again.');
      throw error;
    }
  }, [connected, solanaSignAllTransactions, setError, clearError]);

  // Enhanced send transaction with retry logic
  const sendTransaction = useCallback(async (transaction: Transaction | VersionedTransaction): Promise<string> => {
    try {
      clearError();
      if (!connected || !solanaSendTransaction) {
        throw new Error('Wallet not connected');
      }
      
      console.log('🚀 Sending transaction...');
      const signature = await solanaSendTransaction(
        transaction,
        connection,
        { 
          skipPreflight: false,
          preflightCommitment: 'confirmed',
          maxRetries: 5
        }
      );
      
      console.log(`✅ Transaction sent: ${signature}`);
      return signature;
    } catch (error: any) {
      console.error('❌ Error sending transaction:', error);
      setError(error.message || 'Failed to send transaction. Please try again.');
      throw error;
    }
  }, [connected, solanaSendTransaction, connection, setError, clearError]);

  // Sign message
  const signMessage = useCallback(async (message: Uint8Array): Promise<Uint8Array> => {
    try {
      clearError();
      if (!connected || !solanaSignMessage) {
        throw new Error('Wallet not connected or message signing not supported');
      }
      return await solanaSignMessage(message);
    } catch (error: any) {
      setError(error.message || 'Failed to sign message');
      throw error;
    }
  }, [connected, solanaSignMessage, setError, clearError]);

  // Refresh balance
  const refreshBalance = useCallback(async () => {
    await fetchBalance(true);
  }, [fetchBalance]);

  // Helper function to categorize wallets
  const getWalletCategory = (
    walletName: string, 
    readyState: WalletReadyState, 
    isMobileDevice: boolean
  ): 'popular' | 'mobile' | 'browser' | 'hardware' | 'web3' => {
    const name = walletName.toLowerCase();
    
    // Popular wallets (always show first)
    if (['phantom', 'solflare', 'trust'].some(w => name.includes(w))) {
      return 'popular';
    }
    
    // Mobile wallets
    if (['mobile', 'trust'].some(w => name.includes(w)) || isMobileDevice) {
      return 'mobile';
    }
    
    // Browser extension wallets
    if (['phantom', 'solflare'].some(w => name.includes(w))) {
      return 'browser';
    }
    
    return 'web3';
  };


  // Enhanced wallet filtering logic to handle duplicates properly
  const categorizedWallets = useMemo(() => {
    // console.log('Processing available wallets:', availableWallets.map(w => w.adapter.name));
    
    // Create a Map to ensure unique wallet entries
    const uniqueWallets = new Map<string, {
      name: string; 
      adapter: BaseWalletAdapter;
      icon?: string;
      readyState: WalletReadyState;
      category: 'popular' | 'mobile' | 'browser' | 'hardware' | 'web3';
    }>();
    
    availableWallets.forEach(wallet => {
      const walletName = wallet.adapter.name;
      const readyState = wallet.readyState;
      
      // DON'T skip wallets that are NotDetected! Show them as disabled options
      // The user might want to see what's available and install it
      
      // Use the original name as the key
      if (!uniqueWallets.has(walletName)) {
        uniqueWallets.set(walletName, {
          name: walletName,
          adapter: wallet.adapter as BaseWalletAdapter,
          icon: wallet.adapter.icon,
          readyState: readyState,
          category: getWalletCategory(walletName, readyState, isMobile)
        });
      } else {
        console.warn(`⚠️ Duplicate wallet name detected: ${walletName}. Skipping duplicate.`);
      }
    });

    const result = Array.from(uniqueWallets.values());
    // console.log('Final categorized wallets:', result.map(w => ({ name: w.name, readyState: w.readyState })));
    return result;
  }, [availableWallets, isMobile]);


  const contextValue: WalletContextType = {
    connected,
    publicKey,
    connecting,
    disconnecting,
    walletName,
    walletIcon,
    connect,
    disconnect,
    signTransaction,
    signVersionedTransaction,
    signAllTransactions,
    sendTransaction,
    signMessage,
    balance,
    balanceLoading,
    network,
    availableWallets: categorizedWallets,
    switchNetwork,
    refreshBalance,
    error,
    clearError,
    isMobile,
  };
  
  return (
    <WalletContext.Provider value={contextValue}>
      {children}
      
      {/* Global Error Toast */}
      {error && (
        <div className="fixed top-4 right-4 z-50 max-w-sm animate-in slide-in-from-top-5 duration-300">
          <div className="bg-gradient-to-br from-red-900/90 to-red-800/90 border border-red-700/50 rounded-xl p-4 shadow-2xl backdrop-blur-sm">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-red-300 text-sm">Wallet Error</p>
                <p className="text-xs text-red-400 mt-1">{error}</p>
              </div>
              <button 
                onClick={clearError}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </WalletContext.Provider>
  );
};

// Custom Wallet Connect Button Component
export const WalletConnectButton: React.FC<{ 
  showCopy?: boolean;
  showBalance?: boolean;
  showNetwork?: boolean;
  className?: string;
  variant?: 'default' | 'minimal' | 'expanded';
}> = ({ 
  showCopy = true, 
  showBalance = true, 
  showNetwork = true,
  className = '',
  variant = 'default'
}) => {
  const { 
    connected, 
    publicKey, 
    connecting, 
    disconnecting,
    walletName,
    walletIcon,
    balance,
    balanceLoading,
    network,
    disconnect,
    refreshBalance,
    availableWallets,
    isMobile
  } = useWallet();
  const { setVisible } = useWalletModal();
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(text);
    setTimeout(() => {
      setCopiedText(null);
    }, 2000);
  };
  
  const handleDisconnect = async () => {
    try {
      await disconnect();
      setShowAccountMenu(false);
    } catch (error) {
      console.error('Disconnect error:', error);
    }
  };
  
  const formatBalance = (bal: number | null) => {
    if (bal === null) return '--.--';
    return bal < 0.001 ? '<0.001' : bal.toFixed(3);
  };
  
  const getNetworkColor = (net: WalletAdapterNetwork) => {
    switch (net) {
      case WalletAdapterNetwork.Mainnet: return 'bg-green-500';
      case WalletAdapterNetwork.Testnet: return 'bg-yellow-500';
      case WalletAdapterNetwork.Devnet: return 'bg-blue-500';
      default: return 'bg-gray-500';
    }
  };
  
  // Connected State
  if (connected && publicKey) {
    return (
      <div className="relative">
        <button
          onClick={() => setShowAccountMenu(!showAccountMenu)}
          className={`
            group flex items-center gap-3 bg-gradient-to-r from-gray-900 to-gray-800 
            hover:from-gray-800 hover:to-gray-700 border border-gray-700/50 
            rounded-xl px-4 py-2.5 transition-all duration-200 hover:border-gray-600/50
            hover:shadow-lg ${className}
          `}
        >
          {/* Wallet Icon */}
          {walletIcon ? (
            <img 
              src={walletIcon} 
              alt={walletName || 'Wallet'} 
              className="w-5 h-5 rounded group-hover:scale-110 transition-transform"
            />
          ) : (
            <div className="w-5 h-5 bg-gradient-to-br from-cyan-500 to-blue-500 rounded flex items-center justify-center group-hover:scale-110 transition-transform">
              <Wallet className="w-3 h-3 text-white" />
            </div>
          )}
          
          {/* Balance Display */}
          {showBalance && (
            <div className="hidden sm:block">
              <div className="text-xs text-gray-400">Balance</div>
              <div className="text-sm font-medium text-white flex items-center gap-1">
                {balanceLoading ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <span>{formatBalance(balance)} SOL</span>
                )}
              </div>
            </div>
          )}
          
          {/* Address Display */}
          <div className="text-right">
            <div className="text-xs text-gray-400 hidden sm:block">
              {walletName || 'Wallet'}
            </div>
            <div className="text-sm font-mono text-white flex items-center gap-2">
              {publicKey.toString().slice(0, 4)}...{publicKey.toString().slice(-4)}
              <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showAccountMenu ? 'rotate-180' : ''}`} />
            </div>
          </div>
        </button>
        
        {/* Account Dropdown Menu */}
        {showAccountMenu && (
          <div className="absolute top-full mt-2 right-0 w-72 bg-gray-900/95 border border-gray-700/50 rounded-xl shadow-2xl z-50 overflow-hidden backdrop-blur-sm animate-in slide-in-from-top-5 duration-200">
            {/* Header */}
            <div className="p-4 border-b border-gray-800/50 bg-gradient-to-r from-gray-900 to-gray-800">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-white font-medium flex items-center gap-2">
                    {walletIcon && (
                      <img src={walletIcon} alt={walletName || ''} className="w-4 h-4 rounded" />
                    )}
                    {walletName}
                  </div>
                  <div className="text-xs text-gray-400 mt-1">Connected Wallet</div>
                </div>
                <div className="w-8 h-8 bg-gradient-to-br from-green-500/20 to-emerald-500/20 rounded-lg flex items-center justify-center">
                  <ShieldCheck className="w-4 h-4 text-green-400" />
                </div>
              </div>
            </div>
            
            {/* Balance Section */}
            <div className="p-4 border-b border-gray-800/50">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-gray-400">Available Balance</div>
                  <div className="text-xl font-bold text-white mt-1">
                    {balanceLoading ? (
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-sm">Loading...</span>
                      </div>
                    ) : (
                      `${formatBalance(balance)} SOL`
                    )}
                  </div>
                </div>
                <button
                  onClick={refreshBalance}
                  className="p-2 hover:bg-gray-800/50 rounded-lg transition-colors"
                  title="Refresh balance"
                >
                  <RefreshCw className="w-4 h-4 text-gray-400" />
                </button>
              </div>
            </div>
            
            {/* Address Section */}
            <div className="p-4 border-b border-gray-800/50">
              <div className="text-xs text-gray-400 mb-2">Wallet Address</div>
              <div className="flex items-center gap-2">
                <div className="font-mono text-sm text-gray-300 flex-1 truncate bg-gray-800/50 p-2 rounded">
                  {publicKey.toString().slice(0, 20)}...
                </div>
                <button
                  onClick={() => copyToClipboard(publicKey.toString())}
                  className="p-2 hover:bg-gray-800/50 rounded-lg transition-colors relative group"
                  title="Copy address"
                >
                  {copiedText === publicKey.toString() ? (
                    <CheckCircle className="w-4 h-4 text-green-400" />
                  ) : (
                    <Copy className="w-4 h-4 text-gray-400 group-hover:text-white" />
                  )}
                  <div className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-gray-800 text-white px-2 py-1 rounded text-xs opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                    {copiedText === publicKey.toString() ? 'Copied!' : 'Copy address'}
                  </div>
                </button>
              </div>
            </div>
            
            {/* Network Section */}
            {showNetwork && (
              <div className="p-4 border-b border-gray-800/50">
                <div className="text-xs text-gray-400 mb-2">Network</div>
                <div className="flex items-center gap-2">
                  <Network className="w-4 h-4 text-cyan-400" />
                  <span className="text-sm text-white capitalize">
                    {network.replace('-beta', '')}
                  </span>
                  <div className={`w-2 h-2 rounded-full ml-auto ${getNetworkColor(network)}`} />
                </div>
              </div>
            )}
            
            {/* Device Info */}
            <div className="p-4 border-b border-gray-800/50">
              <div className="text-xs text-gray-400 mb-2">Device</div>
              <div className="flex items-center gap-2">
                {isMobile ? (
                  <>
                    <Smartphone className="w-4 h-4 text-purple-400" />
                    <span className="text-sm text-white">Mobile Browser</span>
                  </>
                ) : (
                  <>
                    <Monitor className="w-4 h-4 text-blue-400" />
                    <span className="text-sm text-white">Desktop Browser</span>
                  </>
                )}
              </div>
            </div>
            
            {/* Actions */}
            <div className="p-4">
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="w-full bg-gradient-to-r from-red-600/90 to-pink-600/90 hover:from-red-700 hover:to-pink-700 text-white font-medium py-2.5 px-4 rounded-lg transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 group"
              >
                {disconnecting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Disconnecting...
                  </>
                ) : (
                  <>
                    <LogOut className="w-4 h-4" />
                    Disconnect Wallet
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }
  
  // Not Connected State
  return (
    <div className="relative">
      <button
        onClick={() => {
          setVisible(true);
        }}
        className={`
          bg-gradient-to-r from-cyan-600 to-blue-600 
          hover:from-cyan-700 hover:to-blue-700 text-white 
          font-medium px-4 md:px-6 py-2 md:py-3 rounded-lg 
          transition-all duration-200 flex items-center gap-2
          ${className}
        `}
      >
        <Wallet className="w-4 h-4" />
        <span>Connect Wallet</span>
      </button>
    </div>
  );
};

// Network Selector Component
export const NetworkSelector: React.FC = () => {
  const { network, switchNetwork } = useWallet();
  const [showNetworks, setShowNetworks] = useState(false);
  
  const networks = [
    { 
      name: 'Mainnet', 
      value: WalletAdapterNetwork.Mainnet, 
      color: 'bg-green-500',
      description: 'Production network with real SOL',
      icon: <ShieldCheck className="w-4 h-4 text-green-400" />
    },
    { 
      name: 'Testnet', 
      value: WalletAdapterNetwork.Testnet, 
      color: 'bg-yellow-500',
      description: 'Testing environment with fake SOL',
      icon: <Cpu className="w-4 h-4 text-yellow-400" />
    },
    { 
      name: 'Devnet', 
      value: WalletAdapterNetwork.Devnet, 
      color: 'bg-blue-500',
      description: 'Development network',
      icon: <Cpu className="w-4 h-4 text-blue-400" />
    },
  ];
  
  return (
    <div className="relative">
      <button
        onClick={() => setShowNetworks(!showNetworks)}
        className="flex items-center gap-2 bg-gray-800/50 hover:bg-gray-700/50 px-3 py-1.5 rounded-lg transition-colors border border-gray-700/50 backdrop-blur-sm"
      >
        <Globe className="w-4 h-4 text-gray-400" />
        <span className="text-sm text-white">
          {networks.find(n => n.value === network)?.name || 'Network'}
        </span>
        <ChevronDown className={`w-3 h-3 text-gray-400 transition-transform ${showNetworks ? 'rotate-180' : ''}`} />
      </button>
      
      {showNetworks && (
        <div className="absolute top-full mt-2 right-0 w-56 bg-gray-900/95 border border-gray-700/50 rounded-xl shadow-2xl z-50 backdrop-blur-sm animate-in slide-in-from-top-5 duration-200">
          <div className="p-3 border-b border-gray-800/50">
                      <div className="text-xs font-medium text-gray-400 uppercase tracking-wider">
            Select Network
          </div>
        </div>
        
        <div className="p-2">
          {networks.map((net) => (
            <button
              key={net.value}
              onClick={() => {
                switchNetwork(net.value);
                setShowNetworks(false);
              }}
              className={`
                w-full flex items-center gap-3 p-2.5 rounded-lg transition-all duration-200
                ${network === net.value 
                  ? 'bg-gray-800/70 border border-gray-700/50' 
                  : 'hover:bg-gray-800/50'
                }
              `}
            >
              <div className={`w-2 h-2 rounded-full ${net.color}`} />
              <div className="flex-1 text-left">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white">{net.name}</span>
                  {network === net.value && (
                    <CheckCircle className="w-3 h-3 text-green-400" />
                  )}
                </div>
                <div className="text-xs text-gray-400 mt-0.5">{net.description}</div>
              </div>
              {net.icon}
            </button>
          ))}
        </div>
        
        <div className="p-3 border-t border-gray-800/50">
          <div className="text-xs text-gray-500 text-center">
            Active: {network.replace('-beta', '')}
          </div>
        </div>
      </div>
    )}
  </div>
);
};

// Enhanced Wallet Selector Component
export const EnhancedWalletSelector: React.FC<{
  showCategoryTabs?: boolean;
  maxHeight?: string;
  onWalletSelect?: (walletName: string) => void;
}> = ({ 
  showCategoryTabs = true, 
  maxHeight = '400px',
  onWalletSelect 
}) => {
  const { availableWallets, connect, isMobile } = useWallet();
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Categories for filtering
  // const categories = [
  //   { id: 'all', label: 'All Wallets', icon: <Wallet className="w-4 h-4" />, count: availableWallets.length },
  //   { id: 'popular', label: 'Popular', icon: <ShieldCheck className="w-4 h-4" />, 
  //     count: availableWallets.filter(w => w.category === 'popular').length },
  //   { id: 'mobile', label: 'Mobile', icon: <Smartphone className="w-4 h-4" />, 
  //     count: availableWallets.filter(w => w.category === 'mobile').length },
  //   { id: 'browser', label: 'Browser', icon: <Monitor className="w-4 h-4" />, 
  //     count: availableWallets.filter(w => w.category === 'browser').length },
  //   { id: 'hardware', label: 'Hardware', icon: <Shield className="w-4 h-4" />, 
  //     count: availableWallets.filter(w => w.category === 'hardware').length },
  //   { id: 'web3', label: 'Web3', icon: <Globe className="w-4 h-4" />, 
  //     count: availableWallets.filter(w => w.category === 'web3').length },
  // ];

  // Categories for filtering
  const categories = [
    { id: 'all', label: 'All Wallets', icon: <Wallet className="w-4 h-4" />, count: availableWallets.length },
    { id: 'popular', label: 'Popular', icon: <ShieldCheck className="w-4 h-4" />, 
      count: availableWallets.filter(w => w.category === 'popular').length },
    { id: 'mobile', label: 'Mobile', icon: <Smartphone className="w-4 h-4" />, 
      count: availableWallets.filter(w => w.category === 'mobile').length },
    { id: 'browser', label: 'Browser', icon: <Monitor className="w-4 h-4" />, 
      count: availableWallets.filter(w => w.category === 'browser').length },
    { id: 'hardware', label: 'Hardware', icon: <Shield className="w-4 h-4" />, 
      count: availableWallets.filter(w => w.category === 'hardware').length },
    { id: 'web3', label: 'Web3', icon: <Globe className="w-4 h-4" />, 
      count: availableWallets.filter(w => w.category === 'web3').length },
  ];
  
  // Filter wallets based on category and search
  const filteredWallets = useMemo(() => {
    return availableWallets.filter(wallet => {
      // Filter by category
      if (selectedCategory !== 'all' && wallet.category !== selectedCategory) {
        return false;
      }
      
      // Filter by search query
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return wallet.name.toLowerCase().includes(query);
      }
      
      return true;
    }).sort((a, b) => {
      // Sort by readiness and then by name
      if (a.readyState !== b.readyState) {
        return a.readyState === WalletReadyState.Installed ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }, [availableWallets, selectedCategory, searchQuery]);
  
  const handleWalletClick = async (walletName: string) => {
    if (onWalletSelect) {
      onWalletSelect(walletName);
    } else {
      await connect(walletName);
    }
  };
  
  const getReadyStateInfo = (readyState: WalletReadyState) => {
    switch (readyState) {
      case WalletReadyState.Installed:
        return { 
          text: 'Installed', 
          color: 'text-green-400',
          bgColor: 'bg-green-900/30',
          borderColor: 'border-green-700/50'
        };
      case WalletReadyState.Loadable:
        return { 
          text: 'Loadable', 
          color: 'text-blue-400',
          bgColor: 'bg-blue-900/30',
          borderColor: 'border-blue-700/50'
        };
      case WalletReadyState.NotDetected:
        return { 
          text: 'Not Installed', 
          color: 'text-gray-400',
          bgColor: 'bg-gray-900/30',
          borderColor: 'border-gray-700/50'
        };
      default:
        return { 
          text: 'Unknown', 
          color: 'text-gray-400',
          bgColor: 'bg-gray-900/30',
          borderColor: 'border-gray-700/50'
        };
    }
  };

  const categoryStyles: Record<string, { bg: string; text: string; border: string }> = {
    popular: {
      bg: 'bg-yellow-900/30',
      text: 'text-yellow-400',
      border: 'border-yellow-700/50'
    },
    mobile: {
      bg: 'bg-purple-900/30',
      text: 'text-purple-400',
      border: 'border-purple-700/50'
    },
    browser: {
      bg: 'bg-blue-900/30',
      text: 'text-blue-400',
      border: 'border-blue-700/50'
    },
    hardware: {
      bg: 'bg-green-900/30',
      text: 'text-green-400',
      border: 'border-green-700/50'
    },
    web3: {
      bg: 'bg-cyan-900/30',
      text: 'text-cyan-400',
      border: 'border-cyan-700/50'
    },
    other: {
      bg: 'bg-gray-900/30',
      text: 'text-gray-400',
      border: 'border-gray-700/50'
    }
  };

  // Type guard to check if a category is not 'other'
  const isNotOtherCategory = (category: string): category is Exclude<typeof category, 'other'> => {
    return category !== 'other';
  };

  
  if (availableWallets.length === 0) {
    return (
      <div className="p-8 text-center">
        <AlertCircle className="w-12 h-12 text-gray-600 mx-auto mb-4" />
        <p className="text-gray-400">No wallets available</p>
        <p className="text-sm text-gray-500 mt-2">
          Please make sure you have a wallet extension installed or try refreshing the page.
        </p>
      </div>
    );
  }
  
  return (
    <div className="w-full max-w-lg bg-gray-900/95 border border-gray-700/50 rounded-xl shadow-2xl backdrop-blur-sm">
      {/* Header */}
      <div className="p-4 border-b border-gray-800/50">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">Select Wallet</h3>
            <p className="text-sm text-gray-400 mt-1">
              Connect to your preferred Solana wallet
            </p>
          </div>
          <div className="w-10 h-10 bg-gradient-to-br from-cyan-500/20 to-blue-500/20 rounded-lg flex items-center justify-center">
            <Wallet className="w-5 h-5 text-cyan-400" />
          </div>
        </div>
      </div>
      
      {/* Search Bar */}
      <div className="p-4 border-b border-gray-800/50">
        <div className="relative">
          <input
            type="text"
            placeholder="Search wallets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-gray-800/50 border border-gray-700/50 rounded-lg px-4 py-2.5 pl-10 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 transition-all"
          />
          <div className="absolute left-3 top-1/2 transform -translate-y-1/2">
            <div className="w-4 h-4 text-gray-500">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
      
      {/* Category Tabs */}
      {showCategoryTabs && (
        <div className="px-4 pt-4 pb-2 border-b border-gray-800/50">
          <div className="flex items-center gap-2 overflow-x-auto pb-2">
            {categories.map((category) => (
              <button
                key={category.id}
                onClick={() => setSelectedCategory(category.id)}
                className={`
                  flex items-center gap-2 px-3 py-1.5 rounded-lg whitespace-nowrap transition-all duration-200 flex-shrink-0
                  ${selectedCategory === category.id 
                    ? 'bg-gray-800 border border-gray-700/50' 
                    : 'hover:bg-gray-800/50'
                  }
                `}
              >
                <div className={`w-4 h-4 ${selectedCategory === category.id ? 'text-cyan-400' : 'text-gray-500'}`}>
                  {category.icon}
                </div>
                <span className={`text-sm ${selectedCategory === category.id ? 'text-white' : 'text-gray-400'}`}>
                  {category.label}
                </span>
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                  selectedCategory === category.id 
                    ? 'bg-cyan-900/30 text-cyan-400' 
                    : 'bg-gray-800 text-gray-500'
                }`}>
                  {category.count}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      
      {/* Wallets List */}
      <div className="p-4">
        <div 
          className="space-y-2 overflow-y-auto"
          style={{ maxHeight }}
        >
          {filteredWallets.length === 0 ? (
            <div className="text-center py-8">
              <div className="w-12 h-12 bg-gray-800/50 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-6 h-6 text-gray-600" />
              </div>
              <p className="text-gray-400">No wallets found</p>
              <p className="text-sm text-gray-500 mt-2">
                Try adjusting your search or selecting a different category
              </p>
            </div>
          ) : (
            filteredWallets.map((wallet) => {
              const readyStateInfo = getReadyStateInfo(wallet.readyState);
              const isMobileRecommended = isMobile && wallet.category === 'mobile';
              
              return (
                <button
                  key={wallet.name}
                  onClick={() => handleWalletClick(wallet.name)}
                  disabled={wallet.readyState === WalletReadyState.NotDetected}
                  title={wallet.readyState === WalletReadyState.NotDetected ? 
                    `${wallet.name} is not installed. Click for installation instructions.` : 
                    `Connect with ${wallet.name}`}
                  className={`
                    w-full flex items-center gap-3 p-3 rounded-lg transition-all duration-200 group
                    ${wallet.readyState === WalletReadyState.NotDetected 
                      ? 'opacity-60 cursor-not-allowed' 
                      : 'hover:bg-gray-800/50'
                    }
                  `}
                >
                  {/* Wallet Icon */}
                  <div className="relative">
                    {wallet.icon ? (
                      <img 
                        src={wallet.icon} 
                        alt={wallet.name} 
                        className="w-10 h-10 rounded-xl"
                      />
                    ) : (
                      <div className="w-10 h-10 bg-gradient-to-br from-gray-700 to-gray-800 rounded-xl flex items-center justify-center">
                        <Wallet className="w-5 h-5 text-gray-400" />
                      </div>
                    )}
                    
                    {/* Mobile Recommended Badge */}
                    {isMobileRecommended && (
                      <div className="absolute -top-1 -right-1 w-5 h-5 bg-gradient-to-br from-purple-600 to-pink-600 rounded-full flex items-center justify-center border border-gray-900">
                        <Smartphone className="w-2.5 h-2.5 text-white" />
                      </div>
                    )}
                  </div>
                  
                  {/* Wallet Info */}
                  <div className="flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-white group-hover:text-cyan-300 transition-colors">
                        {wallet.name}
                      </span>
                      
                      {/* Category Tag */}
                      {isNotOtherCategory(wallet.category) && (
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${categoryStyles[wallet.category].bg} ${categoryStyles[wallet.category].text} ${categoryStyles[wallet.category].border}`}>
                          {wallet.category}
                        </span>
                      )}

                    </div>
                    
                    {/* Ready State */}
                    <div className="flex items-center gap-2 mt-1">
                      <div className={`w-2 h-2 rounded-full ${readyStateInfo.color.replace('text-', 'bg-')}`} />
                      <span className={`text-xs ${readyStateInfo.color}`}>
                        {readyStateInfo.text}
                      </span>
                    </div>
                  </div>
                  
                  {/* Install/Connect Button */}
                  <div className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200
                    ${wallet.readyState === WalletReadyState.Installed 
                      ? 'bg-gradient-to-r from-cyan-600/90 to-blue-600/90 text-white group-hover:from-cyan-700 group-hover:to-blue-700' 
                      : 'bg-gray-800/50 text-gray-400'
                    }
                  `}>
                    {wallet.readyState === WalletReadyState.Installed ? 'Connect' : 'Install'}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
      
      {/* Footer */}
      <div className="p-4 border-t border-gray-800/50 bg-gray-900/50">
        <div className="text-xs text-gray-500 flex items-center justify-between">
          <span>
            Showing {filteredWallets.length} of {availableWallets.length} wallets
          </span>
          <div className="flex items-center gap-1">
            <RefreshCw className="w-3 h-3" />
            <span>Auto-detected</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// Balance Display Component
export const BalanceDisplay: React.FC<{
  showLabel?: boolean;
  showIcon?: boolean;
  showCurrency?: boolean;
  size?: 'sm' | 'md' | 'lg';
  precision?: number;
}> = ({ 
  showLabel = true, 
  showIcon = true, 
  showCurrency = true,
  size = 'md',
  precision = 3
}) => {
  const { balance, balanceLoading, connected, refreshBalance } = useWallet();
  
  const formatBalance = (bal: number | null) => {
    if (bal === null) return '--.--';
    if (bal < 0.001) return '<0.001';
    return bal.toFixed(precision);
  };
  
  const sizeClasses = {
    sm: {
      text: 'text-sm',
      icon: 'w-4 h-4',
      container: 'gap-2',
    },
    md: {
      text: 'text-lg',
      icon: 'w-5 h-5',
      container: 'gap-3',
    },
    lg: {
      text: 'text-2xl',
      icon: 'w-6 h-6',
      container: 'gap-4',
    },
  };
  
  const currentSize = sizeClasses[size];
  
  return (
    <div className="flex items-center">
      {showIcon && (
        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center ${currentSize.container}`}>
          <div className={`text-cyan-400 ${currentSize.icon}`}>
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        </div>
      )}
      
      <div className="ml-3">
        {showLabel && (
          <div className="text-xs text-gray-400">
            {connected ? 'Available Balance' : 'Not Connected'}
          </div>
        )}
        
        <div className={`flex items-center ${currentSize.container}`}>
          <span className={`font-bold text-white ${currentSize.text}`}>
            {balanceLoading ? (
              <div className="flex items-center gap-2">
                <Loader2 className={`animate-spin ${currentSize.icon}`} />
                <span className="text-sm">Loading...</span>
              </div>
            ) : (
              formatBalance(balance)
            )}
          </span>
          
          {showCurrency && connected && (
            <span className="text-gray-400">SOL</span>
          )}
          
          {connected && (
            <button
              onClick={refreshBalance}
              className="p-1 hover:bg-gray-800/50 rounded-lg transition-colors"
              title="Refresh balance"
            >
              <RefreshCw className={`text-gray-500 hover:text-cyan-400 ${currentSize.icon}`} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// Quick Actions Bar Component
export const WalletQuickActions: React.FC = () => {
  const { 
    connected, 
    publicKey, 
    disconnect, 
    network, 
    switchNetwork,
    availableWallets
  } = useWallet();
  const [showNetworks, setShowNetworks] = useState(false);
  const [showWallets, setShowWallets] = useState(false);
  
  const handleNetworkSwitch = (newNetwork: WalletAdapterNetwork) => {
    switchNetwork(newNetwork);
    setShowNetworks(false);
  };
  
  const networks = [
    { 
      name: 'Mainnet', 
      value: WalletAdapterNetwork.Mainnet, 
      color: 'bg-green-500',
      icon: <ShieldCheck className="w-4 h-4" />
    },
    { 
      name: 'Testnet', 
      value: WalletAdapterNetwork.Testnet, 
      color: 'bg-yellow-500',
      icon: <Cpu className="w-4 h-4" />
    },
    { 
      name: 'Devnet', 
      value: WalletAdapterNetwork.Devnet, 
      color: 'bg-blue-500',
      icon: <Cpu className="w-4 h-4" />
    },
  ];
  
  if (!connected) {
    return (
      <div className="flex items-center gap-2 p-4 bg-gray-800/50 rounded-xl border border-gray-700/50">
        <div className="w-10 h-10 bg-gradient-to-br from-gray-700 to-gray-800 rounded-lg flex items-center justify-center">
          <Wallet className="w-5 h-5 text-gray-400" />
        </div>
        <div>
          <div className="text-sm font-medium text-white">No wallet connected</div>
          <div className="text-xs text-gray-400">Connect to get started</div>
        </div>
      </div>
    );
  }
  
  const quickWallets = availableWallets
    .filter(w => w.category === 'popular')
    .slice(0, 3);
  
  return (
    <div className="bg-gray-800/30 border border-gray-700/50 rounded-xl p-4 backdrop-blur-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm font-medium text-white">Quick Actions</div>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            network === WalletAdapterNetwork.Mainnet ? 'bg-green-500' :
            network === WalletAdapterNetwork.Testnet ? 'bg-yellow-500' :
            'bg-blue-500'
          }`} />
          <span className="text-xs text-gray-400 capitalize">
            {network.replace('-beta', '')}
          </span>
        </div>
      </div>
      
      <div className="flex flex-wrap gap-2">
        {/* Network Switch */}
        <div className="relative">
          <button
            onClick={() => setShowNetworks(!showNetworks)}
            className="flex items-center gap-2 px-3 py-2 bg-gray-700/50 hover:bg-gray-700 rounded-lg transition-colors border border-gray-600/50"
          >
            <Globe className="w-4 h-4 text-gray-400" />
            <span className="text-sm text-white">Switch Network</span>
            <ChevronDown className="w-3 h-3 text-gray-400" />
          </button>
          
          {showNetworks && (
            <div className="absolute top-full mt-1 left-0 w-48 bg-gray-900/95 border border-gray-700/50 rounded-lg shadow-lg z-50 backdrop-blur-sm">
              {networks.map((net) => (
                <button
                  key={net.value}
                  onClick={() => handleNetworkSwitch(net.value)}
                  className={`w-full flex items-center gap-2 p-2 text-sm transition-colors ${
                    network === net.value 
                      ? 'bg-gray-800 text-white' 
                      : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
                  }`}
                >
                  <div className={`w-2 h-2 rounded-full ${net.color}`} />
                  <span>{net.name}</span>
                  {network === net.value && (
                    <CheckCircle className="w-3 h-3 ml-auto text-green-400" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
        
        {/* Quick Wallet Switches */}
        {quickWallets.map((wallet) => (
          <button
            key={wallet.name}
            onClick={() => console.log('Switch to', wallet.name)}
            className="flex items-center gap-2 px-3 py-2 bg-gray-700/50 hover:bg-gray-700 rounded-lg transition-colors border border-gray-600/50"
            title={`Switch to ${wallet.name}`}
          >
            {wallet.icon ? (
              <img src={wallet.icon} alt={wallet.name} className="w-4 h-4 rounded" />
            ) : (
              <Wallet className="w-4 h-4 text-gray-400" />
            )}
            <span className="text-sm text-white hidden sm:inline">
              {wallet.name.split(' ')[0]}
            </span>
          </button>
        ))}
        
        {/* Disconnect */}
        <button
          onClick={disconnect}
          className="flex items-center gap-2 px-3 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 hover:text-red-300 rounded-lg transition-colors border border-red-700/50"
        >
          <LogOut className="w-4 h-4" />
          <span className="text-sm">Disconnect</span>
        </button>
        
        {/* View on Explorer */}
        {publicKey && (
          <a
            href={`https://explorer.solana.com/address/${publicKey.toString()}?cluster=${network}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-400 hover:text-cyan-300 rounded-lg transition-colors border border-cyan-700/50"
          >
            <ExternalLink className="w-4 h-4" />
            <span className="text-sm hidden sm:inline">Explorer</span>
          </a>
        )}
      </div>
      
      {/* View All Wallets Button */}
      <button
        onClick={() => setShowWallets(true)}
        className="w-full mt-4 py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-800/50 rounded-lg transition-colors border border-gray-700/50"
      >
        View All Available Wallets
      </button>
      
      {/* Enhanced Wallet Selector Modal */}
      {showWallets && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="relative">
            <EnhancedWalletSelector 
              maxHeight="70vh"
              onWalletSelect={(walletName) => {
                console.log('Selected wallet:', walletName);
                setShowWallets(false);
              }}
            />
            <button
              onClick={() => setShowWallets(false)}
              className="absolute -top-2 -right-2 w-8 h-8 bg-gray-900 border border-gray-700 rounded-full flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// Export types and utilities
export type { WalletContextType };
export { WalletAdapterNetwork, WalletReadyState };

export default {
  WalletProvider,
  useWallet,
  WalletConnectButton,
  NetworkSelector,
  EnhancedWalletSelector,
  BalanceDisplay,
  WalletQuickActions,
};
