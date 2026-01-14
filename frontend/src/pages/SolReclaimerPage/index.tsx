import React, { useState, useEffect, useRef } from 'react';
import { 
  Loader2, Wallet, CheckCircle, AlertCircle, Coins, Zap, Shield, 
  Search, ExternalLink, Copy, X, BarChart3, Info,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  Menu, X as CloseIcon,
  RefreshCw
} from 'lucide-react';
import { useWallet, WalletConnectButton } from '../../contexts/WalletContext';
import { SolReclaimer as SolReclaimerService } from '../../services/solReclaimer';
import { TokenAccount, ReclaimEstimate } from '../../types/solana';
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';

const SolReclaimerPage: React.FC = () => {
  const { connected, publicKey, signTransaction } = useWallet();
  const [walletInput, setWalletInput] = useState('');
  const [scanning, setScanning] = useState(false);
  const [reclaiming, setReclaiming] = useState(false);
  const [tokenAccounts, setTokenAccounts] = useState<TokenAccount[]>([]);
  const [estimate, setEstimate] = useState<ReclaimEstimate | null>(null);
  const [results, setResults] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [scanType, setScanType] = useState<'connected' | 'manual'>('connected');
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [solPrice, setSolPrice] = useState<number | null>(null);
  const [showReclaimModal, setShowReclaimModal] = useState(false);
  const [reclaimStatus, setReclaimStatus] = useState<'pending' | 'processing' | 'success' | 'failed'>('pending');
  const [reclaimProgress, setReclaimProgress] = useState(0);
  const [reclaimDetails, setReclaimDetails] = useState({
    accountsClosing: 0,
    solAmount: 0,
    transactionId: ''
  });


  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [accountsPerPage] = useState(10);
  const [reclaimAttempt, setReclaimAttempt] = useState(0);
  
  const reclaimer = useRef(new SolReclaimerService()).current;

  // Clear all data on disconnect
  useEffect(() => {
    if (!connected) {
      setTokenAccounts([]);
      setEstimate(null);
      setResults([]);
      setWalletInput('');
      setCurrentPage(1);
    }
  }, [connected]);

  // Auto-fill connected wallet
  useEffect(() => {
    if (connected && publicKey) {
      setWalletInput(publicKey.toString());
      if (scanType === 'connected') {
        scanWallet(publicKey.toString());
      }
    }
  }, [connected, publicKey, scanType]);

  // Fetch SOL price
  const fetchSolPrice = async () => {
    try {
      // Using Jupiter V3 API with API key
      const options = {
        method: 'GET',
        headers: {
          'x-api-key': import.meta.env.VITE_JUPITER_API_KEY
        }
      };

      const response = await fetch('https://api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112', options);
      const data = await response.json();
      
      // Access the price from the response structure
      if (data && data['So11111111111111111111111111111111111111112']?.usdPrice) {
        setSolPrice(data['So11111111111111111111111111111111111111112'].usdPrice);
      } else {
        // Fallback to V2 API without key if V3 fails
        const backupResponse = await fetch('https://api.jup.ag/price/v2?ids=SOL');
        const backupData = await backupResponse.json();
        if (backupData.data?.SOL?.price) {
          setSolPrice(backupData.data.SOL.price);
        } else {
          // Final fallback to CoinGecko
          const finalResponse = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
          const finalData = await finalResponse.json();
          setSolPrice(finalData.solana?.usd || 150);
        }
      }
    } catch (error) {
      console.error('Failed to fetch SOL price:', error);
      setSolPrice(150); // Fallback price
    }
  };

  // Fetch SOL price on component mount and when token accounts change
  useEffect(() => {
    if (tokenAccounts.length > 0) {
      fetchSolPrice();
      
      // Optional: Refresh price every 30 seconds
      const interval = setInterval(fetchSolPrice, 30000);
      return () => clearInterval(interval);
    }
  }, [tokenAccounts.length]);


  const validateSolanaAddress = (address: string): boolean => {
    try {
      new PublicKey(address);
      return true;
    } catch {
      return false;
    }
  };

  const scanWallet = async (walletAddress: string) => {
    if (!validateSolanaAddress(walletAddress)) {
      setError('Invalid Solana wallet address');
      return;
    }

    setScanning(true);
    setError(null);
    setTokenAccounts([]);
    setEstimate(null);
    setResults([]);
    setCurrentPage(1);
    
    try {
      const accounts = await reclaimer.getTokenAccounts(walletAddress);
      setTokenAccounts(accounts);
      
      const estimate = reclaimer.getReclaimEstimate(accounts);
      setEstimate(estimate);
    } catch (err: any) {
      setError(err.message || 'Failed to scan wallet. Please try again.');
      console.error(err);
    } finally {
      setScanning(false);
    }
  };

  const handleScan = () => {
    if (scanType === 'connected' && publicKey) {
      scanWallet(publicKey.toString());
    } else if (walletInput.trim()) {
      scanWallet(walletInput.trim());
    } else {
      setError('Please enter a wallet address');
    }
  };

  const handleReclaimClick = () => {
    if (!publicKey || !estimate || estimate.reclaimableAccounts === 0) {
      setError('Please connect your wallet to reclaim SOL');
      return;
    }
    
    setShowReclaimModal(true);
    setReclaimStatus('pending'); // NOT 'processing' yet!
    setReclaimProgress(0);
    setReclaimDetails({
      accountsClosing: estimate.reclaimableAccounts,
      solAmount: estimate.estimatedTotalSol,
      transactionId: ''
    });
  };


  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(text);
    setTimeout(() => {
      setCopiedText(null);
    }, 2000);
  };

  const openInExplorer = (address: string) => {
    window.open(`https://solscan.io/account/${address}`, '_blank');
  };

  // Format SOL amount
  const formatSol = (amount: number): string => {
    return amount.toLocaleString('en-US', {
      minimumFractionDigits: 4,
      maximumFractionDigits: 4
    });
  };

  // Calculate progress percentage
  const progressPercentage = estimate 
    ? Math.min(100, (estimate.reclaimableAccounts / Math.max(estimate.totalAccounts, 1)) * 100)
    : 0;

  // Pagination calculations
  const indexOfLastAccount = currentPage * accountsPerPage;
  const indexOfFirstAccount = indexOfLastAccount - accountsPerPage;
  const currentAccounts = tokenAccounts.slice(indexOfFirstAccount, indexOfLastAccount);
  const totalPages = Math.ceil(tokenAccounts.length / accountsPerPage);

  // Pagination controls
  const goToFirstPage = () => setCurrentPage(1);
  const goToLastPage = () => setCurrentPage(totalPages);
  const goToNextPage = () => setCurrentPage(prev => Math.min(prev + 1, totalPages));
  const goToPrevPage = () => setCurrentPage(prev => Math.max(prev - 1, 1));

  // Statistics
  const emptyAccounts = tokenAccounts.filter(acc => acc.isEmpty).length;
  const accountsWithTokens = tokenAccounts.filter(acc => !acc.isEmpty).length;
  const nftAccounts = tokenAccounts.filter(acc => acc.isNFT).length;
  const reclaimableAccounts = tokenAccounts.filter(acc => acc.closeable).length;


  // Custom Logo Component — Mango Half with Leaf
  const SliceOfMangoLogo = () => {
    return (
      <div className="flex items-center gap-3">
        {/* Mango Icon */}
        <div className="relative w-9 h-9">
          <div className="absolute -top-1 -left-0.5 w-4 h-3 bg-gradient-to-br from-green-500 to-emerald-600 
            rounded-l-full rounded-tr-full transform -rotate-12">
            <div className="absolute top-1 left-1 w-0.5 h-1.5 bg-green-700/30 rounded-full transform rotate-45"></div>
          </div>
          {/* Leaf */}
          <div className="absolute -top-2 -right-2 rotate-12">
          

            {/* Stem */}
            {/* <div className="absolute bottom-0 left-1/2 w-0.5 h-2 bg-green-700 -translate-x-1/2 rounded-b-full"></div> */}
          </div>

          {/* Mango skin */}
          <div className="absolute inset-0 bg-gradient-to-br from-green-500 via-yellow-500 to-orange-500 rounded-[60%_40%_55%_45%] shadow-md"></div>

          {/* Mango flesh */}
          <div className="absolute inset-[2px] bg-gradient-to-br from-yellow-300 via-yellow-400 to-orange-400 rounded-[60%_40%_55%_45%] overflow-hidden">
            {/* Seed cavity */}
            <div className="absolute top-1/2 left-1/2 w-4 h-5 -translate-x-1/2 -translate-y-1/2 bg-gradient-to-br from-orange-500 to-orange-700 rounded-[50%] opacity-60"></div>

            {/* Flesh fibers */}
            <div className="absolute left-1 top-2 w-0.5 h-5 bg-white/20 rotate-12"></div>
            <div className="absolute left-2 top-3 w-0.5 h-4 bg-white/15 rotate-6"></div>

            {/* Juicy highlight */}
            <div className="absolute top-1 left-2 w-3 h-3 bg-gradient-to-br from-white/40 to-transparent rounded-full"></div>
          </div>

          {/* Cut edge */}
          {/* <div className="absolute right-0 top-0 h-full w-1 bg-gradient-to-l from-white/30 to-transparent rounded-r-full"></div> */}
        </div>

        {/* Text Logo */}
        <div className="flex flex-col">
          <div className="text-white text-sm font-black tracking-tight">
            <span className="text-white">SLICEOF</span>
            <span className="text-success">MANGO.COM</span>
          </div>
          <div className="text-[9px] text-gray-400 font-medium tracking-widest uppercase mt-0.5">
            Reclaim SOL
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-[#10b98166] to-secondary relative">
      {/* Background Grid Pattern */}
      <div
        className="absolute inset-0 bg-cover bg-center opacity-20"
        style={{ backgroundImage: 'url(/images/img_grid_layers_v2.png)' }}
      />
      
      <div className="relative z-10">
        {/* Header - Simplified with single wallet button */}
        <header className="sticky top-0 z-50 bg-primary border-b border-[#ffffff21] h-16 flex items-center justify-between px-4 md:px-8">
          <SliceOfMangoLogo />

          {/* Mobile Menu Button */}
          <button
            className="md:hidden text-white p-2"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            {isMobileMenuOpen ? (
              <CloseIcon className="w-6 h-6" />
            ) : (
              <Menu className="w-6 h-6" />
            )}
          </button>
          
          {/* Desktop Navigation - Single WalletConnectButton */}
          <div className="hidden md:flex items-center">
            <WalletConnectButton showCopy={false} />
          </div>
          
          {/* Mobile Menu */}
          {/* {isMobileMenuOpen && (
            <div className="absolute top-16 left-0 right-0 bg-primary border-b border-[#ffffff21] md:hidden">
              <div className="flex flex-col p-4 space-y-4">
                <WalletConnectButton showCopy={true} />
              </div>
            </div>
          )} */}
        </header>

        {/* Hero Section */}
        <div className="flex flex-col items-center justify-center py-8 md:py-12 px-4 md:px-8">
          <h1 className="text-white text-xl md:text-2xl font-black text-center mb-3 md:mb-4">
            Reclaim Locked SOL
          </h1>
          <p className="text-white text-sm md:text-base font-medium text-center max-w-2xl mb-6 md:mb-8 leading-relaxed">
            Every time you buy a token, about 0.002 SOL is locked away.
Close unused token accounts and reclaim your SOL.
          </p>
        </div>

        {/* Main Content - Single column on all screen sizes */}
        <div className="container mx-auto px-4 md:px-8 pb-8 max-w-6xl">
          <div className="space-y-6 md:space-y-8">
            {/* Scan Card */}
            <div className="bg-dark-1 rounded-xl border border-[#ffffff1e] p-4 md:p-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
                <h2 className="text-white text-lg md:text-xl font-bold flex items-center gap-2">
                  <Search className="w-5 h-5" />
                  Scan Wallet
                </h2>
                
                <div className="flex gap-2 bg-gray-900/50 p-1 rounded-lg self-start">
                  <button
                    onClick={() => setScanType('connected')}
                    className={`px-3 md:px-4 py-2 rounded-md text-xs md:text-sm font-medium transition-colors ${
                      scanType === 'connected'
                        ? 'bg-success text-white'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Automatic Scanning
                  </button>
                  <button
                    onClick={() => setScanType('manual')}
                    className={`px-3 md:px-4 py-2 rounded-md text-xs md:text-sm font-medium transition-colors ${
                      scanType === 'manual'
                        ? 'bg-success text-white'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Manual Scanning
                  </button>
                </div>
              </div>

              {scanType === 'manual' && (
                <div className="mb-6">
                  <label className="block text-sm font-medium text-gray-400 mb-2">
                    Solana Wallet Address
                  </label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={walletInput}
                      onChange={(e) => setWalletInput(e.target.value)}
                      placeholder="Enter Solana wallet address..."
                      className="flex-1 bg-accent border border-[#22253e] rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-success focus:border-transparent text-sm"
                    />
                    <button
                      onClick={handleScan}
                      disabled={scanning || !walletInput.trim()}
                      className="bg-success hover:bg-success/90 text-white font-medium px-4 md:px-6 py-3 rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm whitespace-nowrap"
                    >
                      {scanning ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span className="hidden sm:inline">Scanning...</span>
                        </>
                      ) : (
                        <>
                          <Search className="w-4 h-4" />
                          <span>Scan</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {scanType === 'connected' && (
                <div className="mb-6">
                  {connected ? (
                    <div className="bg-gray-900/30 rounded-lg p-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex-1">
                          <div className="text-sm text-gray-400">Scanning connected wallet</div>
                          <div className="font-mono text-sm mt-1 truncate">
                            {publicKey?.toString()}
                          </div>
                        </div>
                        <button
                          onClick={handleScan}
                          disabled={scanning}
                          className="bg-success hover:bg-success/90 text-white font-medium px-4 md:px-6 py-2 rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm whitespace-nowrap"
                        >
                          {scanning ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              <span className="hidden sm:inline">Scanning...</span>
                            </>
                          ) : (
                            <>
                              <Zap className="w-4 h-4" />
                              <span>Scan Now</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-4">
                      <Wallet className="w-8 h-8 mx-auto text-gray-500 mb-3" />
                      <h3 className="text-base font-semibold mb-2">Connect Your Wallet</h3>
                      <p className="text-gray-400 text-sm mb-4">Connect your wallet to scan for reclaimable SOL</p>
                      <div className="flex justify-center">
                        <WalletConnectButton showCopy={false} />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Stats Overview */}
              {estimate && (
                <div className="mt-6">
                  <h3 className="text-white text-base font-semibold mb-4 flex items-center gap-2">
                    <BarChart3 className="w-4 h-4" />
                    Scan Results
                  </h3>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                    <div className="bg-gray-900 rounded-lg p-3 border border-gray-500/80">
                      <div className="text-gray-400 text-xs mb-1">Total Accounts</div>
                      <div className="text-lg font-bold text-white">{estimate.totalAccounts}</div>
                    </div>
                    <div className="bg-gradient-to-br from-cyan-900/30 to-blue-900/30 rounded-lg p-3 border border-cyan-500/20">
                      <div className="text-cyan-400 text-xs mb-1">Empty Accounts</div>
                      <div className="text-lg font-bold text-white">{emptyAccounts}</div>
                    </div>
                    <div className="bg-gradient-to-br from-green-900/30 to-emerald-900/30 rounded-lg p-3 border border-green-600/20">
                      <div className="text-success text-xs mb-1">Locked SOL</div>
                      <div className="text-lg font-bold text-white">{formatSol(estimate.estimatedTotalSol)}</div>
                    </div>
                    <div className="bg-gradient-to-br from-purple-900/30 to-pink-900/30 rounded-lg p-3 border border-purple-500/20">
                      <div className="text-purple-400 text-xs mb-1">You Receive</div>
                      <div className="text-lg font-bold text-white">{formatSol(estimate.netGain)}</div>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="mb-6">
                    <div className="flex justify-between text-xs text-gray-400 mb-2">
                      <span>Reclaimable Accounts</span>
                      <span>{reclaimableAccounts} / {estimate.totalAccounts}</span>
                    </div>
                    <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-gradient-to-r from-success to-emerald-500 rounded-full transition-all duration-500"
                        style={{ width: `${progressPercentage}%` }}
                      />
                    </div>
                  </div>

                  {/* Fee Breakdown */}
                  <div className="bg-gray-900/30 rounded-lg p-4 mb-6">
                    <h4 className="font-semibold mb-3 text-gray-300 text-sm">Fee Breakdown</h4>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-gray-400">Locked SOL</span>
                        <span className="text-success">+{formatSol(estimate.estimatedTotalSol)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Platform fee ({estimate.feePercentage}%)</span>
                        <span className="text-yellow-400">-{formatSol(estimate.feeAmount)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Transaction fees</span>
                        <span className="text-yellow-400">-{formatSol(Math.ceil(estimate.reclaimableAccounts / 8) * 0.000005)}</span>
                      </div>
                      <div className="border-t border-gray-700 pt-2 mt-2 flex justify-between font-semibold">
                        <span className="text-gray-300">You receive</span>
                        <span className="text-success">{formatSol(estimate.netGain)} SOL</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Professional Reclaim Status Modal */}
              {showReclaimModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
                  <div className="relative w-full max-w-md">
                    {/* Animated background effect */}
                    <div className="absolute inset-0 -m-4">
                      <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 via-purple-500/5 to-green-500/5"></div>
                      {/* Subtle floating dots */}
                      <div className="absolute inset-0 overflow-hidden">
                        {[...Array(12)].map((_, i) => (
                          <div
                            key={i}
                            className="absolute w-1 h-1 bg-gradient-to-br from-cyan-500/20 to-purple-500/20 rounded-full"
                            style={{
                              left: `${Math.random() * 100}%`,
                              top: `${Math.random() * 100}%`,
                              animation: `float 3s ease-in-out infinite`,
                              animationDelay: `${i * 0.3}s`
                            }}
                          />
                        ))}
                      </div>
                    </div>

                    <div className="relative bg-gray-900/95 backdrop-blur-sm border border-gray-800/50 rounded-2xl shadow-2xl overflow-hidden">
                      {/* Header */}
                      <div className="p-6 border-b border-gray-800/50">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                              reclaimStatus === 'processing' 
                                ? 'bg-gradient-to-br from-blue-500 to-cyan-500 animate-pulse' 
                                : reclaimStatus === 'success'
                                ? 'bg-gradient-to-br from-green-500 to-emerald-500'
                                : reclaimStatus === 'failed'
                                ? 'bg-gradient-to-br from-red-500 to-orange-500'
                                : 'bg-gradient-to-br from-cyan-500 to-blue-500'
                            }`}>
                              {reclaimStatus === 'processing' ? (
                                <Loader2 className="w-5 h-5 text-white animate-spin" />
                              ) : reclaimStatus === 'success' ? (
                                <CheckCircle className="w-5 h-5 text-white" />
                              ) : reclaimStatus === 'failed' ? (
                                <AlertCircle className="w-5 h-5 text-white" />
                              ) : (
                                <Coins className="w-5 h-5 text-white" />
                              )}
                            </div>
                            <div>
                              <h3 className="text-lg font-semibold text-white">
                                {reclaimStatus === 'processing' 
                                  ? 'Reclaiming SOL' 
                                  : reclaimStatus === 'success'
                                  ? 'Reclaim Complete'
                                  : reclaimStatus === 'failed'
                                  ? 'Transaction Cancelled'
                                  : 'Confirm Reclaim'}
                              </h3>
                              <p className="text-sm text-gray-400">
                                {reclaimStatus === 'processing' 
                                  ? 'Awaiting wallet confirmation...' 
                                  : reclaimStatus === 'success'
                                  ? 'Your SOL has been successfully recovered'
                                  : reclaimStatus === 'failed'
                                  ? 'Transaction was cancelled in your wallet'
                                  : 'Review the details below'}
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={() => {
                              if (reclaimStatus === 'processing') return;
                              setShowReclaimModal(false);
                            }}
                            className="text-gray-400 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            disabled={reclaimStatus === 'processing'}
                          >
                            <X className="w-5 h-5" />
                          </button>
                        </div>
                      </div>

                      {/* Content */}
                      <div className="p-6 space-y-6">
                        {/* Progress Section - Only show during processing */}
                        {reclaimStatus === 'processing' && (
                          <div className="space-y-4">
                            <div>
                              <div className="flex justify-between text-sm mb-2">
                                <span className="text-gray-400">Awaiting wallet confirmation</span>
                                <span className="text-white font-medium">{Math.round(reclaimProgress)}%</span>
                              </div>
                              <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                                <div 
                                  className="h-full bg-gradient-to-r from-blue-500 via-cyan-500 to-green-500 rounded-full transition-all duration-500"
                                  style={{ width: `${reclaimProgress}%` }}
                                />
                              </div>
                            </div>
                            
                            {/* Real-time status updates */}
                            <div className="grid grid-cols-2 gap-3">
                              <div className="bg-gray-800/50 rounded-lg p-4">
                                <div className="flex items-center gap-2 mb-2">
                                  <div className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse"></div>
                                  <span className="text-sm text-gray-400">Closing Accounts</span>
                                </div>
                                <div className="text-xl font-semibold text-white">
                                  {reclaimDetails.accountsClosing || estimate?.reclaimableAccounts || 0}
                                </div>
                              </div>
                              
                              <div className="bg-gray-800/50 rounded-lg p-4">
                                <div className="flex items-center gap-2 mb-2">
                                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                                  <span className="text-sm text-gray-400">Estimated Time</span>
                                </div>
                                <div className="text-xl font-semibold text-white">~15s</div>
                              </div>
                            </div>
                            
                            {/* Wallet Connection Status */}
                            <div className="bg-blue-900/20 border border-blue-700/30 rounded-lg p-4">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
                                  <Wallet className="w-4 h-4 text-white" />
                                </div>
                                <div className="flex-1">
                                  <div className="text-sm text-blue-300 font-medium">Awaiting Phantom Wallet</div>
                                  <div className="text-xs text-blue-400">Please check your wallet popup</div>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Failed State */}
                        {reclaimStatus === 'failed' && (
                          <div className="bg-red-900/20 border border-red-700/30 rounded-lg p-4">
                            <div className="flex items-center gap-3 mb-4">
                              <AlertCircle className="w-6 h-6 text-red-400" />
                              <div>
                                <div className="font-semibold text-red-300">Transaction Cancelled</div>
                                <div className="text-sm text-red-400">You cancelled the transaction in your wallet</div>
                              </div>
                            </div>
                            <div className="text-sm text-gray-300">
                              Click "Try Again" to restart the reclaim process, or "Cancel" to close this modal.
                            </div>
                          </div>
                        )}

                        {/* Amount Display - Always visible */}
                        <div className="bg-gradient-to-br from-gray-900 to-gray-800 border border-gray-800/50 rounded-xl p-5 text-center">
                          <div className="text-sm text-gray-400 mb-2">
                            {reclaimStatus === 'processing' ? 'Awaiting confirmation for' : 
                            reclaimStatus === 'success' ? 'Successfully reclaimed' : 
                            reclaimStatus === 'failed' ? 'Available to reclaim' : 'Available to Reclaim'}
                          </div>
                          <div className="flex items-center justify-center gap-2 mb-2">
                            <div className="w-8 h-8">
                              <svg viewBox="0 0 397.7 311.7" className="w-full h-full">
                                <linearGradient id="sol-gradient" x1="360.879" y1="351.455" x2="141.213" y2="69.294">
                                  <stop offset="0" stopColor="#00FFA3"/>
                                  <stop offset="1" stopColor="#DC1FFF"/>
                                </linearGradient>
                                <path fill="url(#sol-gradient)" d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z"/>
                                <path fill="url(#sol-gradient)" d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z"/>
                                <path fill="url(#sol-gradient)" d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z"/>
                              </svg>
                            </div>
                            <div className="flex items-baseline gap-2">
                              <div className="text-3xl font-bold bg-gradient-to-r from-green-400 via-cyan-400 to-blue-400 bg-clip-text text-transparent">
                                {formatSol(reclaimDetails.solAmount || estimate?.estimatedTotalSol || 0)}
                              </div>
                              <div className="text-lg font-semibold text-cyan-300">SOL</div>
                            </div>
                          </div>

                          
                          {solPrice && (
                            <div className="text-sm text-gray-400 mt-2">
                              ≈ ${((reclaimDetails.solAmount || estimate?.estimatedTotalSol || 0) * solPrice).toLocaleString('en-US', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2
                              })} USD
                            </div>
                          )}
                        </div>

                        {/* Success Details */}
                        {reclaimStatus === 'success' && reclaimDetails.transactionId && (
                          <div className="space-y-4">
                            <div className="bg-gray-800/30 rounded-lg p-4">
                              <div className="flex items-center justify-between mb-3">
                                <span className="text-sm text-gray-400">Transaction ID</span>
                                <a
                                  href={`https://solscan.io/tx/${reclaimDetails.transactionId}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-sm text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                                >
                                  View on Solscan
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              </div>
                              <div className="font-mono text-xs text-gray-300 bg-gray-900/50 rounded px-3 py-2 break-all">
                                {reclaimDetails.transactionId}
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-2 text-sm text-green-400">
                              <CheckCircle className="w-4 h-4" />
                              <span>Successfully recovered from {reclaimDetails.accountsClosing || estimate?.reclaimableAccounts || 0} accounts</span>
                            </div>
                          </div>
                        )}

                        {/* Fee Information - Hide during processing */}
                        {reclaimStatus !== 'processing' && (
                          <div className="bg-gray-800/30 rounded-lg p-4">
                            <div className="text-sm text-gray-400 mb-2">Fee Breakdown</div>
                            <div className="space-y-2">
                              <div className="flex justify-between items-center">
                                <span className="text-gray-300">Platform Fee (0.5%)</span>
                                <span className="text-amber-400">
                                  -{formatSol((reclaimDetails.solAmount || estimate?.estimatedTotalSol || 0) * 0.005)} SOL
                                </span>
                              </div>
                              <div className="flex justify-between items-center">
                                <span className="text-gray-300">Network Fee</span>
                                <span className="text-amber-400">~0.000005 SOL</span>
                              </div>
                              <div className="border-t border-gray-700/50 pt-2 mt-2">
                                <div className="flex justify-between items-center">
                                  <span className="text-gray-300 font-medium">You Receive</span>
                                  <span className="text-green-400 font-bold">
                                    {formatSol((reclaimDetails.solAmount || estimate?.estimatedTotalSol || 0) * 0.995)} SOL
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Footer */}
                      <div className="p-6 border-t border-gray-800/50">
                        {reclaimStatus === 'processing' ? (
                          <div className="space-y-3">
                            <button
                              onClick={() => {
                                // Allow user to cancel the processing state
                                setReclaimStatus('pending');
                                setReclaimProgress(0);
                                setError('Transaction cancelled by user');
                              }}
                              className="w-full py-3 bg-gradient-to-r from-red-600/50 to-orange-600/50 hover:from-red-700/60 hover:to-orange-700/60 text-red-200 rounded-lg font-medium transition-all duration-200 flex items-center justify-center gap-2"
                            >
                              <X className="w-4 h-4" />
                              Cancel Transaction
                            </button>
                            <p className="text-xs text-center text-gray-500">
                              Waiting for confirmation in your wallet. If no popup appears, check your browser extensions.
                            </p>
                          </div>
                        ) : reclaimStatus === 'success' ? (
                          <div className="space-y-3">
                            <button
                              onClick={() => {
                                setShowReclaimModal(false);
                                if (publicKey) {
                                  scanWallet(publicKey.toString());
                                }
                              }}
                              className="w-full py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white rounded-lg font-medium transition-all duration-200"
                            >
                              Continue
                            </button>
                            <button
                              onClick={() => setShowReclaimModal(false)}
                              className="w-full py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg font-medium transition-colors"
                            >
                              Close
                            </button>
                          </div>
                        ) : reclaimStatus === 'failed' ? (
                          <div className="grid grid-cols-2 gap-3">
                            <button
                              onClick={() => {
                                setReclaimStatus('pending');
                                setReclaimProgress(0);
                                setError(null);
                              }}
                              className="py-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700 text-white rounded-lg font-medium transition-all duration-200"
                            >
                              Try Again
                            </button>
                            <button
                              onClick={() => setShowReclaimModal(false)}
                              className="py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg font-medium transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <button
                              onClick={async () => {
                                if (!publicKey) {
                                  setError('Wallet not connected');
                                  setReclaimStatus('failed');
                                  return;
                                }
                                
                                setReclaimStatus('processing');
                                setReclaiming(true);
                                
                                // Start progress animation
                                let progress = 0;
                                const interval = setInterval(() => {
                                  progress += 2;
                                  if (progress > 30) {
                                    progress = 30;
                                  }
                                  setReclaimProgress(progress);
                                }, 200);
                                
                                try {
                                  // Now actually perform the reclaim
                                  const results = await reclaimer.reclaimSol(
                                    tokenAccounts,
                                    publicKey,  // <-- This is now guaranteed to be non-null
                                    async (tx) => {
                                      if (!window.solana || !window.solana.signTransaction) {
                                        throw new Error('Wallet not connected');
                                      }
                                      return await window.solana.signTransaction(tx);
                                    }
                                  );
                                  
                                  clearInterval(interval);
                                  setReclaimProgress(100);
                                  
                                  if (results[0]?.success) {
                                    setReclaimDetails({
                                      accountsClosing: results[0].closedAccounts,
                                      solAmount: results[0].reclaimedSol,
                                      transactionId: results[0].signature || ''
                                    });
                                    setReclaimStatus('success');
                                    setResults(results);
                                    
                                    // Auto-refresh scan after 2 seconds
                                    setTimeout(() => {
                                      if (publicKey) {
                                        scanWallet(publicKey.toString());
                                      }
                                    }, 2000);
                                  } else {
                                    setReclaimStatus('failed');
                                    setError(results[0]?.error || 'Reclaim failed');
                                  }
                                } catch (err: any) {
                                  clearInterval(interval);
                                  setReclaimStatus('failed');
                                  setError(err.message || 'Reclaim failed. Please try again.');
                                  console.error(err);
                                } finally {
                                  setReclaiming(false);
                                }
                              }}
                              className="w-full py-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700 text-white rounded-lg font-medium transition-all duration-200"  
                            >
                              Confirm & Reclaim SOL
                            </button>

                            <button
                              onClick={() => setShowReclaimModal(false)}
                              className="w-full py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg font-medium transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}


              {error && (
                <div className="mt-4 bg-red-900/30 border border-red-700/50 rounded-lg p-4 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-medium text-red-300 text-sm">Error</p>
                    <p className="text-xs text-red-400">{error}</p>
                  </div>
                  <button onClick={() => setError(null)} className="text-gray-400 hover:text-white">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            {/* Reclaim Card */}
            {estimate && (
              <div className="bg-dark-1 rounded-xl border border-[#ffffff1e] p-4 md:p-6">
                <div className="mb-6">
                  <h2 className="text-white text-lg font-bold flex items-center gap-2 mb-2">
                    <Coins className="w-5 h-5" />
                    Reclaim SOL
                  </h2>
                  {!connected && (
                    <div className="text-xs text-yellow-400 flex items-center gap-2">
                      <AlertCircle className="w-3 h-3" />
                      Connect wallet to reclaim
                    </div>
                  )}
                </div>

                <div className="space-y-6">
                  {/* If there are reclaimable accounts */}
                  {estimate.reclaimableAccounts > 0 ? (
                    <>
                      {/* Updated Section */}
                      <div className="text-center">
                        {/* Top Line: Locked in X token accounts */}
                        <div className="text-gray-400 text-sm mb-4">
                          Locked in {estimate.reclaimableAccounts} token account{estimate.reclaimableAccounts !== 1 ? 's' : ''}
                        </div>
                        
                        {/* SOL Logo and Amount */}
                        <div className="flex flex-col md:flex-row items-center justify-center gap-3 mb-1">
                          {/* Solana Logo */}
                          <div className="w-8 h-8 md:w-10 md:h-10 flex-shrink-0">
                            <svg viewBox="0 0 397.7 311.7" className="w-full h-full">
                              <linearGradient id="solana-gradient" x1="360.879" y1="351.455" x2="141.213" y2="69.294" gradientUnits="userSpaceOnUse">
                                <stop offset="0" stopColor="#00FFA3"/>
                                <stop offset="1" stopColor="#DC1FFF"/>
                              </linearGradient>
                              <path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z" fill="url(#solana-gradient)"/>
                              <path d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z" fill="url(#solana-gradient)"/>
                              <path d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z" fill="url(#solana-gradient)"/>
                            </svg>
                          </div>
                          
                          {/* Amount Container */}
                          <div className="flex flex-col md:flex-row md:items-baseline md:gap-4">
                            <div className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-green-400 via-cyan-400 to-purple-500 bg-clip-text text-transparent leading-tight">
                              {formatSol(estimate.estimatedTotalSol)} SOL
                            </div>
                            
                            {solPrice && (
                              <div className="mt-1 md:mt-0">
                                <div className="md:hidden text-lg font-semibold text-cyan-300">
                                  ≈ ${(estimate.netGain * solPrice).toLocaleString('en-US', {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2
                                  })}
                                  <span className="text-sm text-gray-400 ml-2">
                                    @ ${solPrice.toLocaleString('en-US', {
                                      minimumFractionDigits: 2,
                                      maximumFractionDigits: 2
                                    })}
                                  </span>
                                </div>
                                
                                <div className="hidden md:block text-xl font-semibold text-cyan-300">
                                  ≈ ${(estimate.netGain * solPrice).toLocaleString('en-US', {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2
                                  })}
                                  <span className="text-sm text-gray-400 ml-2">
                                    (@ ${solPrice.toLocaleString('en-US', {
                                      minimumFractionDigits: 2,
                                      maximumFractionDigits: 2
                                    })})
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                        
                        {/* Stats Row */}
                        <div className="flex items-center justify-center gap-4 text-sm text-gray-300 mt-3">
                          <div className="flex items-center gap-1">
                            <div className="w-2 h-2 rounded-full bg-success"></div>
                            <span>{estimate.reclaimableAccounts} empty</span>
                          </div>
                          
                          <div className="text-gray-500">•</div>
                          
                          <div className="flex items-center gap-1">
                            <div className="w-2 h-2 rounded-full bg-red-500"></div>
                            <span>{accountsWithTokens} with tokens</span>
                          </div>
                        </div>
                      </div>

                      {/* Button Section - Two Buttons */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {/* Rescan Wallet Button */}
                        <button
                          onClick={handleScan}
                          disabled={scanning || !connected}
                          className={`w-full py-3 rounded-xl font-medium transition-all duration-200 flex items-center justify-center gap-2 ${
                            scanning || !connected
                              ? 'bg-gray-700 cursor-not-allowed text-gray-400'
                              : 'bg-gradient-to-r from-yellow-600 via-amber-500 to-orange-500 hover:from-yellow-700 hover:via-amber-600 hover:to-orange-600 text-white shadow-md hover:shadow-lg border border-amber-400/30'
                          }`}
                        >
                          {scanning ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              <span>Scanning...</span>
                            </>
                          ) : (
                            <>
                              <RefreshCw className="w-4 h-4" />
                              <span>Rescan Wallet</span>
                            </>
                          )}
                        </button>

                        {/* Claim SOL Button */}
                        <button
                          onClick={handleReclaimClick}
                          disabled={!connected || estimate?.reclaimableAccounts === 0} 
                          className={`w-full py-3 rounded-xl font-bold transition-all duration-200 ${
                            reclaiming || !connected
                              ? 'bg-gray-700 cursor-not-allowed'
                              : 'bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white shadow-md hover:shadow-lg border border-emerald-400/30'
                          }`}
                        >
                          {reclaiming ? (
                            <div className="flex items-center justify-center gap-2">
                              <Loader2 className="w-4 h-4 animate-spin" />
                              <span>Processing...</span>
                            </div>
                          ) : !connected ? (
                            <div className="flex items-center justify-center gap-2">
                              <span>Connect Wallet to Claim</span>
                            </div>
                          ) : (
                            <div className="flex items-center justify-center gap-2">
                              <Coins className="w-4 h-4" />
                              <span>Claim {formatSol(estimate.estimatedTotalSol)} SOL</span>
                            </div>
                          )}
                        </button>
                      </div>

                      <p className="text-xs text-gray-400 text-center">
                        Approve transaction in your wallet. Small fees apply per closure.
                      </p>
                    </>
                  ) : (
                    /* NO LOCKED SOL STATE - Professional Design */
                    <div className="space-y-6">
                      {/* Header */}
                      <div className="text-center">
                        {/* Top Line: Consistent with locked SOL state */}
                        <div className="text-gray-400 text-sm mb-4">
                          Locked in {estimate.reclaimableAccounts} token accounts
                        </div>
                        
                        {/* SOL Logo and Amount - Same layout as locked SOL state */}
                        <div className="flex flex-col md:flex-row items-center justify-center gap-3 mb-1">
                          {/* Solana Logo - Same size and style */}
                          <div className="w-8 h-8 md:w-10 md:h-10 flex-shrink-0">
                            <svg viewBox="0 0 397.7 311.7" className="w-full h-full">
                              <linearGradient id="solana-gradient-empty" x1="360.879" y1="351.455" x2="141.213" y2="69.294" gradientUnits="userSpaceOnUse">
                                <stop offset="0" stopColor="#00FFA3"/>
                                <stop offset="1" stopColor="#DC1FFF"/>
                              </linearGradient>
                              <path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z" fill="url(#solana-gradient-empty)"/>
                              <path d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z" fill="url(#solana-gradient-empty)"/>
                              <path d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z" fill="url(#solana-gradient-empty)"/>
                            </svg>
                          </div>
                          
                          {/* Amount Container - Same styling */}
                          <div className="flex flex-col md:flex-row md:items-baseline md:gap-4">
                            <div className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-green-400 via-cyan-400 to-purple-500 bg-clip-text text-transparent leading-tight">
                              0.0000 SOL
                            </div>
                            
                            {solPrice && (
                              <div className="mt-1 md:mt-0">
                                <div className="md:hidden text-lg font-semibold text-gray-400">
                                  ≈ $0.00
                                  <span className="text-sm text-gray-500 ml-2">
                                    @ ${solPrice.toLocaleString('en-US', {
                                      minimumFractionDigits: 2,
                                      maximumFractionDigits: 2
                                    })}
                                  </span>
                                </div>
                                
                                <div className="hidden md:block text-xl font-semibold text-gray-400">
                                  ≈ $0.00
                                  <span className="text-sm text-gray-500 ml-2">
                                    (@ ${solPrice.toLocaleString('en-US', {
                                      minimumFractionDigits: 2,
                                      maximumFractionDigits: 2
                                    })})
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                        
                        {/* Stats Row - Same style */}
                        <div className="flex items-center justify-center gap-4 text-sm text-gray-300 mt-3">
                          <div className="flex items-center gap-1">
                            <div className="w-2 h-2 rounded-full bg-success"></div>
                            <span>{emptyAccounts} empty</span>
                          </div>
                          
                          <div className="text-gray-500">•</div>
                          
                          <div className="flex items-center gap-1">
                            <div className="w-2 h-2 rounded-full bg-red-500"></div>
                            <span>{accountsWithTokens} with tokens</span>
                          </div>
                        </div>
                      </div>

                      {/* Success Message - More professional */}
                      <div className="bg-gradient-to-br from-green-900/20 to-emerald-900/20 border border-green-700/30 rounded-xl p-5 text-center">
                        <div className="flex flex-col items-center gap-3">
                          <div className="w-12 h-12 bg-gradient-to-br from-green-500 to-emerald-600 rounded-full flex items-center justify-center">
                            <CheckCircle className="w-6 h-6 text-white" />
                          </div>
                          <div>
                            <h3 className="text-lg font-semibold text-green-300 mb-1">No Locked SOL Found</h3>
                            <p className="text-sm text-gray-300 max-w-md mx-auto">
                              Your wallet is optimized! All token accounts are either in use or already closed.
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Single Rescan Button - SAME YELLOW STYLE as when there's locked SOL */}
                      <div className="space-y-3">
                        <button
                          onClick={handleScan}
                          disabled={scanning || !connected}
                          className={`w-full py-3 rounded-xl font-medium transition-all duration-200 flex items-center justify-center gap-2 ${
                            scanning || !connected
                              ? 'bg-gray-700 cursor-not-allowed text-gray-400'
                              : 'bg-gradient-to-r from-yellow-600 via-amber-500 to-orange-500 hover:from-yellow-700 hover:via-amber-600 hover:to-orange-600 text-white shadow-md hover:shadow-lg border border-amber-400/30'
                          }`}
                        >
                          {scanning ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              <span>Scanning...</span>
                            </>
                          ) : (
                            <>
                              <RefreshCw className="w-4 h-4" />
                              <span>Rescan Wallet</span>
                            </>
                          )}
                        </button>
                        
                        <p className="text-xs text-center text-gray-400">
                          Rescan to check for any new locked SOL in your wallet
                        </p>
                      </div>

                      {/* Optional: Summary Stats */}
                      <div className="grid grid-cols-3 gap-3">
                        <div className="bg-gray-800/50 rounded-lg p-3 text-center">
                          <div className="text-2xl font-bold text-white mb-1">
                            {tokenAccounts.length}
                          </div>
                          <div className="text-xs text-gray-400">Total Accounts</div>
                        </div>
                        <div className="bg-gray-800/50 rounded-lg p-3 text-center">
                          <div className="text-2xl font-bold text-red-400 mb-1">
                            {accountsWithTokens}
                          </div>
                          <div className="text-xs text-gray-400">Active</div>
                        </div>
                        <div className="bg-gray-800/50 rounded-lg p-3 text-center">
                          <div className="text-2xl font-bold text-green-400 mb-1">
                            {emptyAccounts}
                          </div>
                          <div className="text-xs text-gray-400">Empty</div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Account List */}
            {tokenAccounts.length > 0 && (
              <div className="bg-dark-1 rounded-xl border border-[#ffffff1e] p-4 md:p-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
                  <div>
                    <h3 className="text-white text-lg font-bold">Token Accounts</h3>
                    <p className="text-gray-400 text-sm">
                      {tokenAccounts.length} total • {reclaimableAccounts} reclaimable
                    </p>
                  </div>
                  
                  <div className="text-sm text-gray-400">
                    Page {currentPage} of {totalPages}
                  </div>
                </div>

                {/* Mobile Card View */}
                <div className="md:hidden space-y-3">
                  {currentAccounts.map((account) => (
                    <div key={account.pubkey} className="bg-dark-2 rounded-lg p-4 border border-[#262944]">
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <div className="font-mono text-xs text-gray-400 mb-1">
                            {account.pubkey.slice(0, 8)}...{account.pubkey.slice(-8)}
                          </div>
                          <div className="flex items-center gap-3">
                            {account.closeable ? (
                              <span className="inline-flex items-center gap-1 bg-success/20 text-success px-2 py-1 rounded-full text-xs">
                                <CheckCircle className="w-3 h-3" />
                                Reclaimable
                              </span>
                            ) : account.isNFT ? (
                              <span className="inline-flex items-center gap-1 bg-purple-900/30 text-purple-400 px-2 py-1 rounded-full text-xs">
                                NFT
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 bg-gray-700/50 text-gray-400 px-2 py-1 rounded-full text-xs">
                                Not Empty
                              </span>
                            )}
                            <span className="text-cyan-400 text-sm font-medium">
                              {account.estimatedRent.toFixed(4)} SOL
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => copyToClipboard(account.pubkey)}
                            className="text-gray-400 hover:text-white"
                            title="Copy address"
                          >
                            {copiedText === account.pubkey ? (
                              <CheckCircle className="w-4 h-4 text-green-400" />
                            ) : (
                              <Copy className="w-4 h-4" />
                            )}
                          </button>
                          <button
                            onClick={() => openInExplorer(account.pubkey)}
                            className="text-gray-400 hover:text-blue-400"
                            title="View in explorer"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <div className="text-sm">
                        <div className="flex justify-between text-gray-400 mb-1">
                          <span>Balance:</span>
                          <span className={account.tokenAmount.uiAmount > 0 ? 'text-red-400' : 'text-success'}>
                            {account.tokenAmount.uiAmount > 0 
                              ? account.tokenAmount.uiAmount.toFixed(account.tokenAmount.decimals || 4)
                              : '0.0000'
                            }
                          </span>
                        </div>
                        <div className="text-xs text-gray-500 truncate">
                          Mint: {account.mint.slice(0, 8)}...{account.mint.slice(-8)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop Table View */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full min-w-full">
                    <thead>
                      <tr className="border-b border-gray-700/50">
                        <th className="text-left py-3 px-4 text-gray-400 font-medium text-sm">Account Address</th>
                        <th className="text-left py-3 px-4 text-gray-400 font-medium text-sm">Token Mint</th>
                        {/* <th className="text-left py-3 px-4 text-gray-400 font-medium text-sm">Balance</th> */}
                        <th className="text-left py-3 px-4 text-gray-400 font-medium text-sm">Status</th>
                        <th className="text-left py-3 px-4 text-gray-400 font-medium text-sm">Locked Rent</th>
                        <th className="text-left py-3 px-4 text-gray-400 font-medium text-sm">Solscan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentAccounts.map((account) => (
                        <tr key={account.pubkey} className="border-b border-gray-800/30 hover:bg-gray-700/20">
                          <td className="py-3 px-4">
                            <div className="font-mono text-sm flex items-center gap-2">
                              {account.pubkey.slice(0, 6)}...{account.pubkey.slice(-6)}
                              <button
                                onClick={() => copyToClipboard(account.pubkey)}
                                className="text-gray-400 hover:text-white"
                                title="Copy address"
                              >
                                {copiedText === account.pubkey ? (
                                  <CheckCircle className="w-3 h-3 text-green-400" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                              </button>
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-mono text-sm">
                              {account.mint.slice(0, 6)}...{account.mint.slice(-6)}
                            </div>
                          </td>
                          {/* <td className="py-3 px-4">
                            <span className={account.tokenAmount.uiAmount > 0 ? 'text-red-400' : 'text-success'}>
                              {account.tokenAmount.uiAmount > 0 
                                ? account.tokenAmount.uiAmount.toFixed(account.tokenAmount.decimals || 4)
                                : '0.0000'
                              }
                            </span>
                          </td> */}
                          <td className="py-3 px-4">
                            {account.closeable ? (
                              <span className="inline-flex items-center gap-1 bg-success/20 text-success px-2 py-1 rounded-full text-xs">
                                <CheckCircle className="w-3 h-3" />
                                Reclaimable
                              </span>
                            ) : account.isNFT ? (
                              <span className="inline-flex items-center gap-1 bg-purple-900/30 text-purple-400 px-2 py-1 rounded-full text-xs">
                                NFT
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 bg-gray-700/50 text-gray-400 px-2 py-1 rounded-full text-xs">
                                Not Empty
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <span className="text-cyan-400 font-medium text-sm">
                              {account.estimatedRent.toFixed(6)} SOL
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <button
                              onClick={() => openInExplorer(account.pubkey)}
                              className="text-gray-400 hover:text-blue-400"
                              title="View in explorer"
                            >
                              <ExternalLink className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex flex-col sm:flex-row items-center justify-between pt-6 mt-6 border-t border-gray-700/50 gap-4">
                    <div className="text-sm text-gray-400">
                      Showing {indexOfFirstAccount + 1} to {Math.min(indexOfLastAccount, tokenAccounts.length)} of {tokenAccounts.length}
                    </div>
                    
                    <div className="flex items-center gap-1">
                      <button
                        onClick={goToFirstPage}
                        disabled={currentPage === 1}
                        className="p-2 rounded-lg bg-gray-900/50 hover:bg-gray-800 disabled:opacity-50 transition-colors"
                        title="First page"
                      >
                        <ChevronsLeft className="w-4 h-4" />
                      </button>
                      
                      <button
                        onClick={goToPrevPage}
                        disabled={currentPage === 1}
                        className="p-2 rounded-lg bg-gray-900/50 hover:bg-gray-800 disabled:opacity-50 transition-colors"
                        title="Previous page"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      
                      <div className="px-3 py-1 bg-gray-900/50 rounded-lg text-sm mx-2">
                        {currentPage} / {totalPages}
                      </div>
                      
                      <button
                        onClick={goToNextPage}
                        disabled={currentPage === totalPages}
                        className="p-2 rounded-lg bg-gray-900/50 hover:bg-gray-800 disabled:opacity-50 transition-colors"
                        title="Next page"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                      
                      <button
                        onClick={goToLastPage}
                        disabled={currentPage === totalPages}
                        className="p-2 rounded-lg bg-gray-900/50 hover:bg-gray-800 disabled:opacity-50 transition-colors"
                        title="Last page"
                      >
                        <ChevronsRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Results Section */}
            {results.length > 0 && (
              <div className="bg-gradient-to-br from-success/20 to-emerald-900/20 rounded-xl border border-success/30 p-4 md:p-6">
                <h3 className="text-success text-lg font-bold mb-6 flex items-center gap-2">
                  <CheckCircle className="w-5 h-5" />
                  Reclaim Results
                </h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {results.map((result, index) => (
                    <div key={index} className={`p-4 rounded-lg ${result.success ? 'bg-success/10' : 'bg-red-900/30'}`}>
                      <div className="flex items-center justify-between mb-3">
                        <span className="font-semibold text-sm">Batch {index + 1}</span>
                        {result.success ? (
                          <CheckCircle className="w-5 h-5 text-success" />
                        ) : (
                          <AlertCircle className="w-5 h-5 text-red-400" />
                        )}
                      </div>
                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between">
                          <span className="text-gray-400">Accounts:</span>
                          <span>{result.closedAccounts}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400">SOL Reclaimed:</span>
                          <span className="text-success">{formatSol(result.reclaimedSol)}</span>
                        </div>
                        {result.feePaid > 0 && (
                          <div className="flex justify-between">
                            <span className="text-gray-400">Platform Fee:</span>
                            <span className="text-yellow-400">-{formatSol(result.feePaid)}</span>
                          </div>
                        )}
                        {result.signature && (
                          <div className="pt-2 border-t border-gray-700/50">
                            <button
                              onClick={() => openInExplorer(result.signature)}
                              className="text-blue-400 hover:text-blue-300 text-xs flex items-center gap-1"
                            >
                              View Transaction
                              <ExternalLink className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                
                {/* Total Summary */}
                {results.some(r => r.success) && (
                  <div className="mt-6 pt-6 border-t border-green-700/30">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <div className="text-gray-300 font-semibold">Total Reclaimed</div>
                        <div className="text-sm text-gray-400">
                          From {results.reduce((acc, r) => acc + r.closedAccounts, 0)} accounts
                        </div>
                      </div>
                      <div className="text-2xl font-bold text-green-400">
                        {formatSol(results.reduce((acc, r) => acc + r.reclaimedSol, 0))} SOL
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Safety Notice - At the bottom */}
            <div className="bg-gradient-to-br from-blue-900/20 to-cyan-900/20 rounded-xl border border-blue-700/30 p-4 md:p-6">
              <div className="flex items-start gap-4">
                <Shield className="w-6 h-6 text-blue-400 flex-shrink-0 mt-1" />
                <div className="flex-1">
                  <h4 className="font-bold text-blue-300 mb-3 flex items-center gap-2">
                    <Info className="w-4 h-4" />
                    Safety & Information
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-300">
                    <div className="space-y-2">
                      <div className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
                        <span>100% non-custodial. We never access your funds.</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
                        <span>Only empty token accounts (0 balance) can be closed.</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
                        <span>NFTs and frozen accounts are automatically excluded.</span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
                        <span>Always review transactions in your wallet before signing.</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <div className="w-4 h-4 flex-shrink-0 mt-0.5 text-yellow-400">$</div>
                        <span>5% platform fee supports development & maintenance.</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
                        <span>Small transaction fees apply for each account closure.</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SolReclaimerPage;
