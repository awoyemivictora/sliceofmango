import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { apiService } from '@/services/api';
import { getOrCreateWallet } from '@/utils/wallet.js';
import bs58 from 'bs58';
import { debounce } from 'lodash';
import { tokenLaunchService, LaunchConfig, LaunchStatus, AtomicLaunchRequest, BotArmyWallet, FrontendLaunchStatus, TokenMetadata, LaunchResult, BotWalletsTableProps, BotWallet } from '@/services/tokenLaunch';
import { launchWebSocket } from '@/services/websocket';
import { config } from '@/config/production';
import { registerWallet, verifyWallet, getNonce } from '@/services/auth';
import PreFundingManager from '@/components/PreFundingManager';
import { convertToBackendConfig, createCustomMetadataFromAI, validateMetadataForLaunch } from '@/utils/configConverter';
import { convertIpfsToHttpUrl, isIpfsUrl } from '@/utils/ipfs';

const MIN_SOL_FOR_CREATOR_MODE = 0.0001;

// ============================================
// INTERFACES
// ============================================


// ============================================
// MAIN COMPONENT
// ============================================
const TokenCreator: React.FC = () => {
  const navigate = useNavigate();
  
  // State
  const [userWallet, setUserWallet] = useState<Keypair | null>(null);
  const [userBalance, setUserBalance] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [launchConfig, setLaunchConfig] = useState<LaunchConfig>({
    tokenName: '',
    tokenSymbol: '',
    tokenDescription: '',
    imageUrl: '',
    creatorWallet: '',
    creatorPrivateKey: '',
    botCount: 10,
    initialSolReserves: 1.0,
    botWalletBuyAmount: 0.001,
    creatorBuyAmount: 0.01,
    targetProfitPercentage: 50,
    sellTiming: 'volume_based',
    sellVolumeTrigger: 5.0,
    sellTimeTrigger: 1,
    sellPriceTarget: 1.1,
    useAIForMetadata: true,
    metadataStyle: 'ai-generated',
    metadataKeywords: 'crypto, meme, solana, ai, token',
    useDalle: true,
    useJitoBundle: true,
    priority: 10,
    botSpread: 'random'
  });
  
  const [botArmy, setBotArmy] = useState<BotArmyWallet[]>([]);
  const [launchStatus, setLaunchStatus] = useState<FrontendLaunchStatus>({
    phase: 'setup',
    progress: 0,
    message: 'Ready to launch your token',
    currentStep: 'Setup',
    estimatedTimeRemaining: 0
  });
  
  const [generatedMetadata, setGeneratedMetadata] = useState<TokenMetadata | null>(null);
  const [launchResults, setLaunchResults] = useState<LaunchResult[]>([]);
  const [aiGenerating, setAiGenerating] = useState<boolean>(false);
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [totalRequiredSol, setTotalRequiredSol] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<'quick' | 'custom' | 'ai'>('quick');
  const [showPreview, setShowPreview] = useState<boolean>(false);
  const [activeLaunchId, setActiveLaunchId] = useState<string | null>(null);
  const [creatorStats, setCreatorStats] = useState<any>(null);
  const [botWallets, setBotWallets] = useState<any[]>([]);
  const [authToken, setAuthToken] = useState(localStorage.getItem('authToken') || null);
  const [isRegistered, setIsRegistered] = useState(!!localStorage.getItem('authToken'));
  const [showPrivateKey, setShowPrivateKey] = useState<boolean>(false);
  const [showPrivateKeyWarning, setShowPrivateKeyWarning] = useState<boolean>(false);
  const [usePreFundedBots, setUsePreFundedBots] = useState(false);
  const [atomicLaunchMode, setAtomicLaunchMode] = useState(false);
  const [preFundResult, setPreFundResult] = useState<any>(null);
  const [showPreFundingPanel, setShowPreFundingPanel] = useState(false);
  const [metadataGenerated, setMetadataGenerated] = useState<boolean>(false);
  const currentYear = new Date().getFullYear();

  // Refs
  const progressInterval = useRef<NodeJS.Timeout | null>(null);

  // ============================================
  // INITIALIZATION
  // ============================================

  useEffect(() => {
    const initializeCreator = async () => {
      try {
        // Get or create wallet FIRST (same as sniper)
        const wallet = getOrCreateWallet();
        setUserWallet(wallet);

        const address = wallet.publicKey.toBase58();
        const privateKeyBase58 = bs58.encode(wallet.secretKey); // Convert to base58

        // Store wallet address for persistence
        localStorage.setItem('walletAddress', address);

        // Store private key in localStorage (same as sniper)
        const privateKeyBytes = wallet.secretKey;
        const privateKeyBase64 = btoa(JSON.stringify(Array.from(privateKeyBytes)));
        localStorage.setItem('solana_bot_pk_base64', privateKeyBase64);

        // Set creator wallet address AND private key
        setLaunchConfig(prev => ({
          ...prev,
          creatorWallet: address,
          creatorPrivateKey: privateKeyBase58 // Add the private key here
        }));

        // Try to get balance FIRST
        let userBalance = 0;
        try {
          userBalance = await fetchWalletBalance(wallet.publicKey);
          setUserBalance(userBalance);
        } catch (balanceError) {
          console.warn('Balance fetch failed:', balanceError);
        }

        // AUTO-REGISTRATION LOGIC (same as sniper)
        if (!authToken) {
          try {
            // Get nonce from backend
            const nonce = await getNonce();

            // Verify wallet with backend
            await verifyWallet(address, wallet.secretKey, nonce);

            // Register wallet with backend
            await registerWallet(address, wallet.secretKey);

            // Update auth state
            setIsRegistered(true);
            setAuthToken(localStorage.getItem('authToken'));

            console.log('✅ Creator wallet auto-registered successfully');
          } catch (error) {
            console.error('Wallet registration/verification failed:', error);
            // Don't block the UI, just log the error
          }
        }

        // Check if user has minimum SOL for creator mode
        if (userBalance < MIN_SOL_FOR_CREATOR_MODE) {
          setLaunchStatus(prev => ({
            ...prev,
            phase: 'failed',
            message: `⚠️ Please fund your wallet with at least ${MIN_SOL_FOR_CREATOR_MODE} SOL to enable creator mode.`,
            currentStep: 'Insufficient Balance',
            estimatedTimeRemaining: 0
          }));
          return; // Stop here if insufficient balance
        }

        // Rest of your existing creator initialization code...
        // FIRST: Try to get creator stats to check if creator mode is enabled
        let creatorEnabled = false;
        try {
          const stats = await tokenLaunchService.getCreatorStats();
          setCreatorStats(stats);
          creatorEnabled = stats.user?.creator_enabled || false;
        } catch (statsError) {
          console.warn('Stats fetch failed:', statsError);
          creatorEnabled = false;
        }

        // SECOND: If creator mode is not enabled, enable it automatically
        if (!creatorEnabled) {
          try {
            console.log('Auto-enabling creator mode...');
            const enableResult = await tokenLaunchService.enableCreatorMode();
            console.log('Creator mode enabled:', enableResult);

            // Update creator stats after enabling
            const updatedStats = await tokenLaunchService.getCreatorStats();
            setCreatorStats(updatedStats);
            creatorEnabled = true;

            await new Promise(resolve => setTimeout(resolve, 1000));
          } catch (enableError) {
            console.error('Failed to auto-enable creator mode:', enableError);
            setLaunchStatus(prev => ({
              ...prev,
              message: `❌ Failed to enable creator mode: ${
                enableError instanceof Error ? enableError.message : 'Insufficient balance or network error'
              }`,
              phase: 'failed'
            }));
            return;
          }
        }

        // THIRD: Get bot wallets AFTER creator mode is confirmed enabled
        if (creatorEnabled) {
          try {
            const bots = await tokenLaunchService.getBotWallets();
            setBotWallets(bots.bot_wallets || []);

            if (!bots.bot_wallets || bots.bot_wallets.length === 0) {
              console.log('No bot wallets found, generating automatically...');
              const generateResult = await tokenLaunchService.generateBotWallets(10);

              const updatedBots = await tokenLaunchService.getBotWallets();
              setBotWallets(updatedBots.bot_wallets || []);
            }
          } catch (botError) {
            console.warn('Bot wallets fetch failed:', botError);
          }
        }

      } catch (error) {
        console.error('Failed to initialize creator:', error);
        setLaunchStatus(prev => ({
          ...prev,
          phase: 'failed',
          message: `❌ Initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          currentStep: 'Failed',
          estimatedTimeRemaining: 0
        }));
      }
    };

    initializeCreator();

    return () => {
      if (progressInterval.current) {
        clearInterval(progressInterval.current);
      }
      launchWebSocket.disconnect();
    };
  }, []);

  const handleUsePreFunded = () => {
    setUsePreFundedBots(true);
    setAtomicLaunchMode(true);
    setLaunchStatus(prev => ({
      ...prev,
      message: '✅ Using pre-funded bots for atomic launch',
      phase: 'ready'
    }));
  };

  const checkPreFundedBots = async () => {
    try {
      const status = await tokenLaunchService.checkPreFundedStatus();
      console.log('Pre-funded bots status:', status);
      return status;
    } catch (error) {
      console.error('Failed to check pre-funded bots:', error);
      return { has_pre_funded: false, count: 0, total_amount: 0 };
    }
  };


  useEffect(() => {
    const estimateCost = async () => {
      // Calculate based on launch mode
      let totalCost = 0;
      
      if (atomicLaunchMode && usePreFundedBots) {
        // Atomic launch with pre-funded bots - only pay for creator buy and fees
        const creatorBuySol = launchConfig.creatorBuyAmount;
        const feesSol = 0.02 + 0.08;
        totalCost = creatorBuySol + feesSol;
      } else {
        // Regular launch - pay for everything
        const botWalletsSol = launchConfig.botCount * launchConfig.botWalletBuyAmount;
        const creatorBuySol = launchConfig.creatorBuyAmount;
        const feesSol = 0.02 + 0.08;
        totalCost = botWalletsSol + creatorBuySol + feesSol;
      }
      
      // Set the UI calculation
      setTotalRequiredSol(totalCost);
      
      // Get backend estimation for comparison
      try {
        const estimation = await tokenLaunchService.estimateCost({
          botCount: launchConfig.botCount,
          creatorBuyAmount: launchConfig.creatorBuyAmount,
          botBuyAmount: launchConfig.botWalletBuyAmount,
          useJitoBundle: true,
          atomicMode: atomicLaunchMode
        });
        
        console.log('Backend estimation:', estimation.total_cost);
        console.log('UI calculation:', totalCost);
      } catch (error) {
        console.error('Backend estimation failed:', error);
      }
    };
    
    if (launchConfig.botCount > 0 && launchConfig.botWalletBuyAmount > 0) {
      estimateCost();
    }
  }, [launchConfig.botCount, launchConfig.creatorBuyAmount, launchConfig.botWalletBuyAmount, atomicLaunchMode, usePreFundedBots]);


  // Add WebSocket event handlers for pre-funding
  useEffect(() => {
    if (activeLaunchId) {
      launchWebSocket.connect(activeLaunchId);
      
      // Add pre-funding specific events
      launchWebSocket.on('prefund_start', (data: any) => {
        setLaunchStatus(prev => ({
          ...prev,
          message: `Pre-funding ${data.bot_count} bots...`,
          phase: 'funding',
          progress: 40
        }));
      });
      
      launchWebSocket.on('prefund_progress', (data: any) => {
        setLaunchStatus(prev => ({
          ...prev,
          message: `Pre-funded ${data.funded}/${data.total} bots`,
          progress: 40 + (data.funded / data.total) * 20
        }));
      });
      
      launchWebSocket.on('prefund_complete', (data: any) => {
        setLaunchStatus(prev => ({
          ...prev,
          message: `✅ Pre-funded ${data.total} bots with ${data.total_amount.toFixed(4)} SOL`,
          phase: 'ready',
          progress: 60
        }));
        
        // Update pre-funded bots list
        checkPreFundedBots();
      });
      
      launchWebSocket.on('atomic_launch_start', (data: any) => {
        setLaunchStatus(prev => ({
          ...prev,
          message: 'Building atomic bundle with pre-funded bots...',
          phase: 'launching',
          progress: 70
        }));
      });
    }
    
    return () => {
      launchWebSocket.disconnect();
    };
  }, [activeLaunchId]);

  // Add an effect to check if form fields have valid data
  useEffect(() => {
    // Check if token name and symbol are filled (basic validation)
    const hasManualMetadata = 
      launchConfig.tokenName.trim() !== '' && 
      launchConfig.tokenSymbol.trim() !== '';
    
    // If user manually entered metadata and we haven't already flagged it as generated
    if (hasManualMetadata && !metadataGenerated) {
      setMetadataGenerated(true);
    }
  }, [launchConfig.tokenName, launchConfig.tokenSymbol, metadataGenerated]);

  // ============================================
  // UTILITY FUNCTIONS
  // ============================================
  const validateMetadataForLaunch = (): boolean => {
    // Check if we have the minimum required info
    const hasName = launchConfig.tokenName.trim().length > 0;
    const hasSymbol = launchConfig.tokenSymbol.trim().length > 0;
    
    if (!hasName || !hasSymbol) {
      alert('Token name and symbol are required for launch');
      return false;
    }
    
    // If using AI metadata, check if we have metadata_uri
    if (launchConfig.useAIForMetadata && generatedMetadata) {
      if (!generatedMetadata.metadata_uri) {
        alert('AI metadata generation failed to create IPFS URI. Please regenerate metadata.');
        return false;
      }
      console.log('✅ AI metadata has URI:', generatedMetadata.metadata_uri);
    }
    
    // If manual entry, warn about missing IPFS
    if (!launchConfig.useAIForMetadata && !generatedMetadata?.metadata_uri) {
      const proceed = window.confirm(
        'Manual token creation without IPFS metadata may have limited functionality. ' +
        'Consider using AI metadata generation for full features. Continue anyway?'
      );
      if (!proceed) return false;
    }
    
    return true;
  };

  // Add new launch methods
  const handlePreFundComplete = (result: any) => {
    setPreFundResult(result);
    setUsePreFundedBots(true);
    setAtomicLaunchMode(true);
    
    // Update status
    setLaunchStatus(prev => ({
      ...prev,
      message: `✅ Pre-funded ${result.pre_funded_count} bots with ${result.total_pre_funded.toFixed(4)} SOL`,
      phase: 'ready'
    }));
  };

  const handleFundWallet = () => {
    if (userWallet) {
      const address = userWallet.publicKey.toBase58();
      alert(`Please send at least ${MIN_SOL_FOR_CREATOR_MODE} SOL to:\n\n${address}\n\nAddress has been copied to clipboard.`);
      navigator.clipboard.writeText(address);
    }
  };

  const handleCheckSolDeposit = async () => {
    if (userWallet) {
      const balance = await fetchWalletBalance(userWallet.publicKey);
      setUserBalance(balance);
      
      if (balance >= MIN_SOL_FOR_CREATOR_MODE) {
        setLaunchStatus(prev => ({
          ...prev,
          message: '✅ Sufficient balance! Creator features will now initialize...',
          phase: 'setup'
        }));
        // You might want to re-run the initialization logic here
        setTimeout(() => window.location.reload(), 1500);
      }
    }
  };

  const saveUserSettings = useCallback(
      debounce(async (settings: any) => {
        try {
          await tokenLaunchService.updateUserSettings(settings);
          console.log('Settings saved to backend');
        } catch (error) {
          console.error('Failed to save settings:', error);
        }
      }, 1000), // Debounce for 1 second
      []
  );

  // Update your handle functions to save settings
  const handleBotCountChange = (value: number) => {
    setLaunchConfig(prev => ({ ...prev, botCount: value }));
    
    // Save to backend
    saveUserSettings({ botCount: value });
  };

  const handleBotBuyAmountChange = (value: number) => {
    setLaunchConfig(prev => ({ ...prev, botWalletBuyAmount: value }));
    
    // Save to backend
    saveUserSettings({ botWalletBuyAmount: value });
  };

  const handleCreatorBuyAmountChange = (value: number) => {
    setLaunchConfig(prev => ({ ...prev, creatorBuyAmount: value }));
    
    // Save to backend
    saveUserSettings({ creatorBuyAmount: value });
  };

  const fetchWalletBalance = async (publicKey: PublicKey): Promise<number> => {
    try {
      const connection = new Connection(config.solana.rpcUrl, 'confirmed');
      const lamports = await connection.getBalance(publicKey);
      return lamports / 1_000_000_000;
    } catch (error) {
      console.error('Error fetching balance:', error);
      return 0;
    }
  };

  const generateBotArmy = (count: number): BotArmyWallet[] => {
    const bots: BotArmyWallet[] = [];
    for (let i = 0; i < count; i++) {
      const keypair = Keypair.generate();
      bots.push({
        publicKey: keypair.publicKey.toBase58(),
        privateKey: bs58.encode(keypair.secretKey),
        balance: 0,
        isFunded: false,
        buyAmount: launchConfig.botWalletBuyAmount
      });
    }
    return bots;
  };

  // Add validation function
  const validateLaunchConfig = () => {
    const errors: string[] = [];
    
    if (!launchConfig.tokenName.trim()) {
      errors.push('Token name is required');
    }
    
    if (!launchConfig.tokenSymbol.trim()) {
      errors.push('Token symbol is required');
    }
    
    if (launchConfig.botCount < 1) {
      errors.push('At least 1 bot is required');
    }
    
    if (launchConfig.botWalletBuyAmount < 0.0001) {
      errors.push('Bot buy amount must be at least 0.0001 SOL');
    }
    
    if (launchConfig.creatorBuyAmount < 0.001) {
      errors.push('Creator buy amount must be at least 0.001 SOL');
    }
    
    // Validate sell strategy fields
    if (launchConfig.sellTiming === 'volume_based' && launchConfig.sellVolumeTrigger < 1) {
      errors.push('Volume trigger must be at least 1 SOL');
    }
    
    if (launchConfig.sellTiming === 'time_based' && launchConfig.sellTimeTrigger < 1) {
      errors.push('Time trigger must be at least 1 minute');
    }
    
    if (launchConfig.sellTiming === 'price_target' && launchConfig.sellPriceTarget < 1.1) {
      errors.push('Price target must be at least 1.1%');
    }
    
    // No validation needed for immediate sell
    
    return errors;
  };

  
  // ============================================
  // AI METADATA GENERATION
  // ============================================

  // const generateAIMetadata = useCallback(async () => {
  //   if (!launchConfig.useAIForMetadata) return;
    
  //   setAiGenerating(true);
  //   setLaunchStatus(prev => ({
  //     ...prev,
  //     message: 'Generating AI metadata...',
  //     currentStep: 'AI Generation'
  //   }));
    
  //   try {
  //     const response = await apiService.request('/ai/generate-metadata', {
  //       method: 'POST',
  //       headers: { 'Content-Type': 'application/json' },
  //       body: JSON.stringify({
  //         style: launchConfig.metadataStyle,
  //         keywords: launchConfig.metadataKeywords,
  //         category: 'meme',
  //         use_dalle: launchConfig.useDalle
  //       })
  //     });

  //     // console.log('🔍 Backend response:', response);
      
  //     if (response.success) {
  //       const metadata: TokenMetadata = response.metadata_for_token;
  //       setGeneratedMetadata(metadata);
        
  //       // Convert IPFS URL to HTTP for display
  //       const displayImageUrl = convertIpfsToHttpUrl(metadata.image);

  //       // console.log('🔍 Image URL from backend:', metadata.image);
  //       // console.log('🔍 Display Image URL:', displayImageUrl);
  //       // console.log('🔍 Is IPFS URL?', isIpfsUrl(metadata.image));
          
  //       setLaunchConfig(prev => ({
  //         ...prev,
  //         tokenName: metadata.name,
  //         tokenSymbol: metadata.symbol,
  //         tokenDescription: metadata.description,
  //         imageUrl: displayImageUrl // Use HTTP URL for display
  //       }));

  //       // Set metadata generated flag to true
  //       setMetadataGenerated(true);
        
  //       setLaunchStatus(prev => ({
  //         ...prev,
  //         phase: 'metadata',
  //         message: '✅ AI metadata generated successfully',
  //         progress: 20
  //       }));
        
  //       setShowPreview(true);
        
  //       // Log IPFS info if available
  //       if (metadata.ipfs_cid) {
  //         console.log('📦 IPFS Metadata:', {
  //           cid: metadata.ipfs_cid,
  //           uri: metadata.ipfs_uri,
  //           imageUrl: metadata.image
  //         });
  //       }
  //     }
  //   } catch (error) {
  //     console.error('AI metadata generation failed:', error);
  //     setLaunchStatus(prev => ({
  //       ...prev,
  //       message: '❌ AI generation failed, using defaults',
  //       progress: 10
  //     }));
  //     generateDefaultMetadata();
  //   } finally {
  //     setAiGenerating(false);
  //   }
  // }, [launchConfig]);


  const generateAIMetadata = useCallback(async () => {
    if (!launchConfig.useAIForMetadata) return;
    
    setAiGenerating(true);
    setLaunchStatus(prev => ({
      ...prev,
      message: 'Generating AI metadata...',
      currentStep: 'AI Generation'
    }));
    
    try {
      const response = await apiService.request('/ai/generate-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          style: launchConfig.metadataStyle,
          keywords: launchConfig.metadataKeywords,
          category: 'meme',
          use_dalle: launchConfig.useDalle
        })
      });

      console.log('🔍 Backend response:', response);
      
      if (response.success) {
        // ✅ Create custom metadata for backend
        const customMetadata = createCustomMetadataFromAI(response);
        
        // ✅ Create a display metadata object
        const metadata: TokenMetadata = {
          name: response.name,
          symbol: response.symbol,
          description: response.description || 'Token created via Flash Sniper',
          image: response.image_url,
          external_url: "https://pump.fun",
          attributes: [
            { trait_type: "Created On", value: new Date().toLocaleDateString() },
            { trait_type: "AI Generated", value: "Yes" },
            { trait_type: "Launch Strategy", value: "Orchestrated Launch" }
          ],
          created_at: new Date().toISOString(),
          image_prompt: launchConfig.metadataKeywords,
          
          // ✅ Store the metadata_uri
          metadata_uri: response.metadata_uri,
          ipfs_uri: response.metadata_uri,
          ipfs_cid: response.metadata_uri ? extractIpfsCid(response.metadata_uri) : undefined
        };
        
        setGeneratedMetadata(metadata);
        
        // Convert IPFS URL to HTTP for display
        const displayImageUrl = convertIpfsToHttpUrl(response.image_url);

        console.log('✅ AI Metadata Generated:');
        console.log('   Name:', response.name);
        console.log('   Symbol:', response.symbol);
        console.log('   Metadata URI:', response.metadata_uri);
        console.log('   Image URL:', response.image_url);
        
        // ✅ Update launch config with the critical fields
        setLaunchConfig(prev => ({
          ...prev,
          tokenName: response.name,
          tokenSymbol: response.symbol,
          tokenDescription: response.description || 'Token created via Flash Sniper',
          imageUrl: displayImageUrl,
          
          // ✅ Store the custom metadata for backend use
          customMetadata: customMetadata
        }));

        setMetadataGenerated(true);
        
        setLaunchStatus(prev => ({
          ...prev,
          phase: 'metadata',
          message: '✅ AI metadata generated successfully',
          progress: 20
        }));
        
        setShowPreview(true);
        
      } else {
        throw new Error('AI metadata generation failed: ' + (response.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('AI metadata generation failed:', error);
      setLaunchStatus(prev => ({
        ...prev,
        message: '❌ AI generation failed, using defaults',
        progress: 10
      }));
      generateDefaultMetadata();
    } finally {
      setAiGenerating(false);
    }
  }, [launchConfig]);

  // Add helper function to extract IPFS CID
  const extractIpfsCid = (ipfsUrl: string): string | undefined => {
    try {
      const match = ipfsUrl.match(/ipfs\/([a-zA-Z0-9]+)/);
      return match ? match[1] : undefined;
    } catch {
      return undefined;
    }
  };
  


  const generateDefaultMetadata = () => {
    const defaultMetadata: TokenMetadata = {
      name: launchConfig.tokenName || "AI Meme Token",
      symbol: launchConfig.tokenSymbol || "AIMT",
      description: "The next generation AI-powered meme token on Solana. Community driven and fully decentralized.",
      image: "https://placehold.co/600x400",
      external_url: "https://pump.fun",
      attributes: [
        { trait_type: "Created On", value: new Date().toLocaleDateString() },
        { trait_type: "AI Generated", value: "Yes" },
        { trait_type: "Launch Strategy", value: "Orchestrated Launch" }
      ],
      created_at: new Date().toISOString()
    };
    
    setGeneratedMetadata(defaultMetadata);

    // Also set metadata generated flag for default metadata
    setMetadataGenerated(true);

    setShowPreview(true);
  };
  
  // ============================================
  // QUICK LAUNCH FUNCTIONS
  // ============================================
  const applyQuickLaunch = useCallback((preset: 'meme' | 'professional' | 'micro') => {
    const presets = {
      meme: {
        botCount: 10,
        creatorBuyAmount: 0.001,
        botWalletBuyAmount: 0.0001,
        metadataStyle: 'meme' as const,
        metadataKeywords: 'meme, viral, community, solana, crypto',
        sellTiming: 'volume_based' as const,  // CHANGED: lowercase with underscore
        sellVolumeTrigger: 5.0,
        sellTimeTrigger: 1,  // Added: default minimum
        sellPriceTarget: 1.1 // Added: default minimum
      },
      professional: {
        botCount: 20,
        creatorBuyAmount: 1.0,
        botWalletBuyAmount: 0.2,
        metadataStyle: 'professional' as const,
        metadataKeywords: 'utility, defi, solana, blockchain, technology',
        sellTiming: 'time_based' as const,  // CHANGED: lowercase with underscore
        sellTimeTrigger: 5,
        sellVolumeTrigger: 5.0,  // Added: required field
        sellPriceTarget: 1.1   // Added: required field
      },
      micro: {
        botCount: 5,
        creatorBuyAmount: 0.2,
        botWalletBuyAmount: 0.05,
        metadataStyle: 'ai-generated' as const,
        metadataKeywords: 'micro, test, solana, experimental',
        sellTiming: 'price_target' as const,  // CHANGED: lowercase with underscore
        sellPriceTarget: 50,
        sellTimeTrigger: 1,    // Added: required field
        sellVolumeTrigger: 0   // Added: required field
      }
    };
    
    const selected = presets[preset];
    setLaunchConfig(prev => ({
      ...prev,
      ...selected
    }));
    
    setActiveTab('quick');
    setLaunchStatus(prev => ({
      ...prev,
      message: `Applied ${preset} preset configuration`
    }));
  }, []);
  
  // const handleQuickLaunch = async (preset: 'meme' | 'professional' | 'micro') => {
  //   if (!userWallet) {
  //     alert('Please connect wallet first');
  //     return;
  //   }
    
  //   // Check if creator mode is enabled
  //   if (!creatorStats?.user?.creator_enabled) {
  //     const enable = window.confirm('Creator mode is not enabled. Enable it now?');
  //     if (enable) {
  //       await tokenLaunchService.enableCreatorMode();
  //       alert('Creator mode enabled! Please try again.');
  //       return;
  //     }
  //     return;
  //   }
    
  //   setIsLoading(true);
    
  //   const presets = {
  //     meme: {
  //       botCount: 10,
  //       creatorBuyAmount: 0.001,
  //       botBuyAmount: 0.0001,
  //       style: 'meme',
  //       keywords: 'meme, viral, community, solana, crypto',
  //       useDalle: false,
  //       sellStrategyType: 'volume_based' as const,  // CHANGED: UPPERCASE
  //       sellVolumeTarget: 5.0,
  //       sellTimeMinutes: 1,  // ADDED: required field
  //       sellPriceTarget: 1.1   // ADDED: required field
  //     },
  //     professional: {
  //       botCount: 20,
  //       creatorBuyAmount: 0.01,
  //       botBuyAmount: 0.001,
  //       style: 'professional',
  //       keywords: 'utility, defi, solana, blockchain, technology',
  //       useDalle: true,
  //       sellStrategyType: 'time_based' as const,  // CHANGED: UPPERCASE
  //       sellTimeMinutes: 5,   // ADDED: must be >= 1
  //       sellVolumeTarget: 0,  // ADDED: required field
  //       sellPriceTarget: 1.1    // ADDED: required field
  //     },
  //     micro: {
  //       botCount: 5,
  //       creatorBuyAmount: 0.01,
  //       botBuyAmount: 0.005,
  //       style: 'ai-generated',
  //       keywords: 'micro, test, solana, experimental',
  //       useDalle: false,
  //       sellStrategyType: 'price_target' as const,  // CHANGED: UPPERCASE
  //       sellPriceTarget: 50,   // ADDED: must be >= 1.1
  //       sellTimeMinutes: 1,    // ADDED: required field
  //       sellVolumeTarget: 0    // ADDED: required field
  //     }
  //   };
    
  //   try {
  //     const response = await tokenLaunchService.quickLaunch(presets[preset]);
      
  //     if (response.success) {
  //       // ... rest of your existing success handling code
  //     } else {
  //       throw new Error(response.error || 'Failed to start launch');
  //     }
  //   } catch (error: any) {
  //     console.error('Quick launch failed:', error);
  //     setLaunchStatus({
  //       phase: 'failed',
  //       progress: 0,
  //       message: `❌ Quick launch failed: ${error.message}`,
  //       currentStep: 'Failed',
  //       estimatedTimeRemaining: 0
  //     });
  //   } finally {
  //     setIsLoading(false);
  //   }
  // };


  // ============================================
  // LAUNCH ORCHESTRATION
  // ============================================
  
  const handleQuickLaunch = async (preset: 'meme' | 'professional' | 'micro') => {
    if (!userWallet) {
      alert('Please connect wallet first');
      return;
    }
    
    // Check if creator mode is enabled
    if (!creatorStats?.user?.creator_enabled) {
      const enable = window.confirm('Creator mode is not enabled. Enable it now?');
      if (enable) {
        await tokenLaunchService.enableCreatorMode();
        alert('Creator mode enabled! Please try again.');
        return;
      }
      return;
    }
    
    setIsLoading(true);
    
    const presets = {
      meme: {
        botCount: 10,
        creatorBuyAmount: 0.001,
        botBuyAmount: 0.0001,
        style: 'meme',
        keywords: 'meme, viral, community, solana, crypto',
        useDalle: false,
        sellStrategyType: 'volume_based' as const,  // CHANGED: UPPERCASE
        sellVolumeTarget: 5.0,
        sellTimeMinutes: 1,  // ADDED: required field
        sellPriceTarget: 1.1   // ADDED: required field
      },
      professional: {
        botCount: 20,
        creatorBuyAmount: 0.01,
        botBuyAmount: 0.001,
        style: 'professional',
        keywords: 'utility, defi, solana, blockchain, technology',
        useDalle: true,
        sellStrategyType: 'time_based' as const,  // CHANGED: UPPERCASE
        sellTimeMinutes: 5,   // ADDED: must be >= 1
        sellVolumeTarget: 0,  // ADDED: required field
        sellPriceTarget: 1.1    // ADDED: required field
      },
      micro: {
        botCount: 5,
        creatorBuyAmount: 0.01,
        botBuyAmount: 0.005,
        style: 'ai-generated',
        keywords: 'micro, test, solana, experimental',
        useDalle: false,
        sellStrategyType: 'price_target' as const,  // CHANGED: UPPERCASE
        sellPriceTarget: 50,   // ADDED: must be >= 1.1
        sellTimeMinutes: 1,    // ADDED: required field
        sellVolumeTarget: 0    // ADDED: required field
      }
    };
    
    try {
      const response = await tokenLaunchService.quickLaunch(presets[preset]);
      
      if (response.success) {
        const launchId = response.launch_id;
        setActiveLaunchId(launchId);
        
        // Setup WebSocket connection for real-time updates
        launchWebSocket.connect(launchId);

        // ... rest of WebSocket handling code ...
      
        // ✅ IMPORTANT: Update the launch config with the returned metadata
        if (response.metadata) {
          setLaunchConfig(prev => ({
            ...prev,
            tokenName: response.metadata.name,
            tokenSymbol: response.metadata.symbol,
            // Store custom metadata for later reference
            customMetadata: {
              name: response.metadata.name,
              symbol: response.metadata.symbol,
              metadata_uri: response.metadata.metadata_uri,
              image_url: response.metadata.image_url,
              description: response.metadata.description
            }
          }));
        }
      } else {
        throw new Error(response.error || 'Failed to start launch');
      }
    } catch (error: any) {
      console.error('Quick launch failed:', error);
      setLaunchStatus({
        phase: 'failed',
        progress: 0,
        message: `❌ Quick launch failed: ${error.message}`,
        currentStep: 'Failed',
        estimatedTimeRemaining: 0
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  const startOrchestratedLaunch = async () => {
    console.log('=== DEBUG LAUNCH START ===');
    console.log('UI Display Values:');
    console.log('- Bot Count:', launchConfig.botCount);
    console.log('- Bot Buy Amount:', launchConfig.botWalletBuyAmount);
    console.log('- Creator Buy Amount:', launchConfig.creatorBuyAmount);
    console.log('- UI Total (manual):', totalRequiredSol);
    console.log('- User Balance:', userBalance);
    console.log('- Atomic Mode:', atomicLaunchMode);
    console.log('- Use Pre-funded:', usePreFundedBots);


    // Use the UI calculation that the user sees
    if (userBalance < totalRequiredSol) {
      alert(`Insufficient SOL. Required: ${totalRequiredSol.toFixed(2)} SOL | Available: ${userBalance.toFixed(2)} SOL`);
      return;
    }

    // Optional: Also check backend for extra safety
    try {
      const balanceData = await tokenLaunchService.getCreatorBalance();
      console.log('Backend balance data:', balanceData);
      
      // Compare backend suggestion vs UI calculation
      if (balanceData.required_balance > totalRequiredSol) {
        const confirmLaunch = window.confirm(
          `Note: Backend recommends ${balanceData.required_balance.toFixed(2)} SOL for full reserves.\n` +
          `UI calculation shows ${totalRequiredSol.toFixed(2)} SOL needed.\n\n` +
          `Your balance: ${userBalance.toFixed(2)} SOL\n` +
          `Continue with ${totalRequiredSol.toFixed(2)} SOL launch?`
        );
        
        if (!confirmLaunch) {
          return;
        }
      }
    } catch (balanceError) {
      console.warn('Backend balance check failed, proceeding with UI calculation:', balanceError);
    }

    // Validate first
    const validationErrors = validateLaunchConfig();
    if (validationErrors.length > 0) {
      alert(`Please fix the following errors:\n\n${validationErrors.join('\n')}`);
      return;
    }

    if (!userWallet) {
      alert('Please connect wallet first');
      return;
    }
    
    // Check if creator mode is enabled (with fallback)
    const isCreatorEnabled = creatorStats?.user?.creator_enabled ?? true; // Default to true for testing
    
    if (!isCreatorEnabled) {
      const enable = window.confirm('Creator mode is not enabled. Enable it now?');
      if (enable) {
        try {
          await tokenLaunchService.enableCreatorMode();
          alert('Creator mode enabled! Please try again.');
          return;
        } catch (error) {
          console.error('Failed to enable creator mode:', error);
          alert('Failed to enable creator mode. Please try again later.');
          return;
        }
      }
      return;
    }
    
    // Check balance (with fallback if API fails)
    // Check balance using the same calculation that UI shows
    console.log('=== BALANCE CHECK ===');
    console.log('Total Required (from UI calculation):', totalRequiredSol);
    console.log('User Balance:', userBalance);

    // Use the same calculation that's displayed in UI
    const uiTotalRequired = totalRequiredSol;

    if (userBalance < uiTotalRequired) {
      alert(`Insufficient SOL. Required: ${uiTotalRequired.toFixed(2)} SOL | Available: ${userBalance.toFixed(2)} SOL`);
      return;
    }

    // Also check with backend estimation as fallback
    try {
      const balanceData = await tokenLaunchService.getCreatorBalance();
      console.log('Backend balance data:', balanceData);
      
      if (balanceData.balance_sufficient === false) {
        const confirmLaunch = window.confirm(
          `Backend recommends ${balanceData.required_balance.toFixed(2)} SOL but UI shows ${uiTotalRequired.toFixed(2)} SOL.\n\n` +
          `Your balance: ${userBalance.toFixed(2)} SOL\n` +
          `Proceed anyway?`
        );
        
        if (!confirmLaunch) {
          return;
        }
      }
    } catch (balanceError) {
      console.warn('Backend balance check failed, using UI calculation:', balanceError);
    }

    // ✅ Add metadata validation
    if (!validateMetadataForLaunch()) {
      return;
    }
 
    // Check if we should use pre-funded bots
    const shouldUsePreFunded = usePreFundedBots && atomicLaunchMode;
    
    if (shouldUsePreFunded) {
      // Execute atomic launch with pre-funded bots
      await executeAtomicLaunch();
    } else {
      // Execute regular launch (with auto pre-funding)
      await executeRegularLaunch();
    }
  };

  // ============================================
  // REGULAR LAUNCH (Existing code moved here)
  // ============================================
  // const executeRegularLaunch = async () => {
  //   setIsLoading(true);
    
  //   setLaunchStatus({
  //     phase: 'setup',
  //     progress: 0,
  //     message: 'Starting regular launch...',
  //     currentStep: 'Initialization',
  //     estimatedTimeRemaining: 180
  //   });
    
  //   const bots = generateBotArmy(launchConfig.botCount);
  //   setBotArmy(bots);
    
  //   try {
  //     // Generate or use existing metadata
  //     let metadata = generatedMetadata;
  //     if (launchConfig.useAIForMetadata && !metadata) {
  //       await generateAIMetadata();
  //       metadata = generatedMetadata;
  //     }
      
  //     // Prepare launch config for backend
  //     const backendConfig: Partial<LaunchConfig> = {
  //       tokenName: launchConfig.tokenName,
  //       tokenSymbol: launchConfig.tokenSymbol,
  //       tokenDescription: launchConfig.tokenDescription,
  //       imageUrl: launchConfig.imageUrl,
  //       creatorWallet: launchConfig.creatorWallet || (userWallet ? userWallet.publicKey.toBase58() : ''),
  //       botCount: launchConfig.botCount,
  //       creatorBuyAmount: launchConfig.creatorBuyAmount,
  //       botWalletBuyAmount: launchConfig.botWalletBuyAmount,
  //       targetProfitPercentage: launchConfig.targetProfitPercentage,
        
  //       // Use the existing sellTiming property (already has correct format)
  //       sellTiming: launchConfig.sellTiming, // This should already be 'volume_based', 'time_based', or 'price_target'
        
  //       // These are the correct property names based on your LaunchConfig interface
  //       sellVolumeTrigger: launchConfig.sellTiming === 'volume_based' ? launchConfig.sellVolumeTrigger : 0,
  //       sellTimeTrigger: launchConfig.sellTiming === 'time_based' ? Math.max(launchConfig.sellTimeTrigger, 1) : 1, // Minimum 1
  //       sellPriceTarget: launchConfig.sellTiming === 'price_target' ? Math.max(launchConfig.sellPriceTarget, 1.1) : 1.1, // Minimum 1.1
        
  //       useAIForMetadata: launchConfig.useAIForMetadata,
  //       metadataStyle: launchConfig.metadataStyle,
  //       metadataKeywords: launchConfig.metadataKeywords,
  //       useDalle: launchConfig.useDalle,
  //       useJitoBundle: launchConfig.useJitoBundle !== false,
  //       priority: launchConfig.priority || 10,
  //       botSpread: launchConfig.botSpread || 'random',
  //     };
      
  //     if (metadata) {
  //       backendConfig.customMetadata = {
  //         name: metadata.name,
  //         symbol: metadata.symbol,
  //         description: metadata.description,
  //         image: metadata.image,
  //         attributes: metadata.attributes
  //       };
  //     }
      
  //     console.log('Sending launch config:', backendConfig);
      
  //     // Call backend to create launch
  //     const response = await tokenLaunchService.createLaunch(backendConfig);
      
  //     console.log('Launch response:', response);
      
  //     if (response.success) {
  //       const launchId = response.launch_id;
  //       setActiveLaunchId(launchId);
        
  //       // Setup WebSocket connection for real-time updates
  //       launchWebSocket.connect(launchId);
        
  //       launchWebSocket.on('update', (data: LaunchStatus) => {
  //         setLaunchStatus({
  //           phase: data.status.toLowerCase().replace(/_/g, '-') as any,
  //           progress: data.progress,
  //           message: data.message,
  //           currentStep: data.current_step,
  //           estimatedTimeRemaining: data.estimated_time_remaining
  //         });
  //       });
        
  //       launchWebSocket.on('complete', (data: any) => {
  //         setLaunchStatus({
  //           phase: 'complete',
  //           progress: 100,
  //           message: '🎉 Launch completed successfully!',
  //           currentStep: 'Complete',
  //           estimatedTimeRemaining: 0
  //         });
          
  //         // Add to results
  //         setLaunchResults(prev => [...prev, {
  //           success: data.success || true,
  //           mintAddress: data.mint_address,
  //           creatorTransaction: data.creator_tx_hash,
  //           botBuyBundleId: data.bot_buy_bundle_id,
  //           botSellBundleId: data.bot_sell_bundle_id,
  //           totalProfit: data.total_profit || 0,
  //           roi: data.roi || 0,
  //           duration: data.duration || 0
  //         }]);
  //       });
        
  //       launchWebSocket.on('failed', (data: any) => {
  //         setLaunchStatus({
  //           phase: 'failed',
  //           progress: 0,
  //           message: `❌ Launch failed: ${data.error || 'Unknown error'}`,
  //           currentStep: 'Failed',
  //           estimatedTimeRemaining: 0
  //         });
  //       });
        
  //       // Also poll for status updates (fallback)
  //       const pollStatus = async () => {
  //         try {
  //           const status = await tokenLaunchService.getLaunchStatus(launchId);
  //           setLaunchStatus({
  //             phase: status.status.toLowerCase().replace(/_/g, '-') as any,
  //             progress: status.progress,
  //             message: status.message,
  //             currentStep: status.current_step,
  //             estimatedTimeRemaining: status.estimated_time_remaining
  //           });
            
  //           if (status.status !== 'COMPLETE' && status.status !== 'FAILED') {
  //             setTimeout(pollStatus, 2000);
  //           }
  //         } catch (error) {
  //           console.error('Polling failed:', error);
  //         }
  //       };
        
  //       pollStatus();
        
  //     } else {
  //       throw new Error(response.error || 'Failed to start launch');
  //     }
      
  //   } catch (error: any) {
  //     console.error('Launch failed:', error);
  //     setLaunchStatus({
  //       phase: 'failed',
  //       progress: 0,
  //       message: `❌ Regular launch failed: ${error.message}`,
  //       currentStep: 'Failed',
  //       estimatedTimeRemaining: 0
  //     });
  //   } finally {
  //     setIsLoading(false);
  //   }
  // };

  const executeRegularLaunch = async () => {
    setIsLoading(true);
    
    setLaunchStatus({
      phase: 'setup',
      progress: 0,
      message: 'Starting regular launch...',
      currentStep: 'Initialization',
      estimatedTimeRemaining: 180
    });
    
    try {
      // Generate or use existing metadata
      let metadata = generatedMetadata;
      if (launchConfig.useAIForMetadata && !metadata) {
        await generateAIMetadata();
        metadata = generatedMetadata;
      }
      
      // ✅ CRITICAL: Prepare launch config with proper metadata structure
      const backendConfig: Partial<LaunchConfig> = {
        tokenName: launchConfig.tokenName,
        tokenSymbol: launchConfig.tokenSymbol,
        tokenDescription: launchConfig.tokenDescription,
        imageUrl: launchConfig.imageUrl,
        creatorWallet: launchConfig.creatorWallet || (userWallet ? userWallet.publicKey.toBase58() : ''),
        botCount: launchConfig.botCount,
        creatorBuyAmount: launchConfig.creatorBuyAmount,
        botWalletBuyAmount: launchConfig.botWalletBuyAmount,
        targetProfitPercentage: launchConfig.targetProfitPercentage,
        sellTiming: launchConfig.sellTiming,

        // sellVolumeTrigger: launchConfig.sellTiming === 'volume_based' ? launchConfig.sellVolumeTrigger : 0,
        // sellTimeTrigger: launchConfig.sellTiming === 'time_based' ? Math.max(launchConfig.sellTimeTrigger, 1) : 1,
        // sellPriceTarget: launchConfig.sellTiming === 'price_target' ? Math.max(launchConfig.sellPriceTarget, 1.1) : 1.1,

        // Ensure minimum values even for 'immediate' strategy
        sellVolumeTrigger: launchConfig.sellTiming === 'volume_based' ? 
          Math.max(launchConfig.sellVolumeTrigger, 5.0) : 5.0,
          
        sellTimeTrigger: launchConfig.sellTiming === 'time_based' ? 
          Math.max(launchConfig.sellTimeTrigger, 1) : 1, // Minimum 1 even for immediate
          
        sellPriceTarget: launchConfig.sellTiming === 'price_target' ? 
          Math.max(launchConfig.sellPriceTarget, 1.1) : 1.1, // Minimum 1.1 even for immediate
        
        useAIForMetadata: launchConfig.useAIForMetadata,
        metadataStyle: launchConfig.metadataStyle,
        metadataKeywords: launchConfig.metadataKeywords,
        useDalle: launchConfig.useDalle,
        useJitoBundle: launchConfig.useJitoBundle !== false,
        priority: launchConfig.priority || 10,
        botSpread: launchConfig.botSpread || 'random',
      };
      
      // ✅ If we have AI-generated metadata, use the metadata_uri
      // if (metadata && metadata.metadata_uri) {
      //   console.log('✅ Using AI-generated metadata URI:', metadata.metadata_uri);
      //   backendConfig.customMetadata = {
      //     name: metadata.name,
      //     symbol: metadata.symbol,
      //     description: metadata.description,
      //     uri: metadata.metadata_uri, // ✅ This is the key field!
      //     image: metadata.image
      //   };
      // } 

      // ✅ If we have AI-generated metadata, use the metadata_uri
      if (metadata && metadata.metadata_uri) {
        console.log('✅ Using AI-generated metadata URI:', metadata.metadata_uri);
        backendConfig.customMetadata = {
          name: metadata.name,
          symbol: metadata.symbol,
          description: metadata.description,
          metadata_uri: metadata.metadata_uri, // ✅ Use metadata_uri field
          uri: metadata.metadata_uri, // ✅ Also include uri for compatibility
          image: metadata.image,
          image_url: metadata.image
        };
      }
      
      // ✅ If user manually entered token info (no AI generation)
      else if (launchConfig.tokenName && launchConfig.tokenSymbol) {
        console.log('⚠️ Using manually entered token info (no IPFS URI)');
        backendConfig.customMetadata = {
          name: launchConfig.tokenName,
          symbol: launchConfig.tokenSymbol,
          description: launchConfig.tokenDescription || 'Token created via Flash Sniper',
          // For manual tokens without IPFS, we need to handle this differently
          metadata_uri: null // Will need fallback in backend
        };
      }
      
      console.log('📤 Sending launch config to backend:', {
        ...backendConfig,
        customMetadata: backendConfig.customMetadata ? {
          ...backendConfig.customMetadata,
          metadata_uri: backendConfig.customMetadata.metadata_uri 
            ? `${backendConfig.customMetadata.metadata_uri.substring(0, 50)}...` 
            : 'null'
        } : 'none'
      });
      
      // Call backend to create launch
      const response = await tokenLaunchService.createLaunch(backendConfig);
      
      console.log('📥 Launch response:', response);
      
      if (response.success) {
        const launchId = response.launch_id;
        setActiveLaunchId(launchId);
        
        // Setup WebSocket connection for real-time updates
        launchWebSocket.connect(launchId);
        
        launchWebSocket.on('update', (data: LaunchStatus) => {
          setLaunchStatus({
            phase: data.status.toLowerCase().replace(/_/g, '-') as any,
            progress: data.progress,
            message: data.message,
            currentStep: data.current_step,
            estimatedTimeRemaining: data.estimated_time_remaining
          });
        });
        
        launchWebSocket.on('complete', (data: any) => {
          setLaunchStatus({
            phase: 'complete',
            progress: 100,
            message: '🎉 Launch completed successfully!',
            currentStep: 'Complete',
            estimatedTimeRemaining: 0
          });
          
          // Add to results
          setLaunchResults(prev => [...prev, {
            success: data.success || true,
            mintAddress: data.mint_address,
            creatorTransaction: data.creator_tx_hash,
            botBuyBundleId: data.bot_buy_bundle_id,
            botSellBundleId: data.bot_sell_bundle_id,
            totalProfit: data.total_profit || 0,
            roi: data.roi || 0,
            duration: data.duration || 0
          }]);
        });
        
        launchWebSocket.on('failed', (data: any) => {
          setLaunchStatus({
            phase: 'failed',
            progress: 0,
            message: `❌ Launch failed: ${data.error || 'Unknown error'}`,
            currentStep: 'Failed',
            estimatedTimeRemaining: 0
          });
        });
        
        // Also poll for status updates (fallback)
        const pollStatus = async () => {
          try {
            const status = await tokenLaunchService.getLaunchStatus(launchId);
            setLaunchStatus({
              phase: status.status.toLowerCase().replace(/_/g, '-') as any,
              progress: status.progress,
              message: status.message,
              currentStep: status.current_step,
              estimatedTimeRemaining: status.estimated_time_remaining
            });
            
            if (status.status !== 'COMPLETE' && status.status !== 'FAILED') {
              setTimeout(pollStatus, 2000);
            }
          } catch (error) {
            console.error('Polling failed:', error);
          }
        };
        
        pollStatus();
        
      } else {
        throw new Error(response.error || 'Failed to start launch');
      }
      
    } catch (error: any) {
      console.error('Launch failed:', error);
      setLaunchStatus({
        phase: 'failed',
        progress: 0,
        message: `❌ Regular launch failed: ${error.message}`,
        currentStep: 'Failed',
        estimatedTimeRemaining: 0
      });
    } finally {
      setIsLoading(false);
    }
  };

  // ============================================
  // ATOMIC LAUNCH (New function)
  // ============================================
  // const executeAtomicLaunch = async () => {
  //   setIsLoading(true);
    
  //   setLaunchStatus({
  //     phase: 'setup',
  //     progress: 0,
  //     message: 'Starting atomic launch with pre-funded bots...',
  //     currentStep: 'Atomic Launch Setup',
  //     estimatedTimeRemaining: 120
  //   });

  //   try {
  //     // Check pre-funded bot availability
  //     const preFundStatus = await tokenLaunchService.checkPreFundedStatus();
      
  //     if (!preFundStatus.has_pre_funded || preFundStatus.count < launchConfig.botCount) {
  //       const confirm = window.confirm(
  //         `Need ${launchConfig.botCount} pre-funded bots but only have ${preFundStatus.count}. ` +
  //         `Would you like to pre-fund ${launchConfig.botCount - preFundStatus.count} more bots first?`
  //       );
        
  //       if (confirm) {
  //         setShowPreFundingPanel(true);
  //         setIsLoading(false);
  //         return;
  //       }
  //     }

  //     // Generate or use existing metadata - FIX: Use generatedMetadata instead of launchConfig values
  //     let metadata = generatedMetadata;
  //     if (launchConfig.useAIForMetadata && !metadata) {
  //       await generateAIMetadata();
  //       metadata = generatedMetadata;
  //     }
      
  //     // CRITICAL FIX: Use the AI-generated metadata or fallback to manually entered values
  //     let tokenMetadata;
  //     if (metadata) {
  //       // Use AI-generated metadata
  //       tokenMetadata = {
  //         name: metadata.name,
  //         symbol: metadata.symbol,
  //         description: metadata.description,
  //         image: metadata.image
  //       };
  //     } else {
  //       // Fallback to manually entered values (but warn user)
  //       console.warn('No AI metadata generated, using manual inputs');
  //       tokenMetadata = {
  //         name: launchConfig.tokenName || `Token_${Date.now()}`,
  //         symbol: launchConfig.tokenSymbol || 'TKN',
  //         description: launchConfig.tokenDescription || 'Token created via Flash Sniper',
  //         image: launchConfig.imageUrl || 'https://placehold.co/600x400'
  //       };
  //     }

  //     // Prepare atomic payload for the new backend endpoint
  //     const atomicPayload = {
  //       user_wallet: launchConfig.creatorWallet,
  //       metadata: tokenMetadata, // Use the processed metadata
  //       creator_buy_amount: launchConfig.creatorBuyAmount,
  //       bot_wallets: botWallets.slice(0, launchConfig.botCount).map(bot => ({
  //         public_key: bot.public_key,
  //         buy_amount: launchConfig.botWalletBuyAmount
  //       })),
  //       use_jito: true,
  //       atomic_bundle: true,
  //       sell_strategy: {
  //         type: launchConfig.sellTiming,
  //         volume_target: launchConfig.sellVolumeTrigger,
  //         time_minutes: launchConfig.sellTimeTrigger,
  //         price_target: launchConfig.sellPriceTarget
  //       }
  //     };

  //     console.log('Sending atomic payload to backend:', atomicPayload);
  //     console.log('Metadata being sent:', tokenMetadata);
      
  //     // Call the new atomic create+buy endpoint in YOUR backend (not on-chain service directly)
  //     const response = await tokenLaunchService.executeAtomicCreateAndBuy(atomicPayload);
      
  //     console.log('Atomic launch response:', response);
      
  //     if (response.success) {
  //       const launchId = response.launch_id;
  //       setActiveLaunchId(launchId);
        
  //       // Setup WebSocket connection for atomic launch
  //       launchWebSocket.connect(launchId);
        
  //       launchWebSocket.on('update', (data: LaunchStatus) => {
  //         setLaunchStatus({
  //           phase: data.status.toLowerCase().replace(/_/g, '-') as any,
  //           progress: data.progress,
  //           message: data.message,
  //           currentStep: data.current_step,
  //           estimatedTimeRemaining: data.estimated_time_remaining
  //         });
  //       });
        
  //       // Add atomic-specific events
  //       launchWebSocket.on('atomic_launch_start', (data: any) => {
  //         setLaunchStatus({
  //           phase: 'launching',
  //           progress: 70,
  //           message: 'Building atomic bundle with pre-funded bots...',
  //           currentStep: 'Atomic Bundle',
  //           estimatedTimeRemaining: 60
  //         });
  //       });
        
  //       launchWebSocket.on('complete', (data: any) => {
  //         setLaunchStatus({
  //           phase: 'complete',
  //           progress: 100,
  //           message: '🎉 Atomic launch completed successfully!',
  //           currentStep: 'Complete',
  //           estimatedTimeRemaining: 0
  //         });
          
  //         // Add to results
  //         setLaunchResults(prev => [...prev, {
  //           success: data.success || true,
  //           mintAddress: data.mint_address,
  //           creatorTransaction: data.creator_tx_hash,
  //           botBuyBundleId: data.bot_buy_bundle_id,
  //           botSellBundleId: data.bot_sell_bundle_id,
  //           totalProfit: data.total_profit || 0,
  //           roi: data.roi || 0,
  //           duration: data.duration || 0,
  //           atomic_bundle: true
  //         }]);
  //       });
        
  //       launchWebSocket.on('failed', (data: any) => {
  //         setLaunchStatus({
  //           phase: 'failed',
  //           progress: 0,
  //           message: `❌ Atomic launch failed: ${data.error || 'Unknown error'}`,
  //           currentStep: 'Failed',
  //           estimatedTimeRemaining: 0
  //         });
  //       });
        
  //       // Also poll for status updates (fallback)
  //       const pollStatus = async () => {
  //         try {
  //           const status = await tokenLaunchService.getLaunchStatus(launchId);
  //           setLaunchStatus({
  //             phase: status.status.toLowerCase().replace(/_/g, '-') as any,
  //             progress: status.progress,
  //             message: status.message,
  //             currentStep: status.current_step,
  //             estimatedTimeRemaining: status.estimated_time_remaining
  //           });
            
  //           if (status.status !== 'COMPLETE' && status.status !== 'FAILED') {
  //             setTimeout(pollStatus, 2000);
  //           } else if (status.status === 'COMPLETE') {
  //             // Update results
  //             setLaunchResults(prev => [...prev, {
  //               success: true,
  //               mintAddress: status.mint_address || '',
  //               creatorTransaction: status.creator_tx_hash || '',
  //               botBuyBundleId: status.bot_buy_bundle_id,
  //               botSellBundleId: status.bot_sell_bundle_id,
  //               totalProfit: status.total_profit || 0,
  //               roi: status.roi || 0,
  //               duration: status.duration || 0,
  //               atomic_bundle: true
  //             }]);
  //           }
  //         } catch (error) {
  //           console.error('Polling failed:', error);
  //         }
  //       };
        
  //       pollStatus();
  //     } else {
  //       throw new Error(response.error || 'Atomic launch failed');
  //     }
  //   } catch (error: any) {
  //     console.error('Atomic launch failed:', error);
  //     setLaunchStatus({
  //       phase: 'failed',
  //       progress: 0,
  //       message: `❌ Atomic launch failed: ${error.message}`,
  //       currentStep: 'Failed',
  //       estimatedTimeRemaining: 0
  //     });
  //   } finally {
  //     setIsLoading(false);
  //   }
  // };

  const executeAtomicLaunch = async () => {
    setIsLoading(true);
    
    setLaunchStatus({
      phase: 'setup',
      progress: 0,
      message: 'Starting atomic launch with pre-funded bots...',
      currentStep: 'Atomic Launch Setup',
      estimatedTimeRemaining: 120
    });

    try {
      // FIX: Get ALL bots and filter by actual balance, not just database flag
      const allBotsResponse = await tokenLaunchService.getBotWallets();
      const allBots: BotWallet[] = allBotsResponse.bot_wallets || [];
      
      // Count bots with actual balance
      const botsWithBalance = allBots.filter((bot: BotWallet) => (bot.current_balance || 0) > 0);
      const hasSufficientBots = botsWithBalance.length >= launchConfig.botCount;
      
      if (!hasSufficientBots) {
        const confirm = window.confirm(
          `Need ${launchConfig.botCount} funded bots but only have ${botsWithBalance.length} with balance. ` +
          `Would you like to pre-fund ${launchConfig.botCount - botsWithBalance.length} more bots first?`
        );
        
        if (confirm) {
          setShowPreFundingPanel(true);
          setIsLoading(false);
          return;
        } else {
          // Option: Use what we have and adjust bot count
          setLaunchConfig(prev => ({
            ...prev,
            botCount: botsWithBalance.length
          }));
        }
      }

      // Use adjusted bot count if needed
      const usableBotCount = hasSufficientBots ? launchConfig.botCount : botsWithBalance.length;
      const usableBots = botsWithBalance.slice(0, usableBotCount);
      
      // Generate or use existing metadata
      let metadata = generatedMetadata;
      if (launchConfig.useAIForMetadata && !metadata) {
        await generateAIMetadata();
        metadata = generatedMetadata;
      }
      
      // CRITICAL FIX: Use the AI-generated metadata or fallback
      let tokenMetadata: {
        name: string;
        symbol: string;
        description: string;
        image: string;
      };
      if (metadata) {
        tokenMetadata = {
          name: metadata.name,
          symbol: metadata.symbol,
          description: metadata.description,
          image: metadata.image
        };
      } else {
        // Fallback to manually entered values
        tokenMetadata = {
          name: launchConfig.tokenName || `Token_${Date.now()}`,
          symbol: launchConfig.tokenSymbol || 'TKN',
          description: launchConfig.tokenDescription || 'Token created via Flash Sniper',
          image: launchConfig.imageUrl || 'https://placehold.co/600x400'
        };
      }

      // Prepare atomic payload with proper typing
      const atomicPayload = {
        user_wallet: launchConfig.creatorWallet,
        metadata: tokenMetadata,
        creator_buy_amount: launchConfig.creatorBuyAmount,
        bot_wallets: usableBots.map((bot: BotWallet) => ({
          public_key: bot.public_key,
          buy_amount: launchConfig.botWalletBuyAmount
        })),
        use_jito: true,
        atomic_bundle: true,
        sell_strategy: {
          type: launchConfig.sellTiming,
          volume_target: launchConfig.sellVolumeTrigger,
          time_minutes: launchConfig.sellTimeTrigger,
          price_target: launchConfig.sellPriceTarget
        }
      };

      console.log('Sending atomic payload:', atomicPayload);
      console.log('Using bots with balance:', usableBots.length);
      
      // Call the new atomic create+buy endpoint in YOUR backend (not on-chain service directly)
      const response = await tokenLaunchService.executeAtomicCreateAndBuy(atomicPayload);
      
      console.log('Atomic launch response:', response);
      
      if (response.success) {
        const launchId = response.launch_id;
        setActiveLaunchId(launchId);
        
        // Setup WebSocket connection for atomic launch
        launchWebSocket.connect(launchId);
        
        launchWebSocket.on('update', (data: LaunchStatus) => {
          setLaunchStatus({
            phase: data.status.toLowerCase().replace(/_/g, '-') as any,
            progress: data.progress,
            message: data.message,
            currentStep: data.current_step,
            estimatedTimeRemaining: data.estimated_time_remaining
          });
        });
        
        // Add atomic-specific events
        launchWebSocket.on('atomic_launch_start', (data: any) => {
          setLaunchStatus({
            phase: 'launching',
            progress: 70,
            message: 'Building atomic bundle with pre-funded bots...',
            currentStep: 'Atomic Bundle',
            estimatedTimeRemaining: 60
          });
        });
        
        launchWebSocket.on('complete', (data: any) => {
          setLaunchStatus({
            phase: 'complete',
            progress: 100,
            message: '🎉 Atomic launch completed successfully!',
            currentStep: 'Complete',
            estimatedTimeRemaining: 0
          });
          
          // Add to results
          setLaunchResults(prev => [...prev, {
            success: data.success || true,
            mintAddress: data.mint_address,
            creatorTransaction: data.creator_tx_hash,
            botBuyBundleId: data.bot_buy_bundle_id,
            botSellBundleId: data.bot_sell_bundle_id,
            totalProfit: data.total_profit || 0,
            roi: data.roi || 0,
            duration: data.duration || 0,
            atomic_bundle: true
          }]);
        });
        
        launchWebSocket.on('failed', (data: any) => {
          setLaunchStatus({
            phase: 'failed',
            progress: 0,
            message: `❌ Atomic launch failed: ${data.error || 'Unknown error'}`,
            currentStep: 'Failed',
            estimatedTimeRemaining: 0
          });
        });
        
        // Also poll for status updates (fallback)
        const pollStatus = async () => {
          try {
            const status = await tokenLaunchService.getLaunchStatus(launchId);
            setLaunchStatus({
              phase: status.status.toLowerCase().replace(/_/g, '-') as any,
              progress: status.progress,
              message: status.message,
              currentStep: status.current_step,
              estimatedTimeRemaining: status.estimated_time_remaining
            });
            
            if (status.status !== 'COMPLETE' && status.status !== 'FAILED') {
              setTimeout(pollStatus, 2000);
            } else if (status.status === 'COMPLETE') {
              // Update results
              setLaunchResults(prev => [...prev, {
                success: true,
                mintAddress: status.mint_address || '',
                creatorTransaction: status.creator_tx_hash || '',
                botBuyBundleId: status.bot_buy_bundle_id,
                botSellBundleId: status.bot_sell_bundle_id,
                totalProfit: status.total_profit || 0,
                roi: status.roi || 0,
                duration: status.duration || 0,
                atomic_bundle: true
              }]);
            }
          } catch (error) {
            console.error('Polling failed:', error);
          }
        };
        
        pollStatus();
      } else {
        throw new Error(response.error || 'Atomic launch failed');
      }
    } catch (error: any) {
      console.error('Atomic launch failed:', error);
      setLaunchStatus({
        phase: 'failed',
        progress: 0,
        message: `❌ Atomic launch failed: ${error.message}`,
        currentStep: 'Failed',
        estimatedTimeRemaining: 0
      });
    } finally {
      setIsLoading(false);
    }
  };


  // ============================================
  // ORCHESTRATED LAUNCH (Auto pre-fund + atomic)
  // ============================================
  const executeOrchestratedLaunch = async () => {
    setIsLoading(true);
    setLaunchStatus({
      phase: 'setup',
      progress: 0,
      message: 'Starting orchestrated launch...',
      currentStep: 'Orchestrated Launch',
      estimatedTimeRemaining: 180
    });

    try {
      const response = await tokenLaunchService.startOrchestratedLaunch();
      
      if (response.success) {
        const launchId = response.launch_id;
        setActiveLaunchId(launchId);
        
        // Setup WebSocket connection
        launchWebSocket.connect(launchId);
        
        launchWebSocket.on('update', (data: LaunchStatus) => {
          setLaunchStatus({
            phase: data.status.toLowerCase().replace(/_/g, '-') as any,
            progress: data.progress,
            message: data.message,
            currentStep: data.current_step,
            estimatedTimeRemaining: data.estimated_time_remaining
          });
        });
        
        launchWebSocket.on('complete', (data: any) => {
          setLaunchStatus({
            phase: 'complete',
            progress: 100,
            message: '🎉 Orchestrated launch completed successfully!',
            currentStep: 'Complete',
            estimatedTimeRemaining: 0
          });
          
          // Add to results
          setLaunchResults(prev => [...prev, {
            success: data.success || true,
            mintAddress: data.mint_address,
            creatorTransaction: data.creator_tx_hash,
            botBuyBundleId: data.bot_buy_bundle_id,
            botSellBundleId: data.bot_sell_bundle_id,
            totalProfit: data.total_profit || 0,
            roi: data.roi || 0,
            duration: data.duration || 0,
            orchestrated: true
          }]);
        });
        
        // Start polling
        const pollStatus = async () => {
          try {
            const status = await tokenLaunchService.getLaunchStatus(launchId);
            setLaunchStatus({
              phase: status.status.toLowerCase().replace(/_/g, '-') as any,
              progress: status.progress,
              message: status.message,
              currentStep: status.current_step,
              estimatedTimeRemaining: status.estimated_time_remaining
            });
            
            if (status.status !== 'COMPLETE' && status.status !== 'FAILED') {
              setTimeout(pollStatus, 2000);
            }
          } catch (error) {
            console.error('Polling failed:', error);
          }
        };
        
        pollStatus();
      } else {
        throw new Error(response.error || 'Orchestrated launch failed');
      }
    } catch (error: any) {
      console.error('Orchestrated launch failed:', error);
      setLaunchStatus({
        phase: 'failed',
        progress: 0,
        message: `❌ Orchestrated launch failed: ${error.message}`,
        currentStep: 'Failed',
        estimatedTimeRemaining: 0
      });
    } finally {
      setIsLoading(false);
    }
  };

  
  // ============================================
  // UI COMPONENTS
  // ============================================

   const PhaseIndicator = ({ phase }: { phase: FrontendLaunchStatus['phase'] }) => {
    const phases = [
      { id: 'setup', label: 'Setup', icon: '⚙️', color: 'from-blue-500/20 to-blue-600/10', border: 'border-blue-400/30', iconColor: 'bg-blue-500' },
      { id: 'metadata', label: 'Metadata', icon: '🎨', color: 'from-indigo-500/20 to-purple-600/10', border: 'border-indigo-400/30', iconColor: 'bg-indigo-500' },
      { id: 'creating', label: 'Creating', icon: '🏗️', color: 'from-purple-500/20 to-purple-600/10', border: 'border-purple-400/30', iconColor: 'bg-purple-500' },
      { id: 'funding', label: 'Funding', icon: '💰', color: 'from-pink-500/20 to-rose-600/10', border: 'border-pink-400/30', iconColor: 'bg-pink-500' },
      { id: 'ready', label: 'Ready', icon: '✅', color: 'from-teal-500/20 to-emerald-600/10', border: 'border-teal-400/30', iconColor: 'bg-teal-500' },
      { id: 'launching', label: 'Launching', icon: '🚀', color: 'from-amber-500/20 to-orange-600/10', border: 'border-amber-400/30', iconColor: 'bg-amber-500' },
      { id: 'monitoring', label: 'Monitoring', icon: '📊', color: 'from-orange-500/20 to-red-600/10', border: 'border-orange-400/30', iconColor: 'bg-orange-500' },
      { id: 'selling', label: 'Selling', icon: '📈', color: 'from-emerald-500/20 to-green-600/10', border: 'border-emerald-400/30', iconColor: 'bg-emerald-500' },
      { id: 'complete', label: 'Complete', icon: '🎉', color: 'from-emerald-600/30 to-teal-600/20', border: 'border-teal-400/40', iconColor: 'bg-teal-400' },
    ];

    const currentPhaseIndex = phases.findIndex(p => p.id === phase);
    
    return (
      <div className="relative p-4 bg-dark-2 rounded-lg border border-[#22253e]">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-teal-500 to-emerald-600 rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
            <h3 className="text-white text-sm font-semibold">Launch Progress</h3>
          </div>
          <div className="text-xs text-gray-400 bg-dark-1 px-3 py-1 rounded-full">
            Step {currentPhaseIndex + 1} of {phases.length}
          </div>
        </div>
        
        {/* Connection Lines */}
        <div className="absolute top-14 left-6 right-6 h-0.5 bg-[#22253e] z-0">
          <div 
            className="h-full bg-gradient-to-r from-teal-500 via-emerald-500 to-green-500 transition-all duration-500 ease-out"
            style={{ width: `${(currentPhaseIndex / (phases.length - 1)) * 100}%` }}
          ></div>
        </div>
        
        <div className="relative grid grid-cols-3 sm:grid-cols-9 gap-2 sm:gap-1 z-10">
          {phases.map((p, index) => {
            const isActive = p.id === phase;
            const isCompleted = index < currentPhaseIndex;
            const isUpcoming = index > currentPhaseIndex;
            
            return (
              <div key={p.id} className="flex flex-col items-center">
                <div className={`relative w-10 h-10 rounded-full mb-2 flex items-center justify-center transition-all duration-300 ${
                  isCompleted 
                    ? 'bg-gradient-to-br from-teal-500 to-emerald-500 shadow-lg shadow-teal-500/20' 
                    : isActive 
                    ? `${p.iconColor} shadow-lg shadow-current/20 border-2 border-white/20` 
                    : 'bg-dark-1 border border-[#22253e]'
                }`}>
                  {isCompleted ? (
                    <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    <span className={`${isActive ? 'text-white' : 'text-gray-400'} text-sm`}>
                      {isActive ? p.icon : index + 1}
                    </span>
                  )}
                  
                  {/* Active phase pulse */}
                  {isActive && (
                    <div className="absolute inset-0 rounded-full border-2 border-teal-400 animate-ping opacity-20"></div>
                  )}
                </div>
                
                <span className={`text-xs font-medium text-center px-1 truncate w-full ${
                  isActive ? 'text-teal-400' : 
                  isCompleted ? 'text-emerald-400' : 
                  'text-gray-500'
                }`}>
                  {p.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const StatusCard = () => {
    // Define the PhaseConfig type
    interface PhaseConfig {
      color: string;
      border: string;
      icon: string;
      gradient: string;
      iconBg: string;
      statusText: string;
      bgGradient: string;
      pulse?: boolean;
    }

    const getPhaseConfig = (): PhaseConfig => {
      const configs = {
        'setup': { 
          color: 'from-blue-900/20 to-blue-800/10', 
          border: 'border-blue-500/30',
          icon: '⚙️',
          gradient: 'from-blue-500 via-sky-500 to-cyan-500',
          iconBg: 'bg-blue-500',
          statusText: 'Setup Phase',
          bgGradient: 'bg-gradient-to-br from-blue-900/10 to-blue-800/5'
        },
        'metadata': { 
          color: 'from-indigo-900/20 to-purple-800/10', 
          border: 'border-indigo-500/30',
          icon: '🎨',
          gradient: 'from-indigo-500 via-purple-500 to-violet-500',
          iconBg: 'bg-indigo-500',
          statusText: 'Generating Metadata',
          bgGradient: 'bg-gradient-to-br from-indigo-900/10 to-purple-800/5'
        },
        'creating': { 
          color: 'from-violet-900/20 to-purple-800/10', 
          border: 'border-violet-500/30',
          icon: '🏗️',
          gradient: 'from-violet-500 via-purple-500 to-fuchsia-500',
          iconBg: 'bg-violet-500',
          statusText: 'Creating Token',
          bgGradient: 'bg-gradient-to-br from-violet-900/10 to-purple-800/5'
        },
        'funding': { 
          color: 'from-purple-900/20 to-pink-800/10', 
          border: 'border-purple-500/30',
          icon: '💰',
          gradient: 'from-purple-500 via-pink-500 to-rose-500',
          iconBg: 'bg-purple-500',
          statusText: 'Funding Wallets',
          bgGradient: 'bg-gradient-to-br from-purple-900/10 to-pink-800/5'
        },
        'ready': { 
          color: 'from-teal-900/20 to-emerald-800/10', 
          border: 'border-teal-500/30',
          icon: '✅',
          gradient: 'from-teal-500 via-emerald-500 to-green-500',
          iconBg: 'bg-teal-500',
          statusText: 'Ready to Launch',
          bgGradient: 'bg-gradient-to-br from-teal-900/10 to-emerald-800/5'
        },
        'launching': { 
          color: 'from-amber-900/20 to-orange-800/10', 
          border: 'border-amber-500/30',
          icon: '🚀',
          gradient: 'from-amber-500 via-orange-500 to-red-500',
          iconBg: 'bg-amber-500',
          statusText: 'Launching',
          bgGradient: 'bg-gradient-to-br from-amber-900/10 to-orange-800/5'
        },
        'monitoring': { 
          color: 'from-orange-900/20 to-red-800/10', 
          border: 'border-orange-500/30',
          icon: '📊',
          gradient: 'from-orange-500 via-red-500 to-pink-500',
          iconBg: 'bg-orange-500',
          statusText: 'Monitoring',
          bgGradient: 'bg-gradient-to-br from-orange-900/10 to-red-800/5'
        },
        'selling': { 
          color: 'from-emerald-900/20 to-green-800/10', 
          border: 'border-emerald-500/30',
          icon: '📈',
          gradient: 'from-emerald-500 via-green-500 to-lime-500',
          iconBg: 'bg-emerald-500',
          statusText: 'Selling',
          bgGradient: 'bg-gradient-to-br from-emerald-900/10 to-green-800/5'
        },
        'complete': { 
          color: 'from-emerald-900/30 to-green-800/20', 
          border: 'border-emerald-500/40',
          icon: '🎉',
          gradient: 'from-emerald-400 via-green-400 to-lime-400',
          iconBg: 'bg-emerald-400',
          statusText: 'Complete!',
          bgGradient: 'bg-gradient-to-br from-emerald-900/20 to-green-800/15',
          pulse: true
        },
        'failed': { 
          color: 'from-red-900/30 to-rose-800/20', 
          border: 'border-red-500/40',
          icon: '❌',
          gradient: 'from-red-500 via-rose-500 to-pink-500',
          iconBg: 'bg-red-500',
          statusText: 'Failed',
          bgGradient: 'bg-gradient-to-br from-red-900/20 to-rose-800/15'
        }
      };
      
      return configs[launchStatus.phase] || configs.setup;
    };

    const formatTimeRemaining = () => {
      if (launchStatus.estimatedTimeRemaining <= 0) return 'Complete';
      
      const minutes = Math.floor(launchStatus.estimatedTimeRemaining / 60);
      const seconds = launchStatus.estimatedTimeRemaining % 60;
      
      if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
      }
      return `${seconds}s`;
    };

    const phaseConfig = getPhaseConfig();

    // Add IPFS status
    const hasIpfsMetadata = generatedMetadata?.ipfs_cid;

    return (
      <div className="bg-dark-2 rounded-lg shadow-lg overflow-hidden border border-[#22253e]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#000010] bg-gradient-to-r from-dark-2 to-dark-1">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className={`w-8 h-8 ${phaseConfig.iconBg} rounded-lg flex items-center justify-center`}>
                <span className="text-base">{phaseConfig.icon}</span>
              </div>
              <div className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full border border-dark-2"></div>
            </div>
            <div>
              <h3 className="text-white text-base font-semibold">Launch Status</h3>
              <p className="text-xs text-gray-400">Token deployment progress</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {launchStatus.phase === 'complete' ? (
              <span className="px-2 py-1 bg-emerald-900/30 text-emerald-400 text-xs font-medium rounded-full flex items-center gap-1">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                Complete
              </span>
            ) : launchStatus.phase === 'failed' ? (
              <span className="px-2 py-1 bg-red-900/30 text-red-400 text-xs font-medium rounded-full flex items-center gap-1">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                Failed
              </span>
            ) : (
              <span className="px-2 py-1 bg-teal-900/30 text-teal-400 text-xs font-medium rounded-full flex items-center gap-1">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                </svg>
                In Progress
              </span>
            )}
          </div>
        </div>
        
        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Current Step */}
          <div className="bg-dark-1 rounded-xl p-3 border border-[#2a2d45]">
            <p className="text-sm text-gray-300">{launchStatus.currentStep}</p>
          </div>
          
          {/* Progress Section */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-400">Progress</span>
              <div className="text-right">
                <div className="text-2xl font-bold bg-gradient-to-r from-teal-400 to-emerald-400 bg-clip-text text-transparent">
                  {launchStatus.progress}%
                </div>
                <div className="text-xs text-gray-500">
                  {launchStatus.estimatedTimeRemaining > 0 
                    ? `${formatTimeRemaining()} remaining`
                    : 'Complete'}
                </div>
              </div>
            </div>
            
            {/* Progress Bar */}
            <div className="h-2 bg-dark-1 rounded-full overflow-hidden">
              <div 
                className={`h-full bg-gradient-to-r ${phaseConfig.gradient} transition-all duration-500 ease-out`}
                style={{ width: `${launchStatus.progress}%` }}
              ></div>
            </div>
            
            {/* Progress Markers */}
            <div className="flex justify-between text-xs text-gray-500 px-1">
              <span>0%</span>
              <span>50%</span>
              <span>100%</span>
            </div>
          </div>
          
          {/* Status Message */}
          <div className="bg-dark-1 rounded-xl p-3 border border-[#2a2d45]">
            <div className="flex items-start gap-2">
              <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${phaseConfig.iconBg} ${phaseConfig.pulse ? 'animate-pulse' : ''}`}></div>
              <p className="text-sm text-gray-200">{launchStatus.message}</p>
            </div>
          </div>
          
          {/* Launch ID */}
          {activeLaunchId && (
            <div className="bg-dark-1 rounded-xl p-3 border border-[#2a2d45]">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                  </svg>
                  <span className="text-xs text-gray-400 font-medium">Launch ID</span>
                </div>
                <button
                  onClick={() => navigator.clipboard.writeText(activeLaunchId)}
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copy
                </button>
              </div>
              <div className="text-sm font-mono text-gray-300 break-all bg-dark-2 p-2 rounded-lg border border-[#22253e]">
                {activeLaunchId}
              </div>
            </div>
          )}

          {/* IPFS Status Section */}
          {hasIpfsMetadata && (
            <div className="bg-dark-1 rounded-xl p-3 border border-emerald-500/30">
              <div className="flex items-center gap-2 mb-2">
                <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                <span className="text-sm text-emerald-400 font-medium">IPFS Storage Ready</span>
              </div>
              <div className="text-xs text-gray-400">
                Metadata pinned to IPFS (CID: {generatedMetadata?.ipfs_cid?.slice(0, 12) || 'N/A'}...)
              </div>
              <div className="mt-2 text-xs text-gray-500">
                <div className="truncate">URI: {generatedMetadata.ipfs_uri}</div>
              </div>
            </div>
          )}
          
          {/* Phase Indicator */}
          <PhaseIndicator phase={launchStatus.phase} />
        </div>
      </div>
    );
  };

  const InsufficientBalanceWarning = () => {
    if (userBalance >= MIN_SOL_FOR_CREATOR_MODE) return null;

    return (
      <div className="bg-dark-2 rounded-lg shadow-lg overflow-hidden border border-[#22253e]">
        <div className="flex items-center justify-between p-4 border-b border-[#000010] bg-gradient-to-r from-dark-2 to-dark-1">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-8 h-8 bg-gradient-to-br from-red-500 to-orange-600 rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border border-dark-2"></div>
            </div>
            <div>
              <h3 className="text-white text-base font-semibold">Insufficient Balance</h3>
              <p className="text-xs text-gray-400">Add SOL to enable creator mode</p>
            </div>
          </div>
          <div className="text-xs text-gray-400">
            {userBalance.toFixed(6)} / {MIN_SOL_FOR_CREATOR_MODE} SOL
          </div>
        </div>
        
        <div className="p-4 space-y-4">
          {/* Warning Message */}
          <div className="bg-red-900/20 border border-red-700/30 rounded-xl p-3">
            <div className="flex items-start gap-2">
              <svg className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <p className="text-sm text-red-300">
                You need at least <span className="font-bold text-white">{MIN_SOL_FOR_CREATOR_MODE} SOL</span> to enable creator mode. 
                Current balance: <span className="font-bold text-white">{userBalance.toFixed(6)} SOL</span>.
              </p>
            </div>
          </div>
          
          {/* Action Buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={handleFundWallet}
              className="bg-gradient-to-r from-teal-600 to-emerald-600 text-white text-sm font-medium py-3 px-4 rounded-lg hover:from-teal-700 hover:to-emerald-700 transition-all duration-200 flex items-center justify-center gap-2 shadow-lg"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Fund Wallet
            </button>
            
            <button
              onClick={handleCheckSolDeposit}
              className="bg-dark-1 border border-[#2a2d45] text-gray-300 hover:text-white text-sm font-medium py-3 px-4 rounded-lg hover:bg-dark-2 transition-all duration-200 flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Check Balance
            </button>
          </div>
          
          {/* Wallet Info */}
          <div className="space-y-3">
            {/* Wallet Address */}
            <div className="bg-dark-1 rounded-xl p-3 border border-[#2a2d45]">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                  <span className="text-xs text-gray-400 font-medium">Wallet Address</span>
                </div>
                <button
                  onClick={() => navigator.clipboard.writeText(launchConfig.creatorWallet)}
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1"
                  title="Copy address"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copy
                </button>
              </div>
              <div className="text-sm font-mono text-gray-300 break-all bg-dark-2 p-2 rounded-lg border border-[#22253e]">
                {launchConfig.creatorWallet}
              </div>
            </div>
            
            {/* Private Key (Collapsible) */}
            <div className="bg-dark-1 rounded-xl border border-[#2a2d45] overflow-hidden">
              <div className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    <span className="text-xs text-red-400 font-medium">Private Key</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => navigator.clipboard.writeText(launchConfig.creatorPrivateKey || '')}
                      className="text-xs text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1"
                      title="Copy private key"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Copy
                    </button>
                    <button
                      onClick={() => setShowPrivateKey(!showPrivateKey)}
                      className="text-red-400 hover:text-red-300 transition-colors p-1"
                    >
                      <svg className="w-4 h-4 transform transition-transform" style={{ transform: showPrivateKey ? 'rotate(180deg)' : 'none' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>
                </div>
                
                {showPrivateKey && launchConfig.creatorPrivateKey && (
                  <div className="mt-3">
                    <div className="relative">
                      <code className="text-gray-300 font-mono text-xs break-all bg-red-900/20 px-3 py-2 rounded-lg border border-red-700/30 block max-h-32 overflow-y-auto">
                        {launchConfig.creatorPrivateKey}
                      </code>
                    </div>
                    
                    {/* Security Warning */}
                    <div className="mt-3 p-3 bg-red-900/10 border border-red-700/20 rounded-lg">
                      <div className="flex items-start gap-2">
                        <svg className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <p className="text-xs text-red-300/90 leading-relaxed">
                          <span className="font-bold">Warning:</span> Never share your private key. Anyone with this key has full control over your wallet.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          
          {/* Alternative Action */}
          <div className="text-center pt-2">
            <button
              onClick={() => navigate('/trading-interface')}
              className="text-sm text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 py-2 px-4 rounded-lg transition-colors inline-flex items-center gap-1"
            >
              <span>Go to Trading Interface</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    );
  };


  // const MetadataPreview = () => {
  //   if (!generatedMetadata || !showPreview) return null;
    
  //   // Convert IPFS URL to HTTP URL for display
  //   const displayImageUrl = useMemo(() => {
  //     if (!generatedMetadata?.image) return '';
  //     return convertIpfsToHttpUrl(generatedMetadata.image);
  //   }, [generatedMetadata?.image]);
    
  //   return (
  //     <div className="bg-gradient-to-br from-gray-900/50 to-dark-2/50 backdrop-blur-sm rounded-2xl p-5 border border-gray-800/50 mb-6 shadow-lg">
  //       <div className="flex justify-between items-center mb-4">
  //         <div className="flex items-center gap-3">
  //           <div className="w-10 h-10 bg-gradient-to-br from-cyan-500 to-blue-500 rounded-xl flex items-center justify-center shadow-lg">
  //             <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
  //               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
  //             </svg>
  //           </div>
  //           <div>
  //             <h3 className="text-white font-bold">AI Generated Metadata</h3>
  //             <p className="text-sm text-gray-400">Preview your token details</p>
  //           </div>
  //         </div>
  //         <button
  //           onClick={() => setShowPreview(false)}
  //           className="text-gray-400 hover:text-white transition-colors"
  //         >
  //           <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
  //             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  //           </svg>
  //         </button>
  //       </div>
        
  //       <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
  //         <div className="md:col-span-2">
  //           <div className="bg-gray-900/50 rounded-xl p-4 border border-gray-800/50">
  //             <div className="flex items-start justify-between mb-4">
  //               <div>
  //                 <h4 className="text-xl font-bold text-white mb-1">{generatedMetadata.name}</h4>
  //                 <div className="text-sm text-gray-400 font-mono">${generatedMetadata.symbol}</div>
  //               </div>
  //               <div className="px-3 py-1 bg-gradient-to-r from-cyan-500/20 to-blue-500/20 rounded-full border border-cyan-500/30">
  //                 <span className="text-sm font-medium text-cyan-400">AI Generated</span>
  //               </div>
  //             </div>
              
  //             <p className="text-gray-300 mb-4">{generatedMetadata.description}</p>
              
  //             {/* IPFS Info Badge */}
  //             {generatedMetadata.ipfs_cid && (
  //               <div className="mb-4 p-3 bg-gradient-to-r from-purple-500/10 to-indigo-500/10 rounded-lg border border-purple-500/30">
  //                 <div className="flex items-center gap-2 text-purple-400">
  //                   <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
  //                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
  //                   </svg>
  //                   <span className="text-sm font-medium">IPFS Storage</span>
  //                   <span className="text-xs bg-purple-900/30 px-2 py-1 rounded">
  //                     CID: {generatedMetadata.ipfs_cid.slice(0, 8)}...
  //                   </span>
  //                 </div>
  //               </div>
  //             )}
              
  //             <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
  //               {generatedMetadata.attributes.map((attr, index) => (
  //                 <div key={index} className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
  //                   <div className="text-xs text-gray-400 mb-1">{attr.trait_type}</div>
  //                   <div className="text-sm text-white font-medium">{attr.value}</div>
  //                 </div>
  //               ))}
  //             </div>
  //           </div>
  //         </div>
          
  //         <div>
  //           <div className="bg-gray-900/50 rounded-xl overflow-hidden border border-gray-800/50">
  //             <img 
  //               src={displayImageUrl} 
  //               alt={generatedMetadata.name}
  //               className="w-full h-48 object-cover"
  //               onError={(e) => {
  //                 // Fallback if IPFS gateway fails
  //                 e.currentTarget.src = "https://placehold.co/600x400/6366f1/ffffff?text=" + 
  //                   encodeURIComponent(generatedMetadata.name);
  //               }}
  //             />
  //             <div className="p-4">
  //               <div className="text-sm text-gray-400 mb-2 flex items-center justify-between">
  //                 <span>Token Image</span>
  //                 {isIpfsUrl(generatedMetadata.image) && (
  //                   <span className="text-xs text-purple-400 bg-purple-900/30 px-2 py-1 rounded">
  //                     IPFS
  //                   </span>
  //                 )}
  //               </div>
  //               {generatedMetadata.image_prompt && (
  //                 <div className="text-xs text-gray-500 italic">
  //                   "{generatedMetadata.image_prompt.slice(0, 100)}..."
  //                 </div>
  //               )}
                
  //               {/* Show IPFS URI if available */}
  //               {generatedMetadata.ipfs_uri && (
  //                 <div className="mt-2">
  //                   <div className="text-xs text-gray-500 mb-1">IPFS URI:</div>
  //                   <div className="text-xs font-mono text-gray-400 truncate">
  //                     {generatedMetadata.ipfs_uri}
  //                   </div>
  //                 </div>
  //               )}
  //             </div>
  //           </div>
  //         </div>
  //       </div>
  //     </div>
  //   );
  // };

  const MetadataPreview = () => {
    if (!generatedMetadata || !showPreview) return null;
    
    // Convert IPFS URL to HTTP URL for display
    const displayImageUrl = useMemo(() => {
      if (!generatedMetadata?.image) return '';
      return convertIpfsToHttpUrl(generatedMetadata.image);
    }, [generatedMetadata?.image]);
    
    return (
      <div className="bg-gradient-to-br from-gray-900/50 to-dark-2/50 backdrop-blur-sm rounded-2xl p-5 border border-gray-800/50 mb-6 shadow-lg">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-cyan-500 to-blue-500 rounded-xl flex items-center justify-center shadow-lg">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h3 className="text-white font-bold">AI Generated Metadata</h3>
              <p className="text-sm text-gray-400">Preview your token details</p>
            </div>
          </div>
          <button
            onClick={() => setShowPreview(false)}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2">
            <div className="bg-gray-900/50 rounded-xl p-4 border border-gray-800/50">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h4 className="text-xl font-bold text-white mb-1">{generatedMetadata.name}</h4>
                  <div className="text-sm text-gray-400 font-mono">${generatedMetadata.symbol}</div>
                </div>
                <div className="px-3 py-1 bg-gradient-to-r from-cyan-500/20 to-blue-500/20 rounded-full border border-cyan-500/30">
                  <span className="text-sm font-medium text-cyan-400">AI Generated</span>
                </div>
              </div>
              
              <p className="text-gray-300 mb-4">{generatedMetadata.description}</p>
              
              {/* ✅ Show Metadata URI for on-chain use */}
              {generatedMetadata.metadata_uri && (
                <div className="mb-4 p-3 bg-gradient-to-r from-purple-500/10 to-indigo-500/10 rounded-lg border border-purple-500/30">
                  <div className="flex items-center gap-2 text-purple-400 mb-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                    <span className="text-sm font-medium">On-Chain Metadata URI</span>
                  </div>
                  <div className="text-xs font-mono text-gray-400 break-all bg-gray-900/50 p-2 rounded">
                    {generatedMetadata.metadata_uri}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    This URI will be used for on-chain token creation
                  </div>
                </div>
              )}
              
              {/* IPFS Info Badge */}
              {generatedMetadata.ipfs_cid && (
                <div className="mb-4 p-3 bg-gradient-to-r from-purple-500/10 to-indigo-500/10 rounded-lg border border-purple-500/30">
                  <div className="flex items-center gap-2 text-purple-400">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                    <span className="text-sm font-medium">IPFS Storage</span>
                    <span className="text-xs bg-purple-900/30 px-2 py-1 rounded">
                      CID: {generatedMetadata.ipfs_cid.slice(0, 8)}...
                    </span>
                  </div>
                </div>
              )}
              
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {generatedMetadata.attributes.map((attr, index) => (
                  <div key={index} className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
                    <div className="text-xs text-gray-400 mb-1">{attr.trait_type}</div>
                    <div className="text-sm text-white font-medium">{attr.value}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          
          <div>
            <div className="bg-gray-900/50 rounded-xl overflow-hidden border border-gray-800/50">
              <img 
                src={displayImageUrl} 
                alt={generatedMetadata.name}
                className="w-full h-48 object-cover"
                onError={(e) => {
                  // Fallback if IPFS gateway fails
                  e.currentTarget.src = "https://placehold.co/600x400/6366f1/ffffff?text=" + 
                    encodeURIComponent(generatedMetadata.name);
                }}
              />
              <div className="p-4">
                <div className="text-sm text-gray-400 mb-2 flex items-center justify-between">
                  <span>Token Image</span>
                  {isIpfsUrl(generatedMetadata.image) && (
                    <span className="text-xs text-purple-400 bg-purple-900/30 px-2 py-1 rounded">
                      IPFS
                    </span>
                  )}
                </div>
                {generatedMetadata.image_prompt && (
                  <div className="text-xs text-gray-500 italic">
                    "{generatedMetadata.image_prompt.slice(0, 100)}..."
                  </div>
                )}
                
                {/* Show IPFS URI if available */}
                {generatedMetadata.ipfs_uri && (
                  <div className="mt-2">
                    <div className="text-xs text-gray-500 mb-1">IPFS URI:</div>
                    <div className="text-xs font-mono text-gray-400 truncate">
                      {generatedMetadata.ipfs_uri}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const QuickStartPresets = () => {
    const presets = [
      {
        id: 'meme',
        name: 'Meme Launch',
        description: 'Viral meme token with community focus',
        bots: 10,
        sol: 2.5,
        time: '2-3 min',
        color: 'from-pink-500 to-purple-500',
        icon: '😂',
        action: 'apply'
      },
      {
        id: 'professional',
        name: 'Professional Pump',
        description: 'Serious token with utility focus',
        bots: 20,
        sol: 8.0,
        time: '5-7 min',
        color: 'from-blue-500 to-cyan-500',
        icon: '💼',
        action: 'apply'
      },
      {
        id: 'micro',
        name: 'Quick Micro Launch',
        description: 'One-click micro strategy launch',
        bots: 5,
        sol: 1.2,
        time: '1-2 min',
        color: 'from-emerald-500 to-teal-500',
        icon: '⚡',
        action: 'launch'
      }
    ];
    
    return (
      <div className="bg-gradient-to-br from-gray-900/50 to-dark-2/50 backdrop-blur-sm rounded-2xl p-5 border border-gray-800/50 mb-6 shadow-lg">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-gradient-to-br from-yellow-500 to-orange-500 rounded-xl flex items-center justify-center shadow-lg">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <h3 className="text-white font-bold">Quick Start Presets</h3>
            <p className="text-sm text-gray-400">One-click launch configurations</p>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {presets.map((preset) => (
            <button
              key={preset.id}
              onClick={() => preset.action === 'apply' 
                ? applyQuickLaunch(preset.id as any) 
                : handleQuickLaunch(preset.id as any)
              }
              className={`bg-gradient-to-br ${preset.color} rounded-xl p-5 text-left hover:scale-[1.02] transition-all duration-200 border border-white/10 shadow-lg`}
            >
              <div className="flex justify-between items-start mb-3">
                <div className="text-2xl">{preset.icon}</div>
                <div className="text-xs bg-black/30 px-2 py-1 rounded-full text-white/80">
                  {preset.bots} bots
                </div>
              </div>
              
              <h4 className="text-white font-bold text-lg mb-2">{preset.name}</h4>
              <p className="text-white/80 text-sm mb-4">{preset.description}</p>
              
              <div className="flex justify-between text-xs">
                <div>
                  <div className="text-white/60">SOL Needed</div>
                  <div className="text-white font-medium">{preset.sol} SOL</div>
                </div>
                <div>
                  <div className="text-white/60">Time</div>
                  <div className="text-white font-medium">{preset.time}</div>
                </div>
                <div>
                  <div className="text-white/60">Action</div>
                  <div className={`font-medium ${
                    preset.action === 'launch' ? 'text-yellow-400' : 'text-blue-400'
                  }`}>
                    {preset.action === 'launch' ? 'Quick Launch' : 'Apply'}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  };
  
  const ConfigurationTabs = () => {
    return (
      <div className="bg-gradient-to-br from-gray-900/50 to-dark-2/50 backdrop-blur-sm rounded-2xl p-1 border border-gray-800/50 mb-6 shadow-lg">
        <div className="flex flex-wrap gap-1">
          {[
            { id: 'quick', label: '🚀 Quick Launch', icon: '⚡' },
            { id: 'custom', label: '⚙️ Custom Config', icon: '🔧' },
            { id: 'ai', label: '🤖 AI Assistant', icon: '🧠' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex-1 min-w-[120px] py-3 px-4 rounded-xl text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-gradient-to-r from-blue-500/20 to-cyan-500/20 text-white border border-blue-500/30'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800/30'
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                <span className="text-lg">{tab.icon}</span>
                <span className="hidden sm:inline">{tab.label}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  };

  const refreshBotWallets = async () => {
    try {
      const bots = await tokenLaunchService.getBotWallets();
      setBotWallets(bots.bot_wallets || []);
      
      // Show success message
      setLaunchStatus(prev => ({
        ...prev,
        message: '✅ Bot wallets refreshed',
        phase: 'setup'
      }));
    } catch (error) {
      console.error('Failed to refresh bot wallets:', error);
    }
  };

  const BotWalletsTable: React.FC<BotWalletsTableProps> = ({ botWallets }) => {
    const [copyingKeys, setCopyingKeys] = useState<Record<string, boolean>>({});
    const [currentPage, setCurrentPage] = useState(1);
    const [selectedWallet, setSelectedWallet] = useState<BotWallet | null>(null);
    const [showCopyModal, setShowCopyModal] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [sortBy, setSortBy] = useState<'balance' | 'profit' | 'date' | 'none'>('none');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
    const [isMobile, setIsMobile] = useState(false);
    const [isTablet, setIsTablet] = useState(false);
    const [isCollapsed, setIsCollapsed] = useState(false); // New state for collapse
    
    const itemsPerPage = 10;
    
    // Check screen size on mount and resize
    useEffect(() => {
      const checkScreenSize = () => {
        setIsMobile(window.innerWidth < 640);
        setIsTablet(window.innerWidth >= 640 && window.innerWidth < 1024);
      };
      
      checkScreenSize();
      window.addEventListener('resize', checkScreenSize);
      return () => window.removeEventListener('resize', checkScreenSize);
    }, []);
    
    // Filter wallets based on search and status
    const filteredWallets = botWallets.filter(wallet => {
      const matchesSearch = wallet.public_key.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          wallet.id.toString().includes(searchTerm);
      const matchesStatus = statusFilter === 'all' || wallet.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
    
    // Sort wallets
    const sortedWallets = [...filteredWallets].sort((a, b) => {
      if (sortBy === 'none') return 0;
      
      let aValue: any, bValue: any;
      
      switch (sortBy) {
        case 'balance':
          aValue = a.current_balance;
          bValue = b.current_balance;
          break;
        case 'profit':
          aValue = a.profit;
          bValue = b.profit;
          break;
        case 'date':
          aValue = new Date(a.created_at).getTime();
          bValue = new Date(b.created_at).getTime();
          break;
        default:
          return 0;
      }
      
      if (sortOrder === 'asc') {
        return (aValue || 0) - (bValue || 0);
      } else {
        return (bValue || 0) - (aValue || 0);
      }
    });

    const refreshBalances = async () => {
      try {
        const response = await tokenLaunchService.refreshBotBalances();
        if (response.success) {
          // Wait a moment for backend to update
          setTimeout(async () => {
            const updatedBots = await tokenLaunchService.getBotWallets();
            setBotWallets(updatedBots.bot_wallets || []);
            
            // Show success message
            setLaunchStatus(prev => ({
              ...prev,
              message: '✅ Bot balances refreshed',
              phase: 'setup'
            }));
          }, 2000);
        }
      } catch (error) {
        console.error('Failed to refresh balances:', error);
      }
    };
    
    // Pagination calculations
    const totalPages = Math.ceil(sortedWallets.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const paginatedWallets = sortedWallets.slice(startIndex, startIndex + itemsPerPage);
    
    // Status counts - Update to include pre-funded count
    const preFundedCount = botWallets.filter(w => w.is_pre_funded).length;
    const statusCounts = {
      all: botWallets.length,
      pending: botWallets.filter(w => w.status === 'pending').length,
      ready: botWallets.filter(w => w.status === 'ready').length,
      funded: botWallets.filter(w => w.status === 'funded').length,
      active: botWallets.filter(w => w.status === 'active').length,
      pre_funded: preFundedCount,
    };
    
    const copyPrivateKey = async (walletId: string | number, token: string, publicKey: string) => {
      try {
        setCopyingKeys(prev => ({ ...prev, [walletId]: true }));
        
        // Convert walletId to number if it's a string
        const walletIdNum = typeof walletId === 'string' ? parseInt(walletId, 10) : walletId;
        
        // Simulating API call - replace with your actual service
        const response = await tokenLaunchService.getBotPrivateKey(walletIdNum, token);
        
        if (response.success) {
          // Copy to clipboard
          await navigator.clipboard.writeText(response.private_key_base58);
          
          // Show modal instead of alert
          const wallet = botWallets.find(w => w.id === walletId);
          setSelectedWallet(wallet || null);
          setShowCopyModal(true);
          
          // Auto-hide modal after 3 seconds
          setTimeout(() => {
            setShowCopyModal(false);
          }, 3000);
        }
      } catch (error: any) {
        console.error('Failed to copy private key:', error);
        alert(`Failed to copy private key: ${error.message || 'Token may have expired. Refresh the page to get a new token.'}`);
      } finally {
        setCopyingKeys(prev => ({ ...prev, [walletId]: false }));
      }
    };
    
    const handleSort = (field: 'balance' | 'profit' | 'date') => {
      if (sortBy === field) {
        setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
      } else {
        setSortBy(field);
        setSortOrder('desc');
      }
    };
    
    const getStatusColor = (status: string) => {
      switch (status) {
        case 'funded':
          return 'bg-emerald-900/30 text-emerald-400 border-emerald-500/50';
        case 'active':
          return 'bg-blue-900/30 text-blue-400 border-blue-500/50';
        case 'ready':
          return 'bg-yellow-900/30 text-yellow-400 border-yellow-500/50';
        case 'pending':
          return 'bg-gray-800/30 text-gray-400 border-gray-600/50';
        default:
          return 'bg-gray-800/30 text-gray-400 border-gray-600/50';
      }
    };
    
    const getStatusIcon = (status: string) => {
      switch (status) {
        case 'funded':
          return '💰';
        case 'active':
          return '⚡';
        case 'ready':
          return '✅';
        case 'pending':
          return '⏳';
        default:
          return '❓';
      }
    };
    
    // Reset to page 1 when filters change
    useEffect(() => {
      setCurrentPage(1);
    }, [searchTerm, statusFilter]);
    
    if (botWallets.length === 0) return null;
    
    // Helper function to render wallet row with pre-funding indicators
    const renderWalletRow = (wallet: BotWallet) => {
      // Pre-funding badge component
      const PreFundingBadge = () => {
        if (!wallet.is_pre_funded) return null;
        
        return (
          <div className="mt-2">
            <div className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-900/30 text-emerald-400 text-xs rounded-full border border-emerald-500/30">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>Pre-funded: {wallet.pre_funded_amount?.toFixed(4) || '0.0000'} SOL</span>
            </div>
            {wallet.pre_funded_tx_hash && (
              <div className="text-xs text-gray-500 mt-1">
                TX: {wallet.pre_funded_tx_hash.slice(0, 8)}...
              </div>
            )}
          </div>
        );
      };
      
      // Mobile View
      if (isMobile) {
        return (
          <div key={wallet.id} className="bg-gray-900/30 rounded-xl p-4 border border-gray-800/50">
            <div className="space-y-3">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="text-lg">{getStatusIcon(wallet.status)}</div>
                  <div className="text-white font-medium font-mono text-sm">
                    {wallet.public_key.slice(0, 6)}...{wallet.public_key.slice(-4)}
                  </div>
                </div>
                <div className={`px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(wallet.status)}`}>
                  {wallet.status.charAt(0).toUpperCase() + wallet.status.slice(1)}
                </div>
              </div>
              
              {/* Wallet Info */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <div className="text-xs text-gray-400">Balance</div>
                  <div className="text-white font-medium">
                    {wallet.current_balance?.toFixed(4) || '0.0000'} SOL
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-gray-400">Profit</div>
                  <div className={`font-medium ${wallet.profit > 0 ? 'text-emerald-400' : 'text-gray-400'}`}>
                    {wallet.profit?.toFixed(4) || '0.0000'} SOL
                  </div>
                </div>
              </div>
              
              {/* Pre-funding indicator for mobile */}
              <PreFundingBadge />
              
              {/* Additional Info */}
              <div className="text-xs text-gray-500">
                ID: {wallet.id} • Created: {new Date(wallet.created_at).toLocaleDateString()}
              </div>
              
              {/* Action Button */}
              <button
                onClick={() => copyPrivateKey(wallet.id, wallet.private_key_token, wallet.public_key)}
                disabled={copyingKeys[wallet.id]}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white rounded-lg text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {copyingKeys[wallet.id] ? (
                  <>
                    <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Copying...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy Private Key
                  </>
                )}
              </button>
            </div>
          </div>
        );
      }
      
      // Tablet View
      if (isTablet) {
        return (
          <div key={wallet.id} className="bg-gray-900/30 rounded-xl p-4 border border-gray-800/50 hover:border-purple-500/30 transition-colors">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="text-xl">{getStatusIcon(wallet.status)}</div>
                  <div>
                    <div className="text-white font-medium font-mono text-sm">
                      {wallet.public_key.slice(0, 8)}...{wallet.public_key.slice(-4)}
                    </div>
                    <div className="text-xs text-gray-500">
                      ID: {wallet.id}
                    </div>
                  </div>
                </div>
                <div className={`px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(wallet.status)}`}>
                  {wallet.status.charAt(0).toUpperCase() + wallet.status.slice(1)}
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-gray-400 mb-1">Balance</div>
                  <div className="text-white font-medium">
                    {wallet.current_balance?.toFixed(4) || '0.0000'} SOL
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Allocated: {wallet.funded_amount?.toFixed(4) || wallet.buy_amount?.toFixed(4) || '0.0000'} SOL
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-400 mb-1">Profit / ROI</div>
                  <div className={`font-medium ${wallet.profit > 0 ? 'text-emerald-400' : 'text-gray-400'}`}>
                    {wallet.profit?.toFixed(4) || '0.0000'} SOL
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    ROI: {wallet.roi?.toFixed(2) || '0.00'}%
                  </div>
                </div>
              </div>
              
              {/* Pre-funding indicator for tablet */}
              {/* <PreFundingBadge /> */}

              <button
                onClick={refreshBalances}
                className="flex items-center gap-2 px-3 py-2 bg-gray-800/50 hover:bg-gray-700/50 text-gray-300 hover:text-white rounded-lg border border-gray-700/50 transition-colors text-sm"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh Balances
              </button>
              
              <button
                onClick={() => copyPrivateKey(wallet.id, wallet.private_key_token, wallet.public_key)}
                disabled={copyingKeys[wallet.id]}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white rounded-lg text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {copyingKeys[wallet.id] ? (
                  <>
                    <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Copying...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy Private Key
                  </>
                )}
              </button>
            </div>
          </div>
        );
      }
      
      // Desktop View
      return (
        <div key={wallet.id} className="bg-gray-900/30 rounded-xl p-4 border border-gray-800/50 hover:border-purple-500/30 transition-colors">
          <div className="grid grid-cols-12 gap-4 items-center">
            <div className="col-span-4">
              <div className="flex items-center gap-3">
                <div className="text-xl">{getStatusIcon(wallet.status)}</div>
                <div>
                  <div className="text-white font-medium font-mono text-sm">
                    {wallet.public_key.slice(0, 8)}...{wallet.public_key.slice(-4)}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    ID: {wallet.id} • {new Date(wallet.created_at).toLocaleDateString()}
                  </div>
                </div>
              </div>
            </div>
            
            <div className="col-span-2">
              <div className="text-white font-medium">
                {wallet.current_balance?.toFixed(4) || '0.0000'} SOL
              </div>
              <div className="text-xs text-gray-500">
                Allocated: {wallet.funded_amount?.toFixed(4) || '0.0000'} SOL
              </div>
            </div>
            
            <div className="col-span-2">
              <div className={`font-medium ${wallet.profit > 0 ? 'text-emerald-400' : 'text-gray-400'}`}>
                {wallet.profit?.toFixed(4) || '0.0000'} SOL
              </div>
              <div className="text-xs text-gray-500">
                ROI: {wallet.roi?.toFixed(2) || '0.00'}%
              </div>
            </div>
            
            <div className="col-span-2">
              <div className="flex flex-col gap-2">
                <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(wallet.status)}`}>
                  <div className={`w-2 h-2 rounded-full ${
                    wallet.status === 'funded' ? 'bg-emerald-500' :
                    wallet.status === 'active' ? 'bg-blue-500' :
                    wallet.status === 'ready' ? 'bg-yellow-500' : 'bg-gray-500'
                  }`}></div>
                  {wallet.status.charAt(0).toUpperCase() + wallet.status.slice(1)}
                </div>
                
                {/* Pre-funding indicator for desktop */}
                {wallet.is_pre_funded && (
                  <div className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-900/20 text-emerald-400 text-xs rounded-full border border-emerald-500/30">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>Pre-funded</span>
                  </div>
                )}
              </div>
            </div>
            
            <div className="col-span-2 text-right">
              <button
                onClick={() => copyPrivateKey(wallet.id, wallet.private_key_token, wallet.public_key)}
                disabled={copyingKeys[wallet.id]}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white rounded-lg text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed min-w-[120px]"
              >
                {copyingKeys[wallet.id] ? (
                  <>
                    <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Copying
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy Key
                  </>
                )}
              </button>
            </div>
          </div>
          
          {/* Detailed pre-funding info (only shown on hover or expanded view) */}
          {wallet.is_pre_funded && (
            <div className="mt-3 pt-3 border-t border-gray-800/50">
              <div className="flex items-center justify-between text-xs">
                <div className="text-emerald-400">
                  <span className="font-medium">Pre-funded:</span> {wallet.pre_funded_amount?.toFixed(4) || '0.0000'} SOL
                </div>
                {wallet.pre_funded_tx_hash && (
                  <div className="text-gray-500">
                    TX: {wallet.pre_funded_tx_hash.slice(0, 8)}...
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      );
    };
    
    return (
      <div className="bg-gradient-to-br from-gray-900/50 to-dark-2/50 backdrop-blur-sm rounded-2xl p-5 border border-gray-800/50 mb-6 shadow-lg">
        {/* Collapsible Header */}
        <div 
          className="cursor-pointer mb-6"
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center shadow-lg">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13 1a6 6 0 01-6 6m6-6a6 6 0 00-6-6m6 6h2" />
                </svg>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-white font-bold text-lg">Bot Armies</h3>
                  <svg 
                    className={`w-5 h-5 text-gray-400 transition-transform duration-300 ${isCollapsed ? 'rotate-180' : ''}`}
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
                <p className="text-sm text-gray-400">
                  {isCollapsed ? 'Click to expand' : `${botWallets.length} backend wallets`}
                </p>
              </div>
            </div>
            
            {/* Status Cards - Only show when not collapsed */}
            {!isCollapsed && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="text-center bg-gray-900/50 rounded-lg p-3 border border-gray-800/50">
                  <div className="text-2xl font-bold text-emerald-400">{botWallets.length}</div>
                  <div className="text-xs text-gray-400">Total</div>
                </div>
                <div className="text-center bg-gray-900/50 rounded-lg p-3 border border-gray-800/50">
                  <div className="text-2xl font-bold text-blue-400">{statusCounts.funded}</div>
                  <div className="text-xs text-gray-400">Funded</div>
                </div>
                <div className="text-center bg-gray-900/50 rounded-lg p-3 border border-gray-800/50">
                  <div className="text-2xl font-bold text-emerald-400">{statusCounts.pre_funded}</div>
                  <div className="text-xs text-gray-400">Pre-funded</div>
                </div>
                <div className="text-center bg-gray-900/50 rounded-lg p-3 border border-gray-800/50">
                  <div className="text-2xl font-bold text-yellow-400">{statusCounts.active}</div>
                  <div className="text-xs text-gray-400">Active</div>
                </div>
              </div>
            )}
          </div>
        </div>
        
        {/* Content Area - Collapsible */}
        <div className={`transition-all duration-300 ease-in-out ${isCollapsed ? 'max-h-0 opacity-0 overflow-hidden' : 'max-h-[5000px] opacity-100'}`}>
          
          {/* Filters and Controls */}
          <div className="flex flex-col gap-3 mb-4">
            <div className="relative">
              <input
                type="text"
                placeholder="Search wallets..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-gray-900/30 border border-gray-700/50 rounded-lg px-4 py-2 pl-10 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/50"
              />
              <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            
            <div className="flex gap-2 overflow-x-auto pb-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="flex-1 min-w-[120px] bg-gray-900/30 border border-gray-700/50 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500/50"
              >
                <option value="all">All ({statusCounts.all})</option>
                <option value="pending">Pending ({statusCounts.pending})</option>
                <option value="ready">Ready ({statusCounts.ready})</option>
                <option value="funded">Funded ({statusCounts.funded})</option>
                <option value="active">Active ({statusCounts.active})</option>
                <option value="pre_funded">Pre-funded ({statusCounts.pre_funded})</option>
              </select>
              
              <select
                value={`${sortBy}-${sortOrder}`}
                onChange={(e) => {
                  const [field, order] = e.target.value.split('-');
                  setSortBy(field as any);
                  setSortOrder(order as any);
                }}
                className="flex-1 min-w-[120px] bg-gray-900/30 border border-gray-700/50 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500/50"
              >
                <option value="none-desc">Sort by</option>
                <option value="balance-desc">Balance ↓</option>
                <option value="balance-asc">Balance ↑</option>
                <option value="profit-desc">Profit ↓</option>
                <option value="profit-asc">Profit ↑</option>
                <option value="date-desc">Newest</option>
                <option value="date-asc">Oldest</option>
              </select>
            </div>
          </div>
          
          {/* Wallets List */}
          <div className="space-y-3">
            {paginatedWallets.map((wallet) => renderWalletRow(wallet))}
            
            {paginatedWallets.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                No wallets found matching your filters.
              </div>
            )}
          </div>
          
          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-6 pt-6 border-t border-gray-800/50">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="text-sm text-gray-400 order-2 sm:order-1">
                  Showing {startIndex + 1}-{Math.min(startIndex + itemsPerPage, sortedWallets.length)} of {sortedWallets.length} wallets
                </div>
                
                <div className="flex items-center gap-2 order-1 sm:order-2">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-2 bg-gray-900/30 border border-gray-700/50 rounded-lg text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:border-purple-500/50 transition-colors"
                  >
                    ← Prev
                  </button>
                  
                  <div className="flex items-center gap-1">
                    {/* Always show first page */}
                    {currentPage > 3 && totalPages > 5 && (
                      <>
                        <button
                          onClick={() => setCurrentPage(1)}
                          className="w-8 h-8 rounded-lg bg-gray-900/30 text-gray-400 hover:text-white hover:border-purple-500/30 border border-gray-700/50 text-sm"
                        >
                          1
                        </button>
                        {currentPage > 4 && <span className="text-gray-500 px-1">...</span>}
                      </>
                    )}
                    
                    {/* Show surrounding pages */}
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      let pageNum;
                      if (totalPages <= 5) {
                        pageNum = i + 1;
                      } else if (currentPage <= 3) {
                        pageNum = i + 1;
                      } else if (currentPage >= totalPages - 2) {
                        pageNum = totalPages - 4 + i;
                      } else {
                        pageNum = currentPage - 2 + i;
                      }
                      
                      if (pageNum < 1 || pageNum > totalPages) return null;
                      
                      return (
                        <button
                          key={pageNum}
                          onClick={() => setCurrentPage(pageNum)}
                          className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                            currentPage === pageNum
                              ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white'
                              : 'bg-gray-900/30 text-gray-400 hover:text-white hover:border-purple-500/30 border border-gray-700/50'
                          }`}
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                    
                    {/* Always show last page if needed */}
                    {currentPage < totalPages - 2 && totalPages > 5 && (
                      <>
                        {currentPage < totalPages - 3 && <span className="text-gray-500 px-1">...</span>}
                        <button
                          onClick={() => setCurrentPage(totalPages)}
                          className="w-8 h-8 rounded-lg bg-gray-900/30 text-gray-400 hover:text-white hover:border-purple-500/30 border border-gray-700/50 text-sm"
                        >
                          {totalPages}
                        </button>
                      </>
                    )}
                  </div>
                  
                  <button
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                    disabled={currentPage === totalPages}
                    className="px-3 py-2 bg-gray-900/30 border border-gray-700/50 rounded-lg text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:border-purple-500/50 transition-colors"
                  >
                    Next →
                  </button>
                </div>
              </div>
            </div>
          )}
          
          {/* Footer Note */}
          {sortedWallets.length > 0 && (
            <div className="mt-6 pt-4 border-t border-gray-800/50">
              <div className="text-xs text-gray-500 text-center">
                Each private key token is valid for one-time use only. Refresh to generate new tokens.
              </div>
            </div>
          )}
        </div> {/* End collapsible content */}
        
        {/* Copy Success Modal */}
        {showCopyModal && selectedWallet && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
            <div className="bg-gray-900 border border-emerald-500/30 rounded-2xl p-6 max-w-md w-full shadow-2xl animate-scaleIn">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-emerald-500/20 rounded-xl flex items-center justify-center">
                  <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-white font-bold">Private Key Copied!</h3>
                  <p className="text-sm text-gray-400">Successfully copied to clipboard</p>
                </div>
              </div>
              
              <div className="bg-gray-800/30 rounded-lg p-4 mb-4">
                <div className="text-sm text-gray-400 mb-2">Wallet:</div>
                <div className="font-mono text-sm text-white break-all">
                  {selectedWallet.public_key}
                </div>
                <div className="text-xs text-gray-500 mt-2">
                  Token: {selectedWallet.private_key_token.slice(0, 12)}...
                </div>
              </div>
              
              <div className="text-xs text-amber-400 mb-4 p-3 bg-amber-900/20 rounded-lg border border-amber-500/20">
                ⚠️ <strong>Security Note:</strong> This private key token can only be used once. 
                The key has been copied to your clipboard. Store it securely.
              </div>
              
              <button
                onClick={() => setShowCopyModal(false)}
                className="w-full py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg font-medium hover:from-purple-600 hover:to-pink-600 transition-all"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };



  // ============================================
  // RENDER
  // ============================================
  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-gray-950 via-dark-1 to-secondary">
      {/* Background Pattern */}
      <div className="fixed inset-0 opacity-5">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.1)_1px,transparent_1px)] bg-[size:40px_40px]"></div>
      </div>
      
      <div className="relative z-10">
        {/* Header */}
        <header className="sticky top-0 z-50 bg-gray-900/80 backdrop-blur-lg border-b border-gray-800 h-16 flex items-center justify-between px-4 md:px-8">
          <div className="flex items-center gap-4">
            {/* Make the entire logo area clickable */}
            <button 
              onClick={() => navigate('/')}
              className="flex items-center gap-4 hover:opacity-80 transition-opacity"
            >
              <img src="/images/img_frame_1171277880.svg" alt="Logo" className="w-3 h-3" />
              <div className="text-white text-sm font-black font-inter">
                <span className="text-white">FLASH </span>
                <span className="text-success">CREATOR</span>
              </div>
            </button>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-3 px-4 py-2 bg-gray-800/50 rounded-full border border-gray-700">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
              <span className="text-sm text-gray-300">
                Balance: <span className="text-white font-medium">{userBalance.toFixed(2)} SOL</span>
              </span>
            </div>
            <button
              onClick={() => navigate('/trading-interface')}
              className="text-sm text-gray-300 hover:text-white transition-colors px-4 py-2 hover:bg-gray-800/50 rounded-lg"
            >
              ← Back to Sniper
            </button>
          </div>
        </header>
        
        {/* Main Content */}
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-7xl mx-auto">
            {/* Hero Section */}
            <div className="text-center mb-8">
              <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">
                AI-Powered Token <span className="bg-gradient-to-r from-cyan-400 to-emerald-400 bg-clip-text text-transparent">Launch Platform</span>
              </h1>
              <p className="text-gray-300 max-w-3xl mx-auto text-lg">
                Create, launch, and profit from Solana tokens with AI-generated metadata and orchestrated bot armies.
                All in one automated platform.
              </p>
            </div>
            
            {/* Status Display */}
            <StatusCard />

            {/* Insufficient Balance Warning - Shows when user has < 0.0001 SOL */}
            <InsufficientBalanceWarning />
            
            {/* Only show the rest of the UI if user has sufficient balance */}
            {userBalance >= MIN_SOL_FOR_CREATOR_MODE ? (
              <>
                {/* Configuration Tabs */}
                <ConfigurationTabs />

                {/* Add pre-funding section after ConfigurationTabs */}
                {activeTab === 'custom' && (
                  <>
                    {/* Pre-Funding Manager */}
                    <PreFundingManager
                      botCount={launchConfig.botCount}
                      onPreFundComplete={handlePreFundComplete}
                      onUsePreFunded={handleUsePreFunded}
                      launchConfig={launchConfig}
                    />
                    
                    {/* Launch Mode Selection */}
                    <div className="bg-gradient-to-br from-gray-900/50 to-dark-2/50 backdrop-blur-sm rounded-2xl p-6 border border-gray-800/50 mb-6 shadow-lg">
                      <h3 className="text-white font-bold text-xl mb-4">Launch Mode</h3>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <button
                          onClick={() => {
                            setAtomicLaunchMode(false);
                            setUsePreFundedBots(false);
                          }}
                          className={`p-5 rounded-xl border transition-all ${
                            !atomicLaunchMode
                              ? 'bg-gradient-to-r from-blue-500/20 to-cyan-500/20 border-blue-500/30'
                              : 'bg-gray-900/50 border-gray-700/50 hover:border-gray-600/50'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                              !atomicLaunchMode
                                ? 'bg-gradient-to-r from-blue-500 to-cyan-500'
                                : 'bg-gray-800'
                            }`}>
                              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                            </div>
                            <div className="text-left">
                              <h4 className="text-white font-bold">Regular Launch</h4>
                              <p className="text-sm text-gray-400 mt-1">
                                Auto-fund and launch sequentially
                              </p>
                            </div>
                          </div>
                        </button>
                        
                        <button
                          onClick={() => {
                            setAtomicLaunchMode(true);
                            setUsePreFundedBots(true);
                          }}
                          className={`p-5 rounded-xl border transition-all ${
                            atomicLaunchMode
                              ? 'bg-gradient-to-r from-emerald-500/20 to-teal-500/20 border-emerald-500/30'
                              : 'bg-gray-900/50 border-gray-700/50 hover:border-gray-600/50'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                              atomicLaunchMode
                                ? 'bg-gradient-to-r from-emerald-500 to-teal-500'
                                : 'bg-gray-800'
                            }`}>
                              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                              </svg>
                            </div>
                            <div className="text-left">
                              <h4 className="text-white font-bold">Atomic Launch</h4>
                              <p className="text-sm text-gray-400 mt-1">
                                Pre-funded bots, single bundle (3x faster)
                              </p>
                            </div>
                          </div>
                        </button>
                      </div>
                      
                      <div className="mt-4 text-sm text-gray-400">
                        {atomicLaunchMode ? (
                          <div className="flex items-center gap-2 text-emerald-400">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                            <span>Atomic mode selected: Single transaction bundle, faster execution</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-blue-400">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            <span>Regular mode selected: Sequential transactions, more control</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}

                {/* Quick Launch Presets */}
                {activeTab === 'quick' && <QuickStartPresets />}
                
                {/* Bot Army Display */}
                {/* <BotArmyDisplay /> */}

                {/* <SecurityWarning /> */}

                {/* Add this new section for detailed bot wallet management */}
                {botWallets.length > 0 && (
                  <BotWalletsTable botWallets={botWallets} />
                )}
                
                {/* Metadata Preview */}
                <MetadataPreview />
                
                {/* Configuration Form */}
                <div className="bg-gradient-to-br from-gray-900/50 to-dark-2/50 backdrop-blur-sm rounded-2xl p-6 border border-gray-800/50 mb-8 shadow-lg">
                  <div className="flex flex-col lg:flex-row gap-8">
                    {/* Left Column - Token Details */}
                    <div className="lg:w-1/2 space-y-6">
                      <div>
                        {/* <h3 className="text-white font-bold text-xl mb-4 flex items-center gap-2">
                          <span className="w-6 h-6 bg-gradient-to-br from-blue-500 to-cyan-500 rounded flex items-center justify-center">
                            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                            </svg>
                          </span>
                          Token Details
                        </h3> */}
                        <h3 className="text-white font-bold text-xl mb-4 flex items-center gap-2">
                          <span className="w-6 h-6 bg-gradient-to-br from-blue-500 to-cyan-500 rounded flex items-center justify-center">
                            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                            </svg>
                          </span>
                          Token Details {!metadataGenerated && (
                            <span className="ml-2 px-2 py-1 bg-amber-900/30 text-amber-400 text-xs font-medium rounded-full border border-amber-500/30">
                              Required for Launch
                            </span>
                          )}
                        </h3>
                        
                        <div className="space-y-4">
                          <div>
                            <label className="block text-gray-400 text-sm mb-2">Token Name</label>
                            <input
                              type="text"
                              value={launchConfig.tokenName}
                              onChange={(e) => setLaunchConfig(prev => ({ ...prev, tokenName: e.target.value }))}
                              className="w-full bg-gray-900/50 border border-gray-700/50 rounded-xl p-3 text-white placeholder-gray-500 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30 transition-all"
                              placeholder="Enter token name"
                            />
                          </div>
                          
                          <div>
                            <label className="block text-gray-400 text-sm mb-2">Token Symbol</label>
                            <input
                              type="text"
                              value={launchConfig.tokenSymbol}
                              onChange={(e) => setLaunchConfig(prev => ({ ...prev, tokenSymbol: e.target.value }))}
                              className="w-full bg-gray-900/50 border border-gray-700/50 rounded-xl p-3 text-white placeholder-gray-500 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30 transition-all"
                              placeholder="Enter token symbol (3-6 chars)"
                            />
                          </div>
                          
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="block text-gray-400 text-sm mb-2">AI Style</label>
                              <select
                                value={launchConfig.metadataStyle}
                                onChange={(e) => setLaunchConfig(prev => ({ ...prev, metadataStyle: e.target.value as any }))}
                                className="w-full bg-gray-900/50 border border-gray-700/50 rounded-xl p-3 text-white focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30 transition-all"
                              >
                                <option value="ai-generated">🤖 AI Generated</option>
                                <option value="professional">💼 Professional</option>
                                <option value="meme">😂 Meme Style</option>
                                <option value="community">👥 Community</option>
                                <option value="gaming">🎮 Gaming</option>
                              </select>
                            </div>
                            
                            <div>
                              <label className="block text-gray-400 text-sm mb-2">Use DALL-E</label>
                              <div className="flex items-center h-[52px]">
                                <label className="relative inline-flex items-center cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={launchConfig.useDalle}
                                    onChange={(e) => setLaunchConfig(prev => ({ ...prev, useDalle: e.target.checked }))}
                                    className="sr-only peer"
                                  />
                                  <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                                </label>
                                <span className="ml-3 text-sm text-gray-400">Generate AI image</span>
                              </div>
                            </div>
                          </div>
                          
                          <div>
                            <label className="block text-gray-400 text-sm mb-2">Keywords</label>
                            <input
                              type="text"
                              value={launchConfig.metadataKeywords}
                              onChange={(e) => setLaunchConfig(prev => ({ ...prev, metadataKeywords: e.target.value }))}
                              className="w-full bg-gray-900/50 border border-gray-700/50 rounded-xl p-3 text-white placeholder-gray-500 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30 transition-all"
                              placeholder="meme, solana, crypto, ai, etc."
                            />
                          </div>
                        </div>
                      </div>
                      
                      <div>
                        <h3 className="text-white font-bold text-xl mb-4 flex items-center gap-2">
                          <span className="w-6 h-6 bg-gradient-to-br from-purple-500 to-pink-500 rounded flex items-center justify-center">
                            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13 1a6 6 0 01-6 6m6-6a6 6 0 00-6-6m6 6h2" />
                            </svg>
                          </span>
                          Bot Army Configuration
                        </h3>
                        
                        <div className="space-y-4">
                          <div>
                            <div className="flex justify-between text-sm mb-2">
                              <label className="text-gray-400">Bot Army Size</label>
                              <span className="text-white font-medium">{launchConfig.botCount} bots</span>
                            </div>
                            <input
                              type="range"
                              min="5"
                              max="50"
                              value={launchConfig.botCount}
                              // onChange={(e) => setLaunchConfig(prev => ({ ...prev, botCount: parseInt(e.target.value) }))}
                              onChange={(e) => handleBotCountChange(parseInt(e.target.value))}
                              className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gradient-to-r [&::-webkit-slider-thumb]:from-purple-500 [&::-webkit-slider-thumb]:to-pink-500"
                            />
                          </div>
                          
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="block text-gray-400 text-sm mb-2">Bot Buy Amount (SOL)</label>
                              <input
                                type="number"
                                step="0.001"
                                min="0.001"
                                max="10"
                                value={launchConfig.botWalletBuyAmount}
                                // onChange={(e) => setLaunchConfig(prev => ({ 
                                //   ...prev, 
                                //   botWalletBuyAmount: Math.max(parseFloat(e.target.value) || 0.001, 0.001)
                                // }))}
                                onChange={(e) => handleBotBuyAmountChange(parseFloat(e.target.value))}
                                className="w-full bg-gray-900/50 border border-gray-700/50 rounded-xl p-3 text-white focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30 transition-all"
                              />
                            </div>
                            
                            <div>
                              <label className="block text-gray-400 text-sm mb-2">Creator Buy (SOL)</label>
                              <input
                                type="number"
                                step="0.1"
                                min="0.001"
                                max="50"
                                value={launchConfig.creatorBuyAmount}
                                // onChange={(e) => setLaunchConfig(prev => ({ 
                                //   ...prev, 
                                //   creatorBuyAmount: Math.max(parseFloat(e.target.value) || 0.1, 0.001)
                                // }))}
                                onChange={(e) => handleCreatorBuyAmountChange(parseFloat(e.target.value))}
                                className="w-full bg-gray-900/50 border border-gray-700/50 rounded-xl p-3 text-white focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30 transition-all"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    {/* Right Column - Strategy & Summary */}
                    <div className="lg:w-1/2 space-y-6">
                      <div>
                        <h3 className="text-white font-bold text-xl mb-4 flex items-center gap-2">
                          <span className="w-6 h-6 bg-gradient-to-br from-yellow-500 to-orange-500 rounded flex items-center justify-center">
                            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                            </svg>
                          </span>
                          Launch Strategy
                        </h3>
                        
                        <div className="space-y-4">
                          <div>
                            <label className="block text-gray-400 text-sm mb-2">Sell Strategy</label>
                            <div className="grid grid-cols-3 gap-2">
                              {[
                                { id: 'volume_based', label: 'Volume', icon: '📊', defaults: { sellVolumeTrigger: 5.0, sellTimeTrigger: 1, sellPriceTarget: 1.1 } },
                                { id: 'time_based', label: 'Time', icon: '⏱️', defaults: { sellTimeTrigger: 5, sellVolumeTrigger: 0, sellPriceTarget: 1.1 } },
                                { id: 'price_target', label: 'Price', icon: '🎯', defaults: { sellPriceTarget: 50, sellTimeTrigger: 1, sellVolumeTrigger: 0 } },
                                { id: 'immediate', label: 'Immediate', icon: '⚡', defaults: { sellTimeTrigger: 0, sellVolumeTrigger: 0, sellPriceTarget: 0 } }
                              ].map((strategy) => (
                                <button
                                  key={strategy.id}
                                  onClick={() => setLaunchConfig(prev => ({ 
                                    ...prev, 
                                    sellTiming: strategy.id as any,
                                    ...strategy.defaults
                                  }))}
                                  className={`py-3 rounded-lg border transition-all ${
                                    launchConfig.sellTiming === strategy.id
                                      ? 'bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border-yellow-500/30 text-white'
                                      : 'bg-gray-900/50 border-gray-700/50 text-gray-400 hover:text-white hover:border-gray-600/50'
                                  }`}
                                >
                                  <div className="flex flex-col items-center gap-1">
                                    <span className="text-lg">{strategy.icon}</span>
                                    <span className="text-xs font-medium">{strategy.label}</span>
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                          
                          {launchConfig.sellTiming === 'volume_based' && (
                            <div>
                              <label className="block text-gray-400 text-sm mb-2">Volume Trigger (SOL)</label>
                              <input
                                type="number"
                                step="0.1"
                                min="1"
                                max="100"
                                value={launchConfig.sellVolumeTrigger}
                                onChange={(e) => setLaunchConfig(prev => ({ ...prev, sellVolumeTrigger: parseFloat(e.target.value) }))}
                                className="w-full bg-gray-900/50 border border-gray-700/50 rounded-xl p-3 text-white focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30 transition-all"
                              />
                            </div>
                          )}
                          
                          {launchConfig.sellTiming === 'time_based' && (
                            <div>
                              <label className="block text-gray-400 text-sm mb-2">Time Trigger (Minutes)</label>
                              <input
                                type="number"
                                step="1"
                                min="1"
                                max="60"
                                value={launchConfig.sellTimeTrigger}
                                onChange={(e) => setLaunchConfig(prev => ({ ...prev, sellTimeTrigger: parseInt(e.target.value) }))}
                                className="w-full bg-gray-900/50 border border-gray-700/50 rounded-xl p-3 text-white focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30 transition-all"
                              />
                            </div>
                          )}
                          
                          {launchConfig.sellTiming === 'price_target' && (
                            <div>
                              <label className="block text-gray-400 text-sm mb-2">Price Target (%)</label>
                              <input
                                type="number"
                                step="10"
                                min="10"
                                max="1000"
                                value={launchConfig.sellPriceTarget}
                                onChange={(e) => setLaunchConfig(prev => ({ ...prev, sellPriceTarget: parseInt(e.target.value) }))}
                                className="w-full bg-gray-900/50 border border-gray-700/50 rounded-xl p-3 text-white focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30 transition-all"
                              />
                            </div>
                          )}

                          {/* {launchConfig.sellTiming === 'immediate' && (
                            <div className="p-3 bg-gradient-to-r from-amber-900/20 to-yellow-900/20 rounded-xl border border-amber-500/30">
                              <div className="flex items-center gap-2 text-amber-400">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                </svg>
                                <span className="text-sm font-medium">Bots will sell immediately after buying</span>
                              </div>
                            </div>
                          )} */}

                          {launchConfig.sellTiming === 'immediate' && (
                            <div className="p-3 bg-gradient-to-r from-amber-900/20 to-yellow-900/20 rounded-xl border border-amber-500/30">
                              <div className="flex items-center gap-2 text-amber-400">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                </svg>
                                <span className="text-sm font-medium">Bots will sell immediately after buying</span>
                              </div>
                            </div>
                          )}
                          
                          <div>
                            <div className="flex justify-between text-sm mb-2">
                              <label className="text-gray-400">Target Profit</label>
                              <span className="text-emerald-400 font-medium">{launchConfig.targetProfitPercentage}%</span>
                            </div>
                            <input
                              type="range"
                              min="10"
                              max="200"
                              value={launchConfig.targetProfitPercentage}
                              onChange={(e) => setLaunchConfig(prev => ({ ...prev, targetProfitPercentage: parseInt(e.target.value) }))}
                              className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gradient-to-r [&::-webkit-slider-thumb]:from-emerald-500 [&::-webkit-slider-thumb]:to-teal-500"
                            />
                          </div>
                        </div>
                      </div>
                      
                      {/* Summary Card */}
                      <div className="bg-gradient-to-br from-gray-900 to-dark-2 rounded-2xl p-5 border border-gray-800/50">
                        <h3 className="text-white font-bold text-xl mb-4">Launch Summary</h3>
                        
                        <div className="space-y-3">
                          <div className="flex justify-between items-center">
                            <span className="text-gray-400">Bot Army</span>
                            <span className="text-white font-medium">{launchConfig.botCount} bots</span>
                          </div>
                          
                          <div className="flex justify-between items-center">
                            <span className="text-gray-400">Bot Buy Amount Each</span>
                            <span className="text-white font-medium">{launchConfig.botWalletBuyAmount.toFixed(3)} SOL</span>
                          </div>
                          
                          <div className="flex justify-between items-center">
                            <span className="text-gray-400">Total Bot Buy</span>
                            <span className="text-white font-medium">{(launchConfig.botCount * launchConfig.botWalletBuyAmount).toFixed(3)} SOL</span>
                          </div>
                          
                          <div className="flex justify-between items-center">
                            <span className="text-gray-400">Creator Buy</span>
                            <span className="text-white font-medium">{launchConfig.creatorBuyAmount.toFixed(3)} SOL</span>
                          </div>
                          
                          <div className="border-t border-gray-800/50 pt-3 mt-3">
                            <div className="flex justify-between items-center">
                              <span className="text-gray-300">Token Creation Cost</span>
                              <span className="text-white font-medium">~0.02 SOL</span>
                            </div>
                            
                            <div className="flex justify-between items-center mt-2">
                              <span className="text-gray-300">Transaction Fees</span>
                              <span className="text-white font-medium">~0.08 SOL</span>
                            </div>
                            
                            <div className="flex justify-between items-center mt-2">
                              <span className="text-gray-300 font-bold">Total Required</span>
                              <span className={`text-xl font-bold ${
                                userBalance >= totalRequiredSol ? 'text-emerald-400' : 'text-red-400'
                              }`}>
                                {totalRequiredSol.toFixed(2)} SOL
                              </span>
                            </div>
                            
                            <div className="flex justify-between items-center mt-2">
                              <span className="text-gray-400">Your Balance</span>
                              <span className={`font-medium ${
                                userBalance >= totalRequiredSol ? 'text-emerald-400' : 'text-red-400'
                              }`}>
                                {userBalance.toFixed(2)} SOL
                              </span>
                            </div>
                          </div>
                          
                          {/* Status indicator */}
                          <div className={`mt-4 p-3 rounded-xl border ${
                            userBalance >= totalRequiredSol 
                              ? 'bg-emerald-900/20 border-emerald-500/30' 
                              : 'bg-red-900/20 border-red-500/30'
                          }`}>
                            <div className="flex items-center gap-2">
                              <div className={`w-2 h-2 rounded-full ${
                                userBalance >= totalRequiredSol ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'
                              }`}></div>
                              <span className="text-sm">
                                {userBalance >= totalRequiredSol 
                                  ? '✅ Sufficient balance for launch' 
                                  : '❌ Insufficient balance'}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                
                  {/* Action Buttons */}
                  <div className="flex flex-col sm:flex-row gap-4 mt-8">
                    {/* <button
                      onClick={startOrchestratedLaunch}
                      disabled={isLoading || userBalance < totalRequiredSol}
                      className={`flex-1 py-4 px-6 rounded-xl font-bold text-white transition-all duration-200 flex items-center justify-center gap-3 ${
                        isLoading
                          ? 'bg-gray-700 cursor-not-allowed'
                          : userBalance < totalRequiredSol
                          ? 'bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 cursor-not-allowed'
                          : 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 shadow-lg hover:shadow-emerald-500/25'
                      }`}
                    >
                      {isLoading ? (
                        <>
                          <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                          <span>Launching...</span>
                        </>
                      ) : (
                        <>
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                          <span>Start Orchestrated Launch</span>
                        </>
                      )}
                    </button> */}

                    {/* Show launch button only when metadata is generated OR user has manually filled fields */}
                    {metadataGenerated ? (
                      <button
                        onClick={startOrchestratedLaunch}
                        disabled={isLoading || userBalance < totalRequiredSol}
                        className={`flex-1 py-4 px-6 rounded-xl font-bold text-white transition-all duration-200 flex items-center justify-center gap-3 ${
                          isLoading
                            ? 'bg-gray-700 cursor-not-allowed'
                            : userBalance < totalRequiredSol
                            ? 'bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 cursor-not-allowed'
                            : atomicLaunchMode
                            ? 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 shadow-lg hover:shadow-emerald-500/25'
                            : 'bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 shadow-lg hover:shadow-blue-500/25'
                        }`}
                      >
                        {isLoading ? (
                          <>
                            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            <span>Launching...</span>
                          </>
                        ) : atomicLaunchMode ? (
                          <>
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                            <span>Start Atomic Launch</span>
                          </>
                        ) : (
                          <>
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                            <span>Start Orchestrated Launch</span>
                          </>
                        )}
                      </button>
                    ) : (
                      <div className="flex-1 py-4 px-6 rounded-xl border-2 border-dashed border-amber-500/30 bg-amber-900/10 flex flex-col items-center justify-center">
                        <div className="flex items-center gap-2 text-amber-400 mb-2">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                          </svg>
                          <span className="font-bold">Metadata Required</span>
                        </div>
                        <p className="text-amber-300/80 text-sm text-center">
                          Generate AI Metadata or manually fill Token Name & Symbol first
                        </p>
                      </div>
                    )}

                    <button
                      onClick={generateAIMetadata}
                      disabled={aiGenerating || !launchConfig.useAIForMetadata}
                      className="py-4 px-6 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white rounded-xl font-bold transition-all duration-200 shadow-lg hover:shadow-blue-500/25"
                    >
                      {aiGenerating ? (
                        <div className="flex items-center gap-2">
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                          <span>Generating AI Metadata...</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                          </svg>
                          <span>Generate AI Metadata</span>
                        </div>
                      )}
                    </button>
                    
                    <button
                      onClick={() => setShowAdvanced(!showAdvanced)}
                      className="py-4 px-6 bg-gray-800/50 hover:bg-gray-700/50 text-gray-300 hover:text-white rounded-xl font-medium border border-gray-700/50 transition-all duration-200"
                    >
                      {showAdvanced ? 'Hide Advanced' : 'Show Advanced'}
                    </button>
                  </div>

                  {/* Advanced Options */}
                  {showAdvanced && (
                    <div className="mt-6 p-6 bg-gradient-to-br from-gray-900 to-dark-2 rounded-2xl border border-gray-800/50">
                      <h3 className="text-white font-bold text-xl mb-4">Advanced Options</h3>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-4">
                          <div>
                            <label className="block text-gray-400 text-sm mb-2">Initial SOL Reserves</label>
                            <input
                              type="number"
                              step="0.1"
                              min="0"
                              max="10"
                              value={launchConfig.initialSolReserves || 1.0}
                              onChange={(e) => setLaunchConfig(prev => ({ 
                                ...prev, 
                                initialSolReserves: parseFloat(e.target.value) 
                              }))}
                              className="w-full bg-gray-900/50 border border-gray-700/50 rounded-xl p-3 text-white focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30 transition-all"
                            />
                            <p className="text-xs text-gray-500 mt-1">Extra SOL for bot operations and fees</p>
                          </div>
                          
                          <div>
                            <label className="block text-gray-400 text-sm mb-2">Use Jito Bundles</label>
                            <div className="flex items-center h-[52px]">
                              <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={launchConfig.useJitoBundle !== false}
                                  onChange={(e) => setLaunchConfig(prev => ({ 
                                    ...prev, 
                                    useJitoBundle: e.target.checked 
                                  }))}
                                  className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                              </label>
                              <span className="ml-3 text-sm text-gray-400">Faster transaction execution</span>
                            </div>
                          </div>
                        </div>
                        
                        <div className="space-y-4">
                          <div>
                            <label className="block text-gray-400 text-sm mb-2">Launch Priority</label>
                            <select
                              value={launchConfig.priority || 10}
                              onChange={(e) => setLaunchConfig(prev => ({ 
                                ...prev, 
                                priority: parseInt(e.target.value) 
                              }))}
                              className="w-full bg-gray-900/50 border border-gray-700/50 rounded-xl p-3 text-white focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30 transition-all"
                            >
                              <option value="1">Low Priority</option>
                              <option value="5">Normal</option>
                              <option value="10">High Priority</option>
                              <option value="20">Maximum Priority</option>
                            </select>
                          </div>
                          
                          <div>
                            <label className="block text-gray-400 text-sm mb-2">Bot Spread Strategy</label>
                            <select
                              value={launchConfig.botSpread || 'random'}
                              onChange={(e) => setLaunchConfig(prev => ({ 
                                ...prev, 
                                botSpread: e.target.value 
                              }))}
                              className="w-full bg-gray-900/50 border border-gray-700/50 rounded-xl p-3 text-white focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30 transition-all"
                            >
                              <option value="random">Random Timing</option>
                              <option value="sequential">Sequential</option>
                              <option value="burst">Burst Mode</option>
                              <option value="wave">Wave Pattern</option>
                            </select>
                          </div>
                        </div>
                      </div>
                      
                      {/* <div className="mt-6 pt-6 border-t border-gray-800/50">
                        <h4 className="text-gray-300 font-medium mb-3">Debug Information</h4>
                        <div className="bg-gray-900/50 rounded-lg p-4">
                          <div className="text-xs text-gray-400 space-y-1">
                            <div>Wallet: {userWallet?.publicKey.toBase58()}</div>
                            <div>Balance: {userBalance.toFixed(2)} SOL</div>
                            <div>Creator Enabled: {creatorStats?.user?.creator_enabled ? 'Yes' : 'No'}</div>
                            <div>Bot Wallets: {botWallets.length}</div>
                            <div>Total Required: {totalRequiredSol.toFixed(2)} SOL</div>
                          </div>
                        </div>
                      </div> */}
                    </div>
                  )}
                
                  {/* Warning */}
                  <div className="mt-6 p-4 bg-gradient-to-r from-red-900/20 to-orange-900/20 rounded-xl border border-red-500/20">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 bg-gradient-to-br from-red-500 to-orange-500 rounded-lg flex items-center justify-center flex-shrink-0">
                        <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <div>
                        <h4 className="text-red-200 font-bold mb-2">High Risk Activity</h4>
                        <p className="text-red-200/80 text-sm leading-relaxed">
                          Token launches using orchestrated bot armies may be considered market manipulation in some jurisdictions.
                          This tool is for educational purposes only. Use at your own risk and ensure compliance with local regulations.
                          Only use funds you can afford to lose completely.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              // Optional: Show a message that features are locked
              <div className="bg-gradient-to-br from-gray-900/50 to-dark-2/50 backdrop-blur-sm rounded-2xl p-8 border border-gray-800/50 text-center">
                <div className="w-20 h-20 bg-gradient-to-br from-gray-700 to-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-10 h-10 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <h3 className="text-white text-xl font-bold mb-2">Features Locked</h3>
                <p className="text-gray-400 mb-6">
                  Token creation features require a minimum of {MIN_SOL_FOR_CREATOR_MODE} SOL in your wallet.
                  Please fund your wallet to unlock all features.
                </p>
                <div className="flex justify-center gap-3">
                  <button
                    onClick={handleFundWallet}
                    className="bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white font-medium py-3 px-8 rounded-lg transition-all shadow-lg hover:shadow-emerald-500/25"
                  >
                    Fund Wallet Now
                  </button>
                </div>
              </div>
            )}
            </div>
          </div>
        
        {/* Footer */}
        <footer className="bg-gray-900/80 backdrop-blur-lg border-t border-gray-800 py-4 px-4 md:px-8">
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
            <span className="text-gray-400 text-sm">
              © {currentYear} Flash Orchestrator | High Risk Tool | For Educational Purposes Only
            </span>
            <div className="flex items-center gap-6">
              <button
                onClick={() => navigate('/trading-interface')}
                className="text-gray-400 hover:text-emerald-400 transition-colors text-sm font-medium flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Back to Sniper
              </button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default TokenCreator;



