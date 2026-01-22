import { Connection, Keypair, PublicKey, VersionedTransaction, TransactionMessage, ComputeBudgetProgram } from "@solana/web3.js";
import { BondingCurveFetcher, BondingCurveMath, PUMP_FUN_PROGRAM_ID, PumpFunInstructionBuilder, PumpFunPda } from "../pumpfun/pumpfun-idl-client";
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import axios from "axios";
import bs58 from 'bs58';
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as crypto from 'crypto'
import OAuth from 'oauth-1.0a';
import FormData from "form-data";
import { XOAuth1Client } from './xOAuth1Client';
import * as dotenv from 'dotenv';
dotenv.config();

export interface BotWallet {
    public_key: string;
    private_key: string;
    amount_sol: number;
}

export interface BotSellResult {
    success: boolean;
    signature?: string;
    solReceived?: number;
    error?: string;
}

export interface PhaseResult {
    phase: number;
    botsUsed: number;
    successfulBuys: number;
    totalSolPumped: number;
    estimatedGrowth: number;
    volumeGenerated?: number;
    organicSimulation?: boolean;
    duration?: string;
    exitSignal?: string;
    creatorSold?: boolean;
    botsSold?: number;
    estimatedProfit?: number;
    signatures?: string[];
    actualProfit?: number;
    // New properties for enhanced system
    foundationStrength?: number;
    segments?: SegmentResult[];
    trendingAchieved?: boolean;
    trendingRank?: number;
    holderGrowth?: number;
    strategyUsed?: OrganicStrategyConfig;
    performanceScore?: number;
    marketHealth?: number;
    exitReadiness?: number;
    recommendation?: 'PREPARE_EXIT' | 'CONTINUE_GROWTH';
    exitStrategy?: string;
    recoveryExecuted?: boolean;
    finalHealth?: number;
    organicScore?: number;
}


export interface MarketData {
    priceHistory: number[];
    volumeHistory: number[];
    timeData: number[];
    currentPrice: number;
    trend: 'bullish' | 'bearish' | 'neutral';
    velocity: number;
}

export interface SegmentConfig {
    duration: number;   // in milliseconds
    intensity: number;  // 0.1 to 1.0
    description: string;
    objectives?: string[];
}

export interface SegmentResult {
    duration: number;
    volume: number;
    successfulBuys: number;
    description: string;
    metrics?: {
        priceChange: number;
        holderGrowth: number;
        volumeRatio: number;
    };
    profitabilityScore?: number;
    successfulTrades?: number;
    signatures?: string[];
}

export interface MarketHealth {
    score: number;  // 0-100
    volatility: number;
    buySellRatio: number;
    holderGrowthRate: number;
    liquidityDepth: number;
}

export interface HolderAnalysis {
    realHolders: number;
    suspectedBots: number;
    avgHoldingTime: number; // in minutes
    holderDistribution: Record<string, number>;
    newHoldersLastHour: number;
    newHoldersLast24h: number;
    organicScore: number;
    organicScoreLabel: 'high' | 'medium' | 'low';
    totalHolders: number;
    topHoldersPercentage: number;
    devHoldingsPercentage: number;
    tradingMetrics: {
        hourlyTraders: number;
        hourlyOrganicBuyers: number;
        hourlyNetBuyers: number;
        buySellRatio: number;
    };
    lastUpdated: Date;
}

export interface OrganicStrategyConfig {
    buySizeRange: [number, number];
    sellPercentage: [number, number];
    transactionFrequency: 'LOW' | 'MEDIUM' | 'HIGH' | 'VARIABLE' | 'MEDIUM_HIGH';
    socialActivities: string[];
    narrativeFocus?: string;
}

export interface JupiterTokenData {
    id: string;
    name: string;
    symbol: string;
    holderCount: number | null;
    dev: string | null;
    audit: {
        isSus: boolean;
        mintAuthorityDisabled: boolean;
        freezeAuthorityDisabled: boolean;
        topHoldersPercentage: number;
        devBalancePercentage: number;
        devMigrations: number;
    };
    stats1h: {
        holderChange: number;
        numTraders: number;
        numOrganicBuyers: number;
        numNetBuyers: number;
        buyVolume: number;
        sellVolume: number;
        buyOrganicVolume: number;
        sellOrganicVolume: number;
    };
    stats24h: {
        holderChange: number;
        numTraders: number;
        numOrganicBuyers: number;
        numNetBuyers: number;
    };
    organicScore: number;
    organicScoreLabel: 'high' | 'medium' | 'low';
    updatedAt: string;
}

export interface TokenMetadata {
    name: string;
    symbol: string;
    uri: string;
    image?: string;
    description?: string;
}


// =================================================
// PRODUCTION-READY BOT ORCHESTRATOR
// =================================================

export class AdvancedBotOrchestrator {
    private connection: Connection;
    private userWallet: string;
    private priceHistory: Map<string, {timestamp: number, price: number}[]> = new Map();
    private preparedBots: BotWallet[] = [];
    private trendingProgressCache: Map<string, {
        startTime: number;
        volumeTarget: number;
        currentVolume: number;
        delaysUsed: number[];
    }> = new Map();
    private communityMetrics: Map<string, {
        activities: Array<{
            type: string;
            timestamp: number;
            participants: number;
            volume: number;
            success: boolean;
        }>;
        engagementScore: number;
        lastActivity: number;
    }> = new Map();

    private narrativeTemplates: Map<string, Array<{
        condition: (metrics: any) => boolean;
        template: string;
        channels: string[];
        priority: number;
    }>> = new Map();

    private socialActivityRegistry: Map<string, {
        type: string;
        lastExecuted: number;
        successRate: number;
        totalEngagement: number;
        attempts?: number;
        successes?: number;
    }> = new Map();

    private socialMetrics: {
        totalActivities: number;
        successfulActivities: number;
        totalEngagement: number;
        totalVolume: number;
        averageEngagement: number;
    } = {
        totalActivities: 0,
        successfulActivities: 0,
        totalEngagement: 0,
        totalVolume: 0,
        averageEngagement: 0
    }

    // ENHANCED 2-HOUR PHASE CONFIGURATIONS
    private phases = {
        // Phase 1: Foundation Building (0-30 minutes)
        PHASE_1_FOUNDATION: {
            durationMinutes: 30,
            segments: [
                { 
                    duration: 5 * 60 * 1000, 
                    intensity: 0.8, 
                    description: "Strong opening momentum",
                    objectives: ['volume', 'price_stability']
                },
                { 
                    duration: 10 * 60 * 1000, 
                    intensity: 0.4, 
                    description: "Healthy consolidation",
                    objectives: ['holder_growth', 'liquidity']
                },
                { 
                    duration: 15 * 60 * 1000, 
                    intensity: 0.6, 
                    description: "Building support levels",
                    objectives: ['trending_push', 'organic_growth']
                }
            ],
            targetMarketCap: 10000,
            maxVolatility: 0.3
        },

        // Phase 2: Momentum Building (30-60 minutes)
        PHASE_2_MOMENTUM: {
            durationMinutes: 30,
            trendingTargetRank: 20,
            volumeTargetMultiplier: 3,  // 3x current volume
            communityActivities: [
                'COMMUMITY_BUY_EVENT',
                'TIP_CULTURE',
                'SUPPORT_WALLS'
            ]
        },

        // Phase 3: Organic Growth (60-90 minutes)
        PHASE_3_ORGANIC_GROWTH: {
            durationMinutes: 30,
            holderGrowthTarget: 0.5,
            strategies: {
                AGGRESSIVE_RETAIL_ATTRACTION: {
                    buySizeRange: [0.05, 0.15] as [number, number],
                    sellPercentage: [10, 25] as [number, number],
                    transactionFrequency: 'HIGH' as const, // Changed from 'MEDIUM_HIGH'
                    socialActivities: ['TIP_CULTURE', 'COMMUNITY_EVENTS', 'GIVEAWAYS']
                },
                COMMUNITY_BUILDING: {
                    buySizeRange: [0.1, 0.3] as [number, number],
                    sellPercentage: [5, 15] as [number, number],
                    transactionFrequency: 'MEDIUM' as const,
                    socialActivities: ['SUPPORT_WALLS', 'LEADERBOARDS', 'ACHIEVEMENTS']
                },
                SUSTAINED_GROWTH: {
                    buySizeRange: [0.08, 0.25] as [number, number],
                    sellPercentage: [8, 20] as [number, number],
                    transactionFrequency: 'VARIABLE' as const,
                    socialActivities: ['ORGANIC_DISCUSSION', 'VOTE_EVENTS']
                }
            }
        },

        // Phase 4: Sustained Growth (90-120 minutes)
        PHASE_4_SUSTAINED_GROWTH: {
            durationMinutes: 30,
            performanceThreshold: 60,   // Minimum performance score
            exitReadingWeights: {
                marketHealth: 0.3,
                performance: 0.25,
                holderCount: 0.25,
                liquidityDepth: 0.2
            }
        },

        // Profit extraction remains but with enhanced timing
        PHASE_5_PROFIT_EXTRACTION: {
            durationMinutes: 30,
            exitSignals: ['price_peak', 'volume_stagnation', 'time_threshold', 'profit_target'] as const,
            profitTargets: [0.3, 0.5, 0.8, 1.0] // 30%, 50%, 80%, 100% profit
        }
    };

    private xOAuth1: XOAuth1Client | null = null;

    private oauth: OAuth | null = null;
    
    private metadataCache = new Map<string, TokenMetadata>();
    // Profit tracking
    private profitTracker = {
        totalInvested: 0,
        totalReturned: 0,
        successfulLaunches: 0,
        failedLaunches: 0
    };

    // Monitoring interval
    private monitoringIntervals: NodeJS.Timeout[] = [];


    constructor(connection: Connection, userWallet: string) {
        this.connection = connection;
        this.userWallet = userWallet;
    }

    // ====================================
    // MAIN LAUNCH ORCHESTRATION
    // ====================================

    async execute2HourOrganicLaunch(
        mint: PublicKey,
        botArmy: Array<{public_key: string, amount_sol: number, private_key?: string}>,
        creatorWallet: string,
        totalBudget: number
    ): Promise<{
        success: boolean;
        totalProfit: number;
        roi: number;
        phaseResults: PhaseResult[];
        volumeGenerated: number;
        exitReason: string;
        finalMetrics: {
            marketCap: number;
            realHolders: number;
            trendingRank: number;
            performanceScore: number;
        };
    }> {
        console.log(`🚀 Starting 2-Hour Organic launch for ${mint.toBase58()}`);
        console.log(`💰 Budget: ${totalBudget} SOL | 🤖 Bots: ${botArmy.length}`);
        console.log(`⏰ Timeline: 0-120 minutes`);

        try {
            // Track volume and profit
            let totalVolumeGenerated = 0;
            const phaseResults: PhaseResult[] = [];
            let exitSignal = 'time_threshold';

            console.log(`\n🔍 STEP 1: Checking initial bot balances...`);
            await this.debugBotBalances(botArmy);

            // CRITICAL FIX 2: Ensure bots are properly funded
            console.log(`\n💰 STEP 2: Funding bots...`);
            const fundedBots = await this.ensureBotsAreFunded(botArmy, totalBudget);
            
            if (fundedBots.length === 0) {
                throw new Error('❌ NO BOTS HAVE SUFFICIENT FUNDS - ABORTING');
            }

            // === QUICK FIX: FORCE USING ALL BOTS ===
            if (fundedBots.length < botArmy.length) {
                console.log(`\n⚠️ WARNING: Only ${fundedBots.length}/${botArmy.length} bots funded`);
                console.log(`🔄 QUICK FIX: Adding remaining bots with their current balances`);
                
                // Track which bots are already funded
                const usedAddresses = new Set(fundedBots.map(b => b.public_key));
                let addedCount = 0;
                
                // Check each bot that wasn't funded
                for (const bot of botArmy) {
                    if (!usedAddresses.has(bot.public_key)) {
                        try {
                            const balance = await this.getBotSolBalance(bot.public_key);
                            
                            // Add bot if it has ANY balance (even tiny amounts)
                            if (balance > 0.00001) { // Very low threshold
                                fundedBots.push({
                                    public_key: bot.public_key,
                                    amount_sol: balance, // Use current balance
                                    private_key: bot.private_key
                                });
                                addedCount++;
                                console.log(`  ➕ Added ${bot.public_key.slice(0, 8)}...: ${balance.toFixed(6)} SOL`);
                            } else {
                                console.log(`  ⏭️ Skipped ${bot.public_key.slice(0, 8)}...: ${balance.toFixed(6)} SOL (too low)`);
                            }
                        } catch (error) {
                            console.log(`  ❌ Error checking ${bot.public_key.slice(0, 8)}...: ${error.message}`);
                        }
                    }
                }
                
                console.log(`✅ Added ${addedCount} more bots. Total: ${fundedBots.length}/${botArmy.length}`);
            }
            // === END QUICK FIX ===

            console.log(`\n✅ STEP 3: Preparing bot wallets...`);
            // Prepare bot wallets with private keys
            const preparedBots = await this.prepareBotWallets(fundedBots);
            
            if (preparedBots.length === 0) {
                throw new Error('No prepared bots available');
            }

            // DEBUG: Show final bot status
            console.log(`\n🎯 FINAL BOT STATUS:`);
            console.log(`=======================`);
            for (let i = 0; i < Math.min(10, preparedBots.length); i++) {
                const bot = preparedBots[i];
                try {
                    const balance = await this.getBotSolBalance(bot.public_key);
                    console.log(`Bot ${i+1}: ${bot.public_key.slice(0, 8)}... = ${balance.toFixed(6)} SOL`);
                } catch (error) {
                    console.log(`Bot ${i+1}: ${bot.public_key.slice(0, 8)}... = ERROR`);
                }
            }
            console.log(`=======================\n`);

            // CRITICAL FIX 3: MUCH SMALLER initial token acquisition
            console.log(`\n🛒 STEP 4: Small initial token acquisition...`);
            
            // Adjust initial budget based on number of prepared bots
            const initialBudget = Math.min(
                totalBudget * 0.2, 
                0.1, // MAX 0.1 SOL
                preparedBots.length * 0.001 // Scale with bot count
            );
            
            console.log(`   Using ${initialBudget.toFixed(6)} SOL initial budget for ${preparedBots.length} bots`);
            
            const acquisitionResult = await this.acquireInitialTokensForBots(
                mint, 
                preparedBots, 
                initialBudget
            );
            
            console.log(`✅ Initial acquisition: ${acquisitionResult.successful}/${preparedBots.length} bots, ${acquisitionResult.totalSol.toFixed(6)} SOL`);
            await this.trackBotBalanceChanges(mint, preparedBots, "AFTER INITIAL ACQUISITION");

            // PHASE 1: Foundation Building (0-30 minutes)
            console.log(`\n🎯 PHASE 1: Foundation Building (0-30min)`);
            const phase1Result = await this.executePhase1Foundation(
                mint,
                preparedBots,
                this.phases.PHASE_1_FOUNDATION.durationMinutes
            );
            phaseResults.push({ phase: 1, ...phase1Result });
            totalVolumeGenerated += phase1Result.totalSolPumped;

            await this.trackBotBalanceChanges(mint, preparedBots, "AFTER PHASE 1");

            // Start real-time monitoring
            this.startRealTimeMonitoring(mint, preparedBots, creatorWallet);

            // PHASE 2: Momentum Building (30-60 minutes)
            console.log(`\n📈 PHASE 2: Momentum Building (30-60min)`);
            const phase2Result = await this.executePhase2Momentum(
                mint,
                preparedBots,
                this.phases.PHASE_2_MOMENTUM.durationMinutes
            );
            phaseResults.push({ phase: 2, ...phase2Result });
            totalVolumeGenerated += phase2Result.volumeGenerated || 0;

            await this.trackBotBalanceChanges(mint, preparedBots, "AFTER PHASE 2");

            // PHASE 3: Organic Growth (60-90 minutes)
            console.log(`\n🌱 PHASE 3: Organic Growth (60-90min)`);
            const phase3Result = await this.executePhase3OrganicGrowth(
                mint,
                preparedBots,
                creatorWallet,
                this.phases.PHASE_3_ORGANIC_GROWTH.durationMinutes
            );
            phaseResults.push({ phase: 3, ...phase3Result });
            totalVolumeGenerated += phase3Result.totalSolPumped;

            await this.trackBotBalanceChanges(mint, preparedBots, "AFTER PHASE 3");

            // PHASE 4: Sustained Growth (90-120 minutes)
            console.log('\n⚡ PHASE 4: Sustained Growth (90-120min');
            const phase4Result = await this.executePhase4SustainedGrowth(
                mint,
                preparedBots,
                creatorWallet,
                this.phases.PHASE_4_SUSTAINED_GROWTH.durationMinutes
            );
            phaseResults.push({ phase: 4, ...phase4Result });

            await this.trackBotBalanceChanges(mint, preparedBots, "AFTER PHASE 4");

            // Determine exit strategy
            exitSignal = phase4Result.recommendation === 'PREPARE_EXIT'
                ? 'optimal_exit'
                : 'continue_growth';
            
            // Stop monitoring
            this.stopAllMonitoring();

            // PHASE 5: Profit Extraction
            console.log(`\n💰 PHASE 5: Profit Extraction (${exitSignal})`);
            const phase5Result = await this.executeEnhancedProfitExtraction(
                mint,
                preparedBots,
                creatorWallet,
                exitSignal,
                phase4Result.marketHealth || 0.5
            );
            phaseResults.push({ phase: 5, ...phase5Result });

            await this.trackBotBalanceChanges(mint, preparedBots, "AFTER PHASE 5");

            // Calculate final results
            const totalProfit = phase5Result.estimatedProfit || 0;
            const roi = (totalProfit / totalBudget) * 100;

            // Get final metrics
            const finalMetrics = await this.getFinalMetrics(mint);

            console.log('\n🎉 2-HOUR LAUNCH COMPLETE!');
            console.log(`📊 Final Metrics:`);
            console.log(`   Market Cap: ${finalMetrics.marketCap.toFixed(2)} SOL`);
            console.log(`   Real Holders: ${finalMetrics.realHolders}`);
            console.log(`   TrendingRand: ${finalMetrics.trendingRank}`);
            console.log(`   Performance Score: ${finalMetrics.performanceScore}/100`);
            console.log(`   ROI: ${roi.toFixed(2)}%`);

            return {
                success: true,
                totalProfit,
                roi,
                phaseResults,
                volumeGenerated: totalVolumeGenerated,
                exitReason: exitSignal,
                finalMetrics
            };
        
        } catch (error: any) {
            console.error(`❌ 2-Hour launch failed: ${error.message}`);
            this.stopAllMonitoring();
            this.profitTracker.failedLaunches++;

            return {
                success: false,
                totalProfit: 0,
                roi: -100,
                phaseResults: [],
                volumeGenerated: 0,
                exitReason: 'launch_failed',
                finalMetrics: {
                    marketCap: 0,
                    realHolders: 0,
                    trendingRank: 999,
                    performanceScore: 0
                }
            };
        }
    }

    private async trackBotBalanceChanges(
        mint: PublicKey,
        bots: BotWallet[],
        phaseName: string
    ): Promise<void> {
        console.log(`\n💰 ${phaseName} - BOT BALANCE SNAPSHOT:`);
        console.log(`===================================`);
        
        let totalSol = 0;
        let activeBots = 0;
        
        for (let i = 0; i < Math.min(10, bots.length); i++) {
            const bot = bots[i];
            try {
                const solBalance = await this.getBotSolBalance(bot.public_key);
                const tokenBalance = await this.getBotTokenBalance(mint, bot);
                
                totalSol += solBalance;
                if (solBalance > 0.0001) activeBots++;
                
                console.log(`${i+1}. ${bot.public_key.slice(0, 8)}...:`);
                console.log(`   SOL: ${solBalance.toFixed(6)}`);
                console.log(`   Tokens: ${tokenBalance.toLocaleString()}`);
                
            } catch (error) {
                console.log(`${i+1}. ${bot.public_key.slice(0, 8)}...: ERROR`);
            }
        }
        
        console.log(`\n📊 SUMMARY:`);
        console.log(`Total SOL across ${Math.min(10, bots.length)} bots: ${totalSol.toFixed(6)}`);
        console.log(`Active bots (>0.0001 SOL): ${activeBots}/${Math.min(10, bots.length)}`);
        console.log(`===================================\n`);
    }


    private async ensureBotsAreFunded(
        botArmy: Array<{public_key: string, amount_sol: number, private_key?: string}>,
        totalBudget: number
    ): Promise<Array<{public_key: string, amount_sol: number, private_key?: string}>> {
        console.log(`\n💰 ENSURING BOTS ARE FUNDED:`);
        console.log(`Total Budget: ${totalBudget} SOL`);
        console.log(`Number of Bots: ${botArmy.length}`);
        
        // IMPORTANT: Don't filter out bots - distribute budget evenly!
        // Minimum for each bot to participate
        const MIN_SOL_PER_BOT = 0.002; // Lower minimum to allow more bots
        
        // Calculate how many bots we can afford with minimum funding
        const maxBotsWithMinFunding = Math.min(
            botArmy.length,
            Math.floor(totalBudget / MIN_SOL_PER_BOT)
        );
        
        // CRITICAL FIX: Use ALL bots, but adjust their funding amounts
        console.log(`Can fund ${maxBotsWithMinFunding} bots at minimum ${MIN_SOL_PER_BOT.toFixed(4)} SOL each`);
        
        // Get balances for all bots
        const botsWithBalances = await Promise.all(
            botArmy.map(async (bot) => {
                try {
                    const balance = await this.getBotSolBalance(bot.public_key);
                    return { ...bot, balance };
                } catch (error) {
                    console.error(`Failed to check balance for ${bot.public_key.slice(0, 8)}...: ${error.message}`);
                    return { ...bot, balance: 0 };
                }
            })
        );
        
        // Sort by balance (lowest first) - prioritize funding bots with less SOL
        botsWithBalances.sort((a, b) => a.balance - b.balance);
        
        // Distribute budget evenly among available bots
        const botsToUse = Math.min(maxBotsWithMinFunding, botsWithBalances.length);
        const availableBots = botsWithBalances.slice(0, botsToUse);
        
        console.log(`📊 SELECTED ${availableBots.length} BOTS FOR TRADING:`);
        
        // Calculate equal distribution
        const solPerBot = Math.max(MIN_SOL_PER_BOT, totalBudget / availableBots.length);
        
        const fundedBots: Array<{public_key: string, amount_sol: number, private_key?: string}> = [];
        
        for (let i = 0; i < availableBots.length; i++) {
            const bot = availableBots[i];
            const targetAmount = Math.max(MIN_SOL_PER_BOT, solPerBot);
            
            console.log(`  ${i+1}. ${bot.public_key.slice(0, 8)}...: Current=${bot.balance.toFixed(6)} SOL, Target=${targetAmount.toFixed(6)} SOL`);
            
            // Note: You need to implement actual funding logic here
            // For now, we'll just set the target amount
            fundedBots.push({
                public_key: bot.public_key,
                amount_sol: targetAmount,
                private_key: bot.private_key
            });
        }
        
        console.log(`✅ Prepared ${fundedBots.length} bots for trading`);
        console.log(`💰 Total allocated: ${(fundedBots.length * solPerBot).toFixed(6)} SOL`);
        
        return fundedBots;
    }

    // private async acquireInitialTokensForBots(
    //     mint: PublicKey,
    //     bots: BotWallet[],
    //     budget: number
    // ): Promise<{successful: number; totalSol: number; signatures: string[]}> {
    //     console.log(`   Acquiring initial tokens with ${budget.toFixed(4)} SOL budget for ${bots.length} bots...`);
        
    //     const signatures: string[] = [];
    //     let successful = 0;
    //     let totalSol = 0;
        
    //     // EXTREMELY SMALL buys when we have many bots
    //     const solPerBot = (budget * 0.8) / bots.length; // Use 80% of budget
        
    //     console.log(`   Each bot will use MAX ${solPerBot.toFixed(6)} SOL (average)`);
        
    //     for (let i = 0; i < bots.length; i++) {
    //         const bot = bots[i];
            
    //         try {
    //             const botBalance = await this.getBotSolBalance(bot.public_key);
                
    //             // TINY BUYS: Use only 10-25% of balance
    //             const maxPercentage = 0.1 + (Math.random() * 0.15); // 10-25%
    //             const maxBuy = botBalance * maxPercentage;
                
    //             // Even smaller amount for initial acquisition
    //             // const buyAmount = Math.min(solPerBot, maxBuy, 0.0005); // Absolute max 0.0005 SOL
    //             const buyAmount = this.generateOrganicAmount(botBalance);

                
    //             if (buyAmount < 0.00005) { // Minimum 0.00005 SOL
    //                 console.log(`     ⏭️ Bot ${bot.public_key.slice(0, 8)}... insufficient: ${botBalance.toFixed(6)} SOL`);
    //                 continue;
    //             }
                
    //             console.log(`     🤖 Bot ${bot.public_key.slice(0, 8)}... buying ${buyAmount.toFixed(6)} SOL (${(buyAmount/botBalance*100).toFixed(1)}% of balance)`);
                
    //             const result = await this.executeBotBuy(
    //                 mint,
    //                 bot.public_key,
    //                 bot.private_key,
    //                 buyAmount,
    //                 500
    //             );
                
    //             if (result.success) {
    //                 successful++;
    //                 totalSol += buyAmount;
    //                 if (result.signature) signatures.push(result.signature);
    //             }
                
    //             // Randomized delays (1-3 seconds)
    //             if (i < bots.length - 1) {
    //                 await this.organicTradeDelay();
    //             }
                
    //         } catch (error) {
    //             console.error(`Initial token acquisition error for ${bot.public_key.slice(0, 8)}...: ${error.message}`);
    //         }
    //     }
        
    //     console.log(`   ✅ Initial token acquisition: ${successful}/${bots.length} bots, ${totalSol.toFixed(6)} SOL total`);
        
    //     return { successful, totalSol, signatures };
    // }

    private async acquireInitialTokensForBots(
        mint: PublicKey,
        bots: BotWallet[],
        budget: number
    ): Promise<{successful: number; totalSol: number; signatures: string[]}> {
        console.log(`   Acquiring initial tokens with ${budget.toFixed(4)} SOL budget for ${bots.length} bots...`);
        
        const signatures: string[] = [];
        let successful = 0;
        let totalSol = 0;
        
        // Calculate initial acquisition percentage dynamically
        // For larger budgets, use smaller percentage for initial buys
        const initialPercentage = Math.max(0.005, Math.min(0.02, 0.02 * (5 / budget)));
        const initialBudget = budget * initialPercentage;
        
        console.log(`   Using ${initialPercentage.toFixed(3)}% (${initialBudget.toFixed(6)} SOL) of budget for initial acquisition`);
        
        // Sort bots by balance (lowest first)
        const botsWithBalances = await Promise.all(
            bots.map(async (bot) => {
                try {
                    const balance = await this.getBotSolBalance(bot.public_key);
                    return { bot, balance };
                } catch (error) {
                    return { bot, balance: 0 };
                }
            })
        );
        
        // Filter out bots with insufficient balance
        const eligibleBots = botsWithBalances.filter(({ balance }) => balance > 0.00005);
        eligibleBots.sort((a, b) => a.balance - b.balance);
        
        console.log(`   ${eligibleBots.length}/${bots.length} bots eligible for initial buys`);
        
        // Calculate dynamic initial buy ranges (Phase 0 - pre-launch)
        const phase0Ranges = this.calculateDynamicBuyRanges(budget, eligibleBots.length, 0);
        
        // Batch processing
        const batchSize = Math.max(1, Math.floor(eligibleBots.length / 3));
        
        for (let batch = 0; batch < Math.ceil(eligibleBots.length / batchSize); batch++) {
            const startIdx = batch * batchSize;
            const endIdx = Math.min(startIdx + batchSize, eligibleBots.length);
            const batchBots = eligibleBots.slice(startIdx, endIdx);
            
            console.log(`   Batch ${batch + 1}: ${batchBots.length} bots`);
            
            for (const { bot, balance } of batchBots) {
                try {
                    // Generate dynamic initial buy amount (very small)
                    const buyAmount = this.generateDynamicBuyAmount(
                        balance,
                        0, // Phase 0 for initial acquisition
                        budget,
                        eligibleBots.length
                    );
                    
                    // Extra constraint for initial buys: max 0.0005 SOL
                    const maxInitialBuy = Math.min(0.0005, budget * 0.0001);
                    const finalAmount = Math.min(buyAmount, maxInitialBuy);
                    
                    if (finalAmount < 0.00003) {
                        console.log(`     ⏭️ Bot ${bot.public_key.slice(0, 8)}...: amount too small ${finalAmount.toFixed(6)} SOL`);
                        continue;
                    }
                    
                    console.log(`     🤖 ${bot.public_key.slice(0, 8)}...: ${finalAmount.toFixed(6)} SOL`);
                    
                    const result = await this.executeBotBuy(
                        mint,
                        bot.public_key,
                        bot.private_key,
                        finalAmount,
                        500
                    );
                    
                    if (result.success) {
                        successful++;
                        totalSol += finalAmount;
                        if (result.signature) signatures.push(result.signature);
                    }
                    
                    await this.randomDelay(1000, 3000);
                    
                } catch (error) {
                    console.error(`Initial buy error: ${error.message}`);
                }
            }
            
            // Strategic delay between batches
            if (batch < Math.ceil(eligibleBots.length / batchSize) - 1) {
                await this.randomDelay(5000, 10000);
            }
        }
        
        console.log(`   ✅ Initial acquisition: ${successful}/${eligibleBots.length} bots, ${totalSol.toFixed(6)} SOL`);
        console.log(`   💡 Used ${(totalSol/budget*100).toFixed(2)}% of total budget`);
        
        return { successful, totalSol, signatures };
    }

    private calculateDynamicBuyRanges(
        totalBudget: number,
        botCount: number,
        phase: number
    ): { min: number, max: number, avg: number } {
        // Calculate average SOL per bot
        const avgSolPerBot = totalBudget / botCount;
        
        // Phase multipliers (relative to average bot balance)
        const phaseMultipliers = {
            1: { min: 0.001, max: 0.01 },     // Phase 1: 0.1%-1% of avg balance
            2: { min: 0.005, max: 0.03 },     // Phase 2: 0.5%-3% of avg balance  
            3: { min: 0.01, max: 0.06 },      // Phase 3: 1%-6% of avg balance
            4: { min: 0.02, max: 0.10 },      // Phase 4: 2%-10% of avg balance
        };
        
        // Ensure we have valid values for the phase
        const multiplier = phaseMultipliers[phase as keyof typeof phaseMultipliers] || phaseMultipliers[1];
        
        // Calculate dynamic ranges
        const minBuy = Math.max(0.00005, avgSolPerBot * multiplier.min); // Absolute min 0.00005 SOL
        const maxBuy = Math.min(0.01, avgSolPerBot * multiplier.max);    // Absolute max 0.01 SOL
        
        // Adjust based on total budget (bigger budget = relatively smaller % buys)
        const budgetFactor = Math.min(1, 10 / totalBudget); // Normalize for 10+ SOL budgets
        const adjustedMin = minBuy * budgetFactor;
        const adjustedMax = maxBuy * budgetFactor;
        
        return {
            min: Math.max(0.00005, adjustedMin),
            max: Math.max(adjustedMin * 2, adjustedMax),
            avg: (adjustedMin + adjustedMax) / 2
        };
    }

    private generateDynamicBuyAmount(
        botBalance: number,
        phase: number,
        totalBudget: number,
        botCount: number
    ): number {
        const ranges = this.calculateDynamicBuyRanges(totalBudget, botCount, phase);
        
        // Use a distribution: 70% small buys, 20% medium, 10% large within range
        const random = Math.random();
        let targetPercentage;
        
        if (random < 0.7) {
            // Small buys: lower third of range
            targetPercentage = ranges.min + (Math.random() * (ranges.max - ranges.min) * 0.33);
        } else if (random < 0.9) {
            // Medium buys: middle third of range  
            targetPercentage = ranges.min + (ranges.max - ranges.min) * 0.33 + 
                            (Math.random() * (ranges.max - ranges.min) * 0.33);
        } else {
            // Large buys: upper third of range
            targetPercentage = ranges.min + (ranges.max - ranges.min) * 0.66 + 
                            (Math.random() * (ranges.max - ranges.min) * 0.33);
        }
        
        // Calculate buy amount as percentage of bot balance
        const maxPercentageOfBalance = 0.5; // Never use more than 50% of bot's balance
        const buyAmount = Math.min(
            botBalance * maxPercentageOfBalance,
            targetPercentage
        );
        
        // Ensure minimum and maximum constraints
        const minBuy = Math.max(0.00005, ranges.min * 0.5); // Allow even smaller than min for variety
        const maxBuy = Math.min(0.02, ranges.max * 1.5);   // Allow occasional larger than max
        
        // Apply constraints
        const constrainedAmount = Math.max(minBuy, Math.min(maxBuy, buyAmount));
        
        // Round to natural looking amount
        return this.roundToNaturalAmount(constrainedAmount);
    }

    private generateOrganicAmount(balance: number): number {
        // Common human trading patterns:
        const patterns = [
            // Round numbers (most common)
            () => Math.round(Math.random() * 10) * 0.001, // 0.001, 0.002, ..., 0.01
            () => [0.005, 0.01, 0.02, 0.05, 0.1][Math.floor(Math.random() * 5)],
            // Percentage of balance (varies wildly)
            () => balance * (0.01 + Math.random() * 0.2), // 1%-20% of balance
            // Random small amounts
            () => 0.0001 + Math.random() * 0.001,
        ];
        
        const pattern = patterns[Math.floor(Math.random() * patterns.length)];
        let amount = pattern();
        
        // Ensure it's not too precise
        amount = Math.round(amount * 10000) / 10000; // 4 decimal places max
        
        // Cap at 80% of balance for safety
        return Math.min(amount, balance * 0.8);
        }


    // ====================================
    // PHASE 1: FOUNDATION BUILDING
    // ====================================

    // private async executePhase1Foundation(
    //     mint: PublicKey,
    //     bots: BotWallet[],
    //     durationMinutes: number = 30
    // ): Promise<Omit<PhaseResult, 'phase'>> {
    //     console.log(`🏗️ Phase 1: Foundation Building - ${bots.length} bots trading for ${durationMinutes} minutes`);
        
    //     const startTime = Date.now();
    //     const endTime = startTime + (durationMinutes * 60 * 1000);
        
    //     let successfulBuys = 0;
    //     let successfulSells = 0;
    //     let totalSol = 0;
    //     let totalSellsSol = 0;
    //     const signatures: string[] = [];
        
    //     console.log(`   🤖 ALL ${bots.length} bots will participate in foundation phase`);
        
    //     // Keep track of each bot's activity
    //     const botActivity = new Map<string, {
    //         lastActionTime: number;
    //         buyCount: number;
    //         sellCount: number;
    //         lastAction: 'buy' | 'sell' | null;
    //     }>();
        
    //     // Initialize bot activity tracker
    //     bots.forEach(bot => {
    //         botActivity.set(bot.public_key, {
    //             lastActionTime: 0,
    //             buyCount: 0,
    //             sellCount: 0,
    //             lastAction: null
    //         });
    //     });
        
    //     // PHASE 1A: Initial accumulation (0-10 minutes)
    //     console.log(`\n   📈 Phase 1A: Initial Accumulation (0-10min)`);
    //     const phase1aEnd = startTime + (10 * 60 * 1000);
        
    //     while (Date.now() < phase1aEnd) {
    //         // Pick random bot from ALL bots
    //         const randomBot = bots[Math.floor(Math.random() * bots.length)];
    //         const activity = botActivity.get(randomBot.public_key)!;
            
    //         // Don't let same bot act too frequently (minimum 15 seconds between actions)
    //         if (Date.now() - activity.lastActionTime < 15000) {
    //             await this.randomDelay(500, 1500);
    //             continue;
    //         }
            
    //         // 80% buy, 20% sell in accumulation phase
    //         const isBuy = Math.random() > 0.2;
            
    //         try {
    //             if (isBuy) {
    //                 // BUY - Random amount: 10-40% of balance
    //                 const balance = await this.getBotSolBalance(randomBot.public_key);
    //                 if (balance > 0.0002) {
    //                     const percent = 0.1 + Math.random() * 0.3; // 10-40%
    //                     const buyAmount = balance * percent;
                        
    //                     // Round to natural amounts
    //                     const finalAmount = this.roundToNaturalAmount(buyAmount);
                        
    //                     if (finalAmount >= 0.0001) {
    //                         const result = await this.executeBotBuy(
    //                             mint,
    //                             randomBot.public_key,
    //                             randomBot.private_key,
    //                             finalAmount,
    //                             500
    //                         );
                            
    //                         if (result.success) {
    //                             successfulBuys++;
    //                             totalSol += finalAmount;
    //                             signatures.push(result.signature!);
    //                             activity.lastActionTime = Date.now();
    //                             activity.buyCount++;
    //                             activity.lastAction = 'buy';
                                
    //                             console.log(`     ${randomBot.public_key.slice(0, 8)} bought ${finalAmount.toFixed(6)} SOL (${(percent*100).toFixed(1)}% of ${balance.toFixed(6)} SOL)`);
    //                         }
    //                     }
    //                 }
    //             } else {
    //                 // SELL - Small sells: 3-15% of tokens
    //                 const tokenBalance = await this.getBotTokenBalance(mint, randomBot);
    //                 if (tokenBalance > 0) {
    //                     const percent = 0.03 + Math.random() * 0.12; // 3-15%
    //                     const sellAmount = Math.floor(tokenBalance * percent);
                        
    //                     if (sellAmount > 0) {
    //                         const result = await this.executeSingleSell(mint, randomBot, sellAmount);
                            
    //                         if (result.success) {
    //                             successfulSells++;
    //                             totalSellsSol += result.solReceived || 0;
    //                             signatures.push(result.signature!);
    //                             activity.lastActionTime = Date.now();
    //                             activity.sellCount++;
    //                             activity.lastAction = 'sell';
                                
    //                             console.log(`     ${randomBot.public_key.slice(0, 8)} sold ${(percent * 100).toFixed(2)}% tokens for ${(result.solReceived || 0).toFixed(6)} SOL`);
    //                         }
    //                     }
    //                 }
    //             }
    //         } catch (error) {
    //             // Silent fail - try next bot
    //         }
            
    //         // Random delay: 30–60 seconds
    //         await this.randomDelay(30000, 60000);
    //     }
        
    //     // PHASE 1B: Organic trading (10-25 minutes)
    //     console.log(`\n   🔄 Phase 1B: Organic Trading (10-25min)`);
    //     const phase1bEnd = startTime + (25 * 60 * 1000);
        
    //     while (Date.now() < phase1bEnd) {
    //         // Shuffle bots for more organic feel
    //         const shuffledBots = [...bots].sort(() => Math.random() - 0.5);
            
    //         // Process 2-4 bots in each cycle
    //         const botsThisCycle = shuffledBots.slice(0, 2 + Math.floor(Math.random() * 3));
            
    //         for (const bot of botsThisCycle) {
    //             const activity = botActivity.get(bot.public_key)!;
                
    //             // Don't let same bot act too frequently (minimum 20 seconds between actions)
    //             if (Date.now() - activity.lastActionTime < 20000) {
    //                 continue;
    //             }
                
    //             // 60% buy, 40% sell in organic phase
    //             const isBuy = Math.random() > 0.4;
                
    //             try {
    //                 if (isBuy) {
    //                     // BUY - Smaller amounts: 5-25% of balance
    //                     const balance = await this.getBotSolBalance(bot.public_key);
    //                     if (balance > 0.0002) {
    //                         const percent = 0.05 + Math.random() * 0.2; // 5-25%
    //                         const buyAmount = balance * percent;
                            
    //                         const finalAmount = this.roundToNaturalAmount(buyAmount);
                            
    //                         if (finalAmount >= 0.0001) {
    //                             const result = await this.executeBotBuy(
    //                                 mint,
    //                                 bot.public_key,
    //                                 bot.private_key,
    //                                 finalAmount,
    //                                 500
    //                             );
                                
    //                             if (result.success) {
    //                                 successfulBuys++;
    //                                 totalSol += finalAmount;
    //                                 signatures.push(result.signature!);
    //                                 activity.lastActionTime = Date.now();
    //                                 activity.buyCount++;
    //                                 activity.lastAction = 'buy';
    //                             }
    //                         }
    //                     }
    //                 } else {
    //                     // SELL - Small sells: 2-10% of tokens
    //                     const tokenBalance = await this.getBotTokenBalance(mint, bot);
    //                     if (tokenBalance > 0) {
    //                         const percent = 0.02 + Math.random() * 0.08; // 2-10%
    //                         const sellAmount = Math.floor(tokenBalance * percent);
                            
    //                         if (sellAmount > 0) {
    //                             const result = await this.executeSingleSell(mint, bot, sellAmount);
                                
    //                             if (result.success) {
    //                                 successfulSells++;
    //                                 totalSellsSol += result.solReceived || 0;
    //                                 signatures.push(result.signature!);
    //                                 activity.lastActionTime = Date.now();
    //                                 activity.sellCount++;
    //                                 activity.lastAction = 'sell';
    //                             }
    //                         }
    //                     }
    //                 }
    //             } catch (error) {
    //                 // Silent fail
    //             }
                
    //             // Small delay between bots in same cycle
    //             await this.randomDelay(1000, 3000);
    //         }
            
    //         // Delay between cycles: 10-25 seconds
    //         await this.randomDelay(10000, 25000);
    //     }
        
    //     // PHASE 1C: Consolidation (25-30 minutes)
    //     console.log(`\n   ⚖️ Phase 1C: Consolidation (25-30min)`);
        
    //     while (Date.now() < endTime) {
    //         // Pick random bot
    //         const randomBot = bots[Math.floor(Math.random() * bots.length)];
    //         const activity = botActivity.get(randomBot.public_key)!;
            
    //         // Don't let same bot act too frequently (minimum 30 seconds between actions)
    //         if (Date.now() - activity.lastActionTime < 30000) {
    //             await this.randomDelay(2000, 5000);
    //             continue;
    //         }
            
    //         // 50% buy, 50% sell in consolidation phase
    //         const isBuy = Math.random() > 0.5;
            
    //         try {
    //             if (isBuy) {
    //                 // BUY - Very small amounts: 2-15% of balance
    //                 const balance = await this.getBotSolBalance(randomBot.public_key);
    //                 if (balance > 0.0002) {
    //                     const percent = 0.02 + Math.random() * 0.13; // 2-15%
    //                     const buyAmount = balance * percent;
                        
    //                     const finalAmount = this.roundToNaturalAmount(buyAmount);
                        
    //                     if (finalAmount >= 0.0001) {
    //                         const result = await this.executeBotBuy(
    //                             mint,
    //                             randomBot.public_key,
    //                             randomBot.private_key,
    //                             finalAmount,
    //                             500
    //                         );
                            
    //                         if (result.success) {
    //                             successfulBuys++;
    //                             totalSol += finalAmount;
    //                             signatures.push(result.signature!);
    //                             activity.lastActionTime = Date.now();
    //                             activity.buyCount++;
    //                             activity.lastAction = 'buy';
    //                         }
    //                     }
    //                 }
    //             } else {
    //                 // SELL - Small sells: 1-8% of tokens
    //                 const tokenBalance = await this.getBotTokenBalance(mint, randomBot);
    //                 if (tokenBalance > 0) {
    //                     const percent = 0.01 + Math.random() * 0.07; // 1-8%
    //                     const sellAmount = Math.floor(tokenBalance * percent);
                        
    //                     if (sellAmount > 0) {
    //                         const result = await this.executeSingleSell(mint, randomBot, sellAmount);
                            
    //                         if (result.success) {
    //                             successfulSells++;
    //                             totalSellsSol += result.solReceived || 0;
    //                             signatures.push(result.signature!);
    //                             activity.lastActionTime = Date.now();
    //                             activity.sellCount++;
    //                             activity.lastAction = 'sell';
    //                         }
    //                     }
    //                 }
    //             }
    //         } catch (error) {
    //             // Silent fail
    //         }
            
    //         // Longer delays in consolidation: 15-35 seconds
    //         await this.randomDelay(15000, 35000);
    //     }
        
    //     // Calculate bot participation stats
    //     let botsThatBought = 0;
    //     let botsThatSold = 0;
    //     let totalBotsActive = 0;
        
    //     botActivity.forEach(activity => {
    //         if (activity.buyCount > 0) botsThatBought++;
    //         if (activity.sellCount > 0) botsThatSold++;
    //         if (activity.buyCount > 0 || activity.sellCount > 0) totalBotsActive++;
    //     });
        
    //     console.log(`\n   📊 Phase 1 Complete:`);
    //     console.log(`       Active bots: ${totalBotsActive}/${bots.length}`);
    //     console.log(`       Bots that bought: ${botsThatBought}`);
    //     console.log(`       Bots that sold: ${botsThatSold}`);
    //     console.log(`       Total buys: ${successfulBuys}`);
    //     console.log(`       Total sells: ${successfulSells}`);
    //     console.log(`       Buy/Sell Ratio: ${(successfulBuys / Math.max(1, successfulSells)).toFixed(2)}:1`);
    //     console.log(`       Total SOL bought: ${totalSol.toFixed(6)}`);
    //     console.log(`       Total SOL sold: ${totalSellsSol.toFixed(6)}`);
    //     console.log(`       Net SOL inflow: ${(totalSol - totalSellsSol).toFixed(6)}`);
        
    //     const foundationStrength = await this.assessFoundationStrength(mint);
    //     const estimatedGrowth = await this.calculateGrowthPercentage(mint);
        
    //     return {
    //         botsUsed: bots.length,
    //         successfulBuys: successfulBuys + successfulSells,
    //         totalSolPumped: totalSol,
    //         estimatedGrowth,
    //         duration: `${durationMinutes} minutes`,
    //         foundationStrength,
    //         signatures,
    //         organicScore: Math.min(100, (successfulSells / Math.max(1, successfulBuys)) * 100 * 2)
    //     };
    // }

    private async executePhase1Foundation(
        mint: PublicKey,
        bots: BotWallet[],
        durationMinutes: number = 30,
        totalBudget?: number // Add total budget parameter
    ): Promise<Omit<PhaseResult, 'phase'>> {
        console.log(`🏗️ Phase 1: Foundation Building - ${bots.length} bots trading for ${durationMinutes} minutes`);
        
        const startTime = Date.now();
        const endTime = startTime + (durationMinutes * 60 * 1000);
        
        // Use passed totalBudget or calculate from bots
        const actualTotalBudget = totalBudget || await this.calculateTotalBotBudget(bots);
        
        let successfulBuys = 0;
        let successfulSells = 0;
        let totalSol = 0;
        let totalSellsSol = 0;
        const signatures: string[] = [];
        
        // Get dynamic buy ranges for Phase 1
        const phase1Ranges = this.calculateDynamicBuyRanges(actualTotalBudget, bots.length, 1);
        console.log(`   Phase 1 dynamic ranges: ${phase1Ranges.min.toFixed(6)} - ${phase1Ranges.max.toFixed(6)} SOL per buy`);
        
        // Track bot activity with dynamic thresholds
        const botActivity = new Map<string, {
            buyCount: number;
            lastBuyTime: number;
            totalSpent: number;
            avgBuySize: number;
        }>();
        
        bots.forEach(bot => {
            botActivity.set(bot.public_key, {
                buyCount: 0,
                lastBuyTime: 0,
                totalSpent: 0,
                avgBuySize: 0
            });
        });
        
        // Calculate dynamic timing based on budget and bot count
        const baseDelay = Math.max(15000, Math.min(60000, 30000 * (10 / actualTotalBudget)));
        const minDelay = baseDelay * 0.5;
        const maxDelay = baseDelay * 1.5;
        
        console.log(`   Dynamic timing: ${Math.round(minDelay/1000)}-${Math.round(maxDelay/1000)}s between actions`);
        
        while (Date.now() < endTime) {
            // Select bot with weighted probability (bots that have spent less get priority)
            const selectedBot = this.selectBotWithWeightedProbability(bots, botActivity);
            const activity = botActivity.get(selectedBot.public_key)!;
            
            // Dynamic cooldown based on recent activity
            const cooldown = Math.max(10000, 30000 - (activity.buyCount * 5000));
            if (Date.now() - activity.lastBuyTime < cooldown) {
                await this.randomDelay(2000, 5000);
                continue;
            }
            
            // Dynamic buy/sell ratio: start with more buys, gradually increase sells
            const elapsedRatio = (Date.now() - startTime) / (endTime - startTime);
            const buyProbability = 0.8 - (elapsedRatio * 0.3); // 80% → 50% over time
            
            const isBuy = Math.random() < buyProbability;
            
            try {
                if (isBuy) {
                    const balance = await this.getBotSolBalance(selectedBot.public_key);
                    
                    if (balance > phase1Ranges.min * 2) { // Need at least 2x min buy amount
                        // Generate dynamic buy amount
                        const buyAmount = this.generateDynamicBuyAmount(
                            balance,
                            1, // Phase 1
                            actualTotalBudget,
                            bots.length
                        );
                        
                        // Adjust based on bot's past activity (bots that spent less can spend more)
                        const spentRatio = activity.totalSpent / (actualTotalBudget / bots.length);
                        const adjustedAmount = buyAmount * (1 - Math.min(0.5, spentRatio));
                        
                        const finalAmount = Math.max(phase1Ranges.min, Math.min(phase1Ranges.max, adjustedAmount));
                        
                        const result = await this.executeBotBuy(
                            mint,
                            selectedBot.public_key,
                            selectedBot.private_key,
                            finalAmount,
                            500
                        );
                        
                        if (result.success) {
                            successfulBuys++;
                            totalSol += finalAmount;
                            signatures.push(result.signature!);
                            
                            // Update activity tracker
                            activity.buyCount++;
                            activity.lastBuyTime = Date.now();
                            activity.totalSpent += finalAmount;
                            activity.avgBuySize = (activity.avgBuySize * (activity.buyCount - 1) + finalAmount) / activity.buyCount;
                            
                            // Log with size indicator
                            const sizeIndicator = finalAmount < phase1Ranges.avg ? "↪️" : "📥";
                            console.log(`     ${sizeIndicator} ${selectedBot.public_key.slice(0, 8)}...: ${finalAmount.toFixed(6)} SOL`);
                        }
                    }
                } else {
                    // SELL: Dynamic sell amounts
                    const tokenBalance = await this.getBotTokenBalance(mint, selectedBot);
                    
                    if (tokenBalance > 100) { // Minimum token threshold
                        // Sell 0.5-3% of tokens in Phase 1
                        const sellPercentage = 0.005 + (Math.random() * 0.025);
                        const sellAmount = Math.floor(tokenBalance * sellPercentage);
                        
                        if (sellAmount > 0) {
                            const result = await this.executeSingleSell(mint, selectedBot, sellAmount);
                            
                            if (result.success) {
                                successfulSells++;
                                totalSellsSol += result.solReceived || 0;
                                signatures.push(result.signature!);
                                
                                console.log(`     💎 ${selectedBot.public_key.slice(0, 8)}...: sold ${(sellPercentage * 100).toFixed(1)}% tokens`);
                            }
                        }
                    }
                }
            } catch (error) {
                // Silent fail
            }
            
            // Dynamic delay based on progress
            const progress = (Date.now() - startTime) / (endTime - startTime);
            const progressFactor = 1 + (progress * 0.5); // Increase delay as phase progresses
            const currentDelay = this.randomBetween(minDelay * progressFactor, maxDelay * progressFactor);
            
            await new Promise(resolve => setTimeout(resolve, currentDelay));
        }
        
        // Calculate and log phase statistics
        const avgBuySize = successfulBuys > 0 ? totalSol / successfulBuys : 0;
        const botsThatTraded = Array.from(botActivity.values()).filter(a => a.buyCount > 0).length;
        
        console.log(`\n   📊 Phase 1 Complete:`);
        console.log(`       Active bots: ${botsThatTraded}/${bots.length}`);
        console.log(`       Avg buy size: ${avgBuySize.toFixed(6)} SOL`);
        console.log(`       Target range: ${phase1Ranges.min.toFixed(6)}-${phase1Ranges.max.toFixed(6)} SOL`);
        console.log(`       Net SOL: ${(totalSol - totalSellsSol).toFixed(6)}`);
        
        return {
            botsUsed: bots.length,
            successfulBuys: successfulBuys + successfulSells,
            totalSolPumped: totalSol,
            estimatedGrowth: Math.min(30, (totalSol / actualTotalBudget) * 100),
            duration: `${durationMinutes} minutes`,
            signatures,
            organicScore: Math.min(100, (successfulSells / Math.max(1, successfulBuys)) * 150)
        };
    }

    private async calculateTotalBotBudget(bots: BotWallet[]): Promise<number> {
        let total = 0;
        for (const bot of bots) {
            try {
                const balance = await this.getBotSolBalance(bot.public_key);
                total += balance;
            } catch {
                // Skip errors
            }
        }
        return total;
    }

    private selectBotWithWeightedProbability(
        bots: BotWallet[], 
        activity: Map<string, any>
    ): BotWallet {
        // Create weights based on activity (less active bots have higher weight)
        const weights = bots.map(bot => {
            const botActivity = activity.get(bot.public_key);
            if (!botActivity || botActivity.buyCount === 0) return 10; // Never traded
            return 1 / (botActivity.buyCount + 1); // More trades = lower weight
        });
        
        // Normalize weights
        const totalWeight = weights.reduce((sum, w) => sum + w, 0);
        const normalizedWeights = weights.map(w => w / totalWeight);
        
        // Select based on weights
        const random = Math.random();
        let cumulative = 0;
        
        for (let i = 0; i < bots.length; i++) {
            cumulative += normalizedWeights[i];
            if (random <= cumulative) {
                return bots[i];
            }
        }
        
        return bots[bots.length - 1]; // Fallback
    }

    private randomBetween(min: number, max: number): number {
        return min + Math.random() * (max - min);
    }

    private async debugBotBalances(
        bots: Array<{public_key: string, amount_sol: number, private_key?: string}> | BotWallet[]
    ): Promise<void> {
        console.log(`\n🔍 DEBUGGING BOT BALANCES:`);
        console.log(`===============================`);
        
        let totalBalance = 0;
        
        for (let i = 0; i < bots.length; i++) {
            const bot = bots[i];
            try {
                const solBalance = await this.getBotSolBalance(bot.public_key);
                totalBalance += solBalance;
                
                console.log(`Bot ${i+1}: ${bot.public_key.slice(0, 8)}...`);
                console.log(`  SOL Balance: ${solBalance.toFixed(6)} SOL`);
                console.log(`  Has PK: ${!!bot.private_key}`);
                
                if ('amount_sol' in bot) {
                    console.log(`  Budget: ${bot.amount_sol.toFixed(6)} SOL`);
                }
                
                if (solBalance < 0.001) {
                    console.log(`  ⚠️ LOW BALANCE`);
                } else if (solBalance < 0.005) {
                    console.log(`  ✅ OK (Can trade small amounts)`);
                } else {
                    console.log(`  ✅ GOOD (Can trade)`);
                }
                
            } catch (error) {
                console.log(`Bot ${i+1}: ERROR - ${error.message}`);
            }
        }
        
        console.log(`📊 TOTAL BALANCE: ${totalBalance.toFixed(6)} SOL across ${bots.length} bots`);
        console.log(`📊 AVERAGE: ${(totalBalance / bots.length).toFixed(6)} SOL per bot`);
        console.log(`===============================\n`);
    }


    // ====================================
    // PHASE 2: MOMENTUM BUILDING
    // ====================================

    private async executePhase2Momentum(
        mint: PublicKey,
        bots: BotWallet[],
        durationMinutes: number = 30,
        totalBudget?: number
    ): Promise<Omit<PhaseResult, 'phase'>> {
        console.log(`\n📈 Phase 2: Momentum Building - ${bots.length} bots trading for ${durationMinutes} minutes`);
        
        const startTime = Date.now();
        const endTime = startTime + (durationMinutes * 60 * 1000);
        
        let successfulBuys = 0;
        let successfulSells = 0;
        let totalSol = 0;
        let totalSellsSol = 0;
        const signatures: string[] = [];
        
        console.log(`   🚀 ALL ${bots.length} bots creating momentum`);
        
        // Keep track of each bot's activity
        const botActivity = new Map<string, {
            momentumBuys: number;
            momentumSells: number;
            lastActionTime: number;
        }>();
        
        // Initialize tracker
        bots.forEach(bot => {
            botActivity.set(bot.public_key, {
                momentumBuys: 0,
                momentumSells: 0,
                lastActionTime: 0
            });
        });
        
        // Split into 5-minute segments
        const segmentDuration = 5 * 60 * 1000;
        let segmentStart = startTime;
        let segmentCount = 0;
        
        while (Date.now() < endTime) {
            segmentCount++;
            const segmentEnd = Math.min(segmentStart + segmentDuration, endTime);
            
            console.log(`\n   ⏱️ Momentum Segment ${segmentCount} (${Math.round((segmentEnd - Date.now())/1000)}s remaining)`);
            
            // Shuffle bots for each segment
            const shuffledBots = [...bots].sort(() => Math.random() - 0.5);
            
            // Process ALL bots in this segment
            for (const bot of shuffledBots) {
                if (Date.now() >= segmentEnd) break;
                
                const activity = botActivity.get(bot.public_key)!;
                
                // Don't let same bot act too frequently (minimum 10 seconds in momentum phase)
                if (Date.now() - activity.lastActionTime < 10000) {
                    continue;
                }
                
                // Momentum phase: 75% buy, 25% sell
                const isBuy = Math.random() > 0.25;
                
                try {
                    if (isBuy) {
                        // MOMENTUM BUY - Larger amounts: 15-50% of balance
                        const balance = await this.getBotSolBalance(bot.public_key);
                        if (balance > 0.0002) {
                            const percent = 0.15 + Math.random() * 0.35; // 15-50%
                            const buyAmount = balance * percent;
                            
                            const finalAmount = this.roundToNaturalAmount(buyAmount);
                            
                            if (finalAmount >= 0.0001) {
                                const result = await this.executeBotBuy(
                                    mint,
                                    bot.public_key,
                                    bot.private_key,
                                    finalAmount,
                                    500
                                );
                                
                                if (result.success) {
                                    successfulBuys++;
                                    totalSol += finalAmount;
                                    signatures.push(result.signature!);
                                    activity.momentumBuys++;
                                    activity.lastActionTime = Date.now();
                                    
                                    // Log larger momentum buys
                                    if (finalAmount > 0.001) {
                                        console.log(`     💪 ${bot.public_key.slice(0, 8)} momentum buy: ${finalAmount.toFixed(6)} SOL`);
                                    }
                                }
                            }
                        }
                    } else {
                        // MOMENTUM SELL - Small profit taking: 2-12% of tokens
                        const tokenBalance = await this.getBotTokenBalance(mint, bot);
                        if (tokenBalance > 0) {
                            const percent = 0.02 + Math.random() * 0.10; // 2-12%
                            const sellAmount = Math.floor(tokenBalance * percent);
                            
                            if (sellAmount > 0) {
                                const result = await this.executeSingleSell(mint, bot, sellAmount);
                                
                                if (result.success) {
                                    successfulSells++;
                                    totalSellsSol += result.solReceived || 0;
                                    signatures.push(result.signature!);
                                    activity.momentumSells++;
                                    activity.lastActionTime = Date.now();
                                }
                            }
                        }
                    }
                } catch (error) {
                    // Silent fail
                }
                
                // Faster pace in momentum phase: 2-6 seconds between bot actions
                if (Date.now() < segmentEnd) {
                    await this.randomDelay(20000, 30000);
                }
            }
            
            // Break between segments: 30–60 seconds
            if (Date.now() < segmentEnd) {
                await this.randomDelay(30000, 60000);
            }
            
            segmentStart = segmentEnd;
        }
        
        // Calculate momentum stats
        let botsWithMomentumBuys = 0;
        let botsWithMomentumSells = 0;
        
        botActivity.forEach(activity => {
            if (activity.momentumBuys > 0) botsWithMomentumBuys++;
            if (activity.momentumSells > 0) botsWithMomentumSells++;
        });
        
        console.log(`\n   📊 Phase 2 Complete:`);
        console.log(`       Momentum buys: ${successfulBuys}`);
        console.log(`       Momentum sells: ${successfulSells}`);
        console.log(`       Bots with momentum buys: ${botsWithMomentumBuys}/${bots.length}`);
        console.log(`       Bots with momentum sells: ${botsWithMomentumSells}/${bots.length}`);
        console.log(`       Total SOL momentum: ${totalSol.toFixed(6)}`);
        console.log(`       Volume generated: ${(totalSol + totalSellsSol).toFixed(6)} SOL`);
        
        return {
            botsUsed: bots.length,
            successfulBuys: successfulBuys + successfulSells,
            totalSolPumped: totalSol,
            estimatedGrowth: Math.min(100, totalSol * 15),
            duration: `${durationMinutes} minutes`,
            volumeGenerated: totalSol + totalSellsSol,
            signatures
        };
    }

    // ====================================
    // PHASE 3: ORGANIC GROWTH
    // ====================================

    private async executePhase3OrganicGrowth(
        mint: PublicKey,
        bots: BotWallet[],
        creatorWallet: string,
        durationMinutes: number = 30
    ): Promise<Omit<PhaseResult, 'phase'>> {
        console.log(`\n🌱 Phase 3: Organic Growth - ${bots.length} bots trading for ${durationMinutes} minutes`);
        
        const startTime = Date.now();
        const endTime = startTime + (durationMinutes * 60 * 1000);
        
        let successfulBuys = 0;
        let successfulSells = 0;
        let totalSol = 0;
        let totalSellsSol = 0;
        const signatures: string[] = [];
        
        console.log(`   🌿 ALL ${bots.length} bots simulating organic growth`);
        
        // Split into 3 parts
        const partDuration = (durationMinutes * 60 * 1000) / 3;
        
        // PART 1: Early organic growth (0-10min)
        console.log(`\n   📊 Part 1: Early Growth (0-10min)`);
        const part1End = startTime + partDuration;
        
        while (Date.now() < part1End) {
            // Random bot selection
            const randomBot = bots[Math.floor(Math.random() * bots.length)];
            
            // 70% buy, 30% sell
            const isBuy = Math.random() > 0.3;
            
            try {
                if (isBuy) {
                    const balance = await this.getBotSolBalance(randomBot.public_key);
                    if (balance > 0.0002) {
                        const percent = 0.08 + Math.random() * 0.22; // 8-30%
                        const buyAmount = balance * percent;
                        const finalAmount = this.roundToNaturalAmount(buyAmount);
                        
                        if (finalAmount >= 0.0001) {
                            const result = await this.executeBotBuy(
                                mint,
                                randomBot.public_key,
                                randomBot.private_key,
                                finalAmount,
                                500
                            );
                            
                            if (result.success) {
                                successfulBuys++;
                                totalSol += finalAmount;
                                signatures.push(result.signature!);
                            }
                        }
                    }
                } else {
                    const tokenBalance = await this.getBotTokenBalance(mint, randomBot);
                    if (tokenBalance > 0) {
                        const percent = 0.03 + Math.random() * 0.12; // 3-15%
                        const sellAmount = Math.floor(tokenBalance * percent);
                        
                        if (sellAmount > 0) {
                            const result = await this.executeSingleSell(mint, randomBot, sellAmount);
                            
                            if (result.success) {
                                successfulSells++;
                                totalSellsSol += result.solReceived || 0;
                                signatures.push(result.signature!);
                            }
                        }
                    }
                }
            } catch (error) {
                // Silent fail
            }
            
            await this.randomDelay(8000, 20000);
        }
        
        // PART 2: Mid-phase consolidation (10-20min)
        console.log(`\n   ⚖️ Part 2: Consolidation (10-20min)`);
        const part2End = startTime + (partDuration * 2);
        
        while (Date.now() < part2End) {
            // Process 2-3 bots at a time
            const batchSize = 2 + Math.floor(Math.random() * 2);
            const batchBots = this.selectRandomBots(bots, batchSize / bots.length);
            
            for (const bot of batchBots) {
                // 50% buy, 50% sell in consolidation
                const isBuy = Math.random() > 0.5;
                
                try {
                    if (isBuy) {
                        const balance = await this.getBotSolBalance(bot.public_key);
                        if (balance > 0.0002) {
                            const percent = 0.04 + Math.random() * 0.16; // 4-20%
                            const buyAmount = balance * percent;
                            const finalAmount = this.roundToNaturalAmount(buyAmount);
                            
                            if (finalAmount >= 0.0001) {
                                const result = await this.executeBotBuy(
                                    mint,
                                    bot.public_key,
                                    bot.private_key,
                                    finalAmount,
                                    500
                                );
                                
                                if (result.success) {
                                    successfulBuys++;
                                    totalSol += finalAmount;
                                    signatures.push(result.signature!);
                                }
                            }
                        }
                    } else {
                        const tokenBalance = await this.getBotTokenBalance(mint, bot);
                        if (tokenBalance > 0) {
                            const percent = 0.05 + Math.random() * 0.15; // 5-20%
                            const sellAmount = Math.floor(tokenBalance * percent);
                            
                            if (sellAmount > 0) {
                                const result = await this.executeSingleSell(mint, bot, sellAmount);
                                
                                if (result.success) {
                                    successfulSells++;
                                    totalSellsSol += result.solReceived || 0;
                                    signatures.push(result.signature!);
                                }
                            }
                        }
                    }
                } catch (error) {
                    // Silent fail
                }
                
                await this.randomDelay(30000, 60000);
            }
            
            await this.randomDelay(15000, 30000);
        }
        
        // PART 3: Late growth (20-30min)
        console.log(`\n   📈 Part 3: Late Growth (20-30min)`);
        
        while (Date.now() < endTime) {
            // Random bot
            const randomBot = bots[Math.floor(Math.random() * bots.length)];
            
            // 60% buy, 40% sell
            const isBuy = Math.random() > 0.4;
            
            try {
                if (isBuy) {
                    const balance = await this.getBotSolBalance(randomBot.public_key);
                    if (balance > 0.0002) {
                        const percent = 0.06 + Math.random() * 0.24; // 6-30%
                        const buyAmount = balance * percent;
                        const finalAmount = this.roundToNaturalAmount(buyAmount);
                        
                        if (finalAmount >= 0.0001) {
                            const result = await this.executeBotBuy(
                                mint,
                                randomBot.public_key,
                                randomBot.private_key,
                                finalAmount,
                                500
                            );
                            
                            if (result.success) {
                                successfulBuys++;
                                totalSol += finalAmount;
                                signatures.push(result.signature!);
                            }
                        }
                    }
                } else {
                    const tokenBalance = await this.getBotTokenBalance(mint, randomBot);
                    if (tokenBalance > 0) {
                        const percent = 0.04 + Math.random() * 0.11; // 4-15%
                        const sellAmount = Math.floor(tokenBalance * percent);
                        
                        if (sellAmount > 0) {
                            const result = await this.executeSingleSell(mint, randomBot, sellAmount);
                            
                            if (result.success) {
                                successfulSells++;
                                totalSellsSol += result.solReceived || 0;
                                signatures.push(result.signature!);
                            }
                        }
                    }
                }
            } catch (error) {
                // Silent fail
            }
            
            await this.randomDelay(10000, 25000);
        }
        
        console.log(`\n   📊 Phase 3 Complete:`);
        console.log(`       Organic buys: ${successfulBuys}`);
        console.log(`       Organic sells: ${successfulSells}`);
        console.log(`       Buy/Sell Ratio: ${(successfulBuys / Math.max(1, successfulSells)).toFixed(2)}:1`);
        console.log(`       Total SOL volume: ${(totalSol + totalSellsSol).toFixed(6)}`);
        
        return {
            botsUsed: bots.length,
            successfulBuys: successfulBuys + successfulSells,
            totalSolPumped: totalSol,
            estimatedGrowth: Math.min(80, totalSol * 12),
            duration: `${durationMinutes} minutes`,
            organicSimulation: true,
            signatures,
            holderGrowth: Math.floor(successfulBuys * 0.3) // Estimate new holders
        };
    }


    private roundToNaturalAmount(amount: number): number {
        // Humans trade in natural increments, not precise decimals
        
        if (amount < 0.0001) {
            // Very small amounts: round to 6 decimals
            return Math.round(amount * 1000000) / 1000000;
        } else if (amount < 0.001) {
            // Small amounts: round to 5 decimals
            return Math.round(amount * 100000) / 100000;
        } else if (amount < 0.01) {
            // Medium amounts: round to 4 decimals
            return Math.round(amount * 10000) / 10000;
        } else {
            // Larger amounts: round to 3 decimals
            return Math.round(amount * 1000) / 1000;
        }
    }

    // ====================================
    // PHASE 4: SUSTAINED GROWTH
    // ====================================
    private async executePhase4SustainedGrowth(
        mint: PublicKey,
        bots: BotWallet[],
        creatorWallet: string,
        durationMinutes: number = 30
    ): Promise<Omit<PhaseResult, 'phase'>> {
        console.log(`⚡ Sustaining growth for ${durationMinutes} minutes`);

        // Performance assessment
        const performance = await this.assessPerformance(mint, {
            startTime: Date.now() - (90 * 60 * 1000),
            metrics: ['price_stability', 'holder_growth', 'volume_consistency', 'market_health']
        });

        console.log(`   📈 Performance Score: ${performance.score}/100`);

        if (performance.score < this.phases.PHASE_4_SUSTAINED_GROWTH.performanceThreshold) {
            console.log(`   ⚠️ Suboptimal performance, executing recovery strategy`);
            return await this.executeRecoveryStrategy(mint, bots, creatorWallet, durationMinutes);
        }

        // Execute sustained growth with exit preparation
        const segments = this.createSustainedSegments(durationMinutes);
        const results: SegmentResult[] = []; // Fixed: added type annotation
        let totalVolume = 0;
        let successfulTrades = 0;

        for (const segment of segments) {
            const segmentResult = await this.executeSustainedSegment(
                mint,
                bots,
                segment,
                performance
            );

            results.push(segmentResult);
            totalVolume += segmentResult.volume;
            successfulTrades += segmentResult.successfulBuys;

            // Gradual profit taking if conditions are right
            if (segmentResult.profitabilityScore && segmentResult.profitabilityScore > 0.7) {
                await this.executeGradualProfitTake(
                    mint,
                    bots.slice(0, Math.floor(bots.length * 0.25)),
                    {
                        percentage: [15, 30] as [number, number],
                        delayBetween: [45000, 120000]
                    }
                );
            }
        }

        // Final market health check
        const marketHealth = await this.analyzeMarketHealth(mint);
        const holderCount = await this.countRealHolders(mint, bots.map(b => b.public_key), creatorWallet);
        const liquidityDepth = await this.getLiquidityDepth(mint);

        const exitReadiness = this.calculateExitReadiness({
            marketHealth: marketHealth.score / 100, // Fixed typo: markethealth -> marketHealth
            performance: performance.score / 100,
            holderCount: Math.min(holderCount / 100, 1),
            liquidityDepth
        });

        const recommendation = exitReadiness > 0.7 ? 'PREPARE_EXIT' : 'CONTINUE_GROWTH';

        return {
            botsUsed: bots.length,
            successfulBuys: successfulTrades,
            totalSolPumped: totalVolume,
            estimatedGrowth: performance.score * 0.5,
            duration: `${durationMinutes} minutes`,
            segments: results,
            performanceScore: performance.score,
            marketHealth: marketHealth.score,
            exitReadiness,
            recommendation
        };
    }

    // ====================================
    // ENHANCED PROFIT EXTRACTION
    // ====================================
    private async executeEnhancedProfitExtraction(
        mint: PublicKey,
        bots: BotWallet[],
        creatorWallet: string,
        exitSignal: string,
        marketHealth: number
    ): Promise<Omit<PhaseResult, 'phase'>> {
        console.log(`💰 Enhanced Profit Extraction (Signal: ${exitSignal})`);

        const sellStrategy = this.determineEnhancedSellStrategy(exitSignal, marketHealth);

        let totalProfit = 0;
        let successfulSells = 0;
        const signatures: string[] = [];

        // 1. Creator gradual exit
        console.log(`   👑 Creator executing ${sellStrategy.creatorWaves}-wave exit...`);
        for (let wave = 0; wave < sellStrategy.creatorWaves; wave++) {
            const wavePercentage = sellStrategy.creatorPercentage / sellStrategy.creatorWaves;
            const creatorResult = await this.executeCreatorSellWave(
                mint,
                creatorWallet,
                wavePercentage,
                wave 
            );

            if (creatorResult.success) {
                successfulSells++;
                totalProfit += creatorResult.estimatedProfit || 0;
                if (creatorResult.signature) signatures.push(creatorResult.signature);
            }

            // Strategic delay between creator waves
            await this.randomDelay(sellStrategy.delayBetweenWaves * 0.7, sellStrategy.delayBetweenWaves * 1.3);
        }

        // 2. Bot staggered exit with market consideration
        console.log(`   🤖 Bots executing ${sellStrategy.botBatches}-batch exit...`);

        const shuffledBots = [...bots].sort(() => Math.random() - 0.5);
        const batchSize = Math.max(1, Math.floor(shuffledBots.length / sellStrategy.botBatches));

        for (let batch = 0; batch < sellStrategy.botBatches; batch++) {
            const batchBots = shuffledBots.slice(batch * batchSize, (batch + 1) * batchSize);
            console.log(`     Batch ${batch + 1}/${sellStrategy.botBatches}: ${batchBots.length} bots`);

            const batchResults = await this.executeBotSellsWave(mint, batchBots, {
                percentageRange: [sellStrategy.botPercentage * 0.6, sellStrategy.botPercentage] as [number, number],
                delayRange: [sellStrategy.delayBetweenSells * 0.5, sellStrategy.delayBetweenSells * 1.5],
                minSolValue: 0.0001,
                marketAware: true 
            });

            successfulSells += batchResults.successful;
            totalProfit += batchResults.totalSol;
            signatures.push(...batchResults.signatures);

            // Market-aware delay between batches
            if (batch < sellStrategy.botBatches - 1) {
                const currentPrice = await this.getCurrentPrice(mint);
                const priceChange = await this.getPriceChange(mint, 300000);

                let batchDelay = sellStrategy.delayBetweenBatches;
                if (priceChange < -0.05) {
                    batchDelay *= 1.5;
                    console.log(`     ⚠️ Price down ${(priceChange * 100).toFixed(1)}%, extending delay`);
                } else if (priceChange > 0.05) {
                    batchDelay *= 0.7;
                    console.log(`     📈 Price up ${(priceChange * 100).toFixed(1)}%, reducing delay`);
                }

                await this.randomDelay(batchDelay * 0.8, batchDelay * 1.2);
            }
        }

        // 3. Final liquidity provision (leave some for community)
        if (sellStrategy.leaveLiquidity > 0) {
            console.log(`   💧 Leaving ${(sellStrategy.leaveLiquidity * 100).toFixed(0)}% liquidity for community`);
            await this.provideFinalLiquidity(mint, bots, sellStrategy.leaveLiquidity);
        }

        return {
            botsUsed: bots.length,
            successfulBuys: successfulSells,
            totalSolPumped: 0,
            estimatedGrowth: 0,
            exitSignal,
            creatorSold: true,
            botsSold: successfulSells,
            estimatedProfit: totalProfit,
            signatures,
            exitStrategy: sellStrategy.name 
        };
    }


    // ====================================
    // NEW HELPER METHODS
    // ====================================

    private async executeAdaptiveTradeWave(
        mint: PublicKey,
        bots: BotWallet[],
        config: {
            buyAmountRange: [number, number];
            sellPercentage: [number, number];
            delayRange: [number, number];
            batchSize: number;
        }
    ): Promise<{successful: number, totalSol: number, signatures: string[]}> {
        const signatures: string[] = [];
        let successful = 0;
        let totalSol = 0;

        // Only execute buys (remove sells for now to simplify)
        const buyerBots = this.selectRandomBots(bots, 0.7);
        
        const buyResult = await this.executeBotBuysWave(mint, buyerBots, {
            amountRange: config.buyAmountRange,
            delayRange: config.delayRange,
            simultaneous: 1, // Execute one at a time
            retryOnFailure: true 
        });

        successful = buyResult.successful;
        totalSol = buyResult.totalSol;
        signatures.push(...buyResult.signatures);

        return { successful, totalSol, signatures };
    }

    private async analyzeMarketHealth(mint: PublicKey): Promise<MarketHealth> {
        try {
            const bondingCurve = await BondingCurveFetcher.fetch(this.connection, mint, false);
            if (!bondingCurve) {
                return {
                    score: 0,
                    volatility: 1,
                    buySellRatio: 0,
                    holderGrowthRate: 0,
                    liquidityDepth: 0
                };
            }

            // Get recent transactions for analysis
            const recentTxs = await this.connection.getSignaturesForAddress(mint, { limit: 50 });

            // Simplified health calculation
            const price = Number(bondingCurve.virtual_sol_reserves) / LAMPORTS_PER_SOL;
            const transactions = recentTxs.length;
            const ageMinutes = (Date.now() - (recentTxs[0]?.blockTime || Date.now() / 1000) * 1000) / 60000;

            let score = 50; // Base score

            // Adjust based on metrics
            if (price > 0.0001) score += 10;
            if (transactions > 20) score += 15;
            if (ageMinutes < 60) score += 10;   // New token bonus
            if (ageMinutes > 120) score += 5;   // Age bonus

            return {
                score: Math.min(100, score),
                volatility: 0.3,    // Placeholder
                buySellRatio: 1.2, // Placeholder
                holderGrowthRate: 0.1, // Placeholder
                liquidityDepth: Number(bondingCurve.virtual_sol_reserves) / LAMPORTS_PER_SOL
            };

        } catch (error) {
            console.error(`Market health analysis error: ${error.message}`);
            return {
                score: 30,
                volatility: 0.5,
                buySellRatio: 0.8,
                holderGrowthRate: 0,
                liquidityDepth: 0
            };
        }
    }

    private async analyzeHolders(
        mint: PublicKey,
        params: {
            knownBots: string[],
            creatorWallet: string;
        }
    ): Promise<HolderAnalysis> {
        try {
            console.log(`🔍 Analyzing holders via Jupiter APi for ${mint.toBase58()}`);

            // Fetch data from Jupiter Ultra API
            const jupiterData = await this.fetchJupiterTokenData(mint);

            if (!jupiterData) {
                console.warn(`  ⚠️ No Jupiter data available, using fallback analysis`);
                return await this.fallbackHolderAnalysis(mint, params);
            }

            console.log(`   📊 Jupiter Data Received:`);
            console.log(`       Holder Count: ${jupiterData.holderCount || 'N/A'}`);
            console.log(`       Organic Score: ${jupiterData.organicScoreLabel} (${jupiterData.organicScore})`);
            console.log(`       1h Holder Change: ${jupiterData.stats1h?.holderChange || 0}`);
            console.log(`       1h Organic Buyers: ${jupiterData.stats1h?.numOrganicBuyers || 0}`);

            // Calculate real holders (exclude known bots)
            const totalHolders = jupiterData.holderCount || 0;
            const knownBotCount = params.knownBots.length;

            // Adjust for creator wallet
            const adjustedKnownCount = params.creatorWallet ? knownBotCount + 1 : knownBotCount;

            // Calculate real holders (approximation)
            let realHolders = Math.max(0, totalHolders - adjustedKnownCount);

            // Use organic buyer count as a more accurate measure
            if (jupiterData.stats1h?.numOrganicBuyers) {
                realHolders = Math.max(realHolders, jupiterData.stats1h.numOrganicBuyers);
            }

            // Calculate suspected bots using Jupiter's audit data
            let suspectedBots = 0;
            if (jupiterData.audit) {
                // High top holders percentage indicates potential bot concentration
                if (jupiterData.audit.topHoldersPercentage > 70) {
                    suspectedBots += Math.floor(totalHolders * 0.3);
                }

                // Low organic score indicates bot activity
                if (jupiterData.organicScoreLabel === 'low') {
                    suspectedBots += Math.floor(totalHolders * 0.4);
                }

                // Check SUS flags
                if (jupiterData.audit.isSus) {
                    suspectedBots += Math.floor(totalHolders * 0.2);
                }
            }

            // Cap suspected bots
            suspectedBots = Math.min(suspectedBots, totalHolders - realHolders);

            // Calculate average holding time based on trading patterns
            const avgHoldingTime = this.calculateAverageHoldingTime(jupiterData);

            // Get holder distribution (simplified - would need full holder list API)
            const holderDistribution = await this.estimateHolderDistribution(
                mint,
                jupiterData,
                params
            );

            // Calculate new holders from stats
            const newHoldersLastHour = jupiterData.stats1h?.holderChange || 0;
            const newHoldersLast24h = jupiterData.stats24h?.holderChange || 0;

            return {
                realHolders,
                suspectedBots,
                avgHoldingTime,
                holderDistribution,
                newHoldersLastHour: Math.max(0, newHoldersLastHour),
                newHoldersLast24h: Math.max(0, newHoldersLast24h),
                organicScore: jupiterData.organicScore,
                organicScoreLabel: jupiterData.organicScoreLabel,
                totalHolders,
                topHoldersPercentage: jupiterData.audit?.topHoldersPercentage || 0,
                devHoldingsPercentage: jupiterData.audit?.devBalancePercentage || 0,
                tradingMetrics: {
                    hourlyTraders: jupiterData.stats1h.numTraders || 0,
                    hourlyOrganicBuyers: jupiterData.stats1h?.numOrganicBuyers || 0,
                    hourlyNetBuyers: jupiterData.stats1h.numNetBuyers || 0,
                    buySellRatio: this.calculateBuySellRatio(jupiterData)
                },
                lastUpdated: new Date(jupiterData.updatedAt)
            };

        } catch (error) {
            console.error(`❌ Jupiter holder analysis failed: ${error.message}`);
            return await this.fallbackHolderAnalysis(mint, params);
        }
    }

    private async fetchJupiterTokenData(mint: PublicKey): Promise<JupiterTokenData | null> {
        try {
            const apiKey = process.env.JUPITER_API_KEY;
            if (!apiKey) {
                console.warn('⚠️ Jupiter API key not configured');
                return null;
            }

            const options = {
                method: 'GET',
                headers: {
                    'x-api-key': apiKey,
                    'Content-Type': 'application/json'
                }
            };

            const response = await fetch(
                `https://api.jup.arg/ultra/v1/search?query=${mint.toBase58()}`,
                options
            );

            if (!response.ok) {
                console.warn(`Jupiter API error: ${response.status} ${response.statusText}`);
                return null;
            }

            const data = await response.json();

            if (!data || !Array.isArray(data) || data.length === 0) {
                console.warn(`No Jupiter data for mint: ${mint.toBase58()}`);
                return null;
            }

            return data[0] as JupiterTokenData;

        } catch (error) {
            console.error(`Jupiter fetch error: ${error.message}`);
            return null;
        }
    }

    private async fallbackHolderAnalysis(
        mint: PublicKey,
        params: {
            knownBots: string[];
            creatorWallet: string;
        }
    ): Promise<HolderAnalysis> {
        console.log(`🔄 Using fallback holder analysis`);

        try {
            // Try to get basic holder info from Solana RPC
            const largestAccounts = await this.connection.getTokenLargestAccounts(mint);

            let totalHolders = 0
            let top10Percentage = 0;

            if (largestAccounts.value && largestAccounts.value.length > 0) {
                totalHolders = largestAccounts.value.length;

                // Calculate top holders concentration
                const totalSupply = largestAccounts.value.reduce((sum, acc) => sum + acc.uiAmount, 0);
                const top10Supply = largestAccounts.value.slice(0, 10).reduce((sum, acc) => sum + acc.uiAmount, 0);

                if (totalSupply > 0) {
                    top10Percentage = (top10Supply / totalSupply) * 100;
                }
            }

            // Basic real holder estimation
            const knownBotCount = params.knownBots.length;
            const adjustedKnownCount = params.creatorWallet ? knownBotCount + 1 : knownBotCount;
            const realHolders = Math.max(0, totalHolders - adjustedKnownCount);

            // Estimate suspected bots based on concentration
            let suspectedBots = 0;
            if (top10Percentage > 80) {
                suspectedBots = Math.floor(totalHolders * 0.5);
            } else if (top10Percentage > 60) {
                suspectedBots = Math.floor(totalHolders * 0.3);
            }

            return {
                realHolders,
                suspectedBots,
                avgHoldingTime: 30 + Math.random() * 60,    // 30-90 minutes estimate
                holderDistribution: {},
                newHoldersLastHour: Math.floor(Math.random() * 10),
                newHoldersLast24h: Math.floor(Math.random() * 30),
                organicScore: 50,
                organicScoreLabel: 'medium',
                totalHolders,
                topHoldersPercentage: top10Percentage,
                devHoldingsPercentage: 0,
                tradingMetrics: {
                    hourlyTraders: Math.floor(Math.random() * 20),
                    hourlyOrganicBuyers: Math.floor(Math.random() * 15),
                    hourlyNetBuyers: Math.floor(Math.random() * 5),
                    buySellRatio: 1.2
                },
                lastUpdated: new Date()
            };

        } catch (error) {
            console.error(`Fallback analysis failed: ${error.message}`);
            return this.defaultHolderAnalysis();
        }
    }

    private defaultHolderAnalysis(): HolderAnalysis {
        return {
            realHolders: 10,
            suspectedBots: 5,
            avgHoldingTime: 45,
            holderDistribution: {},
            newHoldersLastHour: 3,
            newHoldersLast24h: 15,
            organicScore: 50,
            organicScoreLabel: 'medium',
            totalHolders: 15,
            topHoldersPercentage: 70,
            devHoldingsPercentage: 20,
            tradingMetrics: {
                hourlyTraders: 8,
                hourlyOrganicBuyers: 5,
                hourlyNetBuyers: 2,
                buySellRatio: 1.0
            },
            lastUpdated: new Date()
        };
    }

    private calculateAverageHoldingTime(jupiterData: JupiterTokenData): number {
        // Use trading frequency to estimate holding time
        const hourlyTrades = jupiterData.stats1h?.numTraders || 1;
        const dailyTrades = jupiterData.stats24h?.numTraders || 24;

        // More frequent trading = shorter holding time
        const tradeFrequency = dailyTrades / 24;    // Trades per hour

        if (tradeFrequency > 10) {
            return 15 + Math.random() * 15; // 15-30 minutes
        } else if (tradeFrequency > 5) {
            return 30 + Math.random() * 30; // 30-60 minutes
        } else if (tradeFrequency > 2) {
            return 60 + Math.random() * 60; // 60-120 minutes
        } else {
            return 120 + Math.random() * 120;   // 120-240 minutes
        }
    }

    private async estimateHolderDistribution(
        mint: PublicKey,
        jupiterData: JupiterTokenData,
        params: {
            knownBots: string[];
            creatorWallet: string;
        }
    ): Promise<Record<string, number>> {
        const distribution: Record<string, number> = {};

        try {
            // Get top holders
            const largestAccounts = await this.connection.getTokenLargestAccounts(mint);

            if (largestAccounts.value && largestAccounts.value.length > 0) {
                // Sample first 20 holders
                const sampleSize = Math.min(20, largestAccounts.value.length);

                for (let i = 0; i < sampleSize; i++) {
                    const account = largestAccounts.value[i];
                    const address = account.address.toBase58();
                    const amount = account.uiAmount || 0;

                    // Check if this is a known entity
                    let label = `Holder_${i + 1}`;

                    if (address === params.creatorWallet) {
                        label = 'Creator';
                    } else if (params.knownBots.includes(address)) {
                        label = `Bot_${i + 1}`;
                    } else if (address === jupiterData.dev) {
                        label = 'Dev';
                    }

                    distribution[label] = amount;
                }
            }

        } catch (error) {
            console.warn(`Holder distribution estimation failed: ${error.message}`);
        }

        return distribution;
    }

    private calculateBuySellRatio(jupiterData: JupiterTokenData): number {
        const buyVolume = jupiterData.stats1h?.buyVolume || 0;
        const sellVolume = jupiterData.stats1h?.sellVolume || 0;

        if (sellVolume === 0) return 10;    // All buys

        return buyVolume / sellVolume;
    }

    private async countRealHolders(
        mint: PublicKey,
        knownBotAddresses: string[],
        creatorWallet: string
    ): Promise<number> {
        try {
            const analysis = await this.analyzeHolders(mint, {
                knownBots: knownBotAddresses,
                creatorWallet
            });

            return analysis.realHolders;

        } catch (error) {
            console.error(`Failed to count real holders: ${error.message}`);
            return 0;
        }
    }

    private startRealTimeMonitoring(
        mint: PublicKey,
        bots: BotWallet[],
        creatorWallet: string 
    ) {
        // Monitor market health every 2 minutes
        const healthMonitor = setInterval(async () => {
            const health = await this.analyzeMarketHealth(mint);
            if (health.score < 30) {
                console.log(`   🚨 CRITICAL: Market health low (${health.score}/100)`);
                await this.executeEmergencyRecovery(mint, bots.slice(0, 3));
            }
        }, 120000); // 2 minutes

        this.monitoringIntervals.push(healthMonitor);

        // Monitor holder growth every 5 minutes
        const holderMonitor = setInterval(async () => {
            const holders = await this.countRealHolders(mint, bots.map(b => b.public_key), creatorWallet);
            console.log(`   👥 Current real holders; ${holders}`);
        }, 300000); // 5 minutes

        this.monitoringIntervals.push(holderMonitor);
    }

    private async executeEmergencyRecovery(
        mint: PublicKey,
        recoveryBots: BotWallet[]
    ): Promise<{success: boolean, volumeInjected: number}> {
        console.log(`🚨 EXECUTING EMERGENCY RECOVERY with ${recoveryBots.length} bots`);

        try {
            // 1. Immediate buy pressure
            console.log(`   🛒 Injecting immediate buy pressure...`);
            const buyResult = await this.executeBotBuysWave(mint, recoveryBots, {
                amountRange: [0.002, 0.005] as [number, number],
                delayRange: [50, 150], // Very fasat
                simultaneous: Math.min(3, recoveryBots.length),
                retryOnFailure: true 
            });

            // 2. Brief pause to let market react
            await this.randomDelay(1000, 2000);

            // 3. Social proof buys (simulated retail buying)
            console.log(`   👥 Creating social proof recovery...`);
            const socialBots = this.selectRandomBots(recoveryBots, 0.5);
            const socialResult = await this.executeBotBuysWave(mint, socialBots, {
                amountRange: [0.0005, 0.0015] as [number, number],
                delayRange: [200, 500],
                simultaneous: 2,
                retryOnFailure: true 
            });

            // 4. Check if recovery worked
            await this.randomDelay(2000, 3000);
            const currentHealth = await this.analyzeMarketHealth(mint);

            if (currentHealth.score < 40) {
                console.log(`   ⚠️ Still low health (${currentHealth.score}/100), executing second wave`);

                // 5. Second wave - larger buys
                const remainingBots = recoveryBots.filter(bot =>
                    !socialBots.map(b => b.public_key).includes(bot.public_key)
                );

                if (remainingBots.length > 0) {
                    await this.executeBotBuysWave(mint, remainingBots, {
                        amountRange: [0.003, 0.007] as [number, number],
                        delayRange: [100, 300],
                        simultaneous: Math.min(2, remainingBots.length),
                        retryOnFailure: true 
                    });
                }
            }

            const totalVolume = buyResult.totalSol + socialResult.totalSol;
            console.log(`   ✅ Emergency recovery complete: ${totalVolume.toFixed(4)} SOL injected`);

            return {
                success: true,
                volumeInjected: totalVolume
            };

        } catch (error: any) {
            console.error(`     ❌ Emergency recovery failed: ${error.message}`);
            return {
                success: false,
                volumeInjected: 0
            }
        }
    }

    private stopAllMonitoring() {
        this.monitoringIntervals.forEach(interval => clearInterval(interval));
        this.monitoringIntervals = [];
    }

    // ====================================
    // LIQUIDITY & EXIT METHODS
    // ====================================
    private async provideFinalLiquidity(
        mint: PublicKey,
        bots: BotWallet[],
        liquidityPercentage: number
    ): Promise<void> {
        if (liquidityPercentage <= 0) return;

        console.log(`   💧 Providing final liquidity (${(liquidityPercentage * 100).toFixed(1)}%)...`);

        // Select bots to leave as liquidity providers
        const liquidityBots = this.selectRandomBots(bots, liquidityPercentage);

        if (liquidityBots.length === 0) {
            console.log(`   ⚠️ No bots available for liquidity`);
            return;
        }

        // These bots will NOT sell their remaining tokens
        // They act as long-term holders to support the token
        for (const bot of liquidityBots) {
            try {
                const tokenBalance = await this.getBotTokenBalance(mint, bot);
                if (tokenBalance > 0) {
                    console.log(`   🤖 Bot ${bot.public_key.slice(0, 8)} holding ${tokenBalance.toLocaleString()} tokens as liquidity`);
                }
            } catch (error) {
                // Silent fail - don't stop the process
            }
        }

        // Optionally, create a smal buy wall to support price
        const supportBots = this.selectRandomBots(liquidityBots, 0.3);
        if (supportBots.length > 0) {
            await this.executeBotBuysWave(mint, supportBots, {
                amountRange: [0.0005, 0.001] as [number, number],
                delayRange: [500, 1500],
                simultaneous: 1,
                retryOnFailure: false 
            });
        }
    }

    // ====================================
    // ASSESSMENT METHODS
    // ====================================

    private async assessFoundationStrength(mint: PublicKey): Promise<number> {
        // Score from 0-100 based on market stability
        try {
            const bondingCurve = await BondingCurveFetcher.fetch(this.connection, mint, false);
            if (!bondingCurve) return 30;

            const reserves = Number(bondingCurve.virtual_sol_reserves) / LAMPORTS_PER_SOL;

            // Simple scoring based on reserves
            if (reserves > 10) return 90;
            if (reserves > 5) return 70;
            if (reserves > 2) return 50;
            if (reserves > 1) return 30;
            return 20;

        } catch (error) {
            return 10;
        }
    }

    private async calculateGrowthPercentage(mint: PublicKey): Promise<number> {
        // Calculate price growth percentage
        try {
            const bondingCurve = await BondingCurveFetcher.fetch(this.connection, mint, false);
            if (!bondingCurve) return 0;

            const currentPrice = Number(bondingCurve.virtual_sol_reserves) / LAMPORTS_PER_SOL;

            // Assuming launch price was around 0.000001 SOL (typical pump.fun launch)
            const launchPrice = 0.000001;

            if (Number(launchPrice) === 0) return 0;

            const growth = ((currentPrice - launchPrice) / launchPrice) * 100;
            return Math.min(1000, growth);  // Cap at 1000% for sanity
        } catch (error) {
            return 0;
        }
    }

    private determineEnhancedSellStrategy(
        exitSignal: string,
        marketHealth: number 
    ): {
        name: string;
        creatorPercentage: number;
        creatorWaves: number;
        botPercentage: number;
        botBatches: number;
        delayBetweenWaves: number;
        delayBetweenBatches: number;
        delayBetweenSells: number;
        leaveLiquidity: number; 
    } {
        const strategies = {
            optimal_exit: {
                name: 'OPTIMAL_EXIT',
                creatorPercentage: 70,
                creatorWaves: 4,
                botPercentage: 80, 
                botBatches: 6,
                delayBetweenWaves: 45000, // 45 seconds
                delayBetweenBatches: 30000, // 30 seconds
                delayBetweenSells: 2000, // 2 seconds
                leaveLiquidity: 0.1 // 10%
            },
            continue_growth: {
                name: 'CONTINUE_GROWTH',
                creatorPercentage: 30,
                creatorWaves: 2,
                botPercentage: 40,
                botBatches: 3,
                delayBetweenWaves: 90000, // 90 seconds
                delayBetweenBatches: 60000, // 60 seconds
                delayBetweenSells: 4000, // 4 seconds
                leaveLiquidity: 0.3 // 30%
            },
            emergency_exit: {
                name: 'EMERGENCY_EXIT',
                creatorPercentage: 90,
                creatorWaves: 1,
                botPercentage: 100,
                botBatches: 1,
                delayBetweenWaves: 0,
                delayBetweenBatches: 0,
                delayBetweenSells: 500, // 0.5 seconds
                leaveLiquidity: 0   // 0%
            }
        };

        // Choose strategy based on exit signal and market health
        if (marketHealth < 0.3) {
            return strategies.emergency_exit;
        } else if (exitSignal === 'optimal_exit' && marketHealth > 0.6) {
            return strategies.optimal_exit;
        } else {
            return strategies.continue_growth;
        }
    }

    private async executeCreatorSellWave(
        mint: PublicKey,
        creatorWallet: string,
        percentage: number,
        waveNumber: number
    ): Promise<{success: boolean, estimatedProfit?: number, signature?: string}> {
        console.log(`     Creator wave ${waveNumber + 1}: Selling ${percentage}%`);
        
        try {
            // Get creator private key
            const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000';
            const response = await axios.post(
                `${backendUrl}/creators/user/get-key-for-token-creation`,
                { wallet_address: creatorWallet },
                {
                    headers: {
                        'X-API-Key': process.env.ONCHAIN_API_KEY,
                        'Content-Type': 'application/json'
                    },
                    timeout: 3000
                }
            );

            if (!response.data.success || !response.data.private_key) {
                throw new Error('Failed to get creator private key');
            }

            const secretKey = bs58.decode(response.data.private_key);
            const keypair = Keypair.fromSecretKey(secretKey);
            
            // Create a bot wallet object (to reuse existing executeSingleSell)
            const creatorBot: BotWallet = {
                public_key: keypair.publicKey.toBase58(),
                private_key: response.data.private_key,
                amount_sol: 0
            };

            // Get creator token balance
            const ata = getAssociatedTokenAddressSync(mint, keypair.publicKey, false, TOKEN_2022_PROGRAM_ID);
            const tokenBalanceInfo = await this.connection.getTokenAccountBalance(ata, 'processed');
            const tokenBalance = Number(tokenBalanceInfo.value.amount);

            if (tokenBalance === 0) {
                console.warn(`   No tokens to sell for creator`);
                return { success: false };
            }

            // Calculate sell amount
            const sellAmount = Math.floor(tokenBalance * (percentage / 100));
            
            // Use the EXISTING executeSingleSell method
            const sellResult = await this.executeSingleSell(mint, creatorBot, sellAmount);
            
            if (sellResult.success) {
                console.log(`     ✅ Creator wave ${waveNumber + 1} sold: ${sellResult.signature?.slice(0, 8) || 'unknown'}...`);
                
                return {
                    success: true,
                    estimatedProfit: sellResult.solReceived || 0,
                    signature: sellResult.signature
                };
            } else {
                return { success: false };
            }

        } catch (error: any) {
            console.error(`   ❌ Creator sell wave ${waveNumber + 1} failed: ${error.message}`);
            return { success: false };
        }
    }

    // ====================================
    // CORE TRADING FUNCTIONS
    // ====================================

    private async executeBotBuysWave(
        mint: PublicKey,
        bots: BotWallet[],
        config: {
            amountRange: [number, number];
            delayRange: [number, number];
            simultaneous?: number;
            retryOnFailure?: boolean;
        }
    ): Promise<{successful: number, totalSol: number, signatures: string[]}> {
        const signatures: string[] = [];
        let successful = 0;
        let totalSol = 0;

        // Process bots sequentially, not in parallel
        for (let i = 0; i < bots.length; i++) {
            const bot = bots[i];
            
            try {
                // Check if bot has any SOL balance left
                const botBalance = await this.getBotSolBalance(bot.public_key);
                
                if (botBalance < 0.0001) {
                    console.log(`   ⏭️ Bot ${bot.public_key.slice(0, 8)}... has no balance: ${botBalance.toFixed(6)} SOL`);
                    continue;
                }

                const result = await this.executeSingleBuy(mint, bot, config.amountRange);
                
                if (result.success) {
                    successful++;
                    totalSol += result.amount;
                    if (result.signature) {
                        signatures.push(result.signature);
                    }
                } else if (config.retryOnFailure) {
                    // Simple retry with smaller amount
                    console.log(`   Retrying with smaller amount...`);
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                    // Retry with half the minimum
                    const retryConfig: [number, number] = [config.amountRange[0] * 0.5, config.amountRange[1] * 0.5];
                    const retryResult = await this.executeSingleBuy(mint, bot, retryConfig);
                    
                    if (retryResult.success) {
                        successful++;
                        totalSol += retryResult.amount;
                        if (retryResult.signature) {
                            signatures.push(retryResult.signature);
                        }
                    }
                }

                // Delay between bots
                if (i < bots.length - 1) {
                    const delay = this.randomInRange(config.delayRange[0], config.delayRange[1]);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }

            } catch (error: any) {
                console.error(`Bot wave error for ${bot.public_key.slice(0, 8)}...: ${error.message}`);
            }
        }

        return { successful, totalSol, signatures };
    }

    private async executeBotSellsWave(
        mint: PublicKey,
        bots: BotWallet[],
        config: {
            percentageRange: [number, number];
            delayRange: [number, number];
            minSolValue?: number;
            marketAware?: boolean;
        }
    ): Promise<{successful: number, totalSol: number, signatures: string[]}> {
        const signatures: string[] = [];
        let successful = 0;
        let totalSol = 0;

        for (const bot of bots) {
            try {
                const sellPercentage = this.randomInRange(config.percentageRange[0], config.percentageRange[1]) / 100;
                
                // Get bot's token balance
                const tokenBalance = await this.getBotTokenBalance(mint, bot);
                if (tokenBalance === 0) {
                    continue;
                }

                const sellAmount = Math.floor(tokenBalance * sellPercentage);
                if (sellAmount === 0) continue;

                // Calculate SOL value
                const solValue = await this.calculateTokenValue(mint, sellAmount);
                if (config.minSolValue && solValue < config.minSolValue) {
                    continue;
                }

                // If marketAware is true, check market conditions
                if (config.marketAware) {
                    const markethealth = await this.analyzeMarketHealth(mint);
                    if (markethealth.score < 30) {
                        console.log(`   ⚠️ Market health low, reducing sell amount`);
                        continue;   // Skip selling in bad market
                    }
                }

                // Execute sell
                const result = await this.executeSingleSell(mint, bot, sellAmount);
                
                if (result.success) {
                    successful++;
                    totalSol += solValue;
                    if (result.signature) {
                        signatures.push(result.signature);
                    }
                }

                // Delay between sells
                await this.randomDelay(config.delayRange[0], config.delayRange[1]);

            } catch (error) {
                console.error(`Bot sell error: ${error.message}`);
            }
        }

        return { successful, totalSol, signatures };
    }

    // ====================================
    // MISSING METHODS
    // ====================================

    private async getFinalMetrics(mint: PublicKey): Promise<{
        marketCap: number;
        realHolders: number;
        trendingRank: number;
        performanceScore: number;
    }> {
        try {
            const bondingCurve = await BondingCurveFetcher.fetch(this.connection, mint, false);
            const marketCap = bondingCurve ? Number(bondingCurve.virtual_sol_reserves) / LAMPORTS_PER_SOL * 2 : 0;

            const holderAnalysis = await this.analyzeHolders(mint, {
                knownBots: [],
                creatorWallet: ''
            });

            const trendingStatus = await this.checkTrendingStatus(mint, marketCap);

            return {
                marketCap,
                realHolders: holderAnalysis.realHolders,
                trendingRank: trendingStatus.rank,
                performanceScore: Math.min(100, marketCap * 10)  // Simplified score
            };
        } catch (error) {
            return {
                marketCap: 0,
                realHolders: 0,
                trendingRank: 999,
                performanceScore: 0
            };
        }
    }

    private async assessPerformance(
        mint: PublicKey,
        params: {
            startTime:  number;
            metrics: string[];
        }
    ): Promise<{score: number}> {
        // Simplified performance assessment
        try {
            const bondingCurve = await BondingCurveFetcher.fetch(this.connection, mint, false);
            if (!bondingCurve) return { score: 30 };

            const reserves = Number(bondingCurve.virtual_sol_reserves) / LAMPORTS_PER_SOL;

            // Score based on reserves
            let score = 50; // Base score
            if (reserves > 10) score = 90;
            else if (reserves > 5) score = 75;
            else if (reserves > 2) score = 60;
            else if (reserves > 1) score = 45;

            return { score };
        } catch (error) {
            return { score: 20 };
        }
    }

    private async executeGradualProfitTake(
        mint: PublicKey,
        bots: BotWallet[],
        config: {
            percentage: [number, number];
            delayBetween: [number, number];
        }
    ): Promise<void> {
        console.log(`   💰 Gradual profit taking with ${bots.length} bots`);

        for (const bot of bots) {
            try {
                const sellPercentage = this.randomInRange(config.percentage[0], config.percentage[1]) / 100;
                const tokenBalance = await this.getBotTokenBalance(mint, bot);

                if (tokenBalance > 0) {
                    const sellAmount = Math.floor(tokenBalance * sellPercentage);
                    await this.executeSingleSell(mint, bot, sellAmount);

                    const delay = this.randomInRange(config.delayBetween[0], config.delayBetween[1]);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            } catch (error) {
                // silent fail for individual bots
            }
        }
    }

    private async executeBotBuy(
        mint: PublicKey,
        publicKey: string,
        privateKey: string,
        amountSol: number,
        slippageBps: number = 500
    ): Promise<{success: boolean; signature?: string; error?: string}> {
        try {
            // Get bonding curve data
            const bondingCurve = await BondingCurveFetcher.fetch(this.connection, mint, false);
            if (!bondingCurve) {
                return { success: false, error: 'Bonding curve not found' };
            }

            // Calculate token amount for given SOL
            const virtualSolReserves = Number(bondingCurve.virtual_sol_reserves);
            const virtualTokenReserves = Number(bondingCurve.virtual_token_reserves);
            const solAmount = Math.floor(amountSol * LAMPORTS_PER_SOL);

            // Calculate expected tokens using bonding curve formula
            const expectedTokens = Math.floor(
                (solAmount * virtualTokenReserves) / (virtualSolReserves + solAmount)
            );

            // Apply slippage
            const minTokensOut = Math.floor(expectedTokens * (10000 - slippageBps) / 10000);

            // Create bot keypair
            const botKeypair = Keypair.fromSecretKey(bs58.decode(privateKey));

            // Get bot ATA
            const botAta = getAssociatedTokenAddressSync(
                mint,
                botKeypair.publicKey,
                false,
                TOKEN_2022_PROGRAM_ID
            );

            // Build buy instruction using the SAME method as botManager.ts
            const buyInstruction = PumpFunInstructionBuilder.buildBuy(
                botKeypair.publicKey,  // user
                mint,                   // mint
                botAta,                 // userAta
                bondingCurve.creator,   // creator
                BigInt(expectedTokens), // tokensOut (expected)
                BigInt(minTokensOut)    // maxSolCost (min tokens out with slippage)
            );

            // Get blockhash
            const { blockhash } = await this.connection.getLatestBlockhash('finalized');

            // Add compute budget
            const computeBudgetInstruction = ComputeBudgetProgram.setComputeUnitLimit({
                units: 200000
            });

            const computePriceInstruction = ComputeBudgetProgram.setComputeUnitPrice({
                microLamports: 1000
            });

            // Create transaction
            const message = new TransactionMessage({
                payerKey: botKeypair.publicKey,
                recentBlockhash: blockhash,
                instructions: [computeBudgetInstruction, computePriceInstruction, buyInstruction]
            }).compileToV0Message();

            // FIX: Pass the Keypair object (which implements Signer interface)
            const transaction = new VersionedTransaction(message);
            transaction.sign([botKeypair]); // ← PASS THE KEYPAIR, not Uint8Array

            // Send transaction
            const signature = await this.connection.sendTransaction(transaction, {
                skipPreflight: true,
                maxRetries: 3
            });

            console.log(`   ✅ Buy: ${amountSol.toFixed(4)} SOL (${signature.slice(0, 8)}...)`);
            return { success: true, signature };

        } catch (error: any) {
            console.error(`❌ Buy failed: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    private async executeSingleSell(
        mint: PublicKey,
        bot: BotWallet,
        tokenAmount: number
    ): Promise<{success: boolean; solReceived?: number; signature?: string; error?: string}> {
        try {
            // Create bot keypair
            const botKeypair = Keypair.fromSecretKey(bs58.decode(bot.private_key));

            // Get bonding curve
            const bondingCurve = await BondingCurveFetcher.fetch(this.connection, mint, false);
            if (!bondingCurve) {
                return { success: false, error: 'Bonding curve not found' };
            }

            // Get bot ATA
            const botAta = getAssociatedTokenAddressSync(
                mint,
                botKeypair.publicKey,
                false,
                TOKEN_2022_PROGRAM_ID
            );

            // Calculate expected SOL output using BondingCurveMath
            const expectedSol = BondingCurveMath.calculateSolForTokens(
                BigInt(bondingCurve.virtual_sol_reserves),
                BigInt(bondingCurve.virtual_token_reserves),
                BigInt(tokenAmount)
            );

            // Apply slippage (5% default)
            const minSolOut = BondingCurveMath.applySlippage(expectedSol, 500);

            // Build sell instruction using the CORRECT method - use buildSell from pumpfun-idl-client
            const sellInstruction = PumpFunInstructionBuilder.buildSell(
                botKeypair.publicKey,  // user
                mint,                   // mint
                botAta,                 // userAta
                bondingCurve.creator,   // creator
                BigInt(tokenAmount),    // amount
                BigInt(minSolOut)       // minSolOutput
            );

            // Get blockhash
            const { blockhash } = await this.connection.getLatestBlockhash('finalized');

            // Add compute budget
            const computeBudgetInstruction = ComputeBudgetProgram.setComputeUnitLimit({
                units: 200000
            });

            const computePriceInstruction = ComputeBudgetProgram.setComputeUnitPrice({
                microLamports: 1000
            });

            // Create transaction
            const message = new TransactionMessage({
                payerKey: botKeypair.publicKey,
                recentBlockhash: blockhash,
                instructions: [computeBudgetInstruction, computePriceInstruction, sellInstruction]
            }).compileToV0Message();

            // FIX: Pass the Keypair object (which implements Signer interface)
            const transaction = new VersionedTransaction(message);
            transaction.sign([botKeypair]); // ← PASS THE KEYPAIR, not Uint8Array

            // Send transaction
            const signature = await this.connection.sendTransaction(transaction, {
                skipPreflight: true,
                maxRetries: 3
            });

            return {
                success: true,
                solReceived: Number(expectedSol) / LAMPORTS_PER_SOL,
                signature
            };

        } catch (error: any) {
            console.error(`Sell error: ${error.message}`);
            return { success: false, error: error.message };
        }
    }


    // ====================================
    // SINGLE TRANSACTION EXECUTION
    // ====================================

    private async executeSingleBuy(
        mint: PublicKey,
        bot: BotWallet,
        amountRange: [number, number]
    ): Promise<{success: boolean, amount: number, signature?: string}> {
        try {
            // CRITICAL: Check bot balance first
            const botBalance = await this.getBotSolBalance(bot.public_key);
            
            if (botBalance <= 0.0001) {
                console.log(`   ⏭️ Bot ${bot.public_key.slice(0, 8)}... has insufficient balance: ${botBalance.toFixed(6)} SOL`);
                return { success: false, amount: 0 };
            }

            // Calculate buy amount based on balance, NOT market metrics
            const maxBuyAmount = botBalance * 0.8; // Use 80% of balance
            
            // Ensure buy amount is within range AND doesn't exceed balance
            const calculatedAmount = this.randomInRange(amountRange[0], amountRange[1]);
            const buyAmount = Math.min(calculatedAmount, maxBuyAmount);
            
            // Minimum buy amount check
            if (buyAmount < 0.0001) {
                console.log(`   ⏭️ Calculated amount too small: ${buyAmount.toFixed(6)} SOL`);
                return { success: false, amount: 0 };
            }
            
            console.log(`   🤖 Bot ${bot.public_key.slice(0, 8)}... buying ${buyAmount.toFixed(6)} SOL (balance: ${botBalance.toFixed(6)} SOL)`);
            
            // Execute the buy with the ACTUAL amount the bot can afford
            const result = await this.executeBotBuy(
                mint,
                bot.public_key,
                bot.private_key,
                buyAmount,
                500 // Default slippage
            );
            
            if (result.success && result.signature) {
                return { success: true, amount: buyAmount, signature: result.signature };
            } else {
                console.log(`   ❌ Bot ${bot.public_key.slice(0, 8)}... buy failed: ${result.error}`);
                return { success: false, amount: 0 };
            }
            
        } catch (error: any) {
            console.error(`Bot buy error: ${error.message}`);
            return { success: false, amount: 0 };
        }
    }

    private async getBotSolBalance(publicKey: string): Promise<number> {
        try {
            const balance = await this.connection.getBalance(new PublicKey(publicKey), 'processed');
            return balance / LAMPORTS_PER_SOL;
        } catch (error) {
            console.error(`Failed to get balance for ${publicKey.slice(0, 8)}...: ${error.message}`);
            return 0;
        }
    }



    // ====================================
    // MARKET ANALYSIS & MONITORING
    // ====================================


    private async checkTrendingStatus(
        mint: PublicKey,
        volumeGenerated: number
    ): Promise<{isTrending: boolean, rank: number, confidence: number}> {
        try {
            // Get current market cap
            const bondingCurve = await BondingCurveFetcher.fetch(this.connection, mint, false);
            if (!bondingCurve) {
                return { isTrending: false, rank: 999, confidence: 0 };
            }

            const marketCap = Number(bondingCurve.virtual_sol_reserves) / LAMPORTS_PER_SOL * 2;
            const volumeRatio = volumeGenerated / marketCap;
            
            // Simple trending algorithm
            let rank = 999;
            let isTrending = false;
            
            if (volumeRatio > 0.5) {
                rank = Math.floor(Math.random() * 20) + 1;
                isTrending = true;
            } else if (volumeRatio > 0.2) {
                rank = Math.floor(Math.random() * 30) + 21;
                isTrending = Math.random() > 0.5;
            } else {
                rank = Math.floor(Math.random() * 50) + 51;
            }

            const confidence = Math.min(volumeRatio * 2, 0.9);

            return { isTrending, rank, confidence };

        } catch (error) {
            console.error(`Trending check error: ${error.message}`);
            return { isTrending: false, rank: 999, confidence: 0 };
        }
    }

    // ====================================
    // RECOVERY STRATEGY METHODS
    // ====================================
    
    private async executeRecoveryStrategy(
        mint: PublicKey,
        bots: BotWallet[],
        creatorWallet: string,
        durationMinutes: number 
    ): Promise<Omit<PhaseResult, 'phase'>> {
        console.log(`🔄 Executing recovery strategy for ${durationMinutes} minutes`);

        const recoveryBots = this.selectRandomBots(bots, 0.4);  // Use 40$ of bots
        let recoveryVolume = 0;
        let successfulTrades = 0;

        const startTime = Date.now();
        const endTime = startTime + (durationMinutes * 60 * 1000);

        while (Date.now() < endTime) {
            // Execute recovery waves
            const waveResult = await this.executeBotBuysWave(mint, recoveryBots, {
                amountRange: [0.001, 0.004] as [number, number],
                delayRange: [150, 450],
                simultaneous: Math.min(2, recoveryBots.length),
                retryOnFailure: true 
            });

            recoveryVolume += waveResult.totalSol;
            successfulTrades += waveResult.successful;

            // Check if recovery is working
            const currentHealth = await this.analyzeMarketHealth(mint);
            if (currentHealth.score > 60) {
                console.log(`   ✅ Recovery successful! Market health: ${currentHealth.score}/100`);
                break;
            }

            // Wait before next wave
            await this.randomDelay(30000, 60000);   // 30-60 seconds
        }

        return {
            botsUsed: recoveryBots.length,
            successfulBuys: successfulTrades,
            totalSolPumped: recoveryVolume,
            estimatedGrowth: Math.min(30, recoveryVolume * 20),
            duration: `${durationMinutes} minutes`,
            recoveryExecuted: true,
            finalHealth: (await this.analyzeMarketHealth(mint)).score
        };
    }

    // ====================================
    // HELPER METHODS FOR STRATEGIES
    // ====================================

    private createSustainedSegments(durationMinutes: number): Array<{
        duration: number;
        focus: string;
        intensity: number;
    }> {
        const segmentDuration = durationMinutes / 3;    // Split into 3 segments

        return [
            {
                duration: segmentDuration * 60 * 1000,
                focus: 'PRICE_STABILITY',
                intensity: 0.5
            },
            {
                duration: segmentDuration * 60 * 1000,
                focus: 'HOLDER_RETENTION',
                intensity: 0.4
            },
            {
                duration: segmentDuration * 60 * 1000,
                focus: 'EXIT_PREPARATION',
                intensity: 0.3
            }
        ];
    }

    private async executeSustainedSegment(
        mint: PublicKey,
        bots: BotWallet[],
        segment: {
            duration: number;
            focus: string;
            intensity: number;
        },
        performance: { score: number }
    ): Promise<SegmentResult & { profitabilityScore: number }> {
        console.log(`   📊 Executing ${segment.focus} segment (${(segment.duration / 60000).toFixed(1)}min)`);

        const segmentBots = this.selectRandomBots(bots, segment.intensity);
        const startTime = Date.now();
        const endTime = startTime + segment.duration;

        let segmentVolume = 0;
        let successfulBuys = 0;

        while (Date.now() < endTime) {
            const tradeResult = await this.executeAdaptiveTradeWave(
                mint, 
                segmentBots,
                {
                    buyAmountRange: [0.0008, 0.002] as [number, number],
                    sellPercentage: [5, 15] as [number, number],
                    delayRange: [200, 600],
                    batchSize: Math.max(1, Math.floor(segmentBots.length * 0.1))
                }
            );

            segmentVolume += tradeResult.totalSol;
            successfulBuys += tradeResult.successful;

            // Strategy-specific logic
            if (segment.focus === 'HOLDER_RETENTION') {
                // More buys than sells to encourage holding
                await this.randomDelay(3000, 6000);
            } else {
                await this.organicTradeDelay();
            }
        }

        // Calculate profitability score
        const profitabilityScore = Math.min(1, performance.score / 100 * 0.8 + Math.random() * 0.2);

        return {
            duration: segment.duration,
            volume: segmentVolume,
            successfulBuys,
            description: `${segment.focus} segment`,
            profitabilityScore
        };
    }

    private calculateExitReadiness(params: {
        marketHealth: number;
        performance: number;
        holderCount: number;
        liquidityDepth: number;
    }): number {
        const weights = this.phases.PHASE_4_SUSTAINED_GROWTH.exitReadingWeights;

        const score = 
            (params.marketHealth * weights.marketHealth) + 
            (params.performance * weights.performance) + 
            (params.holderCount * weights.holderCount) +
            (params.liquidityDepth * weights.liquidityDepth);
        
        return Math.min(score, 1);
    }

    private async getLiquidityDepth(mint: PublicKey): Promise<number> {
        try {
            const bondingCurve = await BondingCurveFetcher.fetch(this.connection, mint, false);
            if (!bondingCurve) return 0;

            const reserves = Number(bondingCurve.virtual_sol_reserves) / LAMPORTS_PER_SOL;

            // Normalize liquidity depth (0-1)
            if (reserves > 5) return 0.9;
            if (reserves > 2) return 0.7;
            if (reserves > 1) return 0.5;
            if (reserves > 0.5) return 0.3;
            return 0.1
        } catch (error) {
            return 0;
        }
    }

    private async getPriceChange(
        mint: PublicKey,
        timeframeMs: number
    ): Promise<number> {
        try {
            // 1. Get current price from bonding curve
            const currentPrice = await this.getCurrentPrice(mint);
            if (currentPrice === 0) return 0;

            // 2. Initialize price history for this mint
            const mintKey = mint.toBase58();
            if (!this.priceHistory.has(mintKey)) {
                this.priceHistory.set(mintKey, []);
            }

            const history = this.priceHistory.get(mintKey)!;

            // 3. Record current price
            history.push({
                timestamp: Date.now(),
                price: currentPrice
            });

            // Keep only last 1000 entries
            if (history.length > 1000) {
                this.priceHistory.set(mintKey, history.slice(-1000));
            }

            // 4. Calculate price change over timeframe
            const cutoffTime = Date.now() - timeframeMs;
            const relevantPrices = history.filter(h => h.timestamp >= cutoffTime);

            if (relevantPrices.length < 2) {
                // Not enough data, return 0
                return 0;
            }

            const oldestPrice = relevantPrices[0].price;
            const priceChange = (currentPrice - oldestPrice) / oldestPrice;

            // 5. Add additional market context
            const marketContext = await this.getMarketContext(mint);
            const adjustedChange = this.adjustPriceChangeForMarket(priceChange, marketContext);

            console.log(`   📊 Price change (${timeframeMs/1000}s): ${(adjustedChange * 100).toFixed(2)}%`);
            return adjustedChange;

        } catch (error) {
            console.error(`Price change calculation error: ${error.message}`);
            return 0;
        }
    }

    private async getMarketContext(mint: PublicKey): Promise<{
        volume24h: number;
        volatility: number;
        trend: 'bullish' | 'bearish' | 'neutral';
        marketCap: number;
    }> {
        try {
            const bondingCurve = await BondingCurveFetcher.fetch(this.connection, mint, false);
            if (!bondingCurve) {
                return {
                    volume24h: 0,
                    volatility: 0.3,
                    trend: 'neutral',
                    marketCap: 0
                };
            }

            // Calculate market cap
            const reserves = Number(bondingCurve.virtual_sol_reserves) / LAMPORTS_PER_SOL;
            const marketCap = reserves * 2;

            // Get recent transactions for volume calculation
            const recentTxs = await this.connection.getSignaturesForAddress(mint, { limit: 100 });

            // Simplified volume estimation (in production, use actual transaction amounts)
            const volume24h = recentTxs.length * 0.001; // Approximate

            // Determine trend 
            const priceHistory = this.priceHistory.get(mint.toBase58()) || [];
            let trend: 'bullish' | 'bearish' | 'neutral' = 'neutral';

            if (priceHistory.length >= 5) {
                const recentPrices = priceHistory.slice(-5).map(p => p.price);
                const priceChange = (recentPrices[4] - recentPrices[0]) / recentPrices[0];

                if (priceChange > 0.05) trend = 'bullish';
                else if (priceChange < -0.05) trend = 'bearish';
            }

            return {
                volume24h,
                volatility: this.calculateVolatility(priceHistory),
                trend,
                marketCap
            };

        } catch (error) {
            return {
                volume24h: 0,
                volatility: 0.3,
                trend: 'neutral',
                marketCap: 0
            };
        }
    }

    private calculateVolatility(priceHistory: {timestamp: number, price: number}[]): number {
        if (priceHistory.length < 10) return 0.3;

        const prices = priceHistory.map(p => p.price);
        const mean = prices.reduce((sum, price) => sum + price, 0) / prices.length;
        const variance = prices.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / prices.length;
        const stdDev = Math.sqrt(variance);

        // Return as percentage
        return mean > 0 ? stdDev / mean : 0.3;
    }

    private adjustPriceChangeForMarket(
        priceChange: number,
        context: {
            volume24h: number;
            volatility: number;
            trend: 'bullish' | 'bearish' | 'neutral';
            marketCap: number;
        }
    ): number {
        let adjusted = priceChange;

        // Adjust for volume (low volume = less reliable price change)
        if (context.volume24h < 0.1) {
            adjusted *= 0.7;
        }

        // Adjusted for volatility (high volatility = amplify changes)
        if (context.volatility > 0.4) {
            adjusted *= 1.3;
        }

        // Adjust for market cap (small caps = more volatile)
        if (context.marketCap < 1000) {
            adjusted *= 1.2;
        }

        return adjusted;
    }

    // ===================== SOCIAL MEDIA INTEGRATIONS STARTS HERE ==========================

    public cacheTokenMetadata(mint: PublicKey, metadata: TokenMetadata): void {
        const mintKey = mint.toBase58();
        console.log(`📊 Caching token metadata for ${mintKey}:`, {
            name: metadata.name,
            symbol: metadata.symbol,
            uri: metadata.uri?.substring(0, 50) + '...'
        });
        this.metadataCache.set(mintKey, metadata);
    }

    private async initializeXOAuth1(): Promise<XOAuth1Client> {
        if (!this.xOAuth1) {
            console.log('🔐 Initializing X OAuth 1.0a client...');
            
            // Get credentials from environment variables or config
            const consumerKey = process.env.X_CONSUMER_KEY;
            const consumerSecret = process.env.X_CONSUMER_SECRET;
            const accessToken = process.env.X_ACCESS_TOKEN;
            const accessTokenSecret = process.env.X_ACCESS_TOKEN_SECRET;

            if (!consumerKey || !consumerSecret || !accessToken || !accessTokenSecret) {
                console.error('❌ Missing X OAuth 1.0a credentials!');
                console.error('💡 Set these environment variables:');
                console.error('   X_CONSUMER_KEY');
                console.error('   X_CONSUMER_SECRET');
                console.error('   X_ACCESS_TOKEN');
                console.error('   X_ACCESS_TOKEN_SECRET');
                throw new Error('Missing X OAuth 1.0a credentials');
            }

            this.xOAuth1 = new XOAuth1Client(
                consumerKey,
                consumerSecret,
                accessToken,
                accessTokenSecret
            );

            // Test the connection
            await this.testXAuthOAuth1();
        }
        
        return this.xOAuth1;
    }

    private async testXAuthOAuth1(): Promise<boolean> {
        try {
            console.log('🔐 Testing X authentication with OAuth 1.0a...');
            
            const userData = await this.xOAuth1!.getUserId();
            
            console.log('✅ X authentication successful with OAuth 1.0a!');
            console.log(`   User ID: ${userData}`);
            return true;
            
        } catch (error: any) {
            console.error('❌ X authentication test error:', error.message);
            return false;
        }
    }

    private async fetchImageFromIPFS(ipfsUrl: string): Promise<Buffer | null> {
        // Keep your existing implementation - it's good!
        try {
            let imageUrl = ipfsUrl;

            // Handle IPFS URLs
            if (ipfsUrl.startsWith('ipfs://')) {
                const cid = ipfsUrl.replace('ipfs://', '');
                imageUrl = `https://ipfs.io/ipfs/${cid}`;
                console.log(`   🌐 Converted IPFS to gateway: ${imageUrl}`);
            }

            // Create AbortController for timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

            try {
                // First, check if it's a metadata JSON or direct image
                const response = await fetch(imageUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    },
                    signal: controller.signal // Add abort signal for timeout
                });
                
                clearTimeout(timeoutId); // Clear timeout on successful response
                
                if (!response.ok) {
                    console.error(`❌ Failed to fetch from ${imageUrl}: ${response.status}`);
                    return null;
                }

                const contentType = response.headers.get('content-type') || '';

                // If it's JSON, parse it and get the image field
                if (contentType.includes('application/json')) {
                    const metadata = await response.json();
                    if (metadata.image) {
                        console.log(`   📄 Found image in metadata: ${metadata.image}`);
                        return await this.fetchImageFromIPFS(metadata.image);
                    } else {
                        console.error(`❌ No image field in metadata`);
                        return null;
                    }
                }
                // If it's an image, download it
                else if (contentType.startsWith('image/')) {
                    const arrayBuffer = await response.arrayBuffer();
                    const buffer = Buffer.from(arrayBuffer);
                    console.log(`   🖼️ Downloaded image: ${buffer.length} bytes, ${contentType}`);
                    return buffer;
                }
                // If it's text/html, might be Arweave
                else if (contentType.includes('text/html')) {
                    // Try to parse Arweave metadata
                    const text = await response.text();
                    try {
                        const metadata = JSON.parse(text);
                        console.log(`   🔗 Found image in Arweave metadata`);
                        return await this.fetchImageFromIPFS(metadata.image);
                    } catch {
                        console.error(`❌ Could not parse as JSON`);
                    }
                }

                console.error(`❌ Unsupported content type: ${contentType}`);
                return null;

            } catch (error: any) {
                clearTimeout(timeoutId); // Clear timeout on error
                if (error.name === 'AbortError') {
                    console.error(`❌ Request timeout for ${imageUrl}`);
                } else {
                    console.error(`❌ Error fetching from ${imageUrl}:`, error.message);
                }
                return null;
            }

        } catch (error: any) {
            console.error(`❌ Error in fetchImageFromIPFS:`, error.message);
            return null;
        }
    }



    private async uploadImageToX(imageBuffer: Buffer, mimeType: string): Promise<string | null> {
        try {
            const xAuth = await this.initializeXOAuth1();
            
            console.log(`   ⬆️ Uploading image to X using OAuth 1.0a...`);
            
            const mediaId = await xAuth.uploadMedia(imageBuffer, mimeType);
            
            console.log(`   ✅ Media uploaded successfully: ${mediaId}`);
            return mediaId;

        } catch (error) {
            console.error('❌ Error uploading media to X:', error);
            return null;
        }
    }



    private async waitForMediaProcessing(mediaId: string): Promise<void> {
        // This is handled by X API v2 automatically
        // Media upload returns processing_info if needed
        console.log(`   ⏳ Waiting for media processing (X API v2 handles this automatically)`);
        await new Promise(resolve => setTimeout(resolve, 2000)); // Brief wait
    }

    private async postLaunchAnnouncement(
        mint: PublicKey, 
        metadata: TokenMetadata
    ): Promise<{ success: boolean; reach?: number; tweetId?: string }> {
        try {
            const xAuth = await this.initializeXOAuth1();

            let mediaId: string | null = null;

            // Try to upload token image
            if (metadata.uri) {
                console.log(`   🖼️ Fetching token image from metadata URI...`);
                const imageBuffer = await this.fetchImageFromIPFS(metadata.uri);

                if (imageBuffer) {
                    console.log(`   ⬆️ Uploading image to X...`);
                    const mimeType = this.getMimeTypeFromBuffer(imageBuffer) || 'image/png';
                    mediaId = await this.uploadImageToX(imageBuffer, mimeType);
                } else {
                    console.log(`   ⚠️ Could not fetch token image, posting text-only`);
                }
            }

            // Create announcement content
            const mintStr = mint.toBase58();
            const shortMint = mintStr.slice(0, 4) + '...' + mintStr.slice(-4);

            const content = `🚀 **LAUNCH ALERT** 🚀\n\n` +
                        `🪙 ${metadata.name} (${metadata.symbol})\n` +
                        `📍 CA: ${shortMint}\n\n` +
                        `✅ Token successfully launched on @pumpdotfun\n` +
                        `✅ Liquidity pool initialized\n` +
                        `✅ Community buys completed\n\n` +
                        `Get in early! 🚀\n\n` +
                        `#Solana #Memecoin #${metadata.symbol} #Crypto #DeFi #Web3`;
            
            // Post tweet
            console.log(`   🐦 Posting launch announcement to X...`);
            
            const mediaIds = mediaId ? [mediaId] : undefined;
            const tweetId = await xAuth.postTweet(content, mediaIds);
            
            console.log(`   ✅ Tweet posted: ${tweetId}`);
            console.log(`   🔗 Tweet URL: https://x.com/i/status/${tweetId}`);

            // Auto-like the tweet
            await xAuth.likeTweet(tweetId);

            return {
                success: true,
                reach: mediaId ? 1500 : 1000,
                tweetId
            };

        } catch (error: any) {
            console.error('❌ Error posting launch announcement:', error.message);
            return { success: false };
        }
    }

    private getMimeTypeFromBuffer(buffer: Buffer): string | null {
        if (buffer.length < 4) return null;

        const header = buffer.slice(0, 4);

        // JPEG - FIXED: Changed 0x08 to 0xD8
        if (header[0] === 0xFF && header[1] === 0xD8) return 'image/jpeg'; // ✅ Fixed
        
        // PNG
        if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47) {
            return 'image/png';
        }

        // GIF
        if (header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46) return 'image/gif';

        // WebP
        if (header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46) {
            if (buffer.length >= 12 && buffer.slice(8, 12).toString() === 'WEBP') {
                return 'image/webp';
            }
        }

        return 'image/png'; // Default
    }

    private async postToX(
        content: string, 
        mint: PublicKey
    ): Promise<{
        success: boolean; 
        reach?: number; 
        tweetId?: string
    }> {
        try {
            const xAuth = await this.initializeXOAuth1();

            console.log(`   🐦 Posting to X: ${content.substring(0, 50)}...`);
            
            const tweetId = await xAuth.postTweet(content);
            
            console.log(`   ✅ X: Posted tweet ${tweetId}`);
            console.log(`   🔗 Tweet URL: https://x.com/i/status/${tweetId}`);

            // Auto-like the tweet
            try {
                await xAuth.likeTweet(tweetId);
                console.log(`   ❤️ Tweet liked successfully`);
            } catch (likeError) {
                console.warn(`   ⚠️ Could not like tweet: ${likeError}`);
            }

            return {
                success: true,
                reach: 1000,
                tweetId
            };

        } catch (error: any) {
            console.error('❌ Error posting to X:', error.message);
            
            // Fallback to simulation
            console.log(`   🐦 [SIM] X: ${content}`);
            return { 
                success: true, 
                reach: 1000,
                tweetId: `sim_${Date.now()}`
            };
        }
    }


    private async postToChannel(
        channel: string,
        content: string,
        mint: PublicKey
    ): Promise<{success: boolean; reach?: number; tweetId?: string}> {
        switch (channel) {
            case 'x':
                try {
                    return await this.postToX(content, mint);
                } catch (error) {
                    console.error('X posting failed:', error);
                    // Fallback to simulation
                    console.log(`   🐦 [SIM] X: ${content}`);
                    return { success: true, reach: 1000 };
                }
            
                case 'telegram':
                    // await telegramBot.sendMessage(channelId, content);
                    console.log(`   📱 [SIM] Telegram: ${content}`);
                    return { success: true, reach: 500 };
                
                case 'discord':
                    // await discordWebhook.send({ content });
                    console.log(`   💬 [SIM] Discord: ${content}`);
                    return { success: true, reach: 300 };
                
                    default:
                        return { success: false };
        }
    }

    public async postTokenLaunchAnnouncement(mint: PublicKey): Promise<{success: boolean; tweetId?: string}> {
        try {
            // Get cached metadata
            const mintKey = mint.toBase58();
            const metadata = this.metadataCache.get(mintKey);

            if (!metadata) {
                console.error(`❌ No metadata cached for ${mintKey}`);
                return { success: false };
            }

            console.log(`🚀 Posting launch announcement for ${metadata.name} (${mintKey})`);

            const result = await this.postLaunchAnnouncement(mint, metadata);

            if (result.success) {
                console.log(`✅ Launch announcement posted successfully!`);
            } else {
                console.error(`❌ Failed to post launch announcment`);
            }

            return result; 

        } catch (error) {
            console.error(`❌ Error posting launch announcement:`, error);
            return { success: false };
        }
    }


    private async executeSocialActivities(
        mint: PublicKey,
        config: {
            activities: string[];
            participantCount: number;
            budget: number;
            hashtags?: string[];
            goals?: string[];
        }
    ): Promise<{
        success: boolean;
        results: Array<{
            activity: string;
            success: boolean;
            engagement: number;
            volume: number;
            signatures: string[];
        }>;
        totalEngagement: number;
        totalVolume: number;
    }> {
        console.log(`   🎪 Executing ${config.activities.length} social activities`);

        const results: Array<{
            activity: string;
            success: boolean;
            engagement: number;
            volume: number;
            signatures: string[];
        }> = [];

        let totalEngagement = 0;
        let totalVolume = 0;

        // Execute activities in sequence
        for (const activityType of config.activities) {
            console.log(`   🎯 Activity: ${activityType}`);

            const activityResult = await this.executeSingleSocialActivity(
                mint,
                activityType,
                {
                    participantCount: config.participantCount,
                    budget: config.budget / config.activities.length,
                    hashtags: config.hashtags,
                    goals: config.goals
                }
            );

            results.push(activityResult);

            if (activityResult.success) {
                totalEngagement += activityResult.engagement;
                totalVolume += activityResult.volume;
            }

            // Update registry
            this.updateSocialActivityRegistry(mint, activityType, activityResult);

            // Delay between activities
            if (activityType !== config.activities[config.activities.length - 1]) {
                await this.randomDelay(30000, 90000);   // 30-90 seconds
            }
        }

        // Post summary if multiple activities
        if (results.length > 1) {
            await this.postSocialActivitiesSummary(mint, results, config);
        }

        return {
            success: results.some(r => r.success),
            results,
            totalEngagement,
            totalVolume
        };
    }

    private async executeSingleSocialActivity(
        mint: PublicKey,
        activityType: string,
        config: any 
    ): Promise<any> {
        switch (activityType) {
            case 'LEADERBOARDS':
                return await this.executeLeaderboardActivity(mint, config);
            case 'ACHIEVEMENTS':
                return await this.executeAchievementActivity(mint, config);
            case 'VOTE_EVENTS':
                return await this.executeVoteEvent(mint, config);
            case 'COMMUNITY_CHALLENGES':
                return await this.executeCommunityChallenge(mint, config);
            case 'NFT_REWARDS':
                return await this.executeNFTRewards(mint, config);
            default:
                return await this.executeGenericSocialActivity(mint, config);
        }
    }

    private async executeLeaderboardActivity(
        mint: PublicKey,
        config: any 
    ): Promise<any> {
        console.log(`   🏆 Creating leaderboard competition...`);

        // Use the stored preparedBots, not the function
        const availableBots = this.preparedBots || [];
        if (availableBots.length === 0) {
            console.log(`   ⚠️ No prepared bots available for leaderboard`);
            return {
                activity: 'LEADERBOARDS',
                success: false,
                engagement: 0,
                volume: 0,
                signatures: []
            };
        }

        // Select top 5-10 holders (simulated)
        const leaderboardSize = Math.min(10, Math.floor(config.participantCount * 0.3));
        const leaderBoardBots = this.selectRandomBots(availableBots, Math.min(1, leaderboardSize / availableBots.length));

        let leaderboardVolume = 0;
        const signatures: string[] = [];

        // Each bot tries to climb the leaderboard
        for (const bot of leaderBoardBots) {
            const buyAmount = this.randomInRange(0.001, 0.005);
            const result = await this.executeSingleBuy(mint, bot, [buyAmount, buyAmount]);

            if (result.success) {
                leaderboardVolume += buyAmount;
                if (result.signature) signatures.push(result.signature);
            }

            // Stagger buys for competition effect
            await this.organicTradeDelay();
        }

        // Generate leaderboard announcement
        const leaderboardText = this.generateLeaderboardText(leaderBoardBots, leaderboardVolume);
        await this.postToChannel('x', leaderboardText, mint);

        return {
            activity: 'LEADERBOARDS',
            success: leaderboardVolume > 0,
            engagement: leaderBoardBots.length * 3,
            volume: leaderboardVolume,
            signatures
        };
    }

    private async organicTradeDelay(): Promise<void> {
        // Human-like delays
        const delays = [
            5000, 8000, 12000, 15000, 20000, 30000, 45000, 60000, 90000, 120000
        ];
        const delay = delays[Math.floor(Math.random() * delays.length)];
        
        // Add some randomness
        const jitter = delay * (0.8 + Math.random() * 0.4);
        await new Promise(resolve => setTimeout(resolve, jitter));
        }

    private async executeAchievementActivity(
        mint: PublicKey,
        config: any 
    ): Promise<any> {
        console.log(`       🎖️ Unlocking achievements...`);

        // Simulate achievement unlocks with small buys
        const achievementBots = this.selectRandomBots(this.preparedBots || [], 0.2);

        const achievements = [
            "First Buy 🛒",
            "Diamond Hands 💎", 
            "Community Builder 👥",
            "Trending Supporter 📈",
            "Volume King 👑"
        ];

        let achievementVolume = 0;
        const signatures: string[] = [];

        for (let i = 0; i < Math.min(achievementBots.length, achievements.length); i++) {
            const achievement = achievements[i];
            const bot = achievementBots[i];

            // Small buy to "unlock" achievement
            const buyAmount = this.randomInRange(0.0002, 0.001);
            const result = await this.executeSingleBuy(mint, bot, [buyAmount, buyAmount]);

            if (result.success) {
                achievementVolume += buyAmount;
                if (result.signature) signatures.push(result.signature);

                // Announce achievement
                const announcement = `🎉 Achievement Unlocked: ${achievement} by ${bot.public_key.slice(0, 8)}...`;
                await this.postToChannel('x', announcement, mint);
            }

            await this.randomDelay(2000, 5000);
        }

        return {
            activity: 'ACHIEVEMENTS',
            success: achievementVolume > 0,
            engagement: achievements.length * 5,
            volume: achievementVolume,
            signatures
        };
    }

    private async executeVoteEvent(
        mint: PublicKey,
        config: any 
    ): Promise<any> {
        console.log(`   🗳️ Executing vote event...`);

        // Simulate voting with small transactions
        const voteBots = this.selectRandomBots(this.preparedBots || [], 0.3);

        let voteVolume = 0;
        const signatures: string[] = [];

        // Create voting options
        const options = ['Feature A', 'Feature B', 'Feature C', 'Feature D'];
        const selectedOption = options[Math.floor(Math.random() * options.length)];

        for (const bot of voteBots) {
            // Small "vote" transaction
            const voteAmount = this.randomInRange(0.0001, 0.0005);
            const result = await this.executeSingleBuy(mint, bot, [voteAmount, voteAmount]);

            if (result.success) {
                voteVolume += voteAmount;
                if (result.signature) signatures.push(result.signature);

                // Simulate vote announcement
                const voteAnnouncement = `🗳️ ${bot.public_key.slice(0, 8)}... voted for "${selectedOption}"!`;
                if (Math.random() > 0.7) {  // 30% chance to announce
                    await this.postToChannel('x', voteAnnouncement, mint);
                }
            }

            await this.randomDelay(1000, 4000);
        }

        // Announce results
        const resultAnnouncement = `📊 VOTE RESULTS: "${selectedOption}" wins with ${voteBots.length} votes! ` +
                              `Total voting volume: ${voteVolume.toFixed(4)} SOL`;
        await this.postToChannel('x', resultAnnouncement, mint);

        return {
            activity: 'VOTE_EVENTS',
            success: voteVolume > 0,
            engagement: voteBots.length * 2,
            volume: voteVolume,
            signatures
        };
    }

    private async executeCommunityChallenge(
        mint: PublicKey,
        config: any 
    ): Promise<any> {
        console.log(`   🎯 Executing community challenge...`);

        const challengeBots = this.selectRandomBots(this.preparedBots || [], 0.4);

        let challengeVolume = 0;
        const signatures: string[] = [];

        // Create challenge parameters
        const challengeGoal = this.randomInRange(0.01, 0.05);   // 0.01-0.05 SOL goal
        
        let currentVolume = 0;
        console.log(`   🎯 Challenge Goal: ${challengeGoal.toFixed(4)} SOL`);

        for (const bot of challengeBots) {
            // Each bot contributes to the challenge
            const contribution = this.randomInRange(0.0005, 0.002);
            const result = await this.executeSingleBuy(mint, bot, [contribution, contribution]);

            if (result.success) {
                currentVolume += contribution;
                challengeVolume += contribution;
                if (result.signature) signatures.push(result.signature);

                // Progress update
                const progress = (currentVolume / challengeGoal) * 100;
                if (progress >= 25 && progress < 50) {
                    console.log(`   📈 Challenge 25% complete!`);
                } else if (progress >= 50 && progress < 75) {
                    console.log(`   📈 Challenge 50% complete!`);
                } else if (progress >= 75 && progress < 100) {
                    console.log(`   📈 Challenge 75% complete!`);
                }
            }

            await this.randomDelay(1500, 4500);
        }

        // Check if challenge was successful
        const challengeSuccess = currentVolume >= challengeGoal * 0.8;  // 80% of goal

        // Announce results
        const resultText = challengeSuccess
            ? `🎉 CHALLENGE COMPLETE! ${currentVolume.toFixed(4)}/${challengeGoal.toFixed(4)} SOL raised! Community unlocked reward! 🎁`
            : `🏁 Challenge ended at ${currentVolume.toFixed(4)}/${challengeGoal.toFixed(4)} SOL. Great effort community! 👏`;

            await this.postToChannel('x', resultText, mint);

            return {
                activity: 'COMMUNITY_CHALLENGES',
                success: challengeVolume > 0,
                engagement: challengeBots.length * (challengeSuccess ? 4 : 2),
                volume: challengeVolume,
                signatures, 
                challengeSuccess,
                goalReached: challengeSuccess ? (currentVolume / challengeGoal) * 100 : 0
            };
    }

    private async executeNFTRewards(
        mint: PublicKey,
        config: any 
    ): Promise<any> {
        console.log(`   🖼️ Executing NFT rewards distribution...`);

        // Select winners for NFT rewards
        const winnerCount = Math.min(5, Math.floor(config.participantCount * 0.1));
        const winnerBots = this.selectRandomBots(this.preparedBots || [], winnerCount / (this.preparedBots?.length || 1));

        let rewardVolume = 0;
        const signatures: string[] = [];

        // NFT tier names
        const nftTiers = [
            { name: "Common", reward: 0.0003 },
            { name: "Rare", reward: 0.0006 },
            { name: "Epic", reward: 0.001 },
            { name: "Legendary", reward: 0.002 },
            { name: "Mythic", reward: 0.003 },
        ];

        for (let i = 0; i < winnerBots.length; i++) {
            const bot = winnerBots[i];
            const tier = nftTiers[Math.min(i, nftTiers.length - 1)];

            // "Claim" reward with a small buy
            const result = await this.executeSingleBuy(mint, bot, [tier.reward, tier.reward]);

            if (result.success) {
                rewardVolume += tier.reward;
                if (result.signature) signatures.push(result.signature);

                // Announce winner
                const announcement = `🎖️ NFT REWARD: ${bot.public_key.slice(0, 8)}... won ${tier.name} NFT! ` + 
                                        `Reward: ${tier.reward.toFixed(4)} SOL 🎉`;
                await this.postToChannel('x', announcement, mint);
            }

            await this.randomDelay(2000, 5000);
        }

        return {
            activity: 'NFT_REWARDS',
            success: rewardVolume > 0,
            engagement: winnerBots.length * 5,  // High engagement for rewards
            volume: rewardVolume,
            signatures,
            winners: winnerBots.length
        };
    }

    private async executeGenericSocialActivity(
        mint: PublicKey,
        config: any 
    ): Promise<any> {
        console.log(`   🎪 Executing generic social activity...`);

        const activityBots = this.selectRandomBots(this.preparedBots || [], 0.2);

        let activityVolume = 0;
        const signatures: string[] = [];

        // Generic activity - small varied transactions
        for (const bot of activityBots) {
            const amount = this.randomInRange(0.0002, 0.001);
            const result = await this.executeSingleBuy(mint, bot, [amount, amount]);

            if (result.success) {
                activityVolume += amount;
                if (result.signature) signatures.push(result.signature);
            }

            // Random delay for organic deal
            await this.randomDelay(1000, 5000);
        }

        // Generic announcement
        await this.postToChannel('discord', 
            `🤝 Community activity complete! ${activityBots.length} participants, ` +
            `${activityVolume.toFixed(4)} SOL volume. Keep building! 🚀`, 
            mint
        );

        return {
            activity: 'GENERIC_SOCIAL',
            success: activityVolume > 0,
            engagement: activityBots.length * 2,
            volume: activityVolume,
            signatures
        };
    }



    private generateLeaderboardText(bots: BotWallet[], totalVolume: number): string {
        const entries = bots.map((bot, index) => 
            `${index + 1}. ${bot.public_key.slice(0, 8)}... - ${this.randomInRange(0.5, 5).toFixed(2)} SOL volume`
        ).join('\n');

        return `🏆 **LEADERBOARD UPDATE** 🏆\n\n` +
        `Top holders competing for the crown:\n\n` + 
        `${entries}\n\n` +
        `Total competition volume: ${totalVolume.toFixed(4)} SOL\n` +
        `Next update in 1 hour!`;
    }

    private updateSocialActivityRegistry(
        mint: PublicKey,
        activityType: string,
        result: { success: boolean; engagement?: number }
    ): void {
        const mintKey = mint.toBase58();
        const registryKey = `${mintKey}:${activityType}`;

        if (!this.socialActivityRegistry.has(registryKey)) {
            this.socialActivityRegistry.set(registryKey, {
                type: activityType,
                lastExecuted: Date.now(),
                successRate: result.success ? 1 : 0,
                totalEngagement: result.engagement || 0,
                attempts: 1,
                successes: result.success ? 1 : 0
            });
        } else {
            const registry = this.socialActivityRegistry.get(registryKey)!;
            registry.lastExecuted = Date.now();
            registry.attempts += 1;
            registry.successes += result.success ? 1 : 0;
            registry.successRate = registry.successes / registry.attempts;
            registry.totalEngagement += result.engagement || 0;
        }
    }

    private async postSocialActivitiesSummary(
        mint: PublicKey,
        results: any[],
        config: any 
    ): Promise<void> {
        const successfulActivities = results.filter(r => r.success);

        if (successfulActivities.length === 0) return;

        const totalVolume = successfulActivities.reduce((sum, r) => sum + r.volume, 0);
        const totalEngagement = successfulActivities.reduce((sum, r) => sum + r.engagement, 0);

        const summary = `🎪 **SOCIAL ACTIVITIES SUMMARY**\n\n` +
                        `Completed ${successfulActivities.length}/${config.activities.length} activities:\n\n` +
                        `• Total Volume: ${totalVolume.toFixed(4)} SOL\n` +
                        `• Total Engagement: ${totalEngagement.toFixed(0)} points\n` +
                        `• Successful Activities: ${successfulActivities.map(a => a.activity).join(', ')}\n\n` +
                        `Community is growing strong! 🚀`;
    
        await this.postToChannel('discord', summary, mint);
    }


    // ===================== SOCIAL MEDIA ENDS STARTS HERE ==========================



    // ====================================
    // HELPER METHODS
    // ====================================

    private selectRandomBots(
        bots: BotWallet[],
        percentage: number
    ): BotWallet[] {
        if (bots.length === 0 || percentage <= 0) return [];
        
        const count = Math.max(1, Math.floor(bots.length * percentage));
        const shuffled = [...bots].sort(() => Math.random() - 0.5);
        return shuffled.slice(0, count);
    }

    private async prepareBotWallets(
        fundedBots: Array<{public_key: string, amount_sol: number, private_key?: string}>
    ): Promise<BotWallet[]> {
        console.log(`\n🤖 Preparing ${fundedBots.length} bot wallets...`);
        
        const preparedBots: BotWallet[] = [];
        
        for (let i = 0; i < fundedBots.length; i++) {
            const bot = fundedBots[i];
            
            // Verify the bot has a private key
            if (!bot.private_key) {
                console.log(`  ⚠️ Bot ${bot.public_key.slice(0, 8)}... has no private key, skipping`);
                continue;
            }
            
            // Check if bot has ANY balance (very low threshold)
            const balance = await this.getBotSolBalance(bot.public_key);
            if (balance < 0.00001) { // Very low threshold
                console.log(`  ⚠️ Bot ${bot.public_key.slice(0, 8)}... very low balance: ${balance.toFixed(6)} SOL`);
                // Still add it - it might have just enough for tiny trades
            }
            
            preparedBots.push({
                public_key: bot.public_key,
                private_key: bot.private_key,
                amount_sol: bot.amount_sol
            });
            
            console.log(`  ${i+1}. ${bot.public_key.slice(0, 8)}...: ${balance.toFixed(6)} SOL`);
            
            // Very small delay to avoid rate limiting
            if (i < fundedBots.length - 1) {
                await this.randomDelay(50, 150);
            }
        }
        
        console.log(`✅ Prepared ${preparedBots.length}/${fundedBots.length} bot wallets`);
        return preparedBots;
    }


    private async getCurrentPrice(mint: PublicKey): Promise<number> {
        const bondingCurve = await BondingCurveFetcher.fetch(this.connection, mint, false);
        if (!bondingCurve) return 0;
        return Number(bondingCurve.virtual_sol_reserves) / LAMPORTS_PER_SOL;
    }

    private async getBotTokenBalance(mint: PublicKey, bot: BotWallet): Promise<number> {
        try {
            const ata = getAssociatedTokenAddressSync(
                mint,
                new PublicKey(bot.public_key),
                false,
                TOKEN_2022_PROGRAM_ID
            );
            
            const tokenBalanceInfo = await this.connection.getTokenAccountBalance(ata, 'processed');
            return Number(tokenBalanceInfo.value.amount);
        } catch (error) {
            // Token account might not exist yet
            return 0;
        }
    }

    private async calculateTokenValue(mint: PublicKey, tokenAmount: number): Promise<number> {
        try {
            const bondingCurve = await BondingCurveFetcher.fetch(this.connection, mint, false);
            if (!bondingCurve) return 0;

            const solReserves = Number(bondingCurve.virtual_sol_reserves);
            const tokenReserves = Number(bondingCurve.virtual_token_reserves);
            
            if (tokenReserves === 0) return 0;
            
            const solValue = (tokenAmount * solReserves) / (tokenReserves + tokenAmount);
            return solValue / LAMPORTS_PER_SOL;
        } catch (error) {
            return 0;
        }
    }


    private async executeEmergencyVolumeBoost(mint: PublicKey, bots: BotWallet[]) {
        console.log(`🚨 Emergency volume boost with ${bots.length} bots`);
        
        // Quick buy-sell cycle
        const buyResult = await this.executeBotBuysWave(mint, bots, {
            amountRange: [0.0005, 0.0015] as [number, number],
            delayRange: [50, 150],
            simultaneous: 3
        });

        await this.randomDelay(200, 500);

        const sellResult = await this.executeBotSellsWave(mint, bots, {
            percentageRange: [30, 60] as [number, number],
            delayRange: [100, 300],
            minSolValue: 0.0001
        });

        return buyResult.totalSol + sellResult.totalSol;
    }

    private async simulateWhaleActivity(
        mint: PublicKey,
        bots: BotWallet[]
    ): Promise<{volume: number, signatures: string[]}> {  // Add return type
        console.log(`🐋 Simulating whale activity...`);
        
        let totalVolume = 0;
        const signatures: string[] = [];
        
        // Select 1-2 "whale" bots (ones with more balance)
        const whaleBots = this.selectRandomBots(bots, 0.2).slice(0, 2);
        
        for (const whale of whaleBots) {
            try {
                // Larger buy (looks like a whale)
                const whaleAmount = this.randomInRange(0.003, 0.008); // 0.003-0.008 SOL
                
                const buyResult = await this.executeSingleBuy(mint, whale, [whaleAmount, whaleAmount]);
                
                if (buyResult.success) {
                    totalVolume += buyResult.amount;
                    if (buyResult.signature) signatures.push(buyResult.signature);
                }
                
                // Wait before next whale (organic timing)
                await this.randomDelay(3000, 8000);
                
                // Partial sell to create liquidity
                const tokenBalance = await this.getBotTokenBalance(mint, whale);
                if (tokenBalance > 0) {
                    const sellAmount = Math.floor(tokenBalance * 0.3); // Sell 30%
                    const sellResult = await this.executeSingleSell(mint, whale, sellAmount);
                    
                    if (sellResult.success) {
                        totalVolume += sellResult.solReceived || 0;
                        if (sellResult.signature) signatures.push(sellResult.signature);
                    }
                }
                
            } catch (error) {
                console.error(`Whale simulation error: ${error.message}`);
            }
        }
        
        return { volume: totalVolume, signatures };  // Return the object
    }

    private async simulateSocialProofTrades(
        mint: PublicKey,
        bots: BotWallet[]
    ): Promise<{volume: number, signatures: string[]}> {  // Add return type
        console.log(`📱 Simulating social proof trades...`);
        
        let totalVolume = 0;
        const signatures: string[] = [];
        
        // Use 30-40% of bots for small, frequent trades
        const socialBots = this.selectRandomBots(bots, 0.4);
        
        // Create 3-5 waves of trading
        const waveCount = Math.floor(this.randomInRange(3, 5));
        
        for (let wave = 0; wave < waveCount; wave++) {
            console.log(`   Wave ${wave + 1}: ${socialBots.length} bots`);
            
            // Small buys (0.0002 - 0.0008 SOL) - looks like retail traders
            const buyPromises = socialBots.map(bot => 
                this.executeSingleBuy(mint, bot, [0.0002, 0.0008])
            );
            
            const buyResults = await Promise.allSettled(buyPromises);
            
            // Track successful buys
            buyResults.forEach(result => {
                if (result.status === 'fulfilled' && result.value.success) {
                    totalVolume += result.value.amount;
                    if (result.value.signature) signatures.push(result.value.signature);
                }
            });
            
            // Wait between waves (makes it look like different traders)
            await this.randomDelay(2000, 5000);
            
            // Some sell pressure (20-40% of holdings)
            const sellPromises = socialBots.map(async (bot) => {
                try {
                    const tokenBalance = await this.getBotTokenBalance(mint, bot);
                    if (tokenBalance > 1000) { // Only if has tokens
                        const sellPercentage = this.randomInRange(20, 40) / 100;
                        const sellAmount = Math.floor(tokenBalance * sellPercentage);
                        return this.executeSingleSell(mint, bot, sellAmount);
                    }
                } catch (error) {
                    console.error(`Social sell error: ${error.message}`);
                    return null;
                }
            });
            
            const sellResults = await Promise.allSettled(sellPromises);
            
            // Track successful sells
            sellResults.forEach(result => {
                if (result.status === 'fulfilled' && result.value) {
                    totalVolume += result.value.solReceived || 0;
                    if (result.value.signature) signatures.push(result.value.signature);
                }
            });
            
            // Longer delay between waves
            if (wave < waveCount - 1) {
                await this.randomDelay(8000, 15000);
            }
        }
        
        return { volume: totalVolume, signatures };  // Return the object
    }

    private selectBotsByPercentage(bots: BotWallet[], percentage: number): BotWallet[] {
        const count = Math.max(1, Math.floor(bots.length * percentage));
        return bots.slice(0, count);
    }

    private randomInRange(min: number, max: number): number {
        return Math.random() * (max - min) + min;
    }

    private async randomDelay(minMs: number, maxMs: number): Promise<void> {
        const delay = this.randomInRange(minMs, maxMs);
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    private updateProfitTracker(invested: number, returned: number): void {
        this.profitTracker.totalInvested += invested;
        this.profitTracker.totalReturned += returned;
        
        if (returned > invested * 0.9) { // At least 90% return considered successful
            this.profitTracker.successfulLaunches++;
        } else {
            this.profitTracker.failedLaunches++;
        }

        const totalLaunches = this.profitTracker.successfulLaunches + this.profitTracker.failedLaunches;
        const successRate = totalLaunches > 0 ? (this.profitTracker.successfulLaunches / totalLaunches) * 100 : 0;
        const totalROI = this.profitTracker.totalInvested > 0 ? 
            ((this.profitTracker.totalReturned - this.profitTracker.totalInvested) / this.profitTracker.totalInvested) * 100 : 0;

        console.log(`📈 Lifetime Stats: ${successRate.toFixed(1)}% success | ${totalROI.toFixed(1)}% ROI`);
    }

}





















