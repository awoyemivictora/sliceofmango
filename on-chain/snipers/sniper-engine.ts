// sniper-engine.ts - OPTIMIZED FOR JITO
import {
    Connection,
    Keypair,
    PublicKey,
    VersionedTransaction,
    TransactionMessage,
    ComputeBudgetProgram,
    LAMPORTS_PER_SOL,
    Commitment,
    TransactionInstruction,
    SystemProgram
} from "@solana/web3.js";
import {
    getAssociatedTokenAddressSync,
    createAssociatedTokenAccountIdempotentInstruction,
    TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import axios from 'axios';
import bs58 from 'bs58';
import WebSocket from 'ws';

// Import our IDL-based client
import {
    PumpFunInstructionBuilder,
    BondingCurveMath,
    PumpFunPda
} from '../pumpfun/pumpfun-idl-client';
import { jitoBundleSender, JitoBundleSender } from "../jito_bundles/jito-integration";

// ============================================
// CONFIGURATION
// ============================================
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';
const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const ONCHAIN_API_KEY = process.env.ONCHAIN_API_KEY;

export const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');


// Connection setup
const connection = new Connection(RPC_URL, {
    commitment: 'confirmed' as Commitment,
    confirmTransactionInitialTimeout: 8000,
    disableRetryOnRateLimit: false,
});

// ============================================
// INTERFACES
// ============================================
interface UserConfig {
    wallet_address: string;
    buy_amount_sol: number;
    buy_slippage_bps: number;
    is_premium: boolean;
    encrypted_private_key: string;
    sol_balance: number;
    has_ws_connection: boolean;
    has_bot_state: boolean;
    has_active_task: boolean;
}

interface TokenData {
    Name: string;
    Symbol: string;
    Mint: string;
    Bonding_Curve: string;
    Creator: string;
    signature: string;
    timestamp: string;
    VirtualTokenReserves: string;
    VirtualSolReserves: string;
    RealTokenReserves: string;
    TokenTotalSupply: string;
}

interface SnipeResult {
    success: boolean;
    token: string;
    users: string[];
    bundleId?: string;
    error?: string;
    timestamp: number;
    executionMethod?: 'jito' | 'rpc';
    retryCount?: number;
}

// ============================================
// PRODUCTION SNIPER ENGINE
// ============================================
export class ProductionSniperEngine {
    private activeUsers: Map<string, UserConfig> = new Map();
    private userKeypairs: Map<string, Keypair> = new Map();
    private lastFetchTime = 0;
    private readonly USER_REFRESH_INTERVAL = 3000; // Increased to reduce load
    
    private recentSnipedTokens = new Map<string, number>();
    private readonly RECENT_SNIPE_TTL = 30000;
    
    private stats = {
        totalSnipes: 0,
        successfulSnipes: 0,
        jitoSuccesses: 0,
        rpcSuccesses: 0,
        failedSnipes: 0,
        totalUsersSnipped: 0,
        totalVolume: 0,
        lastSnipeTime: 0
    };

    private activationWebSocket: WebSocket | null = null;
    private readonly ACTIVATION_WS_URL = process.env.BACKEND_WS_URL || 'ws://localhost:8000';

    constructor() {
        this.initialize();
    }

    private async initialize(): Promise<void> {
        // console.log('🚀 ULTRA-FAST PUMP.FUN SNIPER ENGINE v2.0');
        // console.log('🔧 Jito-optimized version');

        // Initialize Jito with connection testing
        try {
            await jitoBundleSender.initialize();
            // console.log('✅ Jito SDK initialized with endpoint testing');
        } catch (error) {
            console.error('⚠️ Jito SDK initialization failed:', error);
        }

        // Start services
        this.startUserRefreshLoop();
        this.connectToActivationWebSocket();
        // this.startHealthMonitor();
        this.cleanupRecentSnipes();

        // console.log('✅ Engine Initialized - READY FOR PRODUCTION');
        // console.log('ℹ️  RPC fallback is enabled when Jito is rate limited');
    }

    // ============================================
    // MAIN SNIPING LOGIC
    // ============================================

    public async immediateTokenSnipping(tokenData: TokenData): Promise<SnipeResult> {
        const startTime = Date.now();
        // console.log(`\n⚡ IMMEDIATE SNIPE TRIGGERED: ${tokenData.Name} (${tokenData.Symbol})`);

        // 1. IMMEDIATELY snag the mint and creator from the fresh event data
        const mint = new PublicKey(tokenData.Mint);
        const creator = new PublicKey(tokenData.Creator); // Already in the CreateEvent!

        try {
            // 3. Get users READY (don't wait for this to finish - parallelize)
            const eligibleUsers = await this.getEligibleUsersForToken(tokenData);
            if (eligibleUsers.length === 0) {
                throw new Error('No eligible users for snipe');
            }

            // console.log(`👥 Sniping for ${eligibleUsers.length} user${eligibleUsers.length > 1 ? 's' : ''}`);

            // 4. KEY FIX: Don't fetch bonding curve from chain - use data from the CreateEvent!
            // The Shyft example shows VirtualTokenReserves, VirtualSolReserves are in the event
            const virtualTokenReserves = BigInt(tokenData.VirtualTokenReserves || "1000000000");
            const virtualSolReserves = BigInt(tokenData.VirtualSolReserves || "1000000000");

            // console.log(`📊 Using CreateEvent data - Reserves: ${Number(virtualSolReserves)/LAMPORTS_PER_SOL} SOL, ${virtualTokenReserves} tokens`);

            // 6. Execute snipe with the now-ready token
            const bundleResult = await this.executeUltraFastBundle(eligibleUsers, mint, creator, virtualTokenReserves, virtualSolReserves);
            
            const executionTime = Date.now() - startTime;
            
            if (bundleResult.success) {
                console.log(`✅ SNIPE COMPLETED in ${executionTime}ms via ${bundleResult.method}`);
                this.recentSnipedTokens.set(tokenData.Mint, Date.now());
                
                return {
                    success: true,
                    token: tokenData.Mint,
                    users: eligibleUsers.map(u => u.wallet_address),
                    bundleId: bundleResult.bundleId,
                    timestamp: Date.now(),
                    executionMethod: bundleResult.method,
                    retryCount: bundleResult.retryCount
                };
            } else {
                throw new Error('Bundle execution failed');
            }

        } catch (error: any) {
            console.error(`❌ SNIPE FAILED:`, error.message);
            return {
                success: false,
                token: tokenData.Mint,
                users: [],
                error: error.message,
                timestamp: Date.now()
            };
        }
    }

    private async executeUltraFastBundle(
        users: UserConfig[],
        mint: PublicKey,
        creator: PublicKey,
        virtualTokenReserves: bigint,
        virtualSolReserves: bigint
    ): Promise<{ bundleId: string; success: boolean; method: 'jito' | 'rpc'; retryCount?: number }> {
        // console.log(`📦 Building ultra-fast bundle...`);
        
        // Limit to 1 user
        const user = users[0];
        const keypair = this.userKeypairs.get(user.wallet_address);
        
        if (!keypair) {
            throw new Error(`No keypair for ${user.wallet_address.slice(0, 8)}`);
        }

        // console.log(`👤 Building for user: ${user.wallet_address.slice(0, 8)}...`);
        
        // Create transaction using event data instead of fetching
        const transaction = await this.createOptimizedBuyTransaction(
            keypair,
            mint,
            creator,
            user.buy_amount_sol,
            user.buy_slippage_bps,
            virtualTokenReserves,
            virtualSolReserves
        );

        // console.log(`✅ Transaction prepared`);

        // Try Jito first
        // console.log('🚀 Attempting Jito bundle...');
        const jitoResult = await jitoBundleSender.sendBundle([transaction], connection);
        
        if (jitoResult.success) {
            return {
                bundleId: jitoResult.bundleId,
                success: true,
                method: 'jito',
                retryCount: jitoResult.retryCount
            };
        }

        // Jito failed, try RPC fallback
        console.log('🔄 Jito failed, trying RPC with simulation...');
        
        // Try RPC with simulation enabled
        try {
            console.log(`📤 Sending via RPC (with preflight)...`);
            const signature = await connection.sendTransaction(transaction, {
                skipPreflight: false, // Enable preflight for better error messages
                maxRetries: 3,
                preflightCommitment: 'confirmed'
            });
            
            console.log(`✅ RPC TX sent: ${signature.slice(0, 16)}...`);
            
            return {
                bundleId: `rpc_${Date.now()}`,
                success: true,
                method: 'rpc'
            };
            
        } catch (rpcError: any) {
            console.error(`❌ RPC failed:`, rpcError.message);
            
            if (rpcError.logs) {
                console.error(`   Logs (first 10):`);
                rpcError.logs.slice(0, 10).forEach((log: string, i: number) => {
                    console.error(`     ${i}: ${log}`);
                });
            }
            
            throw new Error(`RPC execution failed: ${rpcError.message}`);
        }
    }

    
    

    // Add this to your sniper-engine.ts in the ProductionSniperEngine class
    // private async createBondingCurveTokenAccount(
    //     keypair: Keypair,
    //     mint: PublicKey,
    //     bondingCurvePda: PublicKey
    // ): Promise<TransactionInstruction> {
    //     // Get the associated token account for the bonding curve PDA
    //     const associatedBondingCurve = getAssociatedTokenAddressSync(
    //         mint,
    //         bondingCurvePda,
    //         true, // allowOwnerOffCurve = true (PDA is owner)
    //         TOKEN_2022_PROGRAM_ID // Use Token Program, not Token-2022
    //     );

    //     console.log(`🔧 Getting bonding curve ATA: ${associatedBondingCurve.toBase58().slice(0, 8)} for ${mint}...`);

    //     // Create the account if it doesn't exist
    //     return createAssociatedTokenAccountIdempotentInstruction(
    //         keypair.publicKey,           // payer
    //         associatedBondingCurve,      // account to create
    //         bondingCurvePda,             // owner (bonding curve PDA)
    //         mint,                        // mint
    //         TOKEN_2022_PROGRAM_ID             // token program
    //     );
    // }

    // ============================================
    // RPC FALLBACK EXECUTION
    // ============================================
    
    private async createOptimizedBuyTransaction(
        keypair: Keypair,
        mint: PublicKey,
        creator: PublicKey,
        amountSol: number,
        slippageBps: number,
        virtualTokenReserves: bigint,
        virtualSolReserves: bigint
    ): Promise<VersionedTransaction> {
        const userPubkey = keypair.publicKey;
        
        // console.log(`🔧 Building transaction for ${userPubkey.toBase58().slice(0, 8)}...`);
        
        const spendableSolIn = BigInt(Math.floor(amountSol * LAMPORTS_PER_SOL));
        
        // Calculate using event data
        const expectedTokens = BondingCurveMath.calculateTokensForSol(
            virtualSolReserves,
            virtualTokenReserves,
            spendableSolIn
        );

        if (expectedTokens <= 0n) {
            throw new Error(`Invalid token amount: ${expectedTokens}`);
        }

        // Apply fees and slippage
        const { netAmount: tokensAfterFees } = BondingCurveMath.applyFees(
            expectedTokens,
            100n, // 1% protocol fee
            50n   // 0.5% creator fee
        );
        
        const minTokensOut = BondingCurveMath.applySlippage(tokensAfterFees, slippageBps);
            
        // Get blockhash
        const { blockhash } = await connection.getLatestBlockhash('processed');
        
        const instructions: TransactionInstruction[] = [];

        // Add priority fee
        instructions.push(ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: 1000000 // 0.001 SOL
        }));

        // Get addresses
        const userAta = getAssociatedTokenAddressSync(
            mint, 
            userPubkey, 
            false, 
            TOKEN_2022_PROGRAM_ID); // Changed to TOKEN_PROGRAM_ID
        
        const bondingCurvePda = PumpFunPda.getBondingCurve(mint);

        // 1. Create user ATA
        instructions.push(
            createAssociatedTokenAccountIdempotentInstruction(
                userPubkey,      // payer
                userAta,         // ata to create
                userPubkey,      // owner
                mint,            // mint
                TOKEN_2022_PROGRAM_ID  // token program
            )
        );

        // 2. Create bonding curve ATA (CRITICAL FIX!)
        // const createBondingCurveInstruction = await this.createBondingCurveTokenAccount(
        //     keypair,
        //     mint,
        //     bondingCurvePda
        // );
        // instructions.push(createBondingCurveInstruction);
        
        console.log(`🔧 Creating pump.fun buy instruction...`);
        // console.log(`   User ATA: ${userAta.toBase58().slice(0, 8)}...`);
        // console.log(`   Creator: ${creator.toBase58().slice(0, 8)}...`);
        // console.log(`   SOL In: ${Number(spendableSolIn)/LAMPORTS_PER_SOL} SOL`);
        // console.log(`   Min Tokens Out: ${minTokensOut}`);
        
        // 3. Add buy instruction
        const buyInstruction = PumpFunInstructionBuilder.buildBuyExactSolIn(
            userPubkey,
            mint,
            userAta,
            creator,
            spendableSolIn,
            minTokensOut,
        );

        instructions.push(buyInstruction);

        // After creating buyInstruction, add:
        // console.log(`📊 Instruction details:`);
        // console.log(`   trackVolume param: false`);
        // console.log(`   Total accounts in instruction: ${buyInstruction.keys.length}`);
        // console.log(`   Expected when trackVolume=false: 14 accounts`);
        // console.log(`   Actual: ${buyInstruction.keys.length} accounts`);

        // // After creating the instruction
        // console.log(`✅ Instruction created with ${buyInstruction.keys.length} accounts`);
        // console.log(`📋 Expected: 16 accounts (0-15)`);

        // Verify each account
        // const expectedAccounts = [
        //     "global", "fee_recipient", "mint", "bonding_curve", 
        //     "associated_bonding_curve", "associated_user", "user", 
        //     "system_program", "token_program", "creator_vault", 
        //     "event_authority", "program", "fee_config", "fee_program"
        // ];

        // buyInstruction.keys.forEach((key, i) => {
        //     console.log(`   ${i}: ${expectedAccounts[i] || 'UNKNOWN'} - ${key.pubkey.toBase58().slice(0, 16)}...`);
        // });

        // // Debug: Check instruction accounts
        // console.log(`🔍 Debugging buy instruction:`);
        // PumpFunInstructionBuilder.debugInstruction(buyInstruction);

        // Build transaction
        // console.log(`🔧 Compiling transaction message...`);
        const messageV0 = new TransactionMessage({
            payerKey: userPubkey,
            recentBlockhash: blockhash,
            instructions
        }).compileToV0Message();

        // console.log(`🔧 Signing transaction...`);
        const transaction = new VersionedTransaction(messageV0);
        transaction.sign([keypair]);

        console.log(`✅ Transaction built with ${instructions.length} instructions`);
        
        return transaction;
    }

    // ============================================
    // USER MANAGEMENT (REST OF YOUR CODE - UNCHANGED)
    // ============================================
    
    private async getEligibleUsersForToken(tokenData: TokenData): Promise<UserConfig[]> {
        const eligibleUsers: UserConfig[] = [];
        
        for (const [wallet, user] of this.activeUsers) {
            try {
                const keypair = this.userKeypairs.get(wallet);
                if (!keypair) continue;

                const balance = await this.getUserBalance(wallet);
                const required = user.buy_amount_sol + 0.02;
                
                if (balance < required) continue;

                eligibleUsers.push(user);

            } catch (error) {
                console.error(`User eligibility check failed:`, error);
            }
        }

        return eligibleUsers;
    }

    private async getUserBalance(wallet: string): Promise<number> {
        try {
            const balance = await connection.getBalance(new PublicKey(wallet), 'confirmed');
            return balance / LAMPORTS_PER_SOL;
        } catch {
            return 0;
        }
    }

    private async startUserRefreshLoop(): Promise<void> {
        while (true) {
            try {
                await this.refreshActiveUsers();
                await this.refreshKeypairs();
                await new Promise(resolve => setTimeout(resolve, this.USER_REFRESH_INTERVAL));
            } catch (error) {
                console.error('User refresh error:', error);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }

    private async refreshActiveUsers(): Promise<void> {
        const timeSinceLastFetch = Date.now() - this.lastFetchTime;
        if (timeSinceLastFetch < 1000) {
            await new Promise(resolve => setTimeout(resolve, 1000 - timeSinceLastFetch));
        }

        try {
            const response = await axios.get(`${BACKEND_URL}/user/active-users`, {
                params: { api_key: ONCHAIN_API_KEY },
                timeout: 5000
            });

            const newUsers = new Map<string, UserConfig>();
            if (response.data?.users) {
                for (const user of response.data.users) {
                    if (this.isUserEligibleForSniping(user)) {
                        newUsers.set(user.wallet_address, user);
                    }
                }
            }

            this.activeUsers = newUsers;
            this.lastFetchTime = Date.now();

            if (newUsers.size > 0 && newUsers.size !== this.activeUsers.size) {
                console.log(`👤 Active users: ${newUsers.size}`);
            }

        } catch (error: any) {
            if (error.code !== 'ECONNABORTED') {
                console.error('User refresh failed:', error.message);
            }
        }
    }

    private isUserEligibleForSniping(user: UserConfig): boolean {
        if (!user.encrypted_private_key || user.encrypted_private_key.length < 20) {
            return false;
        }

        const minBalance = (user.buy_amount_sol || 0.1) + 0.02;
        if (user.sol_balance < minBalance) {
            return false;
        }

        return true;
    }

    private async refreshKeypairs(): Promise<void> {
        const startTime = Date.now();
        let decrypted = 0;

        for (const [wallet, user] of this.activeUsers) {
            if (this.userKeypairs.has(wallet)) continue;

            try {
                const keypair = await this.decryptUserKeypair(user);
                if (keypair) {
                    this.userKeypairs.set(wallet, keypair);
                    decrypted++;
                }
            } catch (error) {
                console.error(`Failed to decrypt keypair for ${wallet.slice(0, 8)}`);
                this.activeUsers.delete(wallet);
            }
        }

        if (decrypted > 0) {
            console.log(`🔑 Decrypted ${decrypted} keypairs in ${Date.now() - startTime}ms`);
        }
    }

    private async decryptUserKeypair(user: UserConfig): Promise<Keypair | null> {
        try {
            const decoded = bs58.decode(user.encrypted_private_key);
            if (decoded.length === 64) {
                return Keypair.fromSecretKey(decoded);
            }
        } catch (error) {
            console.error('Keypair decryption error:', error);
        }
        return null;
    }

    private async connectToActivationWebSocket(): Promise<void> {
        try {
            this.activationWebSocket = new WebSocket(`${this.ACTIVATION_WS_URL}/ws/sniper-activations`);
            
            this.activationWebSocket.on('open', () => {
                console.log('📡 Connected to activation WebSocket');
            });
            
            this.activationWebSocket.on('message', async (data: WebSocket.Data) => {
                try {
                    const message = typeof data === 'string' ? data : data.toString();
                    const parsed = JSON.parse(message);
                    
                    if (parsed.type === 'user_activated') {
                        await this.refreshActiveUsers();
                    }
                } catch (error) {
                    console.error('WebSocket message error:', error);
                }
            });
            
            this.activationWebSocket.on('error', (error: Error) => {
                console.error('WebSocket error:', error);
            });
            
            this.activationWebSocket.on('close', () => {
                console.log('WebSocket closed, reconnecting...');
                setTimeout(() => this.connectToActivationWebSocket(), 2000);
            });
            
        } catch (error) {
            console.error('WebSocket connection failed:', error);
            setTimeout(() => this.connectToActivationWebSocket(), 2000);
        }
    }

    // private startHealthMonitor(): void {
    //     setInterval(() => {
    //         const health = this.getHealthStatus();
    //         console.log(`📊 Health: ${health.healthScore}% | Jito: ${health.jitoSuccessRate}% | RPC: ${health.rpcFallbackRate}%`);
            
    //         if (health.healthScore < 80) {
    //             console.warn(`⚠️ Health score low: ${health.healthScore}%`);
    //         }
    //     }, 60000); // Every minute
    // }

    private cleanupRecentSnipes(): void {
        setInterval(() => {
            const now = Date.now();
            for (const [mint, timestamp] of this.recentSnipedTokens.entries()) {
                if (now - timestamp > this.RECENT_SNIPE_TTL) {
                    this.recentSnipedTokens.delete(mint);
                }
            }
        }, 30000);
    }

    private async logSnipeToBackend(
        users: UserConfig[],
        tokenData: TokenData,
        bundleResult: { bundleId: string; success: boolean }
    ): Promise<void> {
        try {
            await axios.post(`${BACKEND_URL}/trade/immediate-snipe`, {
                trades: users.map(user => ({
                    user_wallet_address: user.wallet_address,
                    mint_address: tokenData.Mint,
                    token_symbol: tokenData.Symbol,
                    token_name: tokenData.Name,
                    trade_type: 'immediate_snipe',
                    amount_sol: user.buy_amount_sol,
                    bundle_id: bundleResult.bundleId,
                    timestamp: new Date().toISOString()
                })),
                token_data: tokenData,
                bundle_id: bundleResult.bundleId
            }, {
                headers: { 'X-API-Key': ONCHAIN_API_KEY },
                timeout: 2000
            });
        } catch (error) {
            console.error('Failed to log snipe:', error);
        }
    }

    // public getHealthStatus(): {
    //     healthScore: number;
    //     activeUsers: number;
    //     cachedKeypairs: number;
    //     jitoSuccessRate: number;
    //     rpcFallbackRate: number;
    //     stats: typeof this.stats;
    // } {
    //     const healthScore = this.calculateHealthScore();
        
    //     const jitoSuccessRate = this.stats.totalSnipes > 0 
    //         ? (this.stats.jitoSuccesses / this.stats.totalSnipes) * 100 
    //         : 0;
        
    //     const rpcFallbackRate = this.stats.totalSnipes > 0 
    //         ? (this.stats.rpcSuccesses / this.stats.totalSnipes) * 100 
    //         : 0;
        
    //     return {
    //         healthScore,
    //         activeUsers: this.activeUsers.size,
    //         cachedKeypairs: this.userKeypairs.size,
    //         jitoSuccessRate: Math.round(jitoSuccessRate),
    //         rpcFallbackRate: Math.round(rpcFallbackRate),
    //         stats: { ...this.stats }
    //     };
    // }

    private calculateHealthScore(): number {
        let score = 100;
        
        if (this.activeUsers.size === 0) score -= 40;
        if (this.userKeypairs.size === 0) score -= 40;
        
        const successRate = this.stats.totalSnipes > 0 
            ? (this.stats.successfulSnipes / this.stats.totalSnipes) * 100 
            : 100;
        
        if (successRate < 60) score -= 30;
        if (successRate > 80) score += 10;
        
        return Math.max(0, Math.min(100, Math.round(score)));
    }

    public async emergencyStop(): Promise<void> {
        console.log('🛑 EMERGENCY STOP INITIATED');
        
        this.activeUsers.clear();
        this.userKeypairs.clear();
        this.recentSnipedTokens.clear();
        
        try {
            await axios.post(`${BACKEND_URL}/sniper/emergency-stop`, {}, {
                headers: { 'X-API-Key': ONCHAIN_API_KEY },
                timeout: 2000
            });
        } catch (error) {
            console.error('Emergency stop notification failed:', error);
        }
        
        console.log('✅ Emergency stop complete');
    }
}

// ============================================
// EXPORTS
// ============================================
export const sniperEngine = new ProductionSniperEngine();
export const immediateTokenSniping = sniperEngine.immediateTokenSnipping.bind(sniperEngine);

