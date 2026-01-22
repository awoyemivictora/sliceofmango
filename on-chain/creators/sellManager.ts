import { Connection, PublicKey, Keypair, VersionedTransaction, TransactionMessage, ComputeBudgetProgram } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import bs58 from 'bs58';
import axios from 'axios';
import { BondingCurveFetcher, BondingCurveMath, PUMP_FUN_PROGRAM_ID, PumpFunInstructionBuilder, PumpFunPda, TOKEN_2022_PROGRAM_ID } from '../pumpfun/pumpfun-idl-client';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { BotSellRequest, ExecuteBotBuysResponse, SellExecutionResult, SellStrategyConfig } from 'types/api';
import { createCompleteLaunchBundle } from './botManager';
import * as borsh from 'borsh';
import { AdvancedBotOrchestrator } from './advancedBotManager';

// ============================================
// TYPES FOR ADVANCED SELLING
// ============================================

interface AdvancedSellConfig {
    percentage: number;
    delayRange: [number, number];
    batchSize: number;
}

interface AdvancedSellResult {
    success: boolean;
    signature?: string;
    solReceived?: number;
    error?: string;
}

interface ExitInfo {
    exitSignal: string;
    peakPrice: number;
    reason: string;
}

interface SellStrategy {
    creatorPercentage: number;
    botPercentage: number;
    delayBetweenSells: number;
    aggressiveness: 'conservative' | 'moderate' | 'aggressive';
}

// ============================================
// ENHANCED PROFIT CALCULATOR
// ============================================

export class AdvancedProfitCalculator {
    /**
     * Calculate optimal sell price based on market conditions
     */
    static calculateOptimalSellPrice(
        buyPrice: number,
        currentPrice: number,
        marketVolatility: number
    ): number {
        const profitMargin = 0.3; // 30% minimum profit
        const volatilityAdjustment = marketVolatility * 0.1;
        
        return buyPrice * (1 + profitMargin + volatilityAdjustment);
    }

    /**
     * Calculate dynamic slippage based on market conditions
     */
    static calculateDynamicSlippage(
        tokenLiquidity: number,
        marketVolatility: number
    ): number {
        const baseSlippage = 500; // 5% base
        const liquidityPenalty = tokenLiquidity < 1 ? 300 : 0; // +3% if low liquidity
        const volatilityPenalty = marketVolatility > 20 ? 200 : 0; // +2% if high volatility
        
        return baseSlippage + liquidityPenalty + volatilityPenalty;
    }
}

// ============================================
// ADVANCED SELL MANAGER
// ============================================

export async function executeAdvancedSmartSells(
  connection: Connection,
  request: BotSellRequest & {
    use_advanced_strategy?: boolean;
    profit_targets?: number[];
    max_monitoring_time?: number;
  }
): Promise<SellExecutionResult> {
  try {
    console.log(`🎯 Executing advanced smart sells for ${request.mint_address}`);
    
    const mint = new PublicKey(request.mint_address);
    
    if (request.use_advanced_strategy) {
      console.log(`🚀 Using advanced selling strategy`);
      
      // Create orchestrator instance
      const orchestrator = new AdvancedBotOrchestrator(connection, request.user_wallet);
      
      // Prepare bots for selling
      const preparedBots = await (orchestrator as any).prepareBotWallets(
        request.bot_wallets.map(bot => ({
          public_key: bot.public_key,
          amount_sol: 0, // Not needed for selling
          private_key: undefined // Will be fetched
        }))
      );
      
      // Monitor for optimal exit
      console.log(`👁️ Advanced exit monitoring...`);
      const monitoringTime = request.max_monitoring_time || 300000; // 5 minutes default
      
      // Call the private method using bracket notation
      const exitInfo: ExitInfo = await (orchestrator as any).monitorForOptimalExit(mint, monitoringTime);
      
      console.log(`   Exit signal: ${exitInfo.exitSignal}`);
      console.log(`   Reason: ${exitInfo.reason}`);
      
      // Get sell strategy based on exit signal
      const sellStrategy: SellStrategy = (orchestrator as any).determineSellStrategy(
        exitInfo.exitSignal, 
        exitInfo.peakPrice
      );
      
      let totalSolReceived = 0;
      const signatures: string[] = [];
      
      // Creator sell
      console.log(`💰 Selling creator tokens (${sellStrategy.creatorPercentage}%)...`);
      
      // Create a complete sell strategy config for the creator
      const creatorSellStrategy: SellStrategyConfig = {
        minProfitPercentage: request.sell_strategy?.minProfitPercentage || 30,
        maxHoldTimeSeconds: request.sell_strategy?.maxHoldTimeSeconds || 60,
        stopLossPercentage: request.sell_strategy?.stopLossPercentage || 15,
        staggeredSellDelayMs: request.sell_strategy?.staggeredSellDelayMs || 2000,
        partialSellPercentages: [sellStrategy.creatorPercentage]
      };
      
      const creatorResult = await executeSellForWallet(
        connection,
        mint,
        new PublicKey(request.creator_wallet),
        request.user_wallet,
        true,
        creatorSellStrategy
      );
      
      if (creatorResult.success && creatorResult.signature) {
        signatures.push(creatorResult.signature);
        totalSolReceived += creatorResult.solReceived || 0;
      }
      
      // Bot sells with advanced staggering
      console.log(`🤖 Selling bot tokens with advanced strategy...`);
      const botResults = await executeAdvancedStaggeredSells(
        connection,
        mint,
        request.bot_wallets,
        request.user_wallet,
        {
          percentage: sellStrategy.botPercentage,
          delayRange: [sellStrategy.delayBetweenSells * 0.5, sellStrategy.delayBetweenSells * 1.5] as [number, number],
          batchSize: sellStrategy.aggressiveness === 'aggressive' ? 3 : 
                    sellStrategy.aggressiveness === 'moderate' ? 2 : 1
        }
      );
      
      botResults.forEach(result => {
        if (result.success && result.signature) {
          signatures.push(result.signature);
          totalSolReceived += result.solReceived || 0;
        }
      });
      
      // Calculate advanced stats
      const bondingCurve = await BondingCurveFetcher.fetch(connection, mint, false);
      const finalPrice = bondingCurve ? Number(bondingCurve.virtual_sol_reserves) / LAMPORTS_PER_SOL : 0;
      
      const stats = {
        total_bots: request.bot_wallets.length,
        bots_sold: botResults.filter(r => r.success).length,
        creator_sold: creatorResult.success,
        profit_percentage: finalPrice > 0 ? 
          ((finalPrice - (exitInfo.peakPrice * 0.7)) / (exitInfo.peakPrice * 0.7) * 100) : 0,
        // Advanced stats
        advanced_strategy_used: true,
        monitoring_time_ms: monitoringTime,
        exit_signal: exitInfo.exitSignal,
        peak_price: exitInfo.peakPrice,
        final_price: finalPrice,
        price_drop_from_peak: exitInfo.peakPrice > 0 ? 
          ((exitInfo.peakPrice - finalPrice) / exitInfo.peakPrice * 100).toFixed(2) + '%' : 'N/A',
        strategy_aggressiveness: sellStrategy.aggressiveness
      };
      
      console.log(`\n🎉 Advanced sell complete!`);
      console.log(`📊 Advanced stats:`, JSON.stringify(stats, null, 2));
      console.log(`💰 Total SOL received: ${totalSolReceived.toFixed(6)}`);
      
      return {
        success: signatures.length > 0,
        signatures,
        total_sol_received: totalSolReceived,
        stats
      };
      
    } else {
      // Fall back to original smart sells
      console.log(`🔄 Using basic selling strategy`);
      return await executeSmartSells(connection, request);
    }
    
  } catch (error: any) {
    console.error(`❌ Advanced smart sells failed: ${error.message}`);
    return {
      success: false,
      error: error.message,
      stats: {
        total_bots: request.bot_wallets.length,
        bots_sold: 0,
        creator_sold: false,
        advanced_strategy_used: false
      }
    };
  }
}

// ============================================
// ADVANCED STAGGERED SELLS
// ============================================

async function executeAdvancedStaggeredSells(
  connection: Connection,
  mint: PublicKey,
  bots: Array<{ public_key: string }>,
  userWallet: string,
  config: AdvancedSellConfig
): Promise<AdvancedSellResult[]> {
  const results: AdvancedSellResult[] = [];
  
  // Process in batches for efficiency
  for (let i = 0; i < bots.length; i += config.batchSize) {
    const batch = bots.slice(i, i + config.batchSize);
    console.log(`   Processing batch ${Math.floor(i/config.batchSize) + 1}/${Math.ceil(bots.length/config.batchSize)}`);
    
    // Execute batch in parallel
    const batchPromises = batch.map(bot => {
      const sellStrategy: SellStrategyConfig = {
        partialSellPercentages: [config.percentage],
        staggeredSellDelayMs: 0, // No delay within batch
        // Add default values for required properties
        minProfitPercentage: 0,
        maxHoldTimeSeconds: 60,
        stopLossPercentage: 20
      };
      
      return executeSellForWallet(
        connection,
        mint,
        new PublicKey(bot.public_key),
        userWallet,
        false,
        sellStrategy
      );
    });
    
    const batchResults = await Promise.allSettled(batchPromises);
    
    batchResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        results.push(result.value);
        if (result.value.success) {
          console.log(`     ✅ Bot ${i + index + 1}: Sold ${config.percentage}%`);
        } else {
          console.log(`     ❌ Bot ${i + index + 1}: Failed - ${result.value.error}`);
        }
      } else {
        console.log(`     ❌ Bot ${i + index + 1}: Promise rejected`);
        results.push({
          success: false,
          error: 'Promise rejected'
        });
      }
    });
    
    // Delay between batches
    if (i + config.batchSize < bots.length) {
      const delay = config.delayRange[0] + Math.random() * (config.delayRange[1] - config.delayRange[0]);
      console.log(`     ⏳ Waiting ${Math.round(delay)}ms before next batch...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  return results;
}

// ============================================
// SMART SELL EXECUTOR (ORIGINAL)
// ============================================

export async function executeSmartSells(
    connection: Connection,
    request: BotSellRequest
): Promise<SellExecutionResult> {
    try {
        console.log(`🎯 Executing smart sells for token: ${request.mint_address}`);
        console.log(`📊 Strategy: ${JSON.stringify(request.sell_strategy, null, 2)}`);

        const mint = new PublicKey(request.mint_address);
        const signatures: string[] = [];
        let totalSolReceived = 0;

        // Step 1: Monitor bonding curve growth for initial period
        console.log(`📈 Monitoring bonding curve for 5 seconds...`);
        const curveData = await BondingCurveMonitor.monitorCurveGrowth(
            connection,
            mint,
            15 // 15 secs
        );

        console.log(`📊 Curve Growth Summary:`);
        console.log(`   Start: ${Number(curveData.startVirtualSol)/LAMPORTS_PER_SOL} SOL`);
        console.log(`   End: ${Number(curveData.endVirtualSol)/LAMPORTS_PER_SOL} SOL`);
        console.log(`   Peak: ${Number(curveData.peakVirtualSol)/LAMPORTS_PER_SOL} SOL`);
        console.log(`   Growth: ${curveData.growthPercentage.toFixed(2)}%`);

        // Check if we should proceed with selling
        if (curveData.growthPercentage < 10) { // If less than 10% growth
            console.log(`⚠️ Insufficient curve growth (${curveData.growthPercentage.toFixed(2)}%). Waiting...`);
            
            // Wait for more growth or trigger sell if stop loss
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Check again
            const finalCurveData = await BondingCurveMonitor.monitorCurveGrowth(
                connection,
                mint,
                3
            );
            
            if (finalCurveData.growthPercentage < 5) {
                console.log(`⚠️ Still low growth. Proceeding with conservative sell.`);
            }
        }

        // Step 2: Execute creator sell first (after 5 seconds from creation)
        console.log(`\n💰 SELLING CREATOR TOKENS...`);
        const creatorResult = await executeSellForWallet(
            connection,
            mint,
            new PublicKey(request.creator_wallet),
            request.user_wallet, // Need user to get private key
            true, // isCreator
            request.sell_strategy
        );

        if (creatorResult.success && creatorResult.signature) {
            signatures.push(creatorResult.signature);
            totalSolReceived += creatorResult.solReceived || 0;
            console.log(`✅ Creator sold: ${creatorResult.signature.slice(0, 16)}...`);
        }

        // Wait before bot sells (staggered approach)
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Step 3: Execute staggered bot sells
        console.log(`\n🤖 SELLING BOT TOKENS (${request.bot_wallets.length} bots)...`);
        
        const botResults = await executeStaggeredBotSells(
            connection,
            mint,
            request.bot_wallets,
            request.user_wallet,
            request.sell_strategy
        );

        botResults.forEach(result => {
            if (result.success && result.signature) {
                signatures.push(result.signature);
                totalSolReceived += result.solReceived || 0;
                console.log(`✅ Bot sold: ${result.signature.slice(0, 16)}...`);
            }
        });

        // Step 4: Calculate profit
        const stats = {
            total_bots: request.bot_wallets.length,
            bots_sold: botResults.filter(r => r.success).length,
            creator_sold: creatorResult.success,
            profit_percentage: curveData.growthPercentage,
            advanced_strategy_used: false // Mark as basic strategy
        };

        console.log(`\n🎉 SELL COMPLETE!`);
        console.log(`📊 Stats: ${JSON.stringify(stats, null, 2)}`);
        console.log(`💰 Total SOL Received: ${totalSolReceived.toFixed(6)}`);

        return {
            success: signatures.length > 0,
            signatures,
            total_sol_received: totalSolReceived,
            stats
        };

    } catch (error: any) {
        console.error(`❌ Smart sell execution failed:`, error.message);
        return {
            success: false,
            error: error.message,
            stats: {
                total_bots: request.bot_wallets.length,
                bots_sold: 0,
                creator_sold: false,
                advanced_strategy_used: false
            }
        };
    }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

async function executeSellForWallet(
  connection: Connection,
  mint: PublicKey,
  wallet: PublicKey,
  userWallet: string,
  isCreator: boolean,
  strategy: SellStrategyConfig
): Promise<{
  success: boolean;
  signature?: string;
  solReceived?: number;
  error?: string;
}> {
  try {
    // ============================================
    // 1. Get wallet private key from backend
    // ============================================
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000';
    const endpoint = isCreator
      ? '/creators/user/get-key-for-token-creation'
      : '/creators/user/get-bot-private-key';

    const requestData = isCreator
      ? { wallet_address: wallet.toBase58() }
      : { bot_wallet: wallet.toBase58(), user_wallet: userWallet };

    const response = await axios.post(`${backendUrl}${endpoint}`, requestData, {
      headers: {
        'X-API-Key': process.env.ONCHAIN_API_KEY,
        'Content-Type': 'application/json',
      },
      timeout: 5000,
    });

    if (!response.data.success || !response.data.private_key) {
      throw new Error('Failed to get private key');
    }

    const secretKey = bs58.decode(response.data.private_key);
    const keypair = Keypair.fromSecretKey(secretKey);

    // ============================================
    // 2. Fetch bonding curve (FRESH data)
    // ============================================
    const bondingCurve = await BondingCurveFetcher.fetch(connection, mint, false);
    if (!bondingCurve) {
      throw new Error('Bonding curve not found');
    }

    // ============================================
    // 3. Get token balance
    // ============================================
    const ata = getAssociatedTokenAddressSync(mint, wallet, false, TOKEN_2022_PROGRAM_ID);
    const tokenBalanceInfo = await connection.getTokenAccountBalance(ata, 'processed');
    const tokenBalance = BigInt(tokenBalanceInfo.value.amount);

    if (tokenBalance === 0n) {
      console.log(`⚠️ No tokens to sell for ${wallet.toBase58().slice(0, 8)}...`);
      return { success: false, error: 'No tokens' };
    }

    // ============================================
    // 4. Determine sell amount
    // ============================================
    let sellAmount = tokenBalance;
    if (isCreator && strategy.partialSellPercentages?.length > 0) {
      const percentage = strategy.partialSellPercentages[0] / 100;
      sellAmount = (tokenBalance * BigInt(Math.floor(percentage * 100))) / 100n;
      console.log(`Creator selling ${percentage * 100}% of tokens (${sellAmount})`);
    }

    // ============================================
    // 5. Calculate expected SOL with reasonable slippage
    // ============================================
    const grossExpectedSol = BondingCurveMath.calculateSolForTokens(
      bondingCurve.virtual_sol_reserves,
      bondingCurve.virtual_token_reserves,
      sellAmount
    );

    // CRITICAL FIX: Use reasonable fee assumption (3-4% total)
    // Pump.fun fees are typically ~3-4% total (2% protocol + 1-2% creator)
    const assumedTotalFeesBps = 300n; // 3% total fees as default
    const netExpectedSol = (grossExpectedSol * (10000n - assumedTotalFeesBps)) / 10000n;

    // Apply more aggressive slippage (5-10% instead of 1%)
    const slippageBps = 1000; // 10% slippage - this is what was failing before
    const minSolOutput = ProfitCalculator.applySlippageForSell(netExpectedSol, slippageBps);

    console.log(`Selling ${sellAmount} tokens`);
    console.log(`Gross Expected SOL: ${Number(grossExpectedSol) / LAMPORTS_PER_SOL}`);
    console.log(`Assumed total fees: ${Number(assumedTotalFeesBps) / 100}%`);
    console.log(`Net Expected SOL: ${Number(netExpectedSol) / LAMPORTS_PER_SOL}`);
    console.log(`Min SOL output (with ${slippageBps / 100}% slippage): ${Number(minSolOutput) / LAMPORTS_PER_SOL}`);

    // ============================================
    // 6. Build transaction
    // ============================================
    const { blockhash } = await connection.getLatestBlockhash('confirmed');

    const instructions = [];

    // Compute budget
    instructions.push(ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }));
    instructions.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000000 }));

    // Sell instruction
    const sellInstruction = PumpFunInstructionBuilder.buildSell(
      keypair.publicKey,
      mint,
      ata,
      bondingCurve.creator,
      sellAmount,
      minSolOutput
    );
    instructions.push(sellInstruction);

    // ============================================
    // 7. SIMULATE FIRST (to catch errors early)
    // ============================================
    const messageV0 = new TransactionMessage({
      payerKey: keypair.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([keypair]);

    console.log(`📊 Simulating transaction...`);
    const simulation = await connection.simulateTransaction(transaction, {
      commitment: 'processed'
    });

    if (simulation.value.err) {
      console.error(`❌ Simulation failed:`, simulation.value.err);
      if (simulation.value.logs) {
        console.error(`Simulation logs:`);
        simulation.value.logs.forEach((log: string, i: number) => {
          console.error(`  ${i}: ${log}`);
        });
      }
      throw new Error(`Transaction simulation failed: ${JSON.stringify(simulation.value.err)}`);
    }

    console.log(`✅ Simulation passed, sending transaction...`);

    // ============================================
    // 8. Send and confirm
    // ============================================
    const signature = await connection.sendTransaction(transaction, {
      skipPreflight: true, // We already simulated
      maxRetries: 3,
      preflightCommitment: 'confirmed',
    });

    console.log(`✅ Transaction sent: ${signature.slice(0, 16)}...`);

    await connection.confirmTransaction(signature, 'confirmed');

    return {
      success: true,
      signature,
      solReceived: Number(netExpectedSol) / LAMPORTS_PER_SOL,
    };
  } catch (error: any) {
    console.error(`❌ Sell failed for ${wallet.toBase58().slice(0, 8)}...:`, error.message);
    if (error.logs) {
      console.error('Transaction logs:', error.logs);
    }
    return {
      success: false,
      error: error.message,
    };
  }
}

async function executeStaggeredBotSells(
    connection: Connection,
    mint: PublicKey,
    bots: Array<{ public_key: string }>,
    userWallet: string,
    strategy: SellStrategyConfig
): Promise<Array<{
    success: boolean;
    signature?: string;
    solReceived?: number;
    error?: string;
}>> {
    const results = [];

    for (let i = 0; i < bots.length; i++) {
        const bot = bots[i];
        console.log(`\n🤖 Selling for bot ${i + 1}/${bots.length}: ${bot.public_key.slice(0, 8)}...`);

        const result = await executeSellForWallet(
            connection,
            mint,
            new PublicKey(bot.public_key),
            userWallet,
            false, // not creator
            strategy
        );

        results.push(result);

        // Stagger the sells (wait between each bot)
        if (i < bots.length - 1) {
            const delay = strategy.staggeredSellDelayMs || 2000;
            console.log(`⏳ Waiting ${delay}ms before next bot...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    return results;
}

// ============================================
// BONDING CURVE MONITOR
// ============================================

export class BondingCurveMonitor {
    private static readonly UPDATE_INTERVAL_MS = 1000; // Check every second

    static async monitorCurveGrowth(
        connection: Connection,
        mint: PublicKey,
        durationSeconds: number
    ): Promise<{
        startVirtualSol: bigint;
        endVirtualSol: bigint;
        growthPercentage: number;
        peakVirtualSol: bigint;
    }> {
        const startVirtualSol = await this.getVirtualSolReserves(connection, mint);
        let peakVirtualSol = startVirtualSol;
        let currentVirtualSol = startVirtualSol;

        const startTime = Date.now();
        const endTime = startTime + (durationSeconds * 1000);

        while (Date.now() < endTime) {
            try {
                currentVirtualSol = await this.getVirtualSolReserves(connection, mint);
                if (currentVirtualSol > peakVirtualSol) {
                    peakVirtualSol = currentVirtualSol;
                }

                // Calculate current growth
                const growthPercentage = Number((currentVirtualSol - startVirtualSol) * 10000n / startVirtualSol) / 100;

                console.log(`📈 Curve Growth: ${growthPercentage.toFixed(2)}% (${Number(currentVirtualSol)/LAMPORTS_PER_SOL} SOL)`);

                await new Promise(resolve => setTimeout(resolve, this.UPDATE_INTERVAL_MS));
            } catch (error) {
                console.error(`Error monitoring curve: ${error}`);
            }
        }

        const growthPercentage = Number((currentVirtualSol - startVirtualSol) * 10000n / startVirtualSol) / 100;

        return {
            startVirtualSol,
            endVirtualSol: currentVirtualSol,
            growthPercentage,
            peakVirtualSol
        };
    }

    private static async getVirtualSolReserves(
        connection: Connection,
        mint: PublicKey
    ): Promise<bigint> {
        const { BondingCurveFetcher } = require('../pumpfun/pumpfun-idl-client');
        const bondingCurve = await BondingCurveFetcher.fetch(connection, mint, false);
        if (!bondingCurve) {
            throw new Error('Bonding curve not found');
        }
        return bondingCurve.virtual_sol_reserves;
    }
}

// ============================================
// PROFIT CALCULATOR
// ============================================

export class ProfitCalculator {
    /**
     * Calculate profit percentage based on buy vs current price
     */
    static calculateProfitPercentage(
        buySolAmount: number,
        currentSolValue: number
    ): number {
        if (buySolAmount <= 0) return 0;
        return ((currentSolValue - buySolAmount) / buySolAmount) * 100;
    }

    /**
     * Calculate expected SOL for selling tokens
     */
    static calculateExpectedSolForTokens(
        virtualSolReserves: bigint,
        virtualTokenReserves: bigint,
        tokenAmount: bigint
    ): bigint {
        return BondingCurveMath.calculateSolForTokens(
            virtualSolReserves,
            virtualTokenReserves,
            tokenAmount
        );
    }

    /**
     * Apply slippage for sell
     */
    static applySlippageForSell(solAmount: bigint, slippageBps: number = 1000): bigint {
        const slippageRate = BigInt(slippageBps);
        const minOutput = (solAmount * (10000n - slippageRate)) / 10000n;
        return minOutput > 0n ? minOutput : 1n;
    }
}

// ============================================
// ATOMIC LAUNCH WITH AUTO-SELL
// ============================================

export async function createCompleteLaunchWithAutoSell(
    connection: Connection,
    request: {
        user_wallet: string;
        metadata: any;
        creator_buy_amount: number;
        bot_buys: Array<{public_key: string, amount_sol: number}>;
        sell_strategy?: SellStrategyConfig;
        use_jito?: boolean;
        slippage_bps?: number;
        use_advanced_sell_strategy?: boolean; // New: enable advanced selling
        launch_id?: string
    }
): Promise<ExecuteBotBuysResponse> {
    try {
        console.log('🚀 ATOMIC LAUNCH WITH AUTO-SELL');
        
        // Step 1: Create token and execute buys (using your existing function)
        const launchResult = await createCompleteLaunchBundle(connection, {
            user_wallet: request.user_wallet,
            metadata: request.metadata,
            creator_buy_amount: request.creator_buy_amount,
            bot_buys: request.bot_buys,
            use_jito: request.use_jito !== false,
            slippage_bps: request.slippage_bps || 500,
            use_advanced_strategy: request.use_advanced_sell_strategy // Pass through
        });

        if (!launchResult.success || !launchResult.mint_address) {
            throw new Error('Token creation failed');
        }

        console.log(`✅ Token launched: ${launchResult.mint_address}`);

        // Step 2: Wait for bonding curve to stabilize
        // await new Promise(resolve => setTimeout(resolve, 5000));
        console.log(`⏳ Waiting 180 seconds for organic growth...`);
        await new Promise(resolve => setTimeout(resolve, 180000)); // 3 MINUTES!

        // Step 3: Execute smart sells
        const mint = new PublicKey(launchResult.mint_address);
        
        // Get creator from bonding curve
        const { BondingCurveFetcher } = require('../pumpfun/pumpfun-idl-client');
        const bondingCurve = await BondingCurveFetcher.fetch(connection, mint, true);
        
        if (!bondingCurve) {
            throw new Error('Failed to fetch bonding curve for sell');
        }

        const sellRequest: BotSellRequest = {
            mint_address: launchResult.mint_address,
            user_wallet: request.user_wallet,
            creator_wallet: bondingCurve.creator.toBase58(),
            bot_wallets: request.bot_buys.map(bot => ({
                public_key: bot.public_key
            })),
            sell_strategy: request.sell_strategy || {
                minProfitPercentage: 30,
                maxHoldTimeSeconds: 60,
                stopLossPercentage: 15,
                staggeredSellDelayMs: 2000,
                partialSellPercentages: [50, 50] // Sell 50%, then remaining 50%
            },
            use_jito: request.use_jito
        };

        console.log(`💰 Starting auto-sell strategy...`);
        
        // Choose which sell function to use based on advanced strategy flag
        let sellResult: SellExecutionResult;
        
        if (request.use_advanced_sell_strategy) {
            sellResult = await executeAdvancedSmartSells(connection, {
                ...sellRequest,
                use_advanced_strategy: true,
                max_monitoring_time: 180000 // 3 minutes monitoring
            });
        } else {
            sellResult = await executeSmartSells(connection, sellRequest);
        }

        // Combine results
        const allSignatures = [
            ...(launchResult.signatures || []),
            ...(sellResult.signatures || [])
        ];

        // Create the response with sell stats included in stats object
        const response: ExecuteBotBuysResponse = {
            success: launchResult.success && sellResult.success,
            mint_address: launchResult.mint_address,
            signatures: allSignatures,
            estimated_cost: launchResult.estimated_cost,
            bundle_id: launchResult.bundle_id,
            error: launchResult.error || sellResult.error,
            stats: {
                // Keep original buy stats
                ...launchResult.stats,
                // Add sell stats as new properties
                sell_stats: sellResult.stats,
                total_sol_received: sellResult.total_sol_received
            } as any, // Use type assertion to allow additional properties
            total_sol_received: sellResult.total_sol_received,
            sell_stats: sellResult.stats
        };

        return response;

    } catch (error: any) {
        console.error(`❌ Atomic launch with auto-sell failed:`, error.message);
        return {
            success: false,
            error: error.message
        };
    }
}
