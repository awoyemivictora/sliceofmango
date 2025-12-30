import { PublicKey } from '@solana/web3.js';
import { CreateTokenRequest, BuyRequest, SellRequest, FundBotsRequest, AtomicLaunchRequest, ExecuteBotBuysRequest, EstimateCostRequest } from '../types/api';

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

export function validateRequest<T>(data: any, action: string): ValidationResult {
  const errors: string[] = [];
  
  try {
    switch (action) {
      case 'create_token':
        const createData = data as CreateTokenRequest;
        
        if (!createData.metadata) {
          errors.push('Metadata is required');
        } else {
          if (!createData.metadata.name || createData.metadata.name.length < 1) {
            errors.push('Token name is required');
          }
          if (!createData.metadata.symbol || createData.metadata.symbol.length < 1) {
            errors.push('Token symbol is required');
          }
          if (!createData.metadata.uri || createData.metadata.uri.length < 1) {
            errors.push('Token URI is required');
          }
          if (createData.metadata.name.length > 32) {
            errors.push('Token name must be 32 characters or less');
          }
          if (createData.metadata.symbol.length > 10) {
            errors.push('Token symbol must be 10 characters or less');
          }
        }
        
        if (!createData.user_wallet) {
          errors.push('User wallet is required');
        } else {
          try {
            new PublicKey(createData.user_wallet);
          } catch {
            errors.push('Invalid user wallet address');
          }
        }
        
        break;
        
      case 'buy':
        const buyData = data as BuyRequest;
        
        if (!buyData.mint_address) {
          errors.push('Mint address is required');
        } else {
          try {
            new PublicKey(buyData.mint_address);
          } catch {
            errors.push('Invalid mint address');
          }
        }
        
        if (!buyData.user_wallet) {
          errors.push('User wallet is required');
        } else {
          try {
            new PublicKey(buyData.user_wallet);
          } catch {
            errors.push('Invalid user wallet address');
          }
        }
        
        if (!buyData.amount_sol || buyData.amount_sol <= 0) {
          errors.push('Amount SOL must be greater than 0');
        }
        
        if (buyData.slippage_bps && (buyData.slippage_bps < 0 || buyData.slippage_bps > 10000)) {
          errors.push('Slippage must be between 0 and 10000 basis points (0-100%)');
        }
        
        break;
        
      case 'sell':
        const sellData = data as SellRequest;
        
        if (!sellData.mint_address) {
          errors.push('Mint address is required');
        } else {
          try {
            new PublicKey(sellData.mint_address);
          } catch {
            errors.push('Invalid mint address');
          }
        }
        
        if (!sellData.user_wallet) {
          errors.push('User wallet is required');
        } else {
          try {
            new PublicKey(sellData.user_wallet);
          } catch {
            errors.push('Invalid user wallet address');
          }
        }
        
        if (sellData.slippage_bps && (sellData.slippage_bps < 0 || sellData.slippage_bps > 10000)) {
          errors.push('Slippage must be between 0 and 10000 basis points (0-100%)');
        }
        
        break;
        
      case 'fund_bots':
        const fundData = data as FundBotsRequest;
        
        if (!fundData.bot_wallets || fundData.bot_wallets.length === 0) {
          errors.push('At least one bot wallet is required');
        } else {
          for (const bot of fundData.bot_wallets) {
            if (!bot.public_key) {
              errors.push('Bot public key is required');
            } else {
              try {
                new PublicKey(bot.public_key);
              } catch {
                errors.push(`Invalid bot wallet address: ${bot.public_key}`);
              }
            }
            
            if (!bot.amount_sol || bot.amount_sol <= 0) {
              errors.push(`Amount SOL for bot ${bot.public_key} must be greater than 0`);
            }
          }
        }
        
        if (!fundData.user_wallet) {
          errors.push('User wallet is required');
        } else {
          try {
            new PublicKey(fundData.user_wallet);
          } catch {
            errors.push('Invalid user wallet address');
          }
        }
        
        break;
        
      case 'atomic_launch':
        const atomicData = data as AtomicLaunchRequest;
        
        if (!atomicData.metadata) {
          errors.push('Metadata is required');
        } else {
          if (!atomicData.metadata.name || atomicData.metadata.name.length < 1) {
            errors.push('Token name is required');
          }
          if (!atomicData.metadata.symbol || atomicData.metadata.symbol.length < 1) {
            errors.push('Token symbol is required');
          }
          if (!atomicData.metadata.uri || atomicData.metadata.uri.length < 1) {
            errors.push('Token URI is required');
          }
        }
        
        if (!atomicData.user_wallet) {
          errors.push('User wallet is required');
        } else {
          try {
            new PublicKey(atomicData.user_wallet);
          } catch {
            errors.push('Invalid user wallet address');
          }
        }
        
        if (!atomicData.bot_wallets || atomicData.bot_wallets.length === 0) {
          errors.push('At least one bot wallet is required');
        } else {
          for (const bot of atomicData.bot_wallets) {
            if (!bot.public_key) {
              errors.push('Bot public key is required');
            } else {
              try {
                new PublicKey(bot.public_key);
              } catch {
                errors.push(`Invalid bot wallet address: ${bot.public_key}`);
              }
            }
            
            if (!bot.buy_amount || bot.buy_amount <= 0) {
              errors.push(`Buy amount for bot ${bot.public_key} must be greater than 0`);
            }
          }
        }
        
        if (!atomicData.creator_buy_amount || atomicData.creator_buy_amount <= 0) {
          errors.push('Creator buy amount must be greater than 0');
        }
        
        if (atomicData.slippage_bps && (atomicData.slippage_bps < 0 || atomicData.slippage_bps > 10000)) {
          errors.push('Slippage must be between 0 and 10000 basis points (0-100%)');
        }
        
        break;
        
      case 'execute_bot_buys':
        const botBuysData = data as ExecuteBotBuysRequest;
        
        if (!botBuysData.mint_address) {
          errors.push('Mint address is required');
        } else {
          try {
            new PublicKey(botBuysData.mint_address);
          } catch {
            errors.push('Invalid mint address');
          }
        }
        
        if (!botBuysData.user_wallet) {
          errors.push('User wallet is required');
        } else {
          try {
            new PublicKey(botBuysData.user_wallet);
          } catch {
            errors.push('Invalid user wallet address');
          }
        }
        
        if (!botBuysData.bot_wallets || botBuysData.bot_wallets.length === 0) {
          errors.push('At least one bot wallet is required');
        } else {
          for (const bot of botBuysData.bot_wallets) {
            if (!bot.public_key) {
              errors.push('Bot public key is required');
            } else {
              try {
                new PublicKey(bot.public_key);
              } catch {
                errors.push(`Invalid bot wallet address: ${bot.public_key}`);
              }
            }
            
            if (!bot.buy_amount || bot.buy_amount <= 0) {
              errors.push(`Buy amount for bot ${bot.public_key} must be greater than 0`);
            }
          }
        }
        
        if (botBuysData.slippage_bps && (botBuysData.slippage_bps < 0 || botBuysData.slippage_bps > 10000)) {
          errors.push('Slippage must be between 0 and 10000 basis points (0-100%)');
        }
        
        break;
        
      case 'estimate_cost':
        const estimateData = data as EstimateCostRequest;
        
        if (!estimateData.action) {
          errors.push('Action is required');
        }
        
        if (!estimateData.config) {
          errors.push('Config is required');
        }
        
        break;
        
      default:
        errors.push(`Unknown action: ${action}`);
    }
    
  } catch (error: any) {
    errors.push(`Validation error: ${error.message}`);
  }
  
  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined
  };
}


