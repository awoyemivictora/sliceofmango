import { Connection, Keypair, PublicKey, VersionedTransaction, TransactionMessage, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import bs58 from 'bs58';
import { createJitoBundleSender } from '../jito_bundles/jito-integration';
import { FundBotsRequest, ExecuteBotBuysRequest, ExecuteBotBuysResponse, FundBotsResponse } from '../types/api';
import { LAMPORTS_PER_SOL, ComputeBudgetProgram } from '@solana/web3.js';
import axios from 'axios';
import { BondingCurveFetcher, BondingCurveMath, PUMP_FUN_PROGRAM_ID, PumpFunInstructionBuilder, PumpFunPda, TOKEN_2022_PROGRAM_ID } from '../pumpfun/pumpfun-idl-client';
import { 
  ASSOCIATED_TOKEN_PROGRAM_ID,
    createAssociatedTokenAccountIdempotentInstruction,
    getAssociatedTokenAddressSync, 
    TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import { AdvancedBotOrchestrator } from './advancedBotManager';


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
      // const amount = BigInt(Math.floor((bot.amount_sol * 2)* LAMPORTS_PER_SOL));
      const amount = BigInt(Math.floor((bot.amount_sol + 0.003) * LAMPORTS_PER_SOL));
      
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
    
     // Execute transactions with Jito if enabled
    // if (request.use_jito && transactions.length > 1) {
    //   try {
    //     console.log(`🚀 Sending ${transactions.length} transactions via Jito bundle...`);
        
    //     // Create Jito sender instance
    //     const jitoSender = createJitoBundleSender(connection);
    //     const result = await jitoSender.sendBundle(transactions);
        
    //     if (result.success && result.bundleId) {
    //       const totalCost = request.bot_wallets.reduce((sum, bot) => sum + bot.amount_sol, 0);
    //       return {
    //         success: true,
    //         bundle_id: result.bundleId,
    //         estimated_cost: totalCost,
    //         endpointUsed: result.endpointUsed
    //       };
    //     } else {
    //       console.log('🔄 Jito failed, falling back to RPC...');
    //     }
    //   } catch (jitoError) {
    //     console.error('Jito execution failed:', jitoError);
    //   }
    // }
    
    
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

function getBotAmount(bot: any): number {
    // ✅ Prioritize amount_sol (dynamic amount)
    if (bot.amount_sol !== undefined) {
        console.log(`📊 Using dynamic amount_sol: ${bot.amount_sol} SOL`);
        return bot.amount_sol;
    }
    
    // Fallback to other field names
    if (bot.buy_amount !== undefined) {
        console.log(`📊 Using buy_amount: ${bot.buy_amount} SOL`);
        return bot.buy_amount;
    }
    
    if (bot.amount !== undefined) {
        console.log(`📊 Using amount: ${bot.amount} SOL`);
        return bot.amount;
    }
    
    console.log(`⚠️ No amount found for bot, using default 0.0001 SOL`);
    return 0.0001;
}

export async function executeBotBuys(
  connection: Connection,
  request: ExecuteBotBuysRequest
): Promise<ExecuteBotBuysResponse> {
  try {
    console.log(`🎯 Executing bot buys for token: ${request.mint_address}`);
    console.log(`     Bot count: ${request.bot_wallets.length}`);

    const mint = new PublicKey(request.mint_address);
    
    // Step 1: Get bonding curve immediately (skip balance checks for now)
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
    console.log(`   • Creator: ${bondingCurve.creator.toBase58()}`);
    console.log(`   • Virtual SOL: ${bondingCurve.virtual_sol_reserves}`);
    console.log(`   • Virtual Tokens: ${bondingCurve.virtual_token_reserves}`);
    
    const bondingCurvePda = PumpFunPda.getBondingCurve(mint);
    console.log(`   • Bonding Curve PDA: ${bondingCurvePda.toBase58()}`);

    // Step 2: All bot wallets should have been funded already from backend (so no need to fund again or recheck)
    console.log(`🎯 Executing bot buys for token: ${request.mint_address}`);
    
    // ✅ ASSUME ALL BOTS ARE FUNDED (skip balance checks)
    const fundedBots = request.bot_wallets; // Use all bots
    
    console.log(`✅ Assuming ${fundedBots.length} bots are funded (backend handled funding)`);
  
    
    // Step 3: Get blockhash and prepare transactions
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    const transactions: VersionedTransaction[] = [];
    const signatures: string[] = [];
    
    // Process each funded bot
    for (const bot of fundedBots) {
      try {
        console.log(`\n🤖 Building transaction for bot: ${bot.public_key.slice(0, 8)}...`);
        
        // Get bot private key
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
            },
            timeout: 5000
          }
        );
        
        if (!botResponse.data.success || !botResponse.data.private_key) {
          console.error(`❌ Failed to get bot private key`);
          continue;
        }
        
        const botSecretKey = bs58.decode(botResponse.data.private_key);
        const botKeypair = Keypair.fromSecretKey(botSecretKey);
        
        // Verify public key matches
        if (botKeypair.publicKey.toBase58() !== bot.public_key) {
          console.error(`❌ Bot key mismatch`);
          continue;
        }
        
        // Calculate buy parameters (MUST match sniper-engine logic)
        // const solIn = BigInt(Math.floor(getBotAmount(bot) * LAMPORTS_PER_SOL));

        // ✅ Get the EXACT amount from the bot configuration
        const botAmount = bot.amount_sol || bot.buy_amount || 0.0001;
        console.log(`🤖 Bot ${bot.public_key.slice(0, 8)}: Buying ${botAmount} SOL`);
        
        // Use this amount for calculations
        const solIn = BigInt(Math.floor(botAmount * LAMPORTS_PER_SOL));
        
        // Use bonding curve reserves to calculate expected tokens
        const expectedTokens = BondingCurveMath.calculateTokensForSol(
          bondingCurve.virtual_sol_reserves,
          bondingCurve.virtual_token_reserves,
          solIn
        );
        
        const minTokenOut = BondingCurveMath.applySlippage(expectedTokens, request.slippage_bps || 1000);
        
        console.log(`   • Buying ${getBotAmount(bot)} SOL`);
        console.log(`   • Expected tokens: ${expectedTokens}`);
        console.log(`   • Min tokens out: ${minTokenOut}`);
        
        // Create bot's token account
        const botAta = getAssociatedTokenAddressSync(
          mint,
          botKeypair.publicKey,
          false,
          TOKEN_2022_PROGRAM_ID
        );
        
        console.log(`   • Bot ATA: ${botAta.toBase58()}`);

        console.log(`Fetched creator from curve: ${bondingCurve.creator.toBase58()}`);

        const creatorVaultManual = PublicKey.findProgramAddressSync(
          [Buffer.from("creator-vault"), bondingCurve.creator.toBuffer()],
          PUMP_FUN_PROGRAM_ID
        )[0];
        console.log(`Computed creator_vault: ${creatorVaultManual.toBase58()}`);

        // ── FIX: Declare instructions array EARLY ──
        const instructions: TransactionInstruction[] = [];

        // Add compute budget instructions first (they should be at the beginning)
        instructions.push(
          ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 })
        );
        instructions.push(
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000000 })
        );

        // Check if user volume accumulator exists → create if missing
        const userVolPda = PumpFunPda.getUserVolumeAccumulator(botKeypair.publicKey);
        const volAccInfo = await connection.getAccountInfo(userVolPda);

        if (!volAccInfo) {
          console.log(`Creating user_volume_accumulator for bot ${bot.public_key.slice(0,8)}...`);

          const initVolIx = new TransactionInstruction({
            programId: PUMP_FUN_PROGRAM_ID,
            keys: [
              { pubkey: botKeypair.publicKey, isSigner: true, isWritable: true },        // payer
              { pubkey: botKeypair.publicKey, isSigner: false, isWritable: false },      // user
              { pubkey: userVolPda, isSigner: false, isWritable: true },                 // account
              { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
              { pubkey: PumpFunPda.getEventAuthority(), isSigner: false, isWritable: false },
              { pubkey: PUMP_FUN_PROGRAM_ID, isSigner: false, isWritable: false }
            ],
            data: Buffer.from([94, 6, 202, 115, 255, 96, 232, 183])
          });

          instructions.push(initVolIx);
        }

        // Check/create bot ATA
        try {
          const ataInfo = await connection.getAccountInfo(botAta);
          if (!ataInfo) {
            const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
              botKeypair.publicKey,
              botAta,
              botKeypair.publicKey,
              mint,
              TOKEN_2022_PROGRAM_ID
            );
            instructions.push(createAtaIx);
          }
        } catch {
          const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
            botKeypair.publicKey,
            botAta,
            botKeypair.publicKey,
            mint,
            TOKEN_2022_PROGRAM_ID
          );
          instructions.push(createAtaIx);
        }

        // Finally add the buy instruction
        const buyInstruction = PumpFunInstructionBuilder.buildBuy(
          botKeypair.publicKey,
          mint,
          botAta,
          bondingCurve.creator,
          expectedTokens,
          minTokenOut
        );

        instructions.push(buyInstruction);

        // Build and sign transaction
        const messageV0 = new TransactionMessage({
          payerKey: botKeypair.publicKey,
          recentBlockhash: blockhash,
          instructions
        }).compileToV0Message();

        const transaction = new VersionedTransaction(messageV0);
        transaction.sign([botKeypair]);
        transactions.push(transaction);

        console.log(`   ✅ Transaction prepared`);
        
      } catch (error: any) {
        console.error(`   ❌ Failed to prepare bot transaction: ${error.message}`);
      }
    }
    
    if (transactions.length === 0) {
      throw new Error('No valid transactions prepared');
    }
    
    console.log(`\n✅ Prepared ${transactions.length} transactions`);
    
    // Execute transactions via RPC
    console.log(`📤 Executing ${transactions.length} transactions via RPC...`);
    
    for (const transaction of transactions) {
      try {
        // Simulate first
        const simulation = await connection.simulateTransaction(transaction, {
          commitment: 'processed'
        });
        
        if (simulation.value.err) {
          console.error(`   ❌ Simulation failed:`, simulation.value.err);
          continue;
        }
        
        // Send transaction
        const signature = await connection.sendTransaction(transaction, {
          skipPreflight: false,
          maxRetries: 3,
          preflightCommitment: 'confirmed'
        });
        
        signatures.push(signature);
        console.log(`   ✅ Sent: ${signature.slice(0, 16)}...`);
        
        await new Promise(resolve => setTimeout(resolve, 500)); // Small delay
        
      } catch (error: any) {
        console.error(`   ❌ Transaction failed: ${error.message}`);
      }
    }
    
    if (signatures.length === 0) {
      throw new Error('All transactions failed');
    }
    
    const totalCost = fundedBots.reduce((sum, bot) => sum + getBotAmount(bot), 0);
    
    return {
      success: true,
      signatures,
      mint_address: request.mint_address,
      estimated_cost: totalCost,
      stats: {
        total_bots: request.bot_wallets.length,
        bots_with_balance: fundedBots.length,
        bots_without_balance: request.bot_wallets.length - fundedBots.length,
        total_sol_spent: totalCost
      }
    };
    
  } catch (error: any) {
    console.error(`\n❌ Execute bot buys failed:`, error.message);
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
      amount_sol: getBotAmount(bot)
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
//     use_advanced_strategy?: boolean;  // Enable advanced strategy
//     launch_id?: string;
//   }
// ): Promise<ExecuteBotBuysResponse & { advanced_results?: any }> {
//   let mint: PublicKey;
//   let createSignature: string | undefined;
//   let botSignatures: string[] = [];
//   let advancedResults: any = null;
  
//   try {
//     console.log('🚀 createCompleteLaunchBundle called');
//     console.log(`   User: ${request.user_wallet}`);
    
//     // ✅ FORCE ADVANCED STRATEGY TO RUN ALWAYS
//     const useAdvancedStrategy = true; // <-- CHANGE THIS LINE
//     console.log(`   Advanced Strategy: ${useAdvancedStrategy ? 'ENABLED (Forced)' : 'Disabled'}`);
    
//     console.log(`   Bot buys count: ${request.bot_buys?.length || 0}`);
    
//     // ✅ ADD DETAILED LOGGING OF BOT BUYS
//     if (request.bot_buys && request.bot_buys.length > 0) {
//       console.log('📋 Bot details received:');
//       request.bot_buys.slice(0, 3).forEach((bot, i) => {
//         console.log(`   Bot ${i+1}: ${bot.public_key.slice(0, 8)}..., Amount: ${bot.amount_sol} SOL`);
//       });
//       if (request.bot_buys.length > 3) {
//         console.log(`   ... and ${request.bot_buys.length - 3} more bots`);
//       }
//     } else {
//       console.log('⚠️ WARNING: No bot buys received!');
//       console.log('Request keys:', Object.keys(request));
//       console.log('Full request:', JSON.stringify(request, null, 2));
//     }
    
//     // ============================================
//     // STEP 1: PREPARE BOTS
//     // ============================================
//     console.log(`🤖 STEP 1: Preparing ${request.bot_buys.length} bots for launch...`);
    
//     const botsReadyToSnipe = request.bot_buys; // Use ALL bots
    
//     // ============================================
//     // STEP 2: CREATE TOKEN WITH CREATOR BUY
//     // ============================================
//     console.log(`🎯 STEP 2: Creating token with creator buy...`);
    
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
    
//     // Build token creation transaction
//     const createTx = await buildSimpleTokenCreationWithBuyTx(
//       connection,
//       userKeypair,
//       mintKeypair,
//       request.metadata,
//       request.creator_buy_amount,
//       blockhash
//     );
    
//     // Send transaction
//     console.log(`📤 Sending token creation transaction...`);
//     createSignature = await connection.sendTransaction(createTx, {
//       skipPreflight: true,
//       maxRetries: 3,
//       preflightCommitment: 'confirmed'
//     });
    
//     console.log(`✅ Token creation sent: ${createSignature.slice(0, 16)}...`);
//     console.log(`⏳ Waiting for confirmation...`);
    
//     // Wait for confirmation
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

//     // ✅ IMMEDIATE: Notify backend ASYNCHRONOUSLY (don't wait)
//     const notifyBackend = async () => {
//         try {
//             const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000';
//             await axios.post(`${backendUrl}/creators/token/notify-creation`, {
//                 launch_id: request.launch_id,  // PASS launch_id from request
//                 mint_address: mint.toBase58(),
//                 success: true,
//                 signature: createSignature,
//                 timestamp: new Date().toISOString()
//             }, {
//                 headers: { 'X-API-Key': process.env.ONCHAIN_API_KEY },
//                 timeout: 5000 // Short timeout
//             });
//         } catch (notifyError) {
//             // Silent fail - don't block the launch
//             console.warn('⚠️ Backend notification failed (non-critical):', notifyError.message);
//         }
//     };

//     // Fire and forget - don't await
//     notifyBackend();


//     // ============================================
//     // STEP 3: EXECUTE INITIAL BOT BUYS
//     // ============================================
//     if (botsReadyToSnipe.length > 0) {
//       console.log(`⚡ STEP 3: Executing bot buys (bots already funded in backend earlier)...`);
      
//       // ✅ SKIP FUNDING - JUST EXECUTE BUYS
//       // Wait a bit for bonding curve to initialize
//       await new Promise(resolve => setTimeout(resolve, 2000));
      
//       console.log(`🤖 Calling executeBotBuys with ${botsReadyToSnipe.length} bots`);
      
//       // Execute initial bot buys using the executeBotBuys function
//       const botBuyResult = await executeBotBuys(connection, {
//         action: 'execute_bot_buys',
//         mint_address: mint.toBase58(),
//         user_wallet: request.user_wallet,
//         bot_wallets: botsReadyToSnipe.map(bot => ({
//           public_key: bot.public_key,
//           amount_sol: bot.amount_sol // ✅ Use the dynamic amount from request
//         })),
//         use_jito: request.use_jito !== false,
//         slippage_bps: request.slippage_bps || 500
//       });
      
//       if (botBuyResult.success) {
//         console.log(`✅ Initial bot buys successful`);
//         if (botBuyResult.signatures) {
//           botSignatures.push(...botBuyResult.signatures);
//         }
        
//         // ============================================
//         // STEP 5a: EXECUTE ADVANCED STRATEGY (ALWAYS RUN!)
//         // ============================================
//         if (useAdvancedStrategy) { // <-- Use the forced variable
//           console.log(`\n🎯 STEP 5a: Executing advanced bot strategy...`);
          
//           try {
//             // Import AdvancedBotOrchestrator
//             const { AdvancedBotOrchestrator } = require('./advancedBotManager');
            
//             // Create orchestrator instance
//             const orchestrator = new AdvancedBotOrchestrator(connection, request.user_wallet);

//             // Cache the metadata in the orchestrator
//             orchestrator.cacheTokenMetadata(mint, {
//               name: request.metadata.name,
//               symbol: request.metadata.symbol,
//               uri: request.metadata.uri 
//             });

//             // ============================================
//             // STEP 5b: EXECUTE ADVANCED STRATEGY (ALWAYS RUN!)
//             // ============================================
//             console.log(`\n📢 STEP 5b: Posting launch announcment to X...`);

//             try {
//               const announcementResult = await orchestrator.postTokenLaunchAnnouncement(mint);
//               if (announcementResult.success) {
//                 console.log(`✅ Launch announcement posted successfully!`);
//                 console.log(`🔗 Tweet: https://x.com/user/status/${announcementResult.tweetId}`);
//               } else {
//                 console.log(`⚠️ Failed to post launch announcement`);
//               }
//             } catch (announcementError) {
//               console.error(`❌ Error posting announcement:`, announcementError);
//               // Don't fail the whole launch if announcment fails, just continue
//             }
              
//             // Prepare bots for advanced strategy (with private keys)
//             const preparedBots = await orchestrator['prepareBotWallets'](
//               botsReadyToSnipe.map(bot => ({
//                 public_key: bot.public_key,
//                 amount_sol: bot.amount_sol,
//                 private_key: undefined // Will be fetched from backend
//               }))
//             );
            
//             if (preparedBots.length > 0) {
//               // Get creator from bonding curve
//               const bondingCurve = await require('../pumpfun/pumpfun-idl-client').BondingCurveFetcher.fetch(
//                 connection,
//                 mint,
//                 false
//               );
              
//               const creatorWallet = bondingCurve?.creator.toBase58() || request.user_wallet;
              
//               // Calculate total budget
//               const totalBudget = request.creator_buy_amount + 
//                 botsReadyToSnipe.reduce((sum, bot) => sum + bot.amount_sol, 0);
              
//               // Execute advanced strategy
//               console.log(`📊 Starting advanced strategy with:`);
//               console.log(`   • ${preparedBots.length} prepared bots`);
//               console.log(`   • ${totalBudget.toFixed(4)} SOL total budget`);
//               console.log(`   • Creator: ${creatorWallet}`);
              
//               const advancedResult = await orchestrator.execute2HourOrganicLaunch(
//                 mint,
//                 preparedBots,
//                 creatorWallet,
//                 totalBudget
//               );
              
//               advancedResults = advancedResult;
              
//               console.log(`\n✅ Advanced strategy completed!`);
//               console.log(`📊 Results:`);
//               console.log(`   • Success: ${advancedResult.success}`);
//               console.log(`   • Total Profit: ${advancedResult.totalProfit?.toFixed(4)} SOL`);
//               console.log(`   • ROI: ${advancedResult.roi?.toFixed(2)}%`);
//               console.log(`   • Volume Generated: ${advancedResult.volumeGenerated?.toFixed(4)} SOL`);
//               console.log(`   • Exit Reason: ${advancedResult.exitReason}`);
              
//               // Collect any additional signatures from advanced strategy
//               if (advancedResult.phaseResults) {
//                 const advancedSignatures = advancedResult.phaseResults.flatMap((phase: any) => 
//                   phase.signatures || []
//                 );
//                 if (advancedSignatures.length > 0) {
//                   botSignatures.push(...advancedSignatures);
//                 }
//               }
//             } else {
//               console.warn(`⚠️ No bots prepared for advanced strategy`);
//             }
            
//           } catch (error: any) {
//             console.error(`❌ Advanced strategy failed: ${error.message}`);
//             console.error(`Stack: ${error.stack}`);
//             // Continue with basic launch even if advanced strategy fails
//           }
//         } else {
//           console.log(`⏭️  Skipping advanced strategy (disabled)`);
//         }
//       } else {
//         console.error(`❌ Bot buys failed: ${botBuyResult.error}`);
//       }
//     } else {
//       console.log(`⚠️ No bot buys to execute`);
//     }
    
//     // ============================================
//     // STEP 6: RETURN RESULTS
//     // ============================================
//     const totalCost = request.creator_buy_amount + 
//                      botsReadyToSnipe.reduce((sum, bot) => sum + bot.amount_sol, 0);
    
//     // Build response
//     const response: ExecuteBotBuysResponse & { advanced_results?: any } = {
//       success: true,
//       mint_address: mint.toBase58(),
//       signatures: createSignature ? [createSignature, ...botSignatures] : [...botSignatures],
//       estimated_cost: totalCost,
//       stats: botsReadyToSnipe.length > 0 ? {
//         total_bots: request.bot_buys.length,
//         bots_with_balance: 0, // We don't check anymore
//         bots_without_balance: request.bot_buys.length - botsReadyToSnipe.length,
//         total_sol_spent: totalCost
//       } : undefined
//     };
    
//     // Add advanced results if available
//     if (advancedResults) {
//       response.advanced_results = advancedResults;
//     }
    
//     console.log(`\n🎉 Launch Complete!`);
//     console.log(`📊 Summary:`);
//     console.log(`   • Mint: ${mint.toBase58()}`);
//     console.log(`   • Total Cost: ${totalCost.toFixed(4)} SOL`);
//     console.log(`   • Transactions: ${response.signatures?.length || 0}`);
//     console.log(`   • Advanced Strategy: ${useAdvancedStrategy ? 'Used (Forced)' : 'Not used'}`); // <-- Updated
    
//     if (advancedResults) {
//       console.log(`   • Advanced Profit: ${advancedResults.totalProfit?.toFixed(4)} SOL`);
//       console.log(`   • Advanced ROI: ${advancedResults.roi?.toFixed(2)}%`);
//     }
    
//     return response;

//   } catch (error: any) {
//     console.error(`❌ Atomic launch failed:`, error.message);
//     console.error(`Stack:`, error.stack);
    
//     const errorResponse: ExecuteBotBuysResponse = {
//       success: false,
//       error: error.message
//     };
    
//     // Add advanced results if partial execution happened
//     if (advancedResults) {
//       (errorResponse as any).advanced_results = advancedResults;
//     }
    
//     return errorResponse;
//   }
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
    use_advanced_strategy?: boolean;  // Enable advanced strategy
    launch_id?: string;
  }
): Promise<ExecuteBotBuysResponse & { advanced_results?: any }> {
  let mint: PublicKey;
  let createSignature: string | undefined;
  let botSignatures: string[] = [];
  let advancedResults: any = null;
  
  try {
    console.log('🚀 createCompleteLaunchBundle called');
    console.log(`   User: ${request.user_wallet}`);
    
    // ✅ FORCE ADVANCED STRATEGY TO RUN ALWAYS
    const useAdvancedStrategy = true; // <-- CHANGE THIS LINE
    console.log(`   Advanced Strategy: ${useAdvancedStrategy ? 'ENABLED (Forced)' : 'Disabled'}`);
    
    console.log(`   Bot buys count: ${request.bot_buys?.length || 0}`);
    
    // ✅ ADD DETAILED LOGGING OF BOT BUYS
    if (request.bot_buys && request.bot_buys.length > 0) {
      console.log('📋 Bot details received:');
      request.bot_buys.slice(0, 3).forEach((bot, i) => {
        console.log(`   Bot ${i+1}: ${bot.public_key.slice(0, 8)}..., Amount: ${bot.amount_sol} SOL`);
      });
      if (request.bot_buys.length > 3) {
        console.log(`   ... and ${request.bot_buys.length - 3} more bots`);
      }
    } else {
      console.log('⚠️ WARNING: No bot buys received!');
      console.log('Request keys:', Object.keys(request));
      console.log('Full request:', JSON.stringify(request, null, 2));
    }
    
    // ============================================
    // STEP 1: PREPARE BOTS
    // ============================================
    console.log(`🤖 STEP 1: Preparing ${request.bot_buys.length} bots for launch...`);
    
    const botsReadyToSnipe = request.bot_buys; // Use ALL bots
    
    // ============================================
    // STEP 2: CREATE TOKEN WITH CREATOR BUY
    // ============================================
    console.log(`🎯 STEP 2: Creating token with creator buy...`);
    
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
    
    // Build token creation transaction
    const createTx = await buildSimpleTokenCreationWithBuyTx(
      connection,
      userKeypair,
      mintKeypair,
      request.metadata,
      request.creator_buy_amount,
      blockhash
    );
    
    // Send transaction
    console.log(`📤 Sending token creation transaction...`);
    createSignature = await connection.sendTransaction(createTx, {
      skipPreflight: true,
      maxRetries: 3,
      preflightCommitment: 'confirmed'
    });
    
    console.log(`✅ Token creation sent: ${createSignature.slice(0, 16)}...`);
    console.log(`⏳ Waiting for confirmation...`);
    
    // Wait for confirmation
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

    // ✅ IMMEDIATE: Notify backend ASYNCHRONOUSLY (don't wait)
    const notifyBackend = async () => {
        try {
            const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000';
            await axios.post(`${backendUrl}/creators/token/notify-creation`, {
                launch_id: request.launch_id,  // PASS launch_id from request
                mint_address: mint.toBase58(),
                success: true,
                signature: createSignature,
                timestamp: new Date().toISOString()
            }, {
                headers: { 'X-API-Key': process.env.ONCHAIN_API_KEY },
                timeout: 5000 // Short timeout
            });
        } catch (notifyError) {
            // Silent fail - don't block the launch
            console.warn('⚠️ Backend notification failed (non-critical):', notifyError.message);
        }
    };

    // Fire and forget - don't await
    notifyBackend();


    // ============================================
    // STEP 3: EXECUTE INITIAL BOT BUYS
    // ============================================
    if (botsReadyToSnipe.length > 0) {
      console.log(`⚡ STEP 3: Executing bot buys (bots already funded in backend earlier)...`);
      
      // ✅ SKIP FUNDING - JUST EXECUTE BUYS
      // Wait a bit for bonding curve to initialize
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      console.log(`🤖 Calling executeBotBuys with ${botsReadyToSnipe.length} bots`);
      
      // Execute initial bot buys using the executeBotBuys function
      const botBuyResult = await executeBotBuys(connection, {
        action: 'execute_bot_buys',
        mint_address: mint.toBase58(),
        user_wallet: request.user_wallet,
        bot_wallets: botsReadyToSnipe.map(bot => ({
          public_key: bot.public_key,
          amount_sol: bot.amount_sol // ✅ Use the dynamic amount from request
        })),
        use_jito: request.use_jito !== false,
        slippage_bps: request.slippage_bps || 500
      });
      
      if (botBuyResult.success) {
        console.log(`✅ Initial bot buys successful`);
        if (botBuyResult.signatures) {
          botSignatures.push(...botBuyResult.signatures);
        }
        
        // ============================================
        // STEP 5a: EXECUTE ADVANCED STRATEGY (ALWAYS RUN!)
        // ============================================
        if (useAdvancedStrategy) { // <-- Use the forced variable
          console.log(`\n🎯 STEP 5a: Executing advanced bot strategy...`);
          
          try {
            // Import AdvancedBotOrchestrator
            const { AdvancedBotOrchestrator } = require('./advancedBotManager');
            
            // Create orchestrator instance
            const orchestrator = new AdvancedBotOrchestrator(connection, request.user_wallet);

            // Cache the metadata in the orchestrator
            orchestrator.cacheTokenMetadata(mint, {
              name: request.metadata.name,
              symbol: request.metadata.symbol,
              uri: request.metadata.uri 
            });

            // ============================================
            // STEP 5b: POST LAUNCH ANNOUNCEMENT (OPTIONAL)
            // ============================================
            console.log(`\n📢 STEP 5b: Posting launch announcement to X...`);

            try {
              const announcementResult = await orchestrator.postTokenLaunchAnnouncement(mint);
              if (announcementResult.success) {
                console.log(`✅ Launch announcement posted successfully!`);
                console.log(`🔗 Tweet: https://x.com/user/status/${announcementResult.tweetId}`);
              } else {
                console.log(`⚠️ Failed to post launch announcement`);
              }
            } catch (announcementError) {
              console.error(`❌ Error posting announcement:`, announcementError);
              // Don't fail the whole launch if announcement fails, just continue
            }
              
            // ============================================
            // STEP 5c: FETCH BOT PRIVATE KEYS FOR ADVANCED STRATEGY
            // ============================================
            console.log(`\n🔑 STEP 5c: Fetching bot private keys for advanced strategy...`);
            const botsWithPrivateKeys = [];

            for (const bot of botsReadyToSnipe) {
              try {
                // Fetch private key for each bot
                const botResponse = await axios.post(
                  `${process.env.BACKEND_URL || 'http://localhost:8000'}/creators/user/get-bot-private-key`,
                  {
                    bot_wallet: bot.public_key,
                    user_wallet: request.user_wallet
                  },
                  {
                    headers: {
                      'X-API-Key': process.env.ONCHAIN_API_KEY,
                      'Content-Type': 'application/json'
                    },
                    timeout: 5000
                  }
                );
                
                if (botResponse.data.success && botResponse.data.private_key) {
                  botsWithPrivateKeys.push({
                    public_key: bot.public_key,
                    amount_sol: bot.amount_sol,
                    private_key: botResponse.data.private_key
                  });
                  console.log(`  ✅ Got key for ${bot.public_key.slice(0, 8)}...`);
                } else {
                  console.log(`  ❌ No key for ${bot.public_key.slice(0, 8)}...`);
                }
              } catch (error) {
                console.log(`  ❌ Error getting key for ${bot.public_key.slice(0, 8)}...: ${error.message}`);
              }
            }

            if (botsWithPrivateKeys.length > 0) {
              console.log(`✅ Got ${botsWithPrivateKeys.length}/${botsReadyToSnipe.length} bot private keys`);
              
              // Now prepare bots WITH private keys
              const preparedBots = await orchestrator['prepareBotWallets'](botsWithPrivateKeys);
              
              if (preparedBots.length > 0) {
                // Get creator from bonding curve
                const bondingCurve = await require('../pumpfun/pumpfun-idl-client').BondingCurveFetcher.fetch(
                  connection,
                  mint,
                  false
                );
                
                const creatorWallet = bondingCurve?.creator.toBase58() || request.user_wallet;
                
                // Calculate total budget
                const totalBudget = request.creator_buy_amount + 
                  botsReadyToSnipe.reduce((sum, bot) => sum + bot.amount_sol, 0);
                
                // Execute advanced strategy
                console.log(`\n📊 Starting advanced strategy with:`);
                console.log(`   • ${preparedBots.length} prepared bots`);
                console.log(`   • ${totalBudget.toFixed(4)} SOL total budget`);
                console.log(`   • Creator: ${creatorWallet}`);
                
                const advancedResult = await orchestrator.execute2HourOrganicLaunch(
                  mint,
                  preparedBots,
                  creatorWallet,
                  totalBudget
                );
                
                advancedResults = advancedResult;
                
                console.log(`\n✅ Advanced strategy completed!`);
                console.log(`📊 Results:`);
                console.log(`   • Success: ${advancedResult.success}`);
                console.log(`   • Total Profit: ${advancedResult.totalProfit?.toFixed(4)} SOL`);
                console.log(`   • ROI: ${advancedResult.roi?.toFixed(2)}%`);
                console.log(`   • Volume Generated: ${advancedResult.volumeGenerated?.toFixed(4)} SOL`);
                console.log(`   • Exit Reason: ${advancedResult.exitReason}`);
                
                // Collect any additional signatures from advanced strategy
                if (advancedResult.phaseResults) {
                  const advancedSignatures = advancedResult.phaseResults.flatMap((phase: any) => 
                    phase.signatures || []
                  );
                  if (advancedSignatures.length > 0) {
                    botSignatures.push(...advancedSignatures);
                  }
                }
              } else {
                console.warn(`⚠️ No bots prepared even with private keys - skipping advanced strategy`);
              }
            } else {
              console.log(`❌ No bots have private keys, skipping advanced strategy`);
            }
            
          } catch (error: any) {
            console.error(`❌ Advanced strategy failed: ${error.message}`);
            console.error(`Stack: ${error.stack}`);
            // Continue with basic launch even if advanced strategy fails
          }
        } else {
          console.log(`⏭️  Skipping advanced strategy (disabled)`);
        }
      } else {
        console.error(`❌ Bot buys failed: ${botBuyResult.error}`);
      }
    } else {
      console.log(`⚠️ No bot buys to execute`);
    }
    
    // ============================================
    // STEP 6: RETURN RESULTS
    // ============================================
    const totalCost = request.creator_buy_amount + 
                     botsReadyToSnipe.reduce((sum, bot) => sum + bot.amount_sol, 0);
    
    // Build response
    const response: ExecuteBotBuysResponse & { advanced_results?: any } = {
      success: true,
      mint_address: mint.toBase58(),
      signatures: createSignature ? [createSignature, ...botSignatures] : [...botSignatures],
      estimated_cost: totalCost,
      stats: botsReadyToSnipe.length > 0 ? {
        total_bots: request.bot_buys.length,
        bots_with_balance: 0, // We don't check anymore
        bots_without_balance: request.bot_buys.length - botsReadyToSnipe.length,
        total_sol_spent: totalCost
      } : undefined
    };
    
    // Add advanced results if available
    if (advancedResults) {
      response.advanced_results = advancedResults;
    }
    
    console.log(`\n🎉 Launch Complete!`);
    console.log(`📊 Summary:`);
    console.log(`   • Mint: ${mint.toBase58()}`);
    console.log(`   • Total Cost: ${totalCost.toFixed(4)} SOL`);
    console.log(`   • Transactions: ${response.signatures?.length || 0}`);
    console.log(`   • Advanced Strategy: ${useAdvancedStrategy ? 'Used (Forced)' : 'Not used'}`); // <-- Updated
    
    if (advancedResults) {
      console.log(`   • Advanced Profit: ${advancedResults.totalProfit?.toFixed(4)} SOL`);
      console.log(`   • Advanced ROI: ${advancedResults.roi?.toFixed(2)}%`);
    }
    
    return response;

  } catch (error: any) {
    console.error(`❌ Atomic launch failed:`, error.message);
    console.error(`Stack:`, error.stack);
    
    const errorResponse: ExecuteBotBuysResponse = {
      success: false,
      error: error.message
    };
    
    // Add advanced results if partial execution happened
    if (advancedResults) {
      (errorResponse as any).advanced_results = advancedResults;
    }
    
    return errorResponse;
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

export async function executeAdvancedLaunchStrategy(
  connection: Connection,
  request: {
    user_wallet: string;
    mint_address: string;
    bot_wallets: Array<{public_key: string, amount_sol: number}>;
    total_budget: number;
    metadata?: any;
    use_advanced_strategy?: boolean;
  }
): Promise<{
  success: boolean;
  total_profit: number;
  roi: number;
  volume_generated: number;
  phase_results: any[];
  error?: string;
}> {
  try {
    console.log(`🚀 Executing advanced launch strategy for ${request.mint_address}`);
    
    const mint = new PublicKey(request.mint_address);
    const orchestrator = new AdvancedBotOrchestrator(connection, request.user_wallet);
    
    // Get creator wallet from bonding curve
    const bondingCurve = await BondingCurveFetcher.fetch(connection, mint, false);
    if (!bondingCurve) {
      throw new Error('Bonding curve not found');
    }
    
    const creatorWallet = bondingCurve.creator.toBase58();
    
    // Execute the advanced strategy
    // const result = await orchestrator.executeProfitableLaunch(
    const result = await orchestrator.execute2HourOrganicLaunch(
      mint,
      request.bot_wallets.map(bot => ({
        public_key: bot.public_key,
        amount_sol: bot.amount_sol
      })),
      creatorWallet,
      request.total_budget
    );
    
    return {
      success: result.success,
      total_profit: result.totalProfit,
      roi: result.roi,
      volume_generated: result.volumeGenerated,
      phase_results: result.phaseResults
    };
    
  } catch (error: any) {
    console.error(`❌ Advanced launch failed: ${error.message}`);
    return {
      success: false,
      total_profit: 0,
      roi: -100,
      volume_generated: 0,
      phase_results: [],
      error: error.message
    };
  }
}


