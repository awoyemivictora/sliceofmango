import { useTradeMonitor } from '@/hooks/useTradeMonitor';
import { executeTrade } from '@/services/trade';
import { getOrCreateWallet } from '@/utils/wallet';
import { clusterApiUrl, Connection } from '@solana/web3.js';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import bs58 from 'bs58';

interface Transaction {
  id: string;
  type: 'launch' | 'sell' | 'execution' | 'attempt';
  message: string;
  timestamp: string;
  links?: Array<{
    text: string;
    url: string;
    color: string;
  }>;
}

const TurboSniperDashboard: React.FC = () => {

  const transactions: Transaction[] = [
    {
      id: '1',
      type: 'launch',
      message: 'Starting to observe new token launches',
      timestamp: '22nd September 2026 at 10:30am'
    },
    {
      id: '2',
      type: 'sell',
      message: 'Sell transaction confirmed. View transaction on:',
      timestamp: '5th November 2024 at 1:15pm',
      links: [
        { text: 'Solscan', url: '#', color: 'text-primary' },
        { text: 'Dexscreener', url: '#', color: 'text-primary' },
        { text: 'Swap on Gmgn.ai', url: '#', color: 'text-primary' }
      ]
    },
    {
      id: '3',
      type: 'execution',
      message: 'Transaction executed. Starting confirmation process',
      timestamp: '30th March 2023 at 8:00pm'
    },
    {
      id: '4',
      type: 'attempt',
      message: 'Send sell transaction attempt',
      timestamp: '12th January 2027 at 4:00pm'
    }
  ];





  const [activeTab, setActiveTab] = useState<'logs' | 'transactions'>('logs');
  const [activeWalletTab, setActiveWalletTab] = useState<'wallet' | 'buysell'>('wallet');
  const [showCopyMessage, setShowCopyMessage] = useState<string | null>(null);
  const [walletKeypair, setWalletKeypair] = useState<import('@solana/web3.js').Keypair | null>(null);
  const [walletAddress, setWalletAddress] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [privateKeyString, setPrivateKeyString] = useState('');
  const [balance, setBalance] = useState(0);
  const [copied, setCopied] = useState(false);
  const [authToken, setAuthToken] = useState(localStorage.getItem('authToken') || null);
  const [isRegistered, setIsRegistered] = useState(!!localStorage.getItem('authToken'));
  const [tradeLogs, setTradeLogs] = useState<string[]>([]);
  const tradeLogsRef = useRef<HTMLDivElement>(null); // Ref for auto-scrolling
  const websocketRef = useRef<WebSocket | null>(null); // Ref for WebSocket connection

  // NEW STATE: For bot running status
  const [isBotRunning, setIsBotRunning] = useState(false);
  // NEW STATE: For bot settings
  const [botSettings, setBotSettings] = useState({
    buy_amount_sol: 0.05,
    buy_priority_fee_lamports: 1_000_000,
    buy_slippage_bps: 500,
    sell_take_profit_pct: 50.0,
    sell_stop_loss_pct: 10.0,
    sell_timeout_seconds: 300,
    sell_priority_fee_lamports: 1_000_000,
    sell_slippage_bps: 500,
    enable_trailing_stop_loss: false,
    trailing_stop_loss_pct: null,
    filter_socials_added: true,
    filter_liquidity_burnt: true,
    filter_immutable_metadata: true,
    filter_mint_authority_renounced: true,
    filter_freeze_authority_revoked: true,
    filter_pump_fun_migrated: true,
    filter_check_pool_size_min_sol: 0.5,
    filter_top_holders_max_pct: null,
    filter_bundled_max: null,
    filter_max_same_block_buys: null,
    filter_safety_check_period_seconds: null,
    bot_check_interval_seconds: 30,
    is_premium: false, // Assuming this comes from backend too, default to false
    // Add any other relevant settings from your User model
  });


  interface TradeLog {
    timestamp: string;
    message: string;
  }

  type LogToUIFn = (message: string) => void;

  const handleTabClick = (tab: 'logs' | 'transactions') => {
    setActiveTab(tab);
  };

  const handleWalletTabClick = (tab: 'wallet' | 'buysell') => {
    setActiveWalletTab(tab);
  };

  const handleCopyAddress = async () => {
    try {
      await navigator.clipboard.writeText(walletAddress);
      setShowCopyMessage('address');
      setTimeout(() => setShowCopyMessage(null), 2000);
    } catch (err) {
      console.error('Failed to copy address:', err);
    }
  };

  // const handleCopyPrivateKey = async () => {
  //   const privateKey = 'your-private-key-here';
  //   try {
  //     await navigator.clipboard.writeText(privateKey);
  //     setShowCopyMessage('key');
  //     setTimeout(() => setShowCopyMessage(null), 2000);
  //   } catch (err) {
  //     console.error('Failed to copy private key:', err);
  //   }
  // };

  // const handleCopyPrivateKey = () => {
  //   navigator.clipboard.writeText(privateKeyString);
  //   setCopied(true);
  //   setTimeout(() => setCopied(false), 2000);
  // };

  // Function to handle copying the private key
  const handleCopyPrivateKey = async () => {
    // Make sure privateKeyString actually contains the key you want to copy
    if (!privateKeyString) {
      console.error("Private key not available for copying.");
      setShowCopyMessage('error'); // Show error if key is missing
      setTimeout(() => setShowCopyMessage(null), 2000);
      return;
    }

    try {
      await navigator.clipboard.writeText(privateKeyString);
      setShowCopyMessage('key'); // Set message to 'key' for success
      setTimeout(() => setShowCopyMessage(null), 2000); // Hide after 2 seconds
    } catch (err) {
      console.error('Failed to copy private key:', err);
      setShowCopyMessage('error'); // Set message to 'error' for failure
      setTimeout(() => setShowCopyMessage(null), 2000); // Hide after 2 seconds
    }
  };


  const logToUI: LogToUIFn = useCallback((message: string) => {
    setTradeLogs((prevLogs: string[]) => [
      ...prevLogs,
      `[${new Date().toLocaleTimeString()}] ${message}`,
    ]);
  }, []);

  useTradeMonitor(walletKeypair, walletAddress, authToken, logToUI);

  const connection = new Connection(clusterApiUrl('mainnet-beta'), 'confirmed');

  // Auto-scroll when new logs are added
  useEffect(() => {
    if (tradeLogsRef.current) {
      tradeLogsRef.current.scrollTop = tradeLogsRef.current.scrollHeight;
    }
  }, [tradeLogs]);


  interface FetchBalanceFn {
    (publicKey: import('@solana/web3.js').PublicKey): Promise<void>;
  }

  const fetchBalance: FetchBalanceFn = useCallback(async (publicKey) => {
    try {
      const lamports: number = await connection.getBalance(publicKey);
      setBalance(lamports / 1_000_000_000);
      logToUI(`Balance updated: ${lamports / 1_000_000_000} SOL`);
    } catch (error: any) {
      console.error("Error fetching balance:", error);
      setBalance(0);
      logToUI(`Error fetching balance: ${error.message}`);
    }
  }, [connection, logToUI]);

  interface RegisterWalletResponse {
    access_token: string;
    [key: string]: any;
  }

  interface RegisterWalletError {
    detail?: string;
    [key: string]: any;
  }

  interface RegisterWalletBody {
    wallet_address: string;
    encrypted_private_key_bundle: string;
  }

  const registerWalletWithBackend = useCallback(
    async (keypair: import('@solana/web3.js').Keypair): Promise<void> => {
      const pubKey: string = keypair.publicKey.toBase58();
      const privateKeyBytes: Uint8Array = keypair.secretKey;

      const privateKeyBase64: string = btoa(JSON.stringify(Array.from(privateKeyBytes)));

      try {
        const response: Response = await fetch('https://api-v1.flashsnipper.com/auth/register-or-login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            wallet_address: pubKey,
            encrypted_private_key_bundle: privateKeyBase64,
          } as RegisterWalletBody),
        });

        if (!response.ok) {
          const errorData: RegisterWalletError = await response.json();
          throw new Error(errorData.detail || 'Failed to register/login wallet with backend.');
        }

        const data: RegisterWalletResponse = await response.json();
        localStorage.setItem('authToken', data.access_token);
        setAuthToken(data.access_token);
        setIsRegistered(true);
        logToUI("Wallet successfully registered/logged in with backend.");
        console.log("Wallet successfully registered/logged in wallet with backend. Token:", data.access_token);
      } catch (error: any) {
        logToUI(`Error registering/logging in wallet with backend: ${error.message}`);
        console.error("Error registering/logging in wallet with backend:", error);
      }
    },
    [logToUI]
  );

  // Fetches user bot settings on component mount or when auth/wallet changes
  useEffect(() => {
    const fetchUserSettings = async () => {
      if (authToken && walletAddress) {
        try {
          const response = await fetch(`https://api-v1.flashsnipper.com/user/settings/${walletAddress}`, { // Adjusted path to /user/settings
            headers: {
              'Authorization': `Bearer ${authToken}`
            }
          });
          if (!response.ok) {
            throw new Error('Failed to fetch user settings');
          }
          const settingsData = await response.json();
          setBotSettings(prevSettings => ({
            ...prevSettings,
            ...settingsData,
            filter_top_holders_max_pct: settingsData.filter_top_holders_max_pct || null,
            trailing_stop_loss_pct: settingsData.trailing_stop_loss_pct || null,
            // Ensure is_premium is correctly set from backend response
            is_premium: settingsData.is_premium || false,
          }));
          logToUI("User bot settings loaded.");
        } catch (error) {
          logToUI(`Error loading user settings: ${error instanceof Error ? error.message : String(error)}`);
          console.error("Error loading user settings:", error);
        }
      }
    };

    fetchUserSettings();
  }, [authToken, walletAddress, logToUI]);


  useEffect(() => {
    const keypair = getOrCreateWallet();
    setWalletKeypair(keypair);
    const address = keypair.publicKey.toBase58();
    setWalletAddress(address);

    try {
      const storedKeyBase64 = localStorage.getItem('solana_bot_pk_base64');
      if (!storedKeyBase64) throw new Error("No key in storage");

      const privateKeyBytes = new Uint8Array(JSON.parse(atob(storedKeyBase64)));
      const base58PrivateKey = bs58.encode(privateKeyBytes);
      setPrivateKeyString(base58PrivateKey);
    } catch (e) {
      console.error("Error displaying private key:", e);
      setPrivateKeyString("Error: Could not display private key.");
    }

    fetchBalance(keypair.publicKey);

    if (!isRegistered && keypair) {
      registerWalletWithBackend(keypair);
    }
  }, [fetchBalance, isRegistered, registerWalletWithBackend]);

  // WebSocket connection for real-time logs
  useEffect(() => {
    if (walletAddress && authToken && !websocketRef.current) {
      const wsUrl = `ws://api-v1.flashsnipper.com/ws/connect/${walletAddress}?token=${authToken}`; // Adjust WS URL
      websocketRef.current = new WebSocket(wsUrl);

      websocketRef.current.onopen = () => {
        logToUI("WebSocket connection established.");
      };

      websocketRef.current.onmessage = (event) => {
        const message = JSON.parse(event.data);
        logToUI(`WS Message: ${JSON.stringify(message)}`);

        if (message.type === "trade_instruction" && walletKeypair) {
          logToUI(`Received trade instruction from backend: ${message.message}`);
          executeTrade(walletKeypair, walletAddress, authToken, {
            mint_address: message.mint_address,
            amount_sol: message.amount_sol,
            trade_type: message.trade_type,
            token_symbol: message.token_symbol || "UNKNOWN", // Ensure symbol is passed
            // Pass user's current slippage, priority fees from botSettings
            slippage_bps: botSettings.buy_slippage_bps,
            priority_fee_lamports: botSettings.buy_priority_fee_lamports
          });
        } else if (message.type === "log") {
          logToUI(`Bot Log: ${message.message}`);
        } else if (message.type === "bot_status") {
          setIsBotRunning(message.status === "running"); // Update UI based on bot status
          logToUI(`Bot Status: ${message.status}`);
        } else if (message.type === "trade_update") {
          logToUI(`Trade Update for ${message.mint_address}: ${message.status} (TX: ${message.tx_hash || 'N/A'})`);
          // Here you would typically update a state for transaction history
          // For example, if you had a `const [transactions, setTransactions] = useState([]);`
          // setTransactions(prev => [...prev, message]);
        }
      };

      websocketRef.current.onerror = (error) => {
        logToUI(`WebSocket Error: ${error instanceof ErrorEvent && error.message ? error.message : "Unknown error"}`);
        console.error("WebSocket Error:", error);
      };

      websocketRef.current.onclose = () => {
        logToUI("WebSocket connection closed. Attempting to reconnect in 5 seconds...");
        websocketRef.current = null; // Reset ref
        // Only attempt to reconnect if wallet and auth token are still present
        setTimeout(() => {
          if (walletAddress && authToken && !websocketRef.current) {
            // Re-establish the connection by setting up a new WebSocket instance
            const wsUrl = `ws://localhost:8000/ws/connect/${walletAddress}?token=${authToken}`;
            websocketRef.current = new WebSocket(wsUrl);
            // It's crucial to re-attach ALL event handlers (onopen, onmessage, onerror, onclose)
            // A more robust solution would abstract this into a custom hook (e.g., useWebSocket)
            websocketRef.current.onopen = () => logToUI("WebSocket connection re-established.");
            websocketRef.current.onmessage = (event) => { /* ... existing onmessage logic ... */ };
            websocketRef.current.onerror = (error) => { /* ... existing onerror logic ... */ };
            websocketRef.current.onclose = () => { /* ... existing onclose logic with recursion prevention ... */ };
          }
        }, 5000);
      };

      return () => {
        if (websocketRef.current) {
          websocketRef.current.close();
        }
      };
    }
  }, [walletAddress, authToken, walletKeypair, logToUI, botSettings]); // Added botSettings to dependencies


  const handleCheckSolDeposit = () => {
    if (walletKeypair) {
      fetchBalance(walletKeypair.publicKey);
    }
  };

  const handleRunBot = async () => {
    if (!authToken || !walletAddress) {
      alert("Please ensure wallet is registered and you have an auth token.");
      return;
    }
    logToUI("Sending request to backend to start bot/monitoring...");
    try {
      const response = await fetch('https://api-v1.flashsnipper.com/bot/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ wallet_address: walletAddress })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || 'Failed to start bot.');
      }
      logToUI(`Bot start request: ${data.status}`);
      setIsBotRunning(true); // Set to true on success
      console.log(data);
    } catch (error) {
      logToUI(`Error starting bot: ${error instanceof Error ? error.message : String(error)}`);
      console.error("Error starting bot:", error);
    }
  };

  // NEW FUNCTION: handleStopBot
  const handleStopBot = async () => {
    if (!authToken || !walletAddress) {
      alert("Wallet not authenticated.");
      return;
    }
    logToUI("Sending request to backend to stop bot...");
    try {
      const response = await fetch('https://api-v1.flashsnipper.com/bot/stop', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ wallet_address: walletAddress })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || 'Failed to stop bot.');
      }
      logToUI(`Bot stop request: ${data.status}`);
      setIsBotRunning(false); // Set to false on success
    } catch (error) {
      logToUI(`Error stopping bot: ${error instanceof Error ? error.message : String(error)}`);
      console.error("Error stopping bot:", error);
    }
  };

  const handleManualBuy = async () => {
    if (!walletKeypair || !authToken || !walletAddress) {
      alert("Wallet not loaded or not authenticated.");
      return;
    }
    logToUI("Attempting manual BUY trade...");
    const result = await executeTrade(walletKeypair, walletAddress, authToken, {
      mint_address: "EPjFWdd5AufqSSqeM2qN1xzybapTVG4itwqZNfwpPJ", // Example: USDC
      amount_sol: 0.001, // Buy with 0.001 SOL
      trade_type: "buy",
      token_symbol: "USDC",
      slippage_bps: botSettings.buy_slippage_bps, // Use user's configured slippage
      priority_fee_lamports: botSettings.buy_priority_fee_lamports // Use user's configured priority fee
    });
    if (result.success) {
      logToUI("Manual BUY trade initiated successfully!");
    } else {
      logToUI(`Manual BUY trade failed: ${result.error}`);
    }
  };

  const handleManualSell = async () => {
    if (!walletKeypair || !authToken || !walletAddress) {
      alert("Wallet not loaded or not authenticated.");
      return;
    }
    logToUI("Attempting manual SELL trade...");
    const result = await executeTrade(walletKeypair, walletAddress, authToken, {
      mint_address: "EPjFWdd5AufqSSqeM2qN1xzybapTVG4itwqZNfwpPJ", // Example: USDC
      amount_sol: 1, // Sell 1 USDC (human-readable amount)
      trade_type: "sell",
      token_symbol: "USDC",
      previousBuyPrice: 1, // Example: Assume 1 USDC was bought for $1
      slippage_bps: botSettings.sell_slippage_bps, // Use user's configured slippage
      priority_fee_lamports: botSettings.sell_priority_fee_lamports // Use user's configured priority fee
    });
    if (result.success) {
      logToUI("Manual SELL trade initiated successfully!");
    } else {
      logToUI(`Manual SELL trade failed: ${result.error}`);
    }
  };

  // NEW FUNCTION: handleSaveBotSettings
  interface SaveBotSettingsEvent extends React.FormEvent<HTMLFormElement> {}

  interface SaveBotSettingsResponse {
    [key: string]: any;
  }

  interface SaveBotSettingsError {
    detail?: string;
    [key: string]: any;
  }

  const handleSaveBotSettings = useCallback(
    async (event: SaveBotSettingsEvent): Promise<void> => {
      event.preventDefault();
      if (!authToken || !walletAddress) {
        alert("Please ensure wallet is registered and you have an auth token.");
        return;
      }
      logToUI("Saving bot settings...");
      try {
        const response: Response = await fetch(
          `https://api-v1.flashsnipper.com/user/settings/${walletAddress}`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${authToken}`,
            },
            body: JSON.stringify(botSettings),
          }
        );

        const data: SaveBotSettingsResponse = await response.json();
        if (!response.ok) {
          const errorData: SaveBotSettingsError = data;
          throw new Error(errorData.detail || 'Failed to save bot settings.');
        }
        logToUI("Bot settings saved successfully!");
        console.log("Saved settings response:", data);
      } catch (error: any) {
        logToUI(`Error saving bot settings: ${error.message}`);
        console.error("Error saving bot settings:", error);
      }
    },
    [authToken, walletAddress, botSettings, logToUI]
  );


  if (!walletKeypair) return <div>Loading wallet...</div>;




  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-[#10b98166] to-secondary">
      <div className="flex flex-col h-screen">
        {/* Header */}
        <header className="bg-primary border-b border-[#ffffff21] h-16 flex items-center justify-between px-8">
          <div className="flex items-center gap-4">
            <img 
              src="/images/img_frame_1171277880.svg" 
              alt="Turbo Sniper Logo" 
              className="w-3 h-3"
            />
            <div className="text-white font-inter font-black text-[13px] leading-[17px]">
              <span className="text-white">TURBO </span>
              <span className="text-success">SNIPER</span>
            </div>
          </div>
          <div className="flex items-center gap-8">
            <button className="text-white font-satoshi font-medium text-[13px] leading-[18px] hover:text-success transition-colors">
              Documentation
            </button>
            <button className="text-white font-satoshi font-medium text-[13px] leading-[18px] hover:text-success transition-colors">
              Frequently Asked Questions
            </button>
          </div>
        </header>

        {/* Main Content */}
        <div className="flex-1 flex flex-col relative">
          {/* Hero Section with Background */}
          <div 
            className="relative h-[341px] flex flex-col items-center justify-center text-center"
            style={{
              backgroundImage: `url('/images/img_grid_layers_v2.png')`,
              backgroundSize: 'cover',
              backgroundPosition: 'center'
            }}
          >
            <div className="text-white font-satoshi font-black text-[19px] leading-[27px] mb-6">
              Welcome to
            </div>
            <div className="flex items-center gap-4 mb-8">
              <img 
                src="/images/img_frame_1171277880.svg" 
                alt="Turbo Sniper Logo" 
                className="w-[34px] h-[34px]"
              />
              <div className="text-white font-inter font-black text-[37px] leading-[46px]">
                <span className="text-white">TURBO </span>
                <span className="text-success">SNIPER</span>
              </div>
            </div>
            <p className="text-white font-satoshi font-medium text-[13px] leading-[15px] max-w-[602px] mb-8">
              Velocity. Security. Accuracy. Take control of the Solana market with the quickest and most reliable 
              sniper tool available. Your advantage in the Solana market begins now. Are you prepared to snipe with 
              assurance?
            </p>
            <div className="flex flex-col items-center">
              <div className="text-white font-satoshi font-medium text-[14px] leading-[19px] mb-2">
                Scroll down to snipe
              </div>
              <div className="w-px h-[18px] bg-white"></div>
            </div>
          </div>

          {/* Bottom Section */}


          <div className="flex flex-1">
            {/* Logs/Transactions Panel */}
            <div className="w-[823px] bg-secondary border-l border-[#ffffff21]">
              {/* Tab Navigation */}
              <div className="bg-primary border-t border-b border-[#ffffff1e] flex">
                <button
                  onClick={() => handleTabClick('logs')}
                  className={`flex items-center gap-3 px-14 py-4 border-b-2 transition-colors ${
                    activeTab === 'logs' ? 'border-success text-success' : 'border-transparent text-white hover:text-success'
                  }`}
                >
                  <img
                    src="/images/img_license.svg"
                    alt="Logs"
                    className="w-4 h-4"
                  />
                  <span className="font-satoshi font-medium text-[13px] leading-[18px]">
                    Logs
                  </span>
                </button>
                <button
                  onClick={() => handleTabClick('transactions')}
                  className={`flex items-center gap-3 px-14 py-4 border-b-2 transition-colors ${
                    activeTab === 'transactions' ? 'border-success text-success' : 'border-transparent text-white hover:text-success'
                  }`}
                >
                  <img
                    src="/images/img_transactionhistory.svg"
                    alt="Transactions"
                    className="w-4 h-4"
                  />
                  <span className="font-satoshi font-medium text-[13px] leading-[18px]">
                    Transactions
                  </span>
                </button>
              </div>

              {/* Conditional Content Area based on activeTab */}
              {activeTab === 'logs' && (
                <div className="p-4 space-y-6 h-full overflow-y-auto">
                  {/* Content specifically for the Logs tab */}
                  {/* You'll likely map over a 'logs' array here, not 'transactions' */}
                  {/* For now, just a placeholder or the same transaction list for demonstration */}
                  {/* If your 'transactions' array also serves as 'logs', you can keep the map */}
                  {/* Otherwise, introduce a separate state for 'logs' data */}
                  {transactions.map((transaction) => ( // Assuming 'transactions' also represents logs for now
                    <div key={transaction.id} className="space-y-2">
                      <div className="text-white font-satoshi font-medium text-[13px] leading-[18px]">
                        {transaction.message}
                        {transaction.links && (
                          <span className="ml-1">
                            {transaction.links.map((link, index) => (
                              <span key={index}>
                                <a
                                  href={link.url}
                                  className={`${link.color} hover:underline`}
                                >
                                  {link.text}
                                </a>
                                {index < transaction.links!.length - 1 && ' '}
                              </span>
                            ))}
                            <span className="text-white"> Transaction confirmed</span>
                          </span>
                        )}
                      </div>
                      <div className="text-secondary font-satoshi font-medium text-[11px] leading-[15px]">
                        {transaction.timestamp}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'transactions' && (
                <div className="p-4 space-y-6 h-full overflow-y-auto">
                  {/* Content specifically for the Transactions tab */}
                  {/* This is where you would typically map over your 'transactions' data */}
                  {/* <div className="text-white">This is the Transactions content.</div> */}
                  {/* {transactions.map((transaction) => ( // This is your original transaction mapping
                    <div key={transaction.id} className="space-y-2">
                      <div className="text-white font-satoshi font-medium text-[13px] leading-[18px]">
                        {transaction.message}
                        {transaction.links && (
                          <span className="ml-1">
                            {transaction.links.map((link, index) => (
                              <span key={index}>
                                <a
                                  href={link.url}
                                  className={`${link.color} hover:underline`}
                                >
                                  {link.text}
                                </a>
                                {index < transaction.links!.length - 1 && ' '}
                              </span>
                            ))}
                            <span className="text-white"> Transaction confirmed</span>
                          </span>
                        )}
                      </div>
                      <div className="text-secondary font-satoshi font-medium text-[11px] leading-[15px]">
                        {transaction.timestamp}
                      </div>
                    </div>
                  ))} */}
                </div>
              )}
            </div>

            {/* Wallet Panel (your existing code for this panel) */}
            <div className="flex-1 bg-overlay border-l border-[#ffffff21]">
              {/* Tab Navigation */}
              <div className="bg-primary border-t border-b border-[#ffffff1e] flex">
                <button
                  onClick={() => handleWalletTabClick('wallet')}
                  className={`flex items-center gap-3 px-8 py-4 border-b-2 transition-colors ${
                    activeWalletTab === 'wallet'
                      ? 'border-success text-success' : 'border-transparent text-white hover:text-success'
                  }`}
                >
                  <img
                    src="/images/img_wallet01.svg"
                    alt="Wallet"
                    className="w-4 h-4"
                  />
                  <span className="font-satoshi font-medium text-[13px] leading-[18px]">
                    Wallet
                  </span>
                </button>
                <button
                  onClick={() => handleWalletTabClick('buysell')}
                  className={`flex items-center gap-3 px-8 py-4 border-b-2 transition-colors ${
                    activeWalletTab === 'buysell' ? 'border-success text-success' : 'border-transparent text-white hover:text-success'
                  }`}
                >
                  <img
                    src="/images/img_exchange01.svg"
                    alt="Buy/Sell"
                    className="w-4 h-4"
                  />
                  <span className="font-satoshi font-medium text-[13px] leading-[18px]">
                    Buy/Sell
                  </span>
                </button>
              </div>

              {/* Wallet Content */}
              {activeWalletTab === 'wallet' && (
                <div className="p-4 space-y-4">
                  {/* Wallet Card */}
                  <div className="bg-dark-2 rounded-lg border border-[#262944] shadow-lg">
                    <div className="flex items-center gap-3 p-4 border-b border-[#000010] shadow-sm">
                      <img
                        src="/images/img_wallet01_white_a700.svg"
                        alt="Wallet"
                        className="w-[18px] h-[18px]"
                      />
                      <span className="text-light font-satoshi font-medium text-[13px] leading-[18px]">
                        Your Wallet
                      </span>
                    </div>

                    <div className="p-3 space-y-3">
                      {/* Wallet Address */}
                      <div className="relative">
                        <input
                          type="text"
                          value={walletAddress}
                          readOnly
                          className="w-full bg-primary border border-[#20233a] rounded-lg px-3 py-3 text-white font-satoshi font-medium text-[13px] leading-[18px] shadow-sm"
                        />
                        {showCopyMessage === 'address' && (
                          <div className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-success text-white px-2 py-1 rounded text-xs">
                            Copied!
                          </div>
                        )}
                      </div>

                      {/* Action Buttons */}
                      <div className="flex gap-2">
                        <button
                          onClick={handleCopyAddress}
                          className="flex-1 bg-accent border-t border-[#22253e] rounded-lg px-3 py-3 text-success font-satoshi font-medium text-[13px] leading-[18px] hover:bg-opacity-80 transition-colors shadow-sm"
                        >
                          Copy address
                        </button>
                        <button
                          onClick={handleCopyPrivateKey}
                          className="flex-1 bg-accent border-t border-[#22253e] rounded-lg px-3 py-3 text-success font-satoshi font-medium text-[13px] leading-[18px] hover:bg-opacity-80 transition-colors shadow-sm relative"
                        >
                          Copy private key
                          {showCopyMessage === 'key' && (
                            <div className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-success text-white px-2 py-1 rounded text-xs">
                              Copied!
                            </div>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Warning Message */}
                  <div className="bg-warning-light border border-[#e7a13a4c] rounded-lg px-4 py-3 shadow-sm">
                    <span className="text-warning font-satoshi font-medium text-[13px] leading-[18px]">
                      Please send a minimum of 0.2 sol to this wallet to get started
                    </span>
                  </div>

                  {/* Run Bot Button */}
                  <button
                    onClick={handleRunBot}
                    className={`w-full rounded-lg px-4 py-3 font-satoshi font-medium text-[13px] leading-[18px] border transition-all duration-200 shadow-sm ${
                      isRunning
                        ? 'bg-red-600 border-red-600 text-white hover:bg-red-700' : 'bg-success border-white text-white hover:bg-opacity-90'
                    }`}
                  >
                    {isRunning ? 'Stop Bot' : 'Run Bot'}
                  </button>

                  {/* Disclaimer */}
                  <p className="text-white-transparent font-satoshi font-medium text-[11px] leading-[15px] text-center">
                    Start or stop anytime. 1% fee per trade. Starting means you accept our disclaimer
                  </p>
                </div>
              )}

              {/* Buy/Sell Content */}
              {activeWalletTab === 'buysell' && (
                <div className="p-4">
                  <div className="text-white text-center py-8">
                    <p className="font-satoshi font-medium text-[13px] leading-[18px]">
                      Buy/Sell functionality will be available here
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>


        </div>

        {/* Footer */}
        <footer className="bg-primary border-t border-[#ffffff21] h-12 flex items-center justify-between px-8">
          <div className="text-white font-satoshi font-medium text-[14px] leading-[19px]">
            © 2025 | TurboSniper.com | Disclaimer
          </div>
          <div className="flex items-center gap-10">
            <a href="#" className="hover:opacity-80 transition-opacity">
              <img 
                src="/images/img_newtwitter.svg" 
                alt="Twitter" 
                className="w-4 h-4"
              />
            </a>
            <a href="#" className="hover:opacity-80 transition-opacity">
              <img 
                src="/images/img_telegram.svg" 
                alt="Telegram" 
                className="w-4 h-4"
              />
            </a>
            <a href="#" className="hover:opacity-80 transition-opacity">
              <img 
                src="/images/img_discord.svg" 
                alt="Discord" 
                className="w-4 h-4"
              />
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default TurboSniperDashboard;



