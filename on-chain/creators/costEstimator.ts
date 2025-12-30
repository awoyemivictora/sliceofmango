import { Connection, PublicKey } from '@solana/web3.js';
import { BondingCurveFetcher } from '../pumpfun/pumpfun-idl-client';
import { EstimateCostRequest, CreateTokenRequest, BuyRequest, SellRequest, FundBotsRequest, ExecuteBotBuysRequest, AtomicLaunchRequest } from '../types/api';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

interface EstimateCostResponse {
  success: boolean;
  estimated_cost?: number;
  cost_breakdown?: Record<string, number>;
  error?: string;
}

export async function estimateCost(
  connection: Connection,
  request: EstimateCostRequest
): Promise<EstimateCostResponse> {
  try {
    console.log(`💰 Estimating cost for action: ${request.action}`);
    
    let estimatedCost = 0;
    let costBreakdown: Record<string, number> = {};
    
    switch (request.action) {
      case 'create_token':
        const createConfig = request.config as CreateTokenRequest;
        estimatedCost = 0.1; // Approximate token creation cost
        costBreakdown = {
          mint_creation: 0.03,
          metadata_account: 0.04,
          bonding_curve_account: 0.02,
          transaction_fees: 0.01
        };
        break;
        
      case 'buy':
        const buyConfig = request.config as BuyRequest;
        
        // Base cost is the buy amount
        estimatedCost = buyConfig.amount_sol;
        costBreakdown = {
          token_purchase: buyConfig.amount_sol,
          protocol_fee: buyConfig.amount_sol * 0.01, // 1%
          creator_fee: buyConfig.amount_sol * 0.005, // 0.5%
          transaction_fees: 0.001
        };
        
        // Add bot costs if provided
        if (buyConfig.bot_wallets && buyConfig.bot_wallets.length > 0) {
          const botCosts = buyConfig.bot_wallets.reduce((sum, bot) => sum + bot.buy_amount, 0);
          estimatedCost += botCosts;
          costBreakdown.bot_purchases = botCosts;
        }
        break;
        
      case 'sell':
        const sellConfig = request.config as SellRequest;
        
        // Selling mostly just has fees
        estimatedCost = 0.002; // Approximate transaction fee
        costBreakdown = {
          protocol_fee: 0.001,
          transaction_fees: 0.001
        };
        break;
        
      case 'fund_bots':
        const fundConfig = request.config as FundBotsRequest;
        
        estimatedCost = fundConfig.bot_wallets.reduce((sum, bot) => sum + bot.amount_sol, 0);
        costBreakdown = {
          bot_funding: estimatedCost,
          transaction_fees: 0.001 * fundConfig.bot_wallets.length
        };
        break;
      
        case 'execute_bot_buys':
          const botBuysConfig = request.config as ExecuteBotBuysRequest;

          estimatedCost = botBuysConfig.bot_wallets.reduce((sum, bot) => sum + bot.buy_amount, 0);
          costBreakdown = {
            bot_purchases: estimatedCost,
            protocol_fees: estimatedCost * 0.01,
            creator_fees: estimatedCost * 0.005,
            transaction_fees: 0.001 * botBuysConfig.bot_wallets.length
          };
          break;
        
        case 'atomic_launch':
          const atomicConfig = request.config as AtomicLaunchRequest;

          // Token creation + creator buy + all bot buys
          const tokenCreationCost = 0.1;
          const creatorBuyCost = atomicConfig.creator_buy_amount;
          const botBuysCost = atomicConfig.bot_wallets.reduce((sum, bot) => sum + bot.buy_amount, 0);

          estimatedCost = tokenCreationCost + creatorBuyCost + botBuysCost;
          costBreakdown = {
            token_creation: tokenCreationCost,
            creator_buy: creatorBuyCost,
            bot_purchases: botBuysCost,
            protocol_fees: (creatorBuyCost + botBuysCost) * 0.01,
            creator_fees: (creatorBuyCost + botBuysCost) * 0.005,
            transaction_fees: 0.001 * (2 + atomicConfig.bot_wallets.length) // Rough estimate
          };
          break;
        
      default:
        throw new Error(`Unknown action: ${request.action}`);
    }
    
    return {
      success: true,
      estimated_cost: estimatedCost,
      cost_breakdown: costBreakdown
    };
    
  } catch (error: any) {
    console.error(`❌ Cost estimation failed:`, error.message);
    return {
      success: false,
      error: error.message
    };
  }
}


