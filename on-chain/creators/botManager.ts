import { Connection, Keypair, PublicKey, VersionedTransaction, TransactionMessage, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import bs58 from 'bs58';
import { jitoBundleSender } from '../jito_bundles/jito-integration';
import { FundBotsRequest, ExecuteBotBuysRequest } from '../types/api';
import { LAMPORTS_PER_SOL, ComputeBudgetProgram } from '@solana/web3.js';
import axios from 'axios';
import { BondingCurveMath, PumpFunInstructionBuilder, PumpFunPda, TOKEN_2022_PROGRAM_ID } from '../pumpfun/pumpfun-idl-client';
import { 
  ASSOCIATED_TOKEN_PROGRAM_ID,
    createAssociatedTokenAccountIdempotentInstruction,
    getAssociatedTokenAddressSync, 
    TOKEN_PROGRAM_ID
} from '@solana/spl-token';



interface FundBotsResponse {
  success: boolean;
  bundle_id?: string;
  signatures?: string[];
  error?: string;
  estimated_cost?: number;
}

interface ExecuteBotBuysResponse {
  success: boolean;
  bundle_id?: string;
  signatures?: string[];
  mint_address?: string;
  error?: string;
  estimated_cost?: number;
  transaction?: VersionedTransaction; // Add this line
}


async function getDecryptedPrivateKey(
  walletAddress: string,
  apiKey: string
): Promise<string> {
  try {
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000';
    
    console.log('🔧 Fetching private key from backend...', {
      url: `${backendUrl}/creators/user/get-key-for-token-creation`,
      walletAddress,
      hasApiKey: !!apiKey
    });

    const response = await axios.post(
      `${backendUrl}/creators/user/get-key-for-token-creation`,  // ← Use the WORKING endpoint
      { wallet_address: walletAddress },
      {
        headers: {
          'X-API-Key': apiKey,           // ← This header works
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    if (response.data && response.data.success && response.data.private_key) {
      return response.data.private_key;
    }

    throw new Error('Invalid response: missing private_key');
  } catch (error: any) {
    if (error.response?.status === 401) {
      console.error('❌ Authentication failed: Invalid or missing X-API-Key');
    } else if (error.code === 'ECONNREFUSED') {
      console.error('❌ Backend not reachable');
    }
    console.error(`❌ Failed to decrypt private key: ${error.message}`);
    throw error;
  }
}

export async function fundBots(
  connection: Connection,
  request: FundBotsRequest
): Promise<FundBotsResponse> {
  try {
    console.log(`🎯 Funding ${request.bot_wallets.length} bot wallets for user: ${request.user_wallet}`);
    
    // Get user private key from Python backend
    const userPrivateKey = await getDecryptedPrivateKey(
      request.user_wallet,
      process.env.ONCHAIN_API_KEY || ''
    );
    
    // Decode the base58 private key
    const secretKey = bs58.decode(userPrivateKey);
    const userKeypair = Keypair.fromSecretKey(secretKey);
    const userPublicKey = userKeypair.publicKey; // Store the public key
    
    // Verify wallet matches
    if (userPublicKey.toBase58() !== request.user_wallet) {
      throw new Error('Wallet address does not match provided private key');
    }
    
    // Create transfer transactions
    const transactions: VersionedTransaction[] = [];
    const { blockhash } = await connection.getLatestBlockhash('processed');
    
    for (let i = 0; i < request.bot_wallets.length; i++) {
      const bot = request.bot_wallets[i];
      const botWallet = new PublicKey(bot.public_key);
      const amount = BigInt(Math.floor(bot.amount_sol * LAMPORTS_PER_SOL));
      
      const transferInstruction = SystemProgram.transfer({
        fromPubkey: userPublicKey, // Use userPublicKey instead of userWallet
        toPubkey: botWallet,
        lamports: amount,
      });
      
      const messageV0 = new TransactionMessage({
        payerKey: userPublicKey, // Use userPublicKey here too
        recentBlockhash: blockhash,
        instructions: [transferInstruction]
      }).compileToV0Message();
      
      const transaction = new VersionedTransaction(messageV0);
      transaction.sign([userKeypair]);
      transactions.push(transaction);
    }
    
    // Execute transactions
    if (request.use_jito && transactions.length > 1) {
      try {
        console.log(`🚀 Sending ${transactions.length} transactions via Jito bundle...`);
        const result = await jitoBundleSender.sendBundle(transactions, connection);
        
        if (result.success) {
          const totalCost = request.bot_wallets.reduce((sum, bot) => sum + bot.amount_sol, 0);
          return {
            success: true,
            bundle_id: result.bundleId,
            estimated_cost: totalCost
          };
        } else {
          console.log('🔄 Jito failed, falling back to RPC...');
        }
      } catch (jitoError) {
        console.error('Jito execution failed:', jitoError);
      }
    }
    
    // RPC fallback - send individually
    console.log(`📤 Sending ${transactions.length} transactions via RPC...`);
    const signatures: string[] = [];
    
    for (const transaction of transactions) {
      try {
        const signature = await connection.sendTransaction(transaction, {
          skipPreflight: false,
          maxRetries: 2,
          preflightCommitment: 'processed'
        });
        
        signatures.push(signature);
        console.log(`   Sent: ${signature.slice(0, 16)}...`);
        
      } catch (error: any) {
        console.error(`   Failed to send transaction: ${error.message}`);
      }
    }
    
    const totalCost = request.bot_wallets.reduce((sum, bot) => sum + bot.amount_sol, 0);
    
    return {
      success: signatures.length > 0,
      signatures: signatures.length > 0 ? signatures : undefined,
      estimated_cost: totalCost
    };
    
  } catch (error: any) {
    console.error(`❌ Fund bots failed:`, error.message);
    return {
      success: false,
      error: error.message
    };
  }
}


// Execute buys with pre-funded bots
// export async function executeBotBuys(
//   connection: Connection,
//   request: ExecuteBotBuysRequest
// ): Promise<ExecuteBotBuysResponse> {
//   try {
//     console.log(`🎯 Executing bot buys for token: ${request.mint_address}`);
//     console.log(`     Bot count: ${request.bot_wallets.length}`);

//     const mint = new PublicKey(request.mint_address);
//     const userWallet = new PublicKey(request.user_wallet);
    
//     // First check which bots need funding
//     const botsNeedingFunding: any[] = [];
//     const botsReadyToBuy: any[] = [];
    
//     for (const bot of request.bot_wallets) {
//       try {
//         // Get bot balance
//         const botPubkey = new PublicKey(bot.public_key);
//         const balance = await connection.getBalance(botPubkey);
//         const requiredBalance = BigInt(Math.floor(bot.buy_amount * LAMPORTS_PER_SOL));
        
//         if (balance < requiredBalance) {
//           console.log(`❌ Bot ${bot.public_key.slice(0, 8)}... needs funding: ${balance/LAMPORTS_PER_SOL} SOL < ${bot.buy_amount} SOL`);
//           botsNeedingFunding.push(bot);
//         } else {
//           console.log(`✅ Bot ${bot.public_key.slice(0, 8)}... has sufficient balance: ${balance/LAMPORTS_PER_SOL} SOL`);
//           botsReadyToBuy.push(bot);
//         }
//       } catch (error) {
//         console.error(`Failed to check balance for bot ${bot.public_key}:`, error);
//       }
//     }
    
//     // Only fund bots that need it
//     if (botsNeedingFunding.length > 0) {
//       console.log(`💰 Funding ${botsNeedingFunding.length} bots...`);
      
//       const fundRequest: FundBotsRequest = {
//         user_wallet: request.user_wallet,
//         bot_wallets: botsNeedingFunding.map(bot => ({
//           public_key: bot.public_key,
//           amount_sol: bot.buy_amount
//         })),
//         use_jito: request.use_jito
//       };
      
//       const fundResult = await fundBots(connection, fundRequest);
      
//       if (!fundResult.success) {
//         throw new Error(`Bot funding failed: ${fundResult.error}`);
//       }
      
//       // Wait a moment for funding to settle
//       await new Promise(resolve => setTimeout(resolve, 2000));
//     }
    
//     // Now execute buys with bots that have balance (including newly funded ones)
//     const allBotsReady = [...botsReadyToBuy, ...botsNeedingFunding];
    
//     if (allBotsReady.length === 0) {
//       throw new Error('No bots with sufficient balance');
//     }

//     // Get bot private keys from backend
//     const botTransactions: VersionedTransaction[] = [];
//     const signatures: string[] = [];

//     // Fetch bonding curve once
//     const { BondingCurveFetcher } = require('../pumpfun/pumpfun-idl-client');
//     const bondingCurve = await BondingCurveFetcher.fetch(connection, mint, true);
//     if (!bondingCurve) {
//       throw new Error('Bonding curve not found for token');
//     }

//     const creator = BondingCurveFetcher.getCreator(bondingCurve);

//     // Get blockhash
//     const { blockhash } = await connection.getLatestBlockhash('processed');

//     // For each bot, get it's private key and create buy transaction
//     for (const bot of request.bot_wallets) {
//       try {
//         // Get bot private key from backend
//         const backendurl = process.env.BACKEND_URL || 'http://localhost:8000';
//         const botResponse = await axios.post(
//           `${backendurl}/creators/user/get-bot-private-key`,
//           {
//             bot_wallet: bot.public_key,
//             user_wallet: request.user_wallet
//           },
//           {
//             headers: {
//               'X-API-Key': process.env.ONCHAIN_API_KEY,
//               'Content-Type': 'application/json'
//             }
//           }
//         );

//         if (!botResponse.data.success || !botResponse.data.private_key) {
//           console.error(`❌ Failed to get private key for bot ${bot.public_key}`);
//           continue;
//         }

//         const botSecretKey = bs58.decode(botResponse.data.private_key);
//         const botKeypair = Keypair.fromSecretKey(botSecretKey);

//         // Verify bot wallet matches
//         if (botKeypair.publicKey.toBase58() !== bot.public_key) {
//           console.error(`❌ Bot key mismatch for ${bot.public_key}`);
//           continue;
//         }

//         // Create buy instruction for this bot
//         const solIn = BigInt(Math.floor(bot.buy_amount * LAMPORTS_PER_SOL));
//         const slippageBps = request.slippage_bps || 500;

//         // Calculate expected tokens
//         const expectedTokens = require('../pumpfun/pumpfun-idl-client').BondingCurveMath.calculateTokensForSol(
//           bondingCurve.virtual_sol_reserves,
//           bondingCurve.virtual_token_reserves,
//           solIn 
//         );

//         const minTokenOut = require('../pumpfun/pumpfun-idl-client').BondingCurveMath.applySlippage(expectedTokens, slippageBps);

//         // Get bot ATA
//         const { getAssociatedTokenAddressSync } = require('@solana/spl-token');
//         const botAta = getAssociatedTokenAddressSync(
//           mint,
//           botKeypair.publicKey,
//           false,
//           TOKEN_2022_PROGRAM_ID
//         );

//         // Create buy instruction
//         const buyInstruction = require('../pumpfun/pumpfun-idl-client').PumpFunInstructionBuilder.buildBuyExactSolIn(
//           botKeypair.publicKey,
//           mint,
//           botAta,
//           creator,
//           solIn,
//           minTokenOut
//         );

//         // Build transaction
//         const messageV0 = new TransactionMessage({
//           payerKey: botKeypair.publicKey,
//           recentBlockhash: blockhash,
//           instructions: [buyInstruction]
//         }).compileToV0Message();

//         const transaction = new VersionedTransaction(messageV0);
//         transaction.sign([botKeypair]);
//         botTransactions.push(transaction);

//       } catch (error: any) {
//         console.error(`❌ Failed to prepare transaction for bot ${bot.public_key}:`, error.message);
//       }
//     }

//     if (botTransactions.length == 0) {
//       throw new Error('No valid bot transactions prepared');
//     }

//     console.log(`✅ Prepared ${botTransactions.length} bot buy transactions`);

//     // Execute transactions
//     if (request.use_jito && botTransactions.length > 1) {
//       try {
//         console.log(`🚀 Sending ${botTransactions.length} bot buys via Jito bundle...`);
//         const result = await jitoBundleSender.sendBundle(botTransactions, connection);

//         if (result.success) {
//           return {
//             success: true,
//             bundle_id: result.bundleId,
//             estimated_cost: request.bot_wallets.reduce((sum, bot) => sum + bot.buy_amount, 0)
//           };
//         } else {
//           console.log('🔄 Jito failed, falling back to RPC...');
//         }
//       } catch (jitoError) {
//         console.error('Jito execution failed:', jitoError);
//       }
//     }

//     // RPC fallback
//     console.log(`📤 Sending ${botTransactions.length} bot buys via RPC...`);

//     for (const transaction of botTransactions) {
//       try {
//         const signature = await connection.sendTransaction(transaction, {
//           skipPreflight: false,
//           maxRetries: 3,
//           preflightCommitment: 'processed'
//         });

//         signatures.push(signature);
//         console.log(`   Sent: ${signature.slice(0, 16)}...`);

//       } catch(error: any) {
//         console.error(`     Failed to send bot transaction: ${error.message}`);
//       }
//     }

//     const totalCost = request.bot_wallets.reduce((sum, bot) => sum + bot.buy_amount, 0);

//     return {
//       success: signatures.length > 0,
//       signatures: signatures.length > 0 ? signatures : undefined,
//       estimated_cost: totalCost
//     };

//   } catch (error: any) {
//     console.error(`❌ Execute bot buys failed:`, error.message);
//     return {
//       success: false,
//       error: error.message
//     };
//   }
// }

// app/services/botManager.ts

// Update the executeBotBuys function:

export async function executeBotBuys(
  connection: Connection,
  request: ExecuteBotBuysRequest
): Promise<ExecuteBotBuysResponse> {
  try {
    console.log(`🎯 Executing bot buys for token: ${request.mint_address}`);
    console.log(`     Bot count: ${request.bot_wallets.length}`);

    const mint = new PublicKey(request.mint_address);
    
    // IMPORTANT: Get bonding curve FIRST
    console.log(`🔍 Fetching bonding curve for mint: ${mint.toBase58()}`);
    const { BondingCurveFetcher, PumpFunPda } = require('../pumpfun/pumpfun-idl-client');
    
    let bondingCurve = null;
    let retries = 5;
    
    // Wait for bonding curve to be available
    while (retries > 0 && !bondingCurve) {
      try {
        bondingCurve = await BondingCurveFetcher.fetch(connection, mint, true);
        if (!bondingCurve) {
          console.log(`   ⏳ Bonding curve not ready yet, waiting... (${retries} left)`);
          retries--;
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.log(`   ❌ Bonding curve fetch error: ${error.message}`);
        retries--;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    if (!bondingCurve) {
      throw new Error(`Bonding curve not found for token ${mint.toBase58()} after retries`);
    }
    
    console.log(`✅ Bonding curve found:`);
    console.log(`   • Creator: ${bondingCurve.creator}`);
    console.log(`   • Virtual SOL: ${Number(bondingCurve.virtual_sol_reserves) / LAMPORTS_PER_SOL}`);
    console.log(`   • Virtual Tokens: ${bondingCurve.virtual_token_reserves}`);
    
    // Get bonding curve PDA (THIS IS THE SELLER!)
    const bondingCurvePda = PumpFunPda.getBondingCurve(mint);
    console.log(`   • Bonding Curve PDA: ${bondingCurvePda.toBase58()}`);
    
    // Get blockhash for all bot transactions
    const { blockhash } = await connection.getLatestBlockhash('processed');
    
    const botTransactions: VersionedTransaction[] = [];
    const signatures: string[] = [];

    // For each bot, create buy transaction
    for (const bot of request.bot_wallets) {
      try {
        console.log(`\n🤖 Processing bot: ${bot.public_key.slice(0, 8)}...`);
        
        // 1. Get bot private key from backend
        const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000';
        const botResponse = await axios.post(
          `${backendUrl}/creators/user/get-bot-private-key`,
          {
            bot_wallet: bot.public_key,
            user_wallet: request.user_wallet
          },
          {
            headers: {
              'X-API-Key': process.env.ONCHAIN_API_KEY,
              'Content-Type': 'application/json'
            }
          }
        );

        if (!botResponse.data.success || !botResponse.data.private_key) {
          console.error(`❌ Failed to get private key for bot ${bot.public_key}`);
          continue;
        }

        const botSecretKey = bs58.decode(botResponse.data.private_key);
        const botKeypair = Keypair.fromSecretKey(botSecretKey);

        // Verify bot wallet matches
        if (botKeypair.publicKey.toBase58() !== bot.public_key) {
          console.error(`❌ Bot key mismatch for ${bot.public_key}`);
          continue;
        }
        
        // 2. Check bot balance
        const botBalance = await connection.getBalance(botKeypair.publicKey);
        const requiredBalance = BigInt(Math.floor(bot.buy_amount * LAMPORTS_PER_SOL));
        
        console.log(`   • Bot balance: ${botBalance / LAMPORTS_PER_SOL} SOL`);
        console.log(`   • Required: ${bot.buy_amount} SOL (${requiredBalance} lamports)`);
        
        if (botBalance < requiredBalance) {
          console.error(`   ❌ Insufficient balance!`);
          continue;
        }

        // 3. Calculate buy parameters
        const solIn = requiredBalance;
        const expectedTokens = BondingCurveMath.calculateTokensForSol(
          bondingCurve.virtual_sol_reserves,
          bondingCurve.virtual_token_reserves,
          solIn
        );

        const minTokenOut = BondingCurveMath.applySlippage(expectedTokens, request.slippage_bps || 500);
        
        console.log(`   • Buying ${bot.buy_amount} SOL`);
        console.log(`   • Expected tokens: ${expectedTokens}`);
        console.log(`   • Min tokens (with ${request.slippage_bps || 500} bps slippage): ${minTokenOut}`);

        // 4. Get bot ATA
        const botAta = getAssociatedTokenAddressSync(
          mint,
          botKeypair.publicKey,
          false,
          TOKEN_2022_PROGRAM_ID
        );
        
        console.log(`   • Bot ATA: ${botAta.toBase58()}`);

        // 5. Create buy instruction - CRITICAL: Use bondingCurvePda as seller, NOT creator!
        console.log(`   • Seller (bonding curve): ${bondingCurvePda.toBase58()}`);
        
        const buyInstruction = PumpFunInstructionBuilder.buildBuyExactSolIn(
          botKeypair.publicKey,   // payer (bot)
          mint,                   // mint
          botAta,                 // destination ATA (bot's token account)
          bondingCurvePda,        // seller (BONDING CURVE PDA, not creator!) ⚠️ FIXED
          solIn,                  // amount in
          minTokenOut             // min tokens out
        );

        // 6. Build transaction
        const instructions: TransactionInstruction[] = [];
        
        // Add compute budget if needed
        if (bot.buy_amount > 0.1) { // For larger buys
          instructions.push(
            ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 })
          );
          instructions.push(
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 })
          );
        }
        
        // Check if ATA exists, create if not
        try {
          const ataInfo = await connection.getAccountInfo(botAta);
          if (!ataInfo) {
            console.log(`   • Creating ATA...`);
            const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
              botKeypair.publicKey,
              botAta,
              botKeypair.publicKey,
              mint,
              TOKEN_2022_PROGRAM_ID,
              ASSOCIATED_TOKEN_PROGRAM_ID
            );
            instructions.push(createAtaIx);
          }
        } catch (error) {
          console.log(`   • ATA check failed, assuming needs creation`);
          const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
            botKeypair.publicKey,
            botAta,
            botKeypair.publicKey,
            mint,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
          );
          instructions.push(createAtaIx);
        }
        
        instructions.push(buyInstruction);

        // 7. Build and sign transaction
        const messageV0 = new TransactionMessage({
          payerKey: botKeypair.publicKey,
          recentBlockhash: blockhash,
          instructions
        }).compileToV0Message();

        const transaction = new VersionedTransaction(messageV0);
        transaction.sign([botKeypair]);
        botTransactions.push(transaction);

        console.log(`   ✅ Transaction prepared`);

      } catch (error: any) {
        console.error(`   ❌ Failed to prepare transaction for bot ${bot.public_key}:`, error.message);
      }
    }

    if (botTransactions.length === 0) {
      throw new Error('No valid bot transactions prepared');
    }

    console.log(`\n✅ Prepared ${botTransactions.length} bot buy transactions`);
    console.log(`🚀 Executing buys...`);

    // Execute transactions
    if (request.use_jito && botTransactions.length > 0) {
      try {
        console.log(`📦 Sending via Jito bundle...`);
        const result = await jitoBundleSender.sendBundle(botTransactions, connection);

        if (result.success) {
          console.log(`✅ Jito bundle sent successfully`);
          return {
            success: true,
            bundle_id: result.bundleId,
            mint_address: request.mint_address,
            estimated_cost: request.bot_wallets.reduce((sum, bot) => sum + bot.buy_amount, 0)
          };
        } else {
          console.log('🔄 Jito failed, falling back to RPC...');
        }
      } catch (jitoError: any) {
        console.error('Jito execution failed:', jitoError.message);
      }
    }

    // RPC fallback - send individually
    console.log(`📤 Sending ${botTransactions.length} transactions via RPC...`);

    for (const transaction of botTransactions) {
      try {
        console.log(`   Sending transaction...`);
        
        // First simulate to catch errors
        const simulation = await connection.simulateTransaction(transaction, {
          replaceRecentBlockhash: true,
          commitment: 'processed'
        });
        
        if (simulation.value.err) {
          console.error(`   ❌ Simulation failed:`, simulation.value.err);
          continue;
        }
        
        // Send for real
        const signature = await connection.sendTransaction(transaction, {
          skipPreflight: false,
          maxRetries: 3,
          preflightCommitment: 'processed'
        });

        signatures.push(signature);
        console.log(`   ✅ Sent: ${signature.slice(0, 16)}...`);
        
        // Small delay between transactions
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch(error: any) {
        console.error(`   ❌ Failed to send bot transaction:`, error.message);
      }
    }

    const totalCost = request.bot_wallets.reduce((sum, bot) => sum + bot.buy_amount, 0);

    return {
      success: signatures.length > 0,
      signatures: signatures.length > 0 ? signatures : undefined,
      mint_address: request.mint_address,
      estimated_cost: totalCost
    };

  } catch (error: any) {
    console.error(`\n❌ Execute bot buys failed:`, error.message);
    console.error(error.stack);
    return {
      success: false,
      error: error.message
    };
  }
}



export async function executeAtomicLaunch(
  connection: Connection,
  request: any 
): Promise<ExecuteBotBuysResponse> {
  try {
    console.log(`🚀 Executing atomic launch for user: ${request.user_wallet}`);
    
    // Validate metadata
    if (!request.metadata?.name || !request.metadata?.symbol) {
      throw new Error('Metadata must include name and symbol');
    }
    
    // Ensure URI is provided
    if (!request.metadata.uri) {
      request.metadata.uri = "https://arweave.net/example";
      console.log(`⚠️ Using default metadata URI`);
    }
    
    // Map bot wallets
    const botBuys = request.bot_wallets ? request.bot_wallets.map((bot: any) => ({
      public_key: bot.public_key,
      amount_sol: bot.buy_amount
    })) : [];
    
    return await createCompleteLaunchBundle(connection, {
      user_wallet: request.user_wallet,
      metadata: request.metadata,
      creator_buy_amount: request.creator_buy_amount || 0.01,
      bot_buys: botBuys,
      use_jito: request.use_jito !== false,
      slippage_bps: request.slippage_bps || 500
    });
    
  } catch (error: any) {
    console.error(`❌ Atomic launch failed:`, error.message);
    return {
      success: false,
      error: error.message
    };
  }
}





// export async function createCompleteLaunchBundle(
//   connection: Connection,
//   request: {
//     user_wallet: string;
//     metadata: any;
//     creator_buy_amount: number;
//     bot_buys: Array<{public_key: string, amount_sol: number}>;
//     use_jito?: boolean;
//     slippage_bps?: number;
//   }
// ): Promise<ExecuteBotBuysResponse> {
//   let mint: PublicKey;
//   let createSignature: string | undefined;
  
//   try {
//     console.log(`🚀 Creating pump.fun launch with bot snipes...`);
    
//     // Get user private key
//     const userPrivateKey = await getDecryptedPrivateKey(
//       request.user_wallet,
//       process.env.ONCHAIN_API_KEY || ''
//     );
//     const secretKey = bs58.decode(userPrivateKey);
//     const userKeypair = Keypair.fromSecretKey(secretKey);
    
//     // Generate mint keypair
//     const mintKeypair = Keypair.generate();
//     mint = mintKeypair.publicKey;
    
//     console.log(`🔑 Mint: ${mint.toBase58()}`);
    
//     // Get blockhash
//     const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
    
//     // TRY SIMPLE VERSION FIRST (no compute budget)
//     console.log(`🔄 Trying simple version (no compute budget)...`);
//     let createTx = await buildSimpleTokenCreationWithBuyTx(
//       connection,
//       userKeypair,
//       mintKeypair,
//       request.metadata,
//       request.creator_buy_amount,
//       blockhash
//     );
    
//     const txSize = createTx.serialize().length;
//     console.log(`📏 Transaction size: ${txSize} bytes`);
    
//     if (txSize > 1232) {
//       console.log(`⚠️ Transaction too large (${txSize} bytes), trying to optimize...`);
      
//       // Remove ATA creation and let the buy instruction create it
//       createTx = await buildSimpleTokenCreationWithBuyTx(
//         connection,
//         userKeypair,
//         mintKeypair,
//         request.metadata,
//         request.creator_buy_amount,
//         blockhash
//       );
//     }
    
//     // Send transaction
//     console.log(`📤 Sending transaction...`);
//     createSignature = await connection.sendTransaction(createTx, {
//       skipPreflight: true,  // Skip preflight to avoid size check
//       maxRetries: 3,
//       preflightCommitment: 'confirmed'
//     });
    
//     console.log(`✅ Transaction sent: ${createSignature.slice(0, 16)}...`);
    
//     console.log(`⏳ Waiting for confirmation...`);
    
//     // 8. Quick confirmation (but don't wait too long)
//     const confirmation = await Promise.race([
//       connection.confirmTransaction({
//         signature: createSignature,
//         blockhash,
//         lastValidBlockHeight
//       }, 'confirmed'),
//       new Promise(resolve => setTimeout(resolve, 3000))
//     ]);
    
//     console.log(`🎉 Token created: ${mint.toBase58()}`);
//     console.log(`🔗 Explorer: https://solscan.io/tx/${createSignature}`);
    
//   } catch (error: any) {
//     console.error(`❌ Atomic launch failed:`, error.message);
//     return {
//       success: false,
//       error: error.message
//     };
//   }
  
//   // ============================================
//   // STEP 2: BOT BUYS (AFTER CREATOR)
//   // ============================================
//   const botSignatures: string[] = [];
  
//   if (request.bot_buys && request.bot_buys.length > 0) {
//     try {
//       console.log(`🤖 STEP 2: Preparing ${request.bot_buys.length} bot buys...`);
      
//       // Small delay to ensure bonding curve is initialized
//       await new Promise(resolve => setTimeout(resolve, 1500));
      
//       // Get fresh blockhash for bot buys
//       const { blockhash: botBlockhash } = await connection.getLatestBlockhash('finalized');
      
//       // Build bot transactions
//       const botTransactions: VersionedTransaction[] = [];
      
//       for (const bot of request.bot_buys) {
//         try {
//           const botTx = await buildBotBuyTransactionWithAta(
//             connection,
//             request.user_wallet,
//             bot.public_key,
//             mint,
//             bot.amount_sol,
//             request.slippage_bps || 500,
//             botBlockhash
//           );
          
//           if (botTx) {
//             botTransactions.push(botTx);
//             console.log(`   Prepared bot ${bot.public_key.slice(0, 8)}...`);
//           }
//         } catch (error: any) {
//           console.error(`   Failed bot ${bot.public_key.slice(0, 8)}...:`, error.message);
//         }
//       }
      
//       if (botTransactions.length === 0) {
//         console.log(`⚠️ No valid bot transactions prepared`);
//         return {
//           success: true,
//           mint_address: mint.toBase58(),
//           signatures: createSignature ? [createSignature] : [],
//           estimated_cost: request.creator_buy_amount
//         };
//       }
      
//       console.log(`✅ Prepared ${botTransactions.length} bot transactions`);
      
//       // Send bot buys
//       if (request.use_jito !== false && botTransactions.length > 0) {
//         try {
//           console.log(`🚀 Sending ${botTransactions.length} bot buys via Jito...`);
//           const result = await jitoBundleSender.sendBundle(botTransactions, connection);
          
//           if (result.success) {
//             return {
//               success: true,
//               bundle_id: result.bundleId,
//               mint_address: mint.toBase58(),
//               signatures: createSignature ? [createSignature] : [],
//               estimated_cost: request.creator_buy_amount + 
//                             request.bot_buys.reduce((sum, bot) => sum + bot.amount_sol, 0)
//             };
//           } else {
//             console.log('🔄 Jito failed for bots, falling back to RPC...');
//           }
//         } catch (jitoError: any) {
//           console.error('Jito execution failed:', jitoError.message);
//         }
//       }
      
//       // RPC fallback
//       console.log(`📤 Sending ${botTransactions.length} bot buys via RPC...`);
//       for (const tx of botTransactions) {
//         try {
//           const signature = await connection.sendTransaction(tx, {
//             skipPreflight: false,
//             maxRetries: 2,
//             preflightCommitment: 'processed'
//           });
//           botSignatures.push(signature);
//           console.log(`   Sent: ${signature.slice(0, 16)}...`);
//         } catch (error: any) {
//           console.error(`   Failed: ${error.message}`);
//         }
//       }
      
//     } catch (botError: any) {
//       console.error(`❌ Bot buys failed:`, botError.message);
//       // Still return success if token was created
//     }
//   }
  
//   const totalCost = request.creator_buy_amount + 
//                    (request.bot_buys?.reduce((sum, bot) => sum + bot.amount_sol, 0) || 0);
  
//   return {
//     success: true,
//     mint_address: mint.toBase58(),
//     signatures: createSignature ? [createSignature, ...botSignatures] : [...botSignatures],
//     estimated_cost: totalCost
//   };
// }


export async function createCompleteLaunchBundle(
  connection: Connection,
  request: {
    user_wallet: string;
    metadata: any;
    creator_buy_amount: number;
    bot_buys: Array<{public_key: string, amount_sol: number}>;
    use_jito?: boolean;
    slippage_bps?: number;
  }
): Promise<ExecuteBotBuysResponse> {
  let mint: PublicKey;
  let createSignature: string | undefined;
  let botSignatures: string[] = [];
  
  try {
    console.log('🚀 createCompleteLaunchBundle called with:');
    console.log('📋 Request details:');
    console.log(`   User: ${request.user_wallet}`);
    console.log(`   Metadata:`, JSON.stringify(request.metadata, null, 2));
    console.log(`   Name: ${request.metadata.name}`);
    console.log(`   Symbol: ${request.metadata.symbol}`);
    console.log(`   URI: ${request.metadata.uri}`);
    console.log(`   URI type: ${typeof request.metadata.uri}`);
    console.log(`   URI length: ${request.metadata.uri?.length || 0}`);
    console.log(`   Creator buy: ${request.creator_buy_amount} SOL`);
    console.log(`   Bot buys: ${request.bot_buys.length}`);
    console.log(`   Use Jito: ${request.use_jito}`);


    console.log(`🚀 Creating pump.fun launch with bot snipes...`);
    
    // ============================================
    // STEP 1: CHECK BOT BALANCES BEFORE CREATION
    // ============================================
    console.log(`🤖 STEP 1: Checking ${request.bot_buys.length} bot balances...`);
    
    const botsNeedingFunding: Array<{public_key: string, amount_sol: number}> = [];
    const botsReadyToSnipe: Array<{public_key: string, amount_sol: number}> = [];
    
    for (const bot of request.bot_buys) {
      try {
        const botPubkey = new PublicKey(bot.public_key);
        const balance = await connection.getBalance(botPubkey);
        const requiredBalance = BigInt(Math.floor(bot.amount_sol * LAMPORTS_PER_SOL));
        
        console.log(`   Bot ${bot.public_key.slice(0, 8)}...: ${balance/LAMPORTS_PER_SOL} SOL, needs ${bot.amount_sol} SOL`);
        
        if (balance < requiredBalance) {
          console.log(`   ❌ Needs funding: ${balance/LAMPORTS_PER_SOL} < ${bot.amount_sol}`);
          botsNeedingFunding.push(bot);
        } else {
          console.log(`   ✅ Has sufficient balance`);
          botsReadyToSnipe.push(bot);
        }
      } catch (error) {
        console.error(`   Failed to check balance for bot ${bot.public_key}:`, error);
        botsNeedingFunding.push(bot); // Assume needs funding
      }
    }
    
    // ============================================
    // STEP 2: FUND BOTS THAT NEED IT (BEFORE TOKEN CREATION!)
    // ============================================
    if (botsNeedingFunding.length > 0) {
      console.log(`💰 STEP 2: Funding ${botsNeedingFunding.length} bots...`);
      
      const fundResult = await fundBots(connection, {
        user_wallet: request.user_wallet,
        bot_wallets: botsNeedingFunding,
        use_jito: request.use_jito
      });
      
      if (!fundResult.success) {
        console.error(`❌ Bot funding failed: ${fundResult.error}`);
        // Continue anyway - maybe some bots have balance
      } else {
        console.log(`✅ Bot funding successful`);
        // Wait for funding to settle
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      // Add newly funded bots to ready list
      botsReadyToSnipe.push(...botsNeedingFunding);
    }
    
    if (botsReadyToSnipe.length === 0) {
      console.log(`⚠️ No bots ready to snipe after funding`);
    }
    
    // ============================================
    // STEP 3: CREATE TOKEN WITH CREATOR BUY
    // ============================================
    console.log(`🎯 STEP 3: Creating token with creator buy...`);
    
    // Get user private key
    const userPrivateKey = await getDecryptedPrivateKey(
      request.user_wallet,
      process.env.ONCHAIN_API_KEY || ''
    );
    const secretKey = bs58.decode(userPrivateKey);
    const userKeypair = Keypair.fromSecretKey(secretKey);
    
    // Generate mint keypair
    const mintKeypair = Keypair.generate();
    mint = mintKeypair.publicKey;
    
    console.log(`🔑 Mint: ${mint.toBase58()}`);
    
    // Get blockhash
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
    
    // TRY SIMPLE VERSION FIRST (no compute budget)
    console.log(`🔄 Trying simple version (no compute budget)...`);
    let createTx = await buildSimpleTokenCreationWithBuyTx(
      connection,
      userKeypair,
      mintKeypair,
      request.metadata,
      request.creator_buy_amount,
      blockhash
    );
    
    const txSize = createTx.serialize().length;
    console.log(`📏 Transaction size: ${txSize} bytes`);
    
    if (txSize > 1232) {
      console.log(`⚠️ Transaction too large (${txSize} bytes), trying to optimize...`);
      
      const metadata = request.metadata;

      // DEBUG: Log what we're receiving
      console.log(`📄 Received metadata:`, JSON.stringify(metadata, null, 2));

      // Ensure we have the full image URL, not just IPFS hash
      if (metadata.image && metadata.image.startsWith('ipfs://')) {
          // Convert ipfs://Qm... to https://ipfs.io/ipfs/Qm...
          metadata.image = metadata.image.replace('ipfs://', 'https://ipfs.io/ipfs/');
          console.log(`🔄 Converted IPFS URI: ${metadata.image}`);
      } else if (metadata.uri && metadata.uri.startsWith('ipfs://')) {
          // Some metadata uses 'uri' field instead of 'image'
          metadata.uri = metadata.uri.replace('ipfs://', 'https://ipfs.io/ipfs/');
          console.log(`🔄 Converted IPFS URI: ${metadata.uri}`);
      }

      // If metadata has image but uri is not set, copy image to uri
      if (metadata.image && !metadata.uri) {
          metadata.uri = metadata.image;
          console.log(`📋 Copied image to uri: ${metadata.uri}`);
      }

      // If metadata has uri but image is not set, copy uri to image
      if (metadata.uri && !metadata.image) {
          metadata.image = metadata.uri;
          console.log(`📋 Copied uri to image: ${metadata.image}`);
      }

      // Remove ATA creation and let the buy instruction create it
      createTx = await buildSimpleTokenCreationWithBuyTx(
        connection,
        userKeypair,
        mintKeypair,
        metadata,
        request.creator_buy_amount,
        blockhash
      );
    }
    
    // Send transaction
    console.log(`📤 Sending transaction...`);
    createSignature = await connection.sendTransaction(createTx, {
      skipPreflight: true,  // Skip preflight to avoid size check
      maxRetries: 3,
      preflightCommitment: 'confirmed'
    });
    
    console.log(`✅ Token creation sent: ${createSignature.slice(0, 16)}...`);
    console.log(`⏳ Waiting for confirmation...`);
    
    // 8. Quick confirmation (but don't wait too long)
    const confirmation = await Promise.race([
      connection.confirmTransaction({
        signature: createSignature,
        blockhash,
        lastValidBlockHeight
      }, 'confirmed'),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);
    
    console.log(`🎉 Token created: ${mint.toBase58()}`);
    console.log(`🔗 Explorer: https://solscan.io/tx/${createSignature}`);

    // ============================================
    // STEP 4: BOT SNIPES (AFTER CONFIRMATION)
    // ============================================
    if (botsReadyToSnipe.length > 0) {
      console.log(`⚡ STEP 4: Preparing ${botsReadyToSnipe.length} bot snipes...`);
      
      // Wait for token creation to confirm (important!)
      console.log(`⏳ Waiting for token creation confirmation...`);
      await connection.confirmTransaction(createSignature, 'confirmed');
      
      // Wait a bit more for bonding curve to initialize
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Get fresh blockhash for bot buys
      const { blockhash: snipeBlockhash } = await connection.getLatestBlockhash('finalized');
      
      // Build bot snipe transactions
      const botTransactions: VersionedTransaction[] = [];
      
      for (const bot of botsReadyToSnipe) {
        try {
          const botTx = await buildBotBuyTransactionWithAta(
            connection,
            request.user_wallet,
            bot.public_key,
            mint,
            bot.amount_sol,
            request.slippage_bps || 500,
            snipeBlockhash
          );
          
          if (botTx) {
            botTransactions.push(botTx);
            console.log(`   Prepared snipe for bot ${bot.public_key.slice(0, 8)}...`);
          }
        } catch (error: any) {
          console.error(`   Failed bot ${bot.public_key.slice(0, 8)}...:`, error.message);
        }
      }
      
      if (botTransactions.length > 0) {
        console.log(`✅ Prepared ${botTransactions.length} bot snipe transactions`);
        
        // Send bot buys via Jito (if enabled)
        if (request.use_jito !== false && botTransactions.length > 0) {
          try {
            console.log(`🚀 Sending ${botTransactions.length} bot snipes via Jito...`);
            const result = await jitoBundleSender.sendBundle(botTransactions, connection);
            
            if (result.success) {
              return {
                success: true,
                bundle_id: result.bundleId,
                mint_address: mint.toBase58(),
                signatures: createSignature ? [createSignature] : [],
                estimated_cost: request.creator_buy_amount + 
                              botsReadyToSnipe.reduce((sum, bot) => sum + bot.amount_sol, 0)
              };
            } else {
              console.log('🔄 Jito failed for bot snipes, falling back to RPC...');
            }
          } catch (jitoError: any) {
            console.error('Jito execution failed:', jitoError.message);
          }
        }
        
        // RPC fallback - send individually
        console.log(`📤 Sending ${botTransactions.length} bot snipes via RPC...`);
        for (const tx of botTransactions) {
          try {
            const signature = await connection.sendTransaction(tx, {
              skipPreflight: false,
              maxRetries: 2,
              preflightCommitment: 'processed'
            });
            botSignatures.push(signature);
            console.log(`   Sent: ${signature.slice(0, 16)}...`);
          } catch (error: any) {
            console.error(`   Failed: ${error.message}`);
          }
        }
      }
    }
    
    // ============================================
    // STEP 5: RETURN RESULTS
    // ============================================
    const totalCost = request.creator_buy_amount + 
                     botsReadyToSnipe.reduce((sum, bot) => sum + bot.amount_sol, 0);
    
    return {
      success: true,
      mint_address: mint.toBase58(),
      signatures: createSignature ? [createSignature, ...botSignatures] : [...botSignatures],
      estimated_cost: totalCost
    };

    
  } catch (error: any) {
    console.error(`❌ Atomic launch failed:`, error.message);
    return {
      success: false,
      error: error.message
    };
  }
  

}




async function buildSimpleTokenCreationWithBuyTx(
  connection: Connection,
  userKeypair: Keypair,
  mintKeypair: Keypair,
  metadata: { name: string; symbol: string; uri: string }, // ✅ Only name, symbol, uri
  creatorBuyAmount: number,
  blockhash: string
): Promise<VersionedTransaction> {
  const mint = mintKeypair.publicKey;

  console.log(`🔧 Building SIMPLE pump.fun transaction for mint: ${mint.toBase58()}`);

  // ✅ Extract only what we need - the URI contains everything
  const tokenName = metadata.name || `Token_${Date.now()}`;
  const tokenSymbol = metadata.symbol || 'TKN';
  const tokenUri = metadata.uri;
  
  console.log(`🔧 Building SIMPLE pump.fun transaction`);
  console.log(`📊 Input metadata:`, JSON.stringify(metadata, null, 2));
  console.log(`   Mint: ${mint.toBase58()}`);
  console.log(`   Creator: ${userKeypair.publicKey.toBase58()}`);
  console.log(`   Name: ${metadata.name}`);
  console.log(`   Symbol: ${metadata.symbol}`);
  console.log(`   URI: ${metadata.uri}`);
  console.log(`   URI length: ${metadata.uri.length}`);
  
  // ✅ VERIFY THE URI
  if (!metadata.uri) {
    throw new Error('❌ NO URI PROVIDED!');
  }
  
  if (metadata.uri.includes('ipfs.io/ipfs')) {
    console.log(`🔍 URI appears to be IPFS: ${metadata.uri}`);
    
    // Check if it's likely a metadata JSON or direct image
    if (metadata.uri.includes('.jpg') || metadata.uri.includes('.png') || metadata.uri.includes('.gif')) {
      console.warn(`⚠️ WARNING: URI looks like a direct image, not metadata JSON!`);
      console.warn(`   Expected: https://ipfs.io/ipfs/Qm... (metadata JSON)`);
      console.warn(`   Got: ${metadata.uri}`);
    } else {
      console.log(`✅ URI appears to be metadata JSON`);
    }
  } else {
    console.log(`🔍 URI format: ${metadata.uri.substring(0, 100)}...`);
  }
  
  // ✅ CRITICAL: No need to create JSON metadata here!
  // The URI should already be a complete metadata JSON URL (from IPFS)
  // OR if it's a direct image URL, pump.fun will handle it
  const finalUri = tokenUri;
  
  console.log(`📋 Using URI directly: ${finalUri.substring(0, 100)}...`);
  
  // Rest of the function remains the same...
  // ============================================
  // 1. COMPUTE BUDGET (MUST BE FIRST!)
  // ============================================
  const computeUnitLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: 320000
  });
  
  const computeUnitPriceIx = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: 350000
  });

  // ============================================
  // 2. CREATE_V2 (USE THE URI DIRECTLY!)
  // ============================================
  const createIx = PumpFunInstructionBuilder.buildCreateV2(
    userKeypair,
    mintKeypair,
    tokenName,
    tokenSymbol,
    finalUri, // ✅ Direct URI, no JSON construction
    false,
    userKeypair.publicKey
  );

  // ============================================
  // 3. EXTEND_ACCOUNT
  // ============================================
  const bondingCurve = PumpFunPda.getBondingCurve(mint);
  const extendIx = PumpFunInstructionBuilder.buildExtendAccount(
    bondingCurve,
    userKeypair.publicKey
  );

  // ============================================
  // 4. CREATE CREATOR ATA
  // ============================================
  const creatorAta = getAssociatedTokenAddressSync(
    mint,
    userKeypair.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
    userKeypair.publicKey,
    creatorAta,
    userKeypair.publicKey,
    mint,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  // ============================================
  // 5. CREATOR BUY (with 0.01 SOL and 0 slippage)
  // ============================================
  const lamportsIn = BigInt(Math.floor(creatorBuyAmount * LAMPORTS_PER_SOL));
  
  // IMPORTANT: Use 0 slippage for creator buy
  const buyIx = PumpFunInstructionBuilder.buildBuyExactSolIn(
    userKeypair.publicKey,
    mint,
    creatorAta,
    userKeypair.publicKey,
    lamportsIn,
    BigInt(1) // Minimum 1 token!
  );

  // ============================================
  // BUILD TRANSACTION IN CORRECT ORDER
  // ============================================
  const instructions = [
    computeUnitLimitIx,
    computeUnitPriceIx,
    createIx,
    extendIx,
    createAtaIx,
    buyIx
  ];

  console.log(`📋 Building transaction with ${instructions.length} instructions:`);
  console.log(`   1. Compute Unit Limit (${computeUnitLimitIx.data.length} bytes)`);
  console.log(`   2. Compute Unit Price (${computeUnitPriceIx.data.length} bytes)`);
  console.log(`   3. CreateV2 (${createIx.data.length} bytes)`);
  console.log(`   4. ExtendAccount (${extendIx.data.length} bytes)`);
  console.log(`   5. Create Creator ATA (${createAtaIx.data.length} bytes)`);
  console.log(`   6. Creator Buy (${buyIx.data.length} bytes)`);

  const messageV0 = new TransactionMessage({
    payerKey: userKeypair.publicKey,
    recentBlockhash: blockhash,
    instructions
  }).compileToV0Message();

  const tx = new VersionedTransaction(messageV0);
  tx.sign([userKeypair, mintKeypair]);

  const txSize = tx.serialize().length;
  console.log(`✅ Transaction built: ${txSize} bytes`);
  console.log(`   Signers: ${tx.signatures.length}`);
  
  return tx;
}


// async function buildBotBuyTransactionWithAta(
//   connection: Connection,
//   userWallet: string,
//   botPublicKey: string,
//   mint: PublicKey,
//   buyAmount: number,
//   slippageBps: number,
//   blockhash: string
// ): Promise<VersionedTransaction | null> {
//   try {
//     // Get bot private key
//     const backendurl = process.env.BACKEND_URL || 'http://localhost:8000';
//     const botResponse = await axios.post(
//       `${backendurl}/creators/user/get-bot-private-key`,
//       {
//         bot_wallet: botPublicKey,
//         user_wallet: userWallet
//       },
//       {
//         headers: {
//           'X-API-Key': process.env.ONCHAIN_API_KEY,
//           'Content-Type': 'application/json'
//         }
//       }
//     );
    
//     if (!botResponse.data.success || !botResponse.data.private_key) {
//       console.error(`❌ Failed to get private key for bot ${botPublicKey}`);
//       return null;
//     }
    
//     const botSecretKey = bs58.decode(botResponse.data.private_key);
//     const botKeypair = Keypair.fromSecretKey(botSecretKey);
    
//     if (botKeypair.publicKey.toBase58() !== botPublicKey) {
//       console.error(`❌ Bot key mismatch for ${botPublicKey}`);
//       return null;
//     }
    
//     // Get bonding curve data
//     const { BondingCurveFetcher } = require('../pumpfun/pumpfun-idl-client');
//     const bondingCurve = await BondingCurveFetcher.fetch(connection, mint, true);
//     if (!bondingCurve) {
//       console.error(`❌ Bonding curve not found for ${mint.toBase58()}`);
//       return null;
//     }
    
//     const creator = BondingCurveFetcher.getCreator(bondingCurve);
    
//     // Calculate buy
//     const solIn = BigInt(Math.floor(buyAmount * LAMPORTS_PER_SOL));
//     const expectedTokens = BondingCurveMath.calculateTokensForSol(
//       bondingCurve.virtual_sol_reserves,
//       bondingCurve.virtual_token_reserves,
//       solIn
//     );
    
//     const minTokenOut = BondingCurveMath.applySlippage(expectedTokens, slippageBps);
    
//     // Get bot ATA
//     const botAta = getAssociatedTokenAddressSync(
//       mint,
//       botKeypair.publicKey,
//       false,
//       TOKEN_2022_PROGRAM_ID
//     );
    
//     // Check if ATA exists
//     const ataInfo = await connection.getAccountInfo(botAta);
//     const instructions: TransactionInstruction[] = [];
    
//     // Create ATA if it doesn't exist
//     if (!ataInfo) {
//       const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
//         botKeypair.publicKey,
//         botAta,
//         botKeypair.publicKey,
//         mint,
//         TOKEN_2022_PROGRAM_ID,
//         ASSOCIATED_TOKEN_PROGRAM_ID
//       );
//       instructions.push(createAtaIx);
//     }
    
//     // Add buy instruction
//     const buyIx = PumpFunInstructionBuilder.buildBuyExactSolIn(
//       botKeypair.publicKey,
//       mint,
//       botAta,
//       creator,
//       solIn,
//       minTokenOut
//     );
//     instructions.push(buyIx);
    
//     // Build transaction
//     const messageV0 = new TransactionMessage({
//       payerKey: botKeypair.publicKey,
//       recentBlockhash: blockhash,
//       instructions
//     }).compileToV0Message();
    
//     const transaction = new VersionedTransaction(messageV0);
//     transaction.sign([botKeypair]);
    
//     console.log(`✅ Built bot transaction for ${botPublicKey.slice(0, 8)}...`);
//     return transaction;
    
//   } catch (error: any) {
//     console.error(`❌ Failed to build bot transaction:`, error.message);
//     return null;
//   }
// }

async function buildBotBuyTransactionWithAta(
  connection: Connection,
  userWallet: string,
  botPublicKey: string,
  mint: PublicKey,
  buyAmount: number,
  slippageBps: number,
  blockhash: string
): Promise<VersionedTransaction | null> {
  try {
    // Get bot private key
    const backendurl = process.env.BACKEND_URL || 'http://localhost:8000';
    const botResponse = await axios.post(
      `${backendurl}/creators/user/get-bot-private-key`,
      {
        bot_wallet: botPublicKey,
        user_wallet: userWallet
      },
      {
        headers: {
          'X-API-Key': process.env.ONCHAIN_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (!botResponse.data.success || !botResponse.data.private_key) {
      console.error(`❌ Failed to get private key for bot ${botPublicKey}`);
      return null;
    }
    
    const botSecretKey = bs58.decode(botResponse.data.private_key);
    const botKeypair = Keypair.fromSecretKey(botSecretKey);
    
    if (botKeypair.publicKey.toBase58() !== botPublicKey) {
      console.error(`❌ Bot key mismatch for ${botPublicKey}`);
      return null;
    }
    
    // Get bonding curve data - WITH RETRIES!
    const { BondingCurveFetcher } = require('../pumpfun/pumpfun-idl-client');
    let bondingCurve = null;
    let retries = 3;
    
    while (retries > 0 && !bondingCurve) {
      try {
        bondingCurve = await BondingCurveFetcher.fetch(connection, mint, true);
        if (!bondingCurve) {
          console.log(`   Bonding curve not ready yet, retrying... (${retries} left)`);
          retries--;
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (error) {
        console.log(`   Bonding curve fetch error: ${error.message}`);
        retries--;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    if (!bondingCurve) {
      console.error(`❌ Bonding curve not found for ${mint.toBase58()} after retries`);
      return null;
    }
    
    const creator = BondingCurveFetcher.getCreator(bondingCurve);
    
    // Calculate buy
    const solIn = BigInt(Math.floor(buyAmount * LAMPORTS_PER_SOL));
    const expectedTokens = BondingCurveMath.calculateTokensForSol(
      bondingCurve.virtual_sol_reserves,
      bondingCurve.virtual_token_reserves,
      solIn
    );
    
    const minTokenOut = BondingCurveMath.applySlippage(expectedTokens, slippageBps);
    
    // Get bot ATA
    const botAta = getAssociatedTokenAddressSync(
      mint,
      botKeypair.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    
    // Check if ATA exists
    const ataInfo = await connection.getAccountInfo(botAta);
    const instructions: TransactionInstruction[] = [];
    
    // Create ATA if it doesn't exist
    if (!ataInfo) {
      const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
        botKeypair.publicKey,
        botAta,
        botKeypair.publicKey,
        mint,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      instructions.push(createAtaIx);
    }
    
    // Add buy instruction
    const buyIx = PumpFunInstructionBuilder.buildBuyExactSolIn(
      botKeypair.publicKey,
      mint,
      botAta,
      creator,
      solIn,
      minTokenOut
    );
    instructions.push(buyIx);
    
    // Build transaction
    const messageV0 = new TransactionMessage({
      payerKey: botKeypair.publicKey,
      recentBlockhash: blockhash,
      instructions
    }).compileToV0Message();
    
    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([botKeypair]);
    
    console.log(`✅ Built bot snipe for ${botPublicKey.slice(0, 8)}...`);
    console.log(`   Amount: ${buyAmount} SOL`);
    console.log(`   Min tokens: ${minTokenOut}`);
    
    return transaction;
    
  } catch (error: any) {
    console.error(`❌ Failed to build bot snipe transaction:`, error.message);
    return null;
  }
}





async function createToken2022AtaInstruction(
  payer: PublicKey,
  ata: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  connection: Connection
): Promise<TransactionInstruction> {
  // Get Token-2022 account size
  const token2022AccountSize = 165; // Standard Token-2022 account size
  
  // Check if account already exists
  const accountInfo = await connection.getAccountInfo(ata);
  if (accountInfo) {
    console.log(`ℹ️ ATA already exists: ${ata.toBase58()}`);
    // Return a no-op instruction (SystemProgram transfer of 0 lamports)
    return SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: ata,
      lamports: 0
    });
  }

  // Manual ATA creation for Token-2022:
  // 1. Allocate space
  // 2. Assign to Token-2022 program
  // 3. Initialize account
  
  const instruction = new TransactionInstruction({
    programId: SystemProgram.programId,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
    ],
    data: Buffer.concat([
      Buffer.from([0]), // SystemProgram create account instruction
      Buffer.from(new Uint8Array(8)), // lamports (will be calculated by simulation)
      Buffer.from(new Uint8Array(8).fill(token2022AccountSize)), // space
      TOKEN_2022_PROGRAM_ID.toBuffer(), // owner program (Token-2022)
    ])
  });

  console.log(`✅ Created manual Token-2022 ATA instruction`);
  console.log(`   ATA: ${ata.toBase58()}`);
  console.log(`   Owner: ${owner.toBase58()}`);
  console.log(`   Mint: ${mint.toBase58()}`);
  console.log(`   Program: ${TOKEN_2022_PROGRAM_ID.toBase58()}`);

  return instruction;
}


async function buildBotBuyTransaction(
  connection: Connection,
  userWallet: string,
  botPublicKey: string,
  mint: PublicKey,
  buyAmount: number,
  slippageBps: number,
  blockhash: string,
  skipAtaCreation: boolean = false // NEW: Flag to skip ATA creation
): Promise<VersionedTransaction | null> {
  try {
    // Get bot private key from backend
    const backendurl = process.env.BACKEND_URL || 'http://localhost:8000';
    const botResponse = await axios.post(
      `${backendurl}/creators/user/get-bot-private-key`,
      {
        bot_wallet: botPublicKey,
        user_wallet: userWallet
      },
      {
        headers: {
          'X-API-Key': process.env.ONCHAIN_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (!botResponse.data.success || !botResponse.data.private_key) {
      console.error(`❌ Failed to get private key for bot ${botPublicKey}`);
      return null;
    }
    
    const botSecretKey = bs58.decode(botResponse.data.private_key);
    const botKeypair = Keypair.fromSecretKey(botSecretKey);
    
    // Verify bot wallet matches
    if (botKeypair.publicKey.toBase58() !== botPublicKey) {
      console.error(`❌ Bot key mismatch for ${botPublicKey}`);
      return null;
    }
    
    // Get bonding curve data
    const { BondingCurveFetcher } = require('../pumpfun/pumpfun-idl-client');
    const bondingCurve = await BondingCurveFetcher.fetch(connection, mint, true);
    if (!bondingCurve) {
      console.error(`❌ Bonding curve not found for ${mint.toBase58()}`);
      return null;
    }
    
    const creator = BondingCurveFetcher.getCreator(bondingCurve);
    
    // Calculate buy parameters
    const solIn = BigInt(Math.floor(buyAmount * LAMPORTS_PER_SOL));
    const expectedTokens = BondingCurveMath.calculateTokensForSol(
      bondingCurve.virtual_sol_reserves,
      bondingCurve.virtual_token_reserves,
      solIn
    );
    
    const minTokenOut = BondingCurveMath.applySlippage(expectedTokens, slippageBps);
    
    // Get bot ATA (still calculate it for the buy instruction)
    const { getAssociatedTokenAddressSync } = require('@solana/spl-token');
    const botAta = getAssociatedTokenAddressSync(
      mint,
      botKeypair.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    
    // Create buy instruction
    const buyInstruction = PumpFunInstructionBuilder.buildBuyExactSolIn(
      botKeypair.publicKey,
      mint,
      botAta,
      creator,
      solIn,
      minTokenOut
    );
    
    // Build transaction - CRITICAL: NO ATA creation instruction
    const instructions: TransactionInstruction[] = [buyInstruction];
    
    const messageV0 = new TransactionMessage({
      payerKey: botKeypair.publicKey,
      recentBlockhash: blockhash,
      instructions
    }).compileToV0Message();
    
    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([botKeypair]);
    
    console.log(`✅ Built bot buy transaction for ${botPublicKey.slice(0, 8)}...`);
    
    return transaction;
    
  } catch (error: any) {
    console.error(`❌ Failed to build bot transaction:`, error.message);
    return null;
  }
}

































