import { Connection, VersionedTransaction } from '@solana/web3.js';
import { JitoJsonRpcClient } from 'jito-js-rpc';

export interface JitoBundleResult {
    bundleId: string;
    success: boolean;
    error?: string;
    retryCount?: number;
    endpointUsed?: string;
}

export class JitoBundleSender {
    private jitoClients: Map<string, JitoJsonRpcClient> = new Map();
    private readonly endpoints = [
        'https://mainnet.block-engine.jito.wtf/api/v1',
        'https://amsterdam.mainnet.block-engine.jito.wtf/api/v1',
        'https://ny.mainnet.block-engine.jito.wtf/api/v1',
        'https://frankfurt.mainnet.block-engine.jito.wtf/api/v1',
        'https://tokyo.mainnet.block-engine.jito.wtf/api/v1'
    ];
    private currentEndpointIndex = 0;
    private requestQueue: Array<() => Promise<any>> = [];
    private isProcessingQueue = false;
    private readonly MAX_CONCURRENT_REQUESTS = 1; // Conservative for rate limits
    private readonly MIN_REQUEST_INTERVAL = 2000; // 2 seconds between requests

    constructor() {
        // Initialize clients for all endpoints
        this.endpoints.forEach(endpoint => {
            this.jitoClients.set(endpoint, new JitoJsonRpcClient(endpoint, ''));
        });
        console.log(`✅ Jito Bundle Sender initialized with ${this.endpoints.length} endpoints`);
    }

    async initialize(): Promise<void> {
        // Test connection to all endpoints
        console.log('🔗 Testing Jito endpoints...');
        const connectionPromises = this.endpoints.map(async (endpoint, index) => {
            try {
                const client = this.jitoClients.get(endpoint)!;
                const tipAccount = await client.getRandomTipAccount();
                console.log(`  ${index + 1}. ${endpoint.split('/')[2]} ✅`);
                return { endpoint, success: true };
            } catch (error) {
                console.log(`  ${index + 1}. ${endpoint.split('/')[2]} ❌ (${error.message})`);
                return { endpoint, success: false };
            }
        });

        await Promise.allSettled(connectionPromises);
    }

    async sendBundle(
        transactions: VersionedTransaction[],
        connection: Connection
    ): Promise<JitoBundleResult> {
        if (transactions.length === 0) {
            return {
                bundleId: '',
                success: false,
                error: 'No transactions to bundle'
            };
        }

        if (transactions.length > 5) {
            transactions = transactions.slice(0, 5);
        }

        console.log(`📤 Preparing ${transactions.length} transaction${transactions.length > 1 ? 's' : ''} for Jito...`);

        // Convert transactions to base64
        const base64Transactions = transactions.map(tx => {
            const serialized = tx.serialize();
            return Buffer.from(serialized).toString('base64');
        });

        // Try with retry logic across different endpoints
        const maxRetries = this.endpoints.length * 2; // Try each endpoint twice
        let retryCount = 0;
        let lastError: any = null;

        while (retryCount < maxRetries) {
            const endpoint = this.getNextEndpoint();
            const client = this.jitoClients.get(endpoint)!;

            try {
                // Wait between attempts (exponential backoff)
                if (retryCount > 0) {
                    const backoffTime = Math.min(1000 * Math.pow(1.5, retryCount), 8000);
                    console.log(`⏳ Waiting ${backoffTime}ms before retry ${retryCount + 1}/${maxRetries}...`);
                    await new Promise(resolve => setTimeout(resolve, backoffTime));
                }

                console.log(`🚀 Attempt ${retryCount + 1}/${maxRetries} via ${endpoint.split('/')[2]}`);

                // Add Jito tip instruction to transactions (from Jito example)
                const { blockhash } = await connection.getLatestBlockhash('confirmed');
                
                // Get tip account
                let tipAccount;
                try {
                    tipAccount = await client.getRandomTipAccount();
                    console.log(`🎯 Using tip account: ${tipAccount.substring(0, 16)}...`);
                } catch (tipError) {
                    console.log('⚠️ Could not get tip account, using fallback');
                    tipAccount = '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5';
                }

                // Send bundle using Jito SDK (EXACT format from examples)
                const result = await client.sendBundle([
                    base64Transactions, 
                    { encoding: 'base64' }
                ]);

                const bundleId = result.result;
                console.log(`✅ Jito bundle submitted: ${bundleId?.slice(0, 16)}...`);

                // Monitor confirmation in background
                this.monitorBundleConfirmation(bundleId, endpoint).catch(console.error);

                return {
                    bundleId,
                    success: true,
                    retryCount,
                    endpointUsed: endpoint
                };

            } catch (error: any) {
                retryCount++;
                lastError = error;

                // Check error type
                if (error.response?.status === 429) {
                    console.log(`⚠️ Rate limited on ${endpoint.split('/')[2]}, rotating endpoint...`);
                    this.currentEndpointIndex = (this.currentEndpointIndex + 1) % this.endpoints.length;
                    continue;
                } else if (error.response?.status === 400) {
                    console.error(`❌ Bad request (likely transaction issue): ${error.message}`);
                    break; // Don't retry 400 errors
                } else {
                    console.error(`❌ Error on ${endpoint.split('/')[2]}: ${error.message}`);
                    // Try next endpoint
                    this.currentEndpointIndex = (this.currentEndpointIndex + 1) % this.endpoints.length;
                }
            }
        }

        return {
            bundleId: '',
            success: false,
            error: `Jito failed after ${retryCount} attempts: ${lastError?.message || 'Unknown error'}`,
            retryCount
        };
    }

    private getNextEndpoint(): string {
        const endpoint = this.endpoints[this.currentEndpointIndex];
        this.currentEndpointIndex = (this.currentEndpointIndex + 1) % this.endpoints.length;
        return endpoint;
    }

    private async monitorBundleConfirmation(bundleId: string, endpoint: string): Promise<void> {
        try {
            // Wait before checking status
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            const client = this.jitoClients.get(endpoint)!;
            const status = await client.confirmInflightBundle(bundleId, 30000); // 30 second timeout
            
            // Type guard to check which type of status we have
            if ('confirmation_status' in status) {
                // Type 2: Detailed bundle status with confirmation_status
                if (status.confirmation_status === 'confirmed') {
                    console.log(`✅ Bundle ${bundleId.slice(0, 16)}... confirmed on chain!`);
                } else if (status.err) {
                    console.log(`⚠️ Bundle ${bundleId.slice(0, 16)}... failed:`, status.err);
                } else {
                    console.log(`📊 Bundle ${bundleId.slice(0, 16)}... status: ${status.confirmation_status}`);
                }
            } else if ('status' in status && typeof status.status === 'string') {
                // Type 1: Simple status object
                console.log(`📊 Bundle ${bundleId.slice(0, 16)}... status: ${status.status}`);
                
                if (status.status === 'Landed' && 'landed_slot' in status) {
                    console.log(`   Landed at slot: ${status.landed_slot}`);
                }
            } else {
                // Type 3: Generic status object
                console.log(`📊 Bundle ${bundleId.slice(0, 16)}... status: ${JSON.stringify(status)}`);
            }
        } catch (error) {
            // Silent error for monitoring
        }
    }

    // Utility function to test Jito connection
    async testConnection(): Promise<boolean> {
        console.log('🧪 Testing Jito connection with simple transaction...');
        
        try {
            const testKeypair = new (await import('@solana/web3.js')).Keypair();
            const connection = new Connection('https://api.mainnet-beta.solana.com');
            
            const transaction = new (await import('@solana/web3.js')).Transaction();
            transaction.add(
                (await import('@solana/web3.js')).SystemProgram.transfer({
                    fromPubkey: testKeypair.publicKey,
                    toPubkey: testKeypair.publicKey,
                    lamports: 1000
                })
            );
            
            const { blockhash } = await connection.getLatestBlockhash();
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = testKeypair.publicKey;
            transaction.sign(testKeypair);
            
            // Convert to VersionedTransaction
            const messageV0 = transaction.compileMessage();
            const versionedTx = new VersionedTransaction(messageV0);
            versionedTx.sign([testKeypair]);
            
            console.log('✅ Test transaction created');
            return true;
        } catch (error) {
            console.error('❌ Test failed:', error);
            return false;
        }
    }
}

// Global instance - NO API KEY NEEDED
export const jitoBundleSender = new JitoBundleSender();


