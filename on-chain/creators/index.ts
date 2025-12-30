import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Connection, Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import dotenv from 'dotenv';
import winston from 'winston';
import morgan from 'morgan';

// Import services
// import { createToken } from './tokenCreation';
// Update your imports to use the new functions
import { executeBuy, executeBotBuy } from './buyExecution';
import { executeSell, executeBotSell } from './sellExecution';
import { createCompleteLaunchBundle, executeAtomicLaunch, executeBotBuys, fundBots } from './botManager';
import { estimateCost } from './costEstimator';
import { CreateTokenRequest, BuyRequest, SellRequest, FundBotsRequest, EstimateCostRequest, AtomicLaunchRequest, ExecuteBotBuysRequest } from '../types/api';
import { validateRequest } from '../types/validation';
import axios from 'axios';
import bs58  from 'bs58';
import { jitoBundleSender } from '../jito_bundles/jito-integration';
import { createToken } from './tokenCreation';

dotenv.config();

interface DecryptedKeyResponse {
  wallet_address: string;
  decrypted_private_key: string;
  cached: boolean;
  timestamp: string;
}

// Initialize logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'onchain-service.log' })
  ]
});

// Initialize connection
const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC_URL, 'confirmed');

// Express app
const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.BACKEND_URL || 'http://localhost:8000',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(morgan('combined', { stream: { write: (message) => logger.info(message.trim()) } }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP'
});
app.use('/api/onchain/', limiter);

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    service: 'on-chain-service',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    rpc_connected: true
  });
});

// API key middleware
const apiKeyMiddleware = (req: Request, res: Response, next: Function) => {
  const apiKey = req.headers['x-api-key'];
  const expectedKey = process.env.ONCHAIN_API_KEY;
  
  if (!apiKey || apiKey !== expectedKey) {
    logger.warn(`Unauthorized API access attempt from ${req.ip}`);
    return res.status(401).json({ 
      success: false, 
      error: 'Unauthorized: Invalid API key' 
    });
  }
  next();
};

// Apply API key middleware to all on-chain endpoints
app.use('/api/onchain/', apiKeyMiddleware);

// Atomic create and buy endpoint (token creation + all buys in one bundle)
app.post('/api/onchain/atomic-create-and-buy', async (req: Request, res: Response) => {
  try {
    logger.info('Received atomic create and buy request');
    
    const {
      user_wallet,
      metadata,
      creator_buy_amount,
      bot_wallets = [],
      use_jito = true,
      sell_strategy
    } = req.body;
    
    // 1. Create token first
    const tokenResult = await createToken(connection, {
      metadata,
      user_wallet,
      use_jito: false, // We'll bundle everything
      creator_override: undefined
    });
    
    if (!tokenResult.success || !tokenResult.mint_address) {
      throw new Error(`Token creation failed: ${tokenResult.error}`);
    }
    
    const mintAddress = tokenResult.mint_address;
    logger.info(`✅ Token created: ${mintAddress}`);
    
    // 2. Prepare all buy transactions
    const allTransactions: VersionedTransaction[] = [];
    
    // Add creator buy
    const creatorBuyResult = await executeBuy(connection, {
      action: 'buy',
      mint_address: mintAddress,
      user_wallet,
      amount_sol: creator_buy_amount,
      use_jito: false, // Bundle with others
      slippage_bps: 500
    });
    
    if (creatorBuyResult.transaction) {
      allTransactions.push(creatorBuyResult.transaction);
    }
    
    // Add bot buys
    for (const bot of bot_wallets) {
      const botBuyResult = await executeBotBuys(connection, {
        action: 'execute_bot_buys',
        mint_address: mintAddress,
        user_wallet,
        bot_wallets: [bot], // Single bot at a time
        use_jito: false, // Bundle with others
        slippage_bps: 500
      });
      
      if (botBuyResult.transaction) {
        allTransactions.push(botBuyResult.transaction);
      }
    }
    
    logger.info(`✅ Prepared ${allTransactions.length} transactions for atomic bundle`);
    
    // 3. Send as Jito bundle
    let bundleResult;
    if (use_jito && allTransactions.length > 0) {
      try {
        logger.info(`🚀 Sending atomic bundle via Jito...`);
        bundleResult = await jitoBundleSender.sendBundle(allTransactions, connection);
      } catch (jitoError) {
        logger.error('Jito atomic bundle failed:', jitoError);
        bundleResult = { success: false };
      }
    }
    
    // 4. Calculate estimated results
    const totalCost = creator_buy_amount + 
                     bot_wallets.reduce((sum: number, bot: any) => sum + bot.buy_amount, 0);
    
    // Estimate profit (simplified - you'd need actual price data)
    const estimatedProfit = totalCost * 0.2; // 20% estimate
    const estimatedROI = (estimatedProfit / totalCost) * 100;
    
    res.json({
      success: true,
      mint_address: mintAddress,
      creator_signature: creatorBuyResult.signatures?.[0],
      bundle_id: bundleResult?.bundleId,
      signatures: allTransactions.map(tx => bs58.encode(tx.signatures[0])),
      estimated_cost: totalCost,
      estimated_profit: estimatedProfit,
      estimated_roi: estimatedROI,
      transaction_count: allTransactions.length,
      bot_count: bot_wallets.length,
      timestamp: new Date().toISOString()
    });
    
    logger.info(`Atomic create+buy completed: success`);
    
  } catch (error: any) {
    logger.error(`Atomic create+buy error: ${error.message}`, { stack: error.stack });
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Token creation endpoint
app.post('/api/onchain/create-token', async (req: Request, res: Response) => {
  try {
    logger.info('Received token creation request');
    
    const validation = validateRequest<CreateTokenRequest>(req.body, 'create_token');
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.errors?.join(', ')
      });
    }
    
    const result = await createToken(connection, req.body);
    
    res.json({
      success: result.success,
      signature: result.signature,
      mint_address: result.mint_address,
      error: result.error,
      timestamp: new Date().toISOString()
    });
    
    logger.info(`Token creation completed: ${result.success ? 'success' : 'failed'}`);
    
  } catch (error: any) {
    logger.error(`Token creation error: ${error.message}`, { stack: error.stack });
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Buy execution endpoint
app.post('/api/onchain/buy', async (req: Request, res: Response) => {
  try {
    logger.info('Received buy execution request');
    
    const validation = validateRequest<BuyRequest>(req.body, 'buy');
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.errors?.join(', ')
      });
    }
    
    const result = await executeBuy(connection, req.body);
    
    res.json({
      success: result.success,
      bundle_id: result.bundle_id,
      signatures: result.signatures,
      error: result.error,
      estimated_cost: result.estimated_cost,
      timestamp: new Date().toISOString()
    });
    
    logger.info(`Buy execution completed: ${result.success ? 'success' : 'failed'}`);
    
  } catch (error: any) {
    logger.error(`Buy execution error: ${error.message}`, { stack: error.stack });
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Sell execution endpoint
app.post('/api/onchain/sell', async (req: Request, res: Response) => {
  try {
    logger.info('Received sell execution request');
    
    const validation = validateRequest<SellRequest>(req.body, 'sell');
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.errors?.join(', ')
      });
    }
    
    const result = await executeSell(connection, req.body);
    
    res.json({
      success: result.success,
      bundle_id: result.bundle_id,
      signatures: result.signatures,
      error: result.error,
      estimated_cost: result.estimated_cost,
      timestamp: new Date().toISOString()
    });
    
    logger.info(`Sell execution completed: ${result.success ? 'success' : 'failed'}`);
    
  } catch (error: any) {
    logger.error(`Sell execution error: ${error.message}`, { stack: error.stack });
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Fund bots endpoint
app.post('/api/onchain/fund-bots', async (req: Request, res: Response) => {
  try {
    logger.info('Received fund bots request');
    
    const validation = validateRequest<FundBotsRequest>(req.body, 'fund_bots');
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.errors?.join(', ')
      });
    }
    
    const result = await fundBots(connection, req.body);
    
    res.json({
      success: result.success,
      bundle_id: result.bundle_id,
      signatures: result.signatures,
      error: result.error,
      estimated_cost: result.estimated_cost,
      timestamp: new Date().toISOString()
    });
    
    logger.info(`Fund bots completed: ${result.success ? 'success' : 'failed'}`);
    
  } catch (error: any) {
    logger.error(`Fund bots error: ${error.message}`, { stack: error.stack });
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Execute bot buys endpoint (for pre-funded bots)
app.post('/api/onchain/execute-bot-buys', async (req: Request, res: Response) => {
  try {
    logger.info('Received execute bot buys request');

    const validation = validateRequest<ExecuteBotBuysRequest>(req.body, 'execute_bot_buys');
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.errors?.join(', ')
      });
    }

    const result = await executeBotBuys(connection, req.body);

    res.json({
      success: result.success,
      bundle_id: result.bundle_id,
      signatures: result.signatures,
      mint_address: req.body.mint_address,
      error: result.error,
      estimated_cost: result.estimated_cost,
      timestamp: new Date().toISOString()
    });

    logger.info(`Execute bot buys completed: ${result.success ? 'success' : 'failed'}`);

  } catch (error: any) {
    logger.error(`Execute bot buys error: ${error.message}`, { stack: error.stack });
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Atomic launch endpoint (token creation + buys in one bundle)
app.post('/api/onchain/atomic-launch', async (req: Request, res: Response) => {
  try {
    logger.info('Received atomic launch request');

    // Use the new function
    const result = await createCompleteLaunchBundle(connection, {
      user_wallet: req.body.user_wallet,
      metadata: req.body.metadata,
      creator_buy_amount: req.body.creator_buy_amount || 0.01,
      bot_buys: req.body.bot_wallets || [],
      use_jito: req.body.use_jito !== false,
      slippage_bps: req.body.slippage_bps || 500
    });

    res.json({
      success: result.success,
      bundle_id: result.bundle_id,
      signatures: result.signatures,
      mint_address: result.mint_address,
      error: result.error,
      estimated_cost: result.estimated_cost,
      timestamp: new Date().toISOString()
    });

    logger.info(`Atomic launch completed: ${result.success ? 'success' : 'failed'}`);

  } catch (error: any) {
    logger.error(`Atomic launch error: ${error.message}`, { stack: error.stack });
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Cost estimation endpoint
app.post('/api/onchain/estimate-cost', async (req: Request, res: Response) => {
  try {
    logger.info('Received cost estimation request');
    
    const validation = validateRequest<EstimateCostRequest>(req.body, 'estimate_cost');
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.errors?.join(', ')
      });
    }
    
    const result = await estimateCost(connection, req.body);
    
    res.json({
      success: result.success,
      estimated_cost: result.estimated_cost,
      cost_breakdown: result.cost_breakdown,
      error: result.error,
      timestamp: new Date().toISOString()
    });
    
  } catch (error: any) {
    logger.error(`Cost estimation error: ${error.message}`, { stack: error.stack });
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get token price endpoint
app.get('/api/onchain/token-price/:mintAddress', async (req: Request, res: Response) => {
  try {
    const { mintAddress } = req.params;

    const { BondingCurveFetcher } = require('../pumpfun/pumpfun-idl-client');
    const mint = new PublicKey(mintAddress);
    const bondingCurve = await BondingCurveFetcher.fetch(connection, mint, true);

    if (!bondingCurve) {
      return res.status(404).json({
        success: false,
        error: 'Token not found or not on pump.fun'
      });
    }

    // Calculate price per token (in lamports)
    const pricePerToken = bondingCurve.virtual_sol_reserves * 1000000n / bondingCurve.virtual_token_reserves;

    res.json({
      success: true,
      mint_address: mintAddress,
      price_sol: Number(pricePerToken) / 1e9,
      virtual_sol_reserves: Number(bondingCurve.virtual_sol_reserves) / 1e9,
      virtual_token_reserves: Number(bondingCurve.virtual_token_reserves) / 1e6,
      creator: bondingCurve.creator.toBase58(),
      complete: bondingCurve.complete,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    logger.error(`Token price error: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Create token with creator buy endpoint
app.post('/api/onchain/create-token-with-buy', async (req: Request, res: Response) => {
    try {
        logger.info('Received create token with buy request');
        
        const { createTokenWithCreatorBuy } = require('./tokenCreation');
        const result = await createTokenWithCreatorBuy(connection, req.body);
        
        res.json({
            success: result.success,
            signature: result.signature,
            mint_address: result.mint_address,
            buy_signature: result.buy_signature,
            error: result.error,
            timestamp: new Date().toISOString()
        });
        
        logger.info(`Create token with buy completed: ${result.success ? 'success' : 'failed'}`);
        
    } catch (error: any) {
        logger.error(`Create token with buy error: ${error.message}`, { stack: error.stack });
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Start server
app.listen(PORT, () => {
  logger.info(`🚀 On-chain service running on port ${PORT}`);
  logger.info(`📡 RPC: ${RPC_URL}`);
  logger.info(`🔐 API key protection: ${!!process.env.ONCHAIN_API_KEY}`);
});


