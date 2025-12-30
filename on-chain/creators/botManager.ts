import { Connection, Keypair, PublicKey, VersionedTransaction, TransactionMessage, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import bs58 from 'bs58';
import { jitoBundleSender } from '../jito_bundles/jito-integration';
import { FundBotsRequest, ExecuteBotBuysRequest } from '../types/api';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import axios from 'axios';
import { BondingCurveMath, PumpFunInstructionBuilder, PumpFunPda, TOKEN_2022_PROGRAM_ID } from '../pumpfun/pumpfun-idl-client';
import { 
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
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    
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
          preflightCommitment: 'confirmed'
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
export async function executeBotBuys(
  connection: Connection,
  request: ExecuteBotBuysRequest
): Promise<ExecuteBotBuysResponse> {
  try {
    console.log(`🎯 Executing bot buys for token: ${request.mint_address}`);
    console.log(`     Bot count: ${request.bot_wallets.length}`);

    const mint = new PublicKey(request.mint_address);
    const userWallet = new PublicKey(request.user_wallet);
    
    // First check which bots need funding
    const botsNeedingFunding: any[] = [];
    const botsReadyToBuy: any[] = [];
    
    for (const bot of request.bot_wallets) {
      try {
        // Get bot balance
        const botPubkey = new PublicKey(bot.public_key);
        const balance = await connection.getBalance(botPubkey);
        const requiredBalance = BigInt(Math.floor(bot.buy_amount * LAMPORTS_PER_SOL));
        
        if (balance < requiredBalance) {
          console.log(`❌ Bot ${bot.public_key.slice(0, 8)}... needs funding: ${balance/LAMPORTS_PER_SOL} SOL < ${bot.buy_amount} SOL`);
          botsNeedingFunding.push(bot);
        } else {
          console.log(`✅ Bot ${bot.public_key.slice(0, 8)}... has sufficient balance: ${balance/LAMPORTS_PER_SOL} SOL`);
          botsReadyToBuy.push(bot);
        }
      } catch (error) {
        console.error(`Failed to check balance for bot ${bot.public_key}:`, error);
      }
    }
    
    // Only fund bots that need it
    if (botsNeedingFunding.length > 0) {
      console.log(`💰 Funding ${botsNeedingFunding.length} bots...`);
      
      const fundRequest: FundBotsRequest = {
        user_wallet: request.user_wallet,
        bot_wallets: botsNeedingFunding.map(bot => ({
          public_key: bot.public_key,
          amount_sol: bot.buy_amount
        })),
        use_jito: request.use_jito
      };
      
      const fundResult = await fundBots(connection, fundRequest);
      
      if (!fundResult.success) {
        throw new Error(`Bot funding failed: ${fundResult.error}`);
      }
      
      // Wait a moment for funding to settle
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Now execute buys with bots that have balance (including newly funded ones)
    const allBotsReady = [...botsReadyToBuy, ...botsNeedingFunding];
    
    if (allBotsReady.length === 0) {
      throw new Error('No bots with sufficient balance');
    }

    // Get bot private keys from backend
    const botTransactions: VersionedTransaction[] = [];
    const signatures: string[] = [];

    // Fetch bonding curve once
    const { BondingCurveFetcher } = require('../pumpfun/pumpfun-idl-client');
    const bondingCurve = await BondingCurveFetcher.fetch(connection, mint, true);
    if (!bondingCurve) {
      throw new Error('Bonding curve not found for token');
    }

    const creator = BondingCurveFetcher.getCreator(bondingCurve);

    // Get blockhash
    const { blockhash } = await connection.getLatestBlockhash('confirmed');

    // For each bot, get it's private key and create buy transaction
    for (const bot of request.bot_wallets) {
      try {
        // Get bot private key from backend
        const backendurl = process.env.BACKEND_URL || 'http://localhost:8000';
        const botResponse = await axios.post(
          `${backendurl}/creators/user/get-bot-private-key`,
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

        // Create buy instruction for this bot
        const solIn = BigInt(Math.floor(bot.buy_amount * LAMPORTS_PER_SOL));
        const slippageBps = request.slippage_bps || 500;

        // Calculate expected tokens
        const expectedTokens = require('../pumpfun/pumpfun-idl-client').BondingCurveMath.calculateTokensForSol(
          bondingCurve.virtual_sol_reserves,
          bondingCurve.virtual_token_reserves,
          solIn 
        );

        const minTokenOut = require('../pumpfun/pumpfun-idl-client').BondingCurveMath.applySlippage(expectedTokens, slippageBps);

        // Get bot ATA
        const { getAssociatedTokenAddressSync } = require('@solana/spl-token');
        const botAta = getAssociatedTokenAddressSync(
          mint,
          botKeypair.publicKey,
          false,
          require('../pumpfun/pumpfun-idl-client').TOKEN_2022_PROGRAM_ID
        );

        // Create buy instruction
        const buyInstruction = require('../pumpfun/pumpfun-idl-client').PumpFunInstructionBuilder.buildBuyExactSolIn(
          botKeypair.publicKey,
          mint,
          botAta,
          creator,
          solIn,
          minTokenOut
        );

        // Build transaction
        const messageV0 = new TransactionMessage({
          payerKey: botKeypair.publicKey,
          recentBlockhash: blockhash,
          instructions: [buyInstruction]
        }).compileToV0Message();

        const transaction = new VersionedTransaction(messageV0);
        transaction.sign([botKeypair]);
        botTransactions.push(transaction);

      } catch (error: any) {
        console.error(`❌ Failed to prepare transaction for bot ${bot.public_key}:`, error.message);
      }
    }

    if (botTransactions.length == 0) {
      throw new Error('No valid bot transactions prepared');
    }

    console.log(`✅ Prepared ${botTransactions.length} bot buy transactions`);

    // Execute transactions
    if (request.use_jito && botTransactions.length > 1) {
      try {
        console.log(`🚀 Sending ${botTransactions.length} bot buys via Jito bundle...`);
        const result = await jitoBundleSender.sendBundle(botTransactions, connection);

        if (result.success) {
          return {
            success: true,
            bundle_id: result.bundleId,
            estimated_cost: request.bot_wallets.reduce((sum, bot) => sum + bot.buy_amount, 0)
          };
        } else {
          console.log('🔄 Jito failed, falling back to RPC...');
        }
      } catch (jitoError) {
        console.error('Jito execution failed:', jitoError);
      }
    }

    // RPC fallback
    console.log(`📤 Sending ${botTransactions.length} bot buys via RPC...`);

    for (const transaction of botTransactions) {
      try {
        const signature = await connection.sendTransaction(transaction, {
          skipPreflight: false,
          maxRetries: 3,
          preflightCommitment: 'confirmed'
        });

        signatures.push(signature);
        console.log(`   Sent: ${signature.slice(0, 16)}...`);

      } catch(error: any) {
        console.error(`     Failed to send bot transaction: ${error.message}`);
      }
    }

    const totalCost = request.bot_wallets.reduce((sum, bot) => sum + bot.buy_amount, 0);

    return {
      success: signatures.length > 0,
      signatures: signatures.length > 0 ? signatures : undefined,
      estimated_cost: totalCost
    };

  } catch (error: any) {
    console.error(`❌ Execute bot buys failed:`, error.message);
    return {
      success: false,
      error: error.message
    };
  }
}


// // Atomic launch with pre-funded bots
// export async function executeAtomicLaunch(
//   connection: Connection,
//   request: any 
// ): Promise<ExecuteBotBuysResponse> {
//   try {
//     console.log(`🚀 Executing atomic launch for user: ${request.user_wallet}`);

//     // First create the token
//     // const { createToken } = require('./tokenCreation');
//     // const tokenResult = await createToken(connection, {
//     //   metadata: request.metadata,
//     //   user_wallet: request.user_wallet,
//     //   use_jito: request.use_jito,
//     //   creator_override: request.creator_override
//     // });

//     // if (!tokenResult.success || !tokenResult.mint_address) {
//     //   throw new Error(`Token creation failed: ${tokenResult.error}`);
//     // }

//     // const mintAddress = tokenResult.mint_address;
//     // console.log(`✅ Token created: ${mintAddress}`);

//      // Create token with creator buy
//     const { createTokenWithCreatorBuy } = require('./tokenCreation');
//     const tokenResult = await createTokenWithCreatorBuy(connection, {
//         ...request,
//         creator_buy_amount: request.creator_buy_amount || 0.01 // Default 0.01 SOL
//     });

//     if (!tokenResult.success || !tokenResult.mint_address) {
//         throw new Error(`Token creation failed: ${tokenResult.error}`);
//     }

//     const mintAddress = tokenResult.mint_address;
//     console.log(`✅ Token created with creator buy: ${mintAddress}`);

//     // Then execute creator buy
//     const { executeBuy } = require('./buyExecution');
//     const creatorBuyResult = await executeBuy(connection, {
//       mint_address: mintAddress,
//       user_wallet: request.user_wallet,
//       amount_sol: request.creator_buy_amount,
//       use_jito: false,  // We'll bundle everything together
//       slippage_bps: request.slippage_bps
//     });

//     if (!creatorBuyResult.success) {
//       throw new Error(`Creator buy failed: ${creatorBuyResult.error}`);
//     }

//     console.log('✅ Creator buy prepared');

//     // Prepare bot buy transactions
//     const mint = new PublicKey(mintAddress);
//     const { BondingCurveFetcher } = require('../pumpfun/pumpfun-idl-client');
//     const bondingCurve = await BondingCurveFetcher.fetch(connection, mint, true);
//     if (!bondingCurve) {
//       throw new Error('Bonding curve not found for token');
//     }

//     const creator = BondingCurveFetcher.getCreator(bondingCurve);
//     const { blockhash } = await connection.getLatestBlockhash('confirmed');

//     const allTransactions: VersionedTransaction[] = [];

//     // Add creator buy transaction if available
//     if (creatorBuyResult.transaction) {
//       allTransactions.push(creatorBuyResult.transaction);
//     }

//     // Add bot buy transactions
//     for (const bot of request.bot_wallets) {
//       try {
//         // Get bot private key
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

//         // Create bot buy transaction
//         const solIn = BigInt(Math.floor(bot.buy_amount * LAMPORTS_PER_SOL));
//         const slippageBps = request.slippage_bps || 500;

//         const expectedTokens = require('../pumpfun/pumpfun-idl-client').BondingCurveMath.calculateTokensForSol(
//           bondingCurve.virtual_sol_reserves,
//           bondingCurve.virtual_token_reserves,
//           solIn
//         );

//         const minTokensOut = require('../pumpfun/pumpfun-idl-client').BondingCurveMath.applySlippage(expectedTokens, slippageBps);

//         const { getAssociatedTokenAddressSync } = require('@solana/spl-token');
//         const botAta = getAssociatedTokenAddressSync(
//           mint,
//           botKeypair.publicKey,
//           false,
//           require('../pumpfun/pumpfun-idl-client').TOKEN_2022_PROGRAM_ID
//         );

//         const buyInstruction = require('../pumpfun/pumpfun-idl-client').PumpFunInstructionBuilder.buildBuyExactSolIn(
//           botKeypair.publicKey,
//           mint,
//           botAta,
//           creator,
//           solIn,
//           minTokensOut
//         );

//         const messageV0 = new TransactionMessage({
//           payerKey: botKeypair.publicKey,
//           recentBlockhash: blockhash,
//           instructions: [buyInstruction]
//         }).compileToV0Message();

//         const transaction = new VersionedTransaction(messageV0);
//         transaction.sign([botKeypair]);
//         allTransactions.push(transaction);

//       } catch (error: any) {
//         console.error(`❌ Failed to prepare bot transaction:`, error.message);
//       }
//     }

//     console.log(`✅ Prepared ${allTransactions.length} transactions for atomic bundle`);

//     // Send as Jito bundle
//     if (request.use_jito && allTransactions.length > 0) {
//       try {
//         console.log(`🚀 Sending atomic bundle via Jito...`);
//         const result = await jitoBundleSender.sendBundle(allTransactions, connection);

//         if (result.success) {
//           return {
//             success: true,
//             bundle_id: request.bundleId,
//             mint_address: mintAddress,
//             estimated_cost: request.creator_buy_amount + 
//                             request.bot_wallets.reduce((sum: number, bot: any) => sum + bot.buy_amount, 0)
//           };
//         } else {
//           console.log('🔄 Jito atomic bundle failed');
//         }
//       } catch (jitoError) {
//         console.error('Jito atomic bundle failed:', jitoError);
//       }
//     }

//     // Fallback: send individually
//     console.log(`📤 Sending ${allTransactions.length} transactions individually...`);
//     const signatures: string[] = [];

//     for (const transaction of allTransactions) {
//       try {
//         const signature = await connection.sendTransaction(transaction, {
//           skipPreflight: false,
//           maxRetries: 3,
//           preflightCommitment: 'confirmed'
//         });

//         signatures.push(signature);
//         console.log(`   Send: ${signature.slice(0, 16)}...`);

//       } catch (error: any) {
//         console.error(`   Failed to send transaction: ${error.message}`);
//       }
//     }

//     const totalCost = request.creator_buy_amount + 
//                     request.bot_wallets.reduce((sum: number, bot: any) => sum + bot.buy_amount, 0);

//     return {
//       success: signatures.length > 0,
//       signatures: signatures.length > 0 ? signatures : undefined,
//       mint_address: mintAddress,
//       estimated_cost: totalCost
//     };

//   } catch (error: any) {
//     console.error(`❌ Atomic launch failed:`, error.message);
//     return {
//       success: false,
//       error: error.message
//     }
//   }
// }



export async function executeAtomicLaunch(
  connection: Connection,
  request: any 
): Promise<ExecuteBotBuysResponse> {
  try {
    console.log(`🚀 Executing atomic launch for user: ${request.user_wallet}`);
    
    // Map the bot_wallets to the expected format
    const botBuys = request.bot_wallets ? request.bot_wallets.map((bot: any) => ({
        public_key: bot.public_key,
        amount_sol: bot.buy_amount
    })) : [];
    
    // Use the new complete bundle creator
    return await createCompleteLaunchBundle(connection, {
      user_wallet: request.user_wallet,
      metadata: request.metadata,
      creator_buy_amount: request.creator_buy_amount || 0.01,
      bot_buys: botBuys,  // Use the mapped format
      use_jito: request.use_jito !== false,
      slippage_bps: request.slippage_bps || 500
    });
    
  } catch (error: any) {
    console.error(`❌ Atomic launch failed:`, error.message);
    return {
      success: false,
      error: error.message
    }
  }
}












// NEW: True atomic bundle creator
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
//   try {
//     console.log(`🚀 Creating complete launch bundle for user: ${request.user_wallet}`);
    
//     // 1. Get user private key ✅
//     const userPrivateKey = await getDecryptedPrivateKey(
//       request.user_wallet,
//       process.env.ONCHAIN_API_KEY || ''
//     );
//     const secretKey = bs58.decode(userPrivateKey);
//     const userKeypair = Keypair.fromSecretKey(secretKey);
    
//     // 2. Generate mint keypair ✅
//     const mintKeypair = Keypair.generate();
//     const mint = mintKeypair.publicKey;
    
//     // 3. Get SAME blockhash for ALL transactions ✅
//     const { blockhash } = await connection.getLatestBlockhash('confirmed');
//     console.log(`📊 Using blockhash: ${blockhash.slice(0, 16)}...`);
    
//     // 4. Prepare all transactions
//     const allTransactions: VersionedTransaction[] = [];
    
//     // 5. Create token creation + creator buy transaction
//     console.log(`🔧 Building token creation + creator buy transaction...`);
//     const tokenTx = await buildTokenCreationWithBuyTx(
//       connection,
//       userKeypair,
//       mintKeypair,
//       request.metadata,
//       request.creator_buy_amount,
//       blockhash
//     );
//     allTransactions.push(tokenTx);
//     console.log(`✅ Token creation transaction prepared`);
    
//     // 6. Prepare bot armies buy transactions
//     if (request.bot_buys && request.bot_buys.length > 0) {
//       console.log(`🤖 Preparing ${request.bot_buys.length} bot buy transactions...`);
      
//       // First check which bots need funding
//       const botsNeedingFunding: any[] = [];
//       const botsReadyToBuy: any[] = [];
      
//       for (const bot of request.bot_buys) {
//         try {
//           const botPubkey = new PublicKey(bot.public_key);
//           const balance = await connection.getBalance(botPubkey);
//           const requiredBalance = BigInt(Math.floor(bot.amount_sol * LAMPORTS_PER_SOL));
          
//           if (balance < requiredBalance) {
//             console.log(`❌ Bot ${bot.public_key.slice(0, 8)}... needs funding`);
//             botsNeedingFunding.push(bot);
//           } else {
//             console.log(`✅ Bot ${bot.public_key.slice(0, 8)}... ready`);
//             botsReadyToBuy.push(bot);
//           }
//         } catch (error) {
//           console.error(`Failed to check bot ${bot.public_key}:`, error);
//         }
//       }
      
//       // Fund bots that need it
//       if (botsNeedingFunding.length > 0) {
//         console.log(`💰 Funding ${botsNeedingFunding.length} bots...`);
//         const fundResult = await fundBots(connection, {
//           user_wallet: request.user_wallet,
//           bot_wallets: botsNeedingFunding.map(bot => ({
//             public_key: bot.public_key,
//             amount_sol: bot.amount_sol
//           })),
//           use_jito: false // Don't use Jito for funding - we'll bundle everything
//         });
        
//         if (!fundResult.success) {
//           throw new Error(`Bot funding failed: ${fundResult.error}`);
//         }
//       }
      
//       // Now prepare buy transactions for ALL bots (including newly funded ones)
//       const allBots = [...botsReadyToBuy, ...botsNeedingFunding];
      
//       for (const bot of allBots) {
//         try {
//           const botTx = await buildBotBuyTransaction(
//             connection,
//             request.user_wallet,
//             bot.public_key,
//             mint,
//             bot.amount_sol,
//             request.slippage_bps || 500,
//             blockhash
//           );
          
//           if (botTx) {
//             allTransactions.push(botTx);
//           }
//         } catch (error) {
//           console.error(`Failed to prepare bot ${bot.public_key} transaction:`, error);
//         }
//       }
//     }
    
//     console.log(`✅ Prepared ${allTransactions.length} total transactions for atomic bundle`);
    
//     // 7. Send as Jito bundle (or individually)
//     if (request.use_jito !== false && allTransactions.length > 0) {
//       try {
//         console.log(`🚀 Sending atomic bundle via Jito...`);
//         const result = await jitoBundleSender.sendBundle(allTransactions, connection);
        
//         if (result.success) {
//           const totalCost = request.creator_buy_amount + 
//                           request.bot_buys.reduce((sum, bot) => sum + bot.amount_sol, 0);
          
//           return {
//             success: true,
//             bundle_id: result.bundleId,
//             mint_address: mint.toBase58(),
//             estimated_cost: totalCost
//           };
//         } else {
//           console.log('🔄 Jito failed, falling back to RPC...');
//         }
//       } catch (jitoError) {
//         console.error('Jito atomic bundle failed:', jitoError);
//       }
//     }
    
//     // RPC fallback
//     console.log(`📤 Sending ${allTransactions.length} transactions via RPC...`);
//     const signatures: string[] = [];
    
//     for (const transaction of allTransactions) {
//       try {
//         const signature = await connection.sendTransaction(transaction, {
//           skipPreflight: false,
//           maxRetries: 3,
//           preflightCommitment: 'confirmed'
//         });
        
//         signatures.push(signature);
//         console.log(`   Sent: ${signature.slice(0, 16)}...`);
        
//       } catch (error: any) {
//         console.error(`   Failed to send transaction: ${error.message}`);
//       }
//     }
    
//     const totalCost = request.creator_buy_amount + 
//                     request.bot_buys.reduce((sum, bot) => sum + bot.amount_sol, 0);
    
//     return {
//       success: signatures.length > 0,
//       signatures: signatures.length > 0 ? signatures : undefined,
//       mint_address: mint.toBase58(),
//       estimated_cost: totalCost
//     };
    
//   } catch (error: any) {
//     console.error(`❌ Complete launch bundle failed:`, error.message);
//     return {
//       success: false,
//       error: error.message
//     };
//   }
// }

// In createCompleteLaunchBundle function, replace the 2-transaction approach with this:

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
  try {
    console.log(`🚀 Creating atomic launch bundle for user: ${request.user_wallet}`);
    
    // 1. Get user private key
    const userPrivateKey = await getDecryptedPrivateKey(
      request.user_wallet,
      process.env.ONCHAIN_API_KEY || ''
    );
    const secretKey = bs58.decode(userPrivateKey);
    const userKeypair = Keypair.fromSecretKey(secretKey);
    
    // 2. Get SAME blockhash for ALL transactions
    // const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    // console.log(`📊 Using blockhash: ${blockhash.slice(0, 16)}...`);
    
    // ============================================
    // STEP 1: CREATE TOKEN ONLY (using working pattern)
    // ============================================
    console.log(`📝 STEP 1: Creating token...`);
    
    // Generate mint keypair ONCE
    const mintKeypair = Keypair.generate();
    const mint = mintKeypair.publicKey;
    console.log(`🔑 Generated mint: ${mint.toBase58()}`);
    
    // Use the EXACT SAME pattern as tokenCreation.ts
    const tokenConfig = {
      name: request.metadata.name,
      symbol: request.metadata.symbol,
      uri: request.metadata.uri || "a",
      creatorOverride: userKeypair.publicKey
    };
    // console.log(`Passing token metadata: ${tokenConfig}`);
    
    // Create token using TokenCreationManager (proven to work) and Pass the mintKeypair
    const { TokenCreationManager } = require('../pumpfun/pumpfun-idl-client');
    const createResult = await TokenCreationManager.createNewToken(
      connection,
      userKeypair,
      mintKeypair,
      tokenConfig
    );
    
    if (!createResult.success || !createResult.mint) {
      throw new Error(`Token creation failed: ${createResult.error}`);
    }
    
    console.log(`✅ Token created: ${createResult.mint.toBase58()}`);
    console.log(`🔍 Created mint equals generated mint? ${createResult.mint.equals(mint) ? 'YES' : 'NO'}`);
    
    // Quick check for confirmation
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // ============================================
    // STEP 2: IMMEDIATE CREATOR BUY (same block)
    // ============================================
    console.log(`💰 STEP 2: Executing creator buy...`);

    // Get FRESH blockhash after token creation
    const { blockhash: freshBlockhash } = await connection.getLatestBlockhash('confirmed');
    console.log(`📊 Using FRESH blockhash for buys: ${freshBlockhash.slice(0, 16)}...`);

    // Use the mint that was actually created
    // const actualMint = createResult.mint.toBase58()
    // console.log(`🔍 Using actual created mint address for ${tokenConfig.symbol}: ${actualMint.toBase58()}`);

    const actualMint = mint;
    
    const { BondingCurveFetcher } = require('../pumpfun/pumpfun-idl-client');
    // const bondingCurve = await BondingCurveFetcher.fetch(connection, mint, true);
    const bondingCurve = await BondingCurveFetcher.fetch(connection, actualMint, true);
    console.log(`Bonding Curve for ${tokenConfig.symbol}: ${bondingCurve}`);
    
    if (!bondingCurve) {
      console.log(`⚠️ Bonding curve not immediately available, retrying...`);
      // Retry a few times with delay
      for (let i = 0; i < 3; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const retryCurve = await BondingCurveFetcher.fetch(connection, mint, false);
        if (retryCurve) {
          console.log(`✅ Bonding curve found on attempt ${i + 1}`);
          break;
        }
      }
      throw new Error('Bonding curve not found for newly created token');
    }
    
    const creator = BondingCurveFetcher.getCreator(bondingCurve);
    console.log(`Creator for ${tokenConfig.symbol}: ${creator}`);
    
    // Calculate creator buy
    const creatorBuyAmountLamports = BigInt(Math.floor(request.creator_buy_amount * LAMPORTS_PER_SOL));
    console.log(`Calculated creator buy amount: ${creatorBuyAmountLamports}`);

    const expectedTokens = BondingCurveMath.calculateTokensForSol(
      bondingCurve.virtual_sol_reserves,
      bondingCurve.virtual_token_reserves,
      creatorBuyAmountLamports
    );
    console.log(`Expected token for creator: ${expectedTokens}`);
    
    const minTokensOut = BondingCurveMath.applySlippage(expectedTokens, request.slippage_bps || 500);
    console.log(`Minimum tokens out: ${minTokensOut}`);
    
    // Get creator ATA
    const { getAssociatedTokenAddressSync } = require('@solana/spl-token');

    const creatorAta = getAssociatedTokenAddressSync(
      mint,
      userKeypair.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID // Pump.fun creates Token-2022 tokens
    );

    // DEBUG: Show what we're creating
    console.log(`🔍 Creating ATA for creator:`);
    console.log(`   Owner: ${userKeypair.publicKey.toBase58().slice(0, 8)}...`);
    console.log(`   Mint: ${mint.toBase58().slice(0, 8)}...`);
    console.log(`   ATA Address: ${creatorAta.toBase58().slice(0, 8)}...`);
    console.log(`   Using Token Program: ${TOKEN_2022_PROGRAM_ID.toBase58().slice(0, 8)}...`);


    // Add ATA creation if it doesn't exist
  //   const createCreatorAtaInstruction = createAssociatedTokenAccountInstruction2022(
  //     userKeypair.publicKey,  // payer
  //     creatorAta,             // ata address
  //     userKeypair.publicKey,  // owner
  //     mint,                   // mint
  //     TOKEN_2022_PROGRAM_ID   // token program
  // );

    // const createCreatorAtaInstruction = createAssociatedTokenAccountIdempotentInstruction(
    //   userKeypair.publicKey,  // payer
    //   creatorAta,                // ata address  
    //   userKeypair.publicKey,  // owner
    //   mint,                  // mint
    //   TOKEN_2022_PROGRAM_ID  // Use regular Token Program for ATA creation
    // );
    
    // Build creator buy transaction
    const creatorBuyInstruction = PumpFunInstructionBuilder.buildBuyExactSolIn(
      userKeypair.publicKey,
      actualMint,
      creatorAta,
      creator,
      creatorBuyAmountLamports,
      minTokensOut
    );
    
    // const { blockhash: freshBlockhash } = await connection.getLatestBlockhash('confirmed');

    const creatorBuyMessage = new TransactionMessage({
      payerKey: userKeypair.publicKey,
      recentBlockhash: freshBlockhash, // Use FRESH blockhash!
      instructions: [creatorBuyInstruction] // Create ATA, then buy
    }).compileToV0Message();
    
    const creatorBuyTx = new VersionedTransaction(creatorBuyMessage);
    creatorBuyTx.sign([userKeypair]);
    
    // ============================================
    // STEP 3: BOT BUYS (same block)
    // ============================================
    const allTransactions: VersionedTransaction[] = [];
    allTransactions.push(creatorBuyTx); // Add creator buy
    
    if (request.bot_buys && request.bot_buys.length > 0) {
      console.log(`🤖 STEP 3: Preparing ${request.bot_buys.length} bot buys...`);
      
      for (const bot of request.bot_buys) {
        try {
          const botTx = await buildBotBuyTransaction(
            connection,
            request.user_wallet,
            bot.public_key,
            mint,
            bot.amount_sol,
            request.slippage_bps || 500,
            freshBlockhash // Use SAME FRESH blockhash!
          );
          
          if (botTx) {
            allTransactions.push(botTx);
          }
        } catch (error) {
          console.error(`Failed to prepare bot ${bot.public_key.slice(0, 8)}...:`, error);
        }
      }
    }
    
    console.log(`✅ Prepared ${allTransactions.length} buy transactions for atomic execution`);
    
    // ============================================
    // EXECUTE ALL BUYS AS ATOMIC BUNDLE
    // ============================================
    
    // Option 1: Jito Bundle (Fastest)
    if (request.use_jito !== false && allTransactions.length > 0) {
      try {
        console.log(`🚀 Sending buy bundle via Jito...`);
        const result = await jitoBundleSender.sendBundle(allTransactions, connection);
        
        if (result.success) {
          const totalCost = request.creator_buy_amount + 
                          request.bot_buys.reduce((sum, bot) => sum + bot.amount_sol, 0);
          
          return {
            success: true,
            bundle_id: result.bundleId,
            mint_address: mint.toBase58(),
            signatures: [createResult.signature],
            estimated_cost: totalCost
          };
        } else {
          console.log('🔄 Jito failed, falling back to RPC...');
        }
      } catch (jitoError) {
        console.error('Jito execution failed:', jitoError);
      }
    }
    
    // Option 2: Parallel RPC Sends
    console.log(`📤 Sending ${allTransactions.length} buy transactions via RPC...`);
    const buySignatures: string[] = [];
    
    // Send all buy transactions in parallel
    const sendPromises = allTransactions.map(tx => 
      connection.sendTransaction(tx, {
        skipPreflight: false,
        maxRetries: 3,
        preflightCommitment: 'confirmed'
      }).catch(e => {
        console.error(`Failed to send transaction:`, e.message);
        return null;
      })
    );
    
    const buyResults = await Promise.all(sendPromises);
    buyResults.forEach(sig => {
      if (sig) buySignatures.push(sig);
    });
    
    const totalCost = request.creator_buy_amount + 
                    request.bot_buys.reduce((sum, bot) => sum + bot.amount_sol, 0);
    
    return {
      success: buySignatures.length > 0,
      signatures: [createResult.signature, ...buySignatures],
      mint_address: mint.toBase58(),
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


async function buildTokenCreationWithBuyTx(
  connection: Connection,
  userKeypair: Keypair,
  mintKeypair: Keypair,
  metadata: any,
  creatorBuyAmount: number,
  blockhash: string
): Promise<VersionedTransaction> {
  const mint = mintKeypair.publicKey;

  // PDAs
  const bondingCurve = PumpFunPda.getBondingCurve(mint);

  // USE STANDARD ATA – this matches what legacy create actually creates now
  const associatedBondingCurve = getAssociatedTokenAddressSync(
    mint,
    bondingCurve,
    true,
    TOKEN_2022_PROGRAM_ID
  );

  // Creator ATA
  const creatorAta = getAssociatedTokenAddressSync(
    mint,
    userKeypair.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  // Buy math (initial reserves)
  const creatorBuyLamports = BigInt(Math.floor(creatorBuyAmount * LAMPORTS_PER_SOL));
  const initialSol = BigInt(Math.floor(0.01 * LAMPORTS_PER_SOL));
  const initialTokens = BigInt(1_000_000_000_000);

  const expected = BondingCurveMath.calculateTokensForSol(initialSol, initialTokens, creatorBuyLamports);
  const minTokensOut = BondingCurveMath.applySlippage(expected, 100); // 1%

  console.log(`Creator buy: ${creatorBuyAmount} SOL → min ${minTokensOut} tokens`);

  // Instructions
  const createIx = PumpFunInstructionBuilder.buildCreate(
    userKeypair,
    mintKeypair,
    metadata.name ?? 'Token',
    metadata.symbol ?? 'TOK',
    "a",
    userKeypair.publicKey
  );

  const buyIx = PumpFunInstructionBuilder.buildBuyExactSolIn(
    userKeypair.publicKey,
    mint,
    creatorAta,
    userKeypair.publicKey,
    creatorBuyLamports,
    minTokensOut
  );

  // Debug check
  const abcInCreate = createIx.keys.find(k => k.pubkey.equals(associatedBondingCurve));
  const abcInBuy = buyIx.keys.find(k => k.pubkey.equals(associatedBondingCurve));
  console.log(`ABC in CREATE: ${abcInCreate ? 'YES' : 'NO'}`);
  console.log(`ABC in BUY: ${abcInBuy ? 'YES' : 'NO'}`);

  const messageV0 = new TransactionMessage({
    payerKey: userKeypair.publicKey,
    recentBlockhash: blockhash,
    instructions: [createIx, buyIx]
  }).compileToV0Message();

  const tx = new VersionedTransaction(messageV0);
  tx.sign([userKeypair, mintKeypair]);

  console.log(`Combined tx size: ${tx.serialize().length} bytes`);
  return tx;
}

// Helper function to build bot buy transaction
async function buildBotBuyTransaction(
  connection: Connection,
  userWallet: string,
  botPublicKey: string,
  mint: PublicKey,
  buyAmount: number,
  slippageBps: number,
  blockhash: string
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
    
    // Get bot ATA
    const { getAssociatedTokenAddressSync } = require('@solana/spl-token');
    const botAta = getAssociatedTokenAddressSync(
      mint,
      botKeypair.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID // Token-2022 for the mint
    );

    // DEBUG: Show what we're creating
    console.log(`🔍 Creating ATA for bot ${botPublicKey.slice(0, 8)}...:`);
    console.log(`   Owner: ${botKeypair.publicKey.toBase58().slice(0, 8)}...`);
    console.log(`   Mint: ${mint.toBase58().slice(0, 8)}...`);
    console.log(`   ATA Address: ${botAta.toBase58().slice(0, 8)}...`);
    console.log(`   Using Token Program: ${TOKEN_2022_PROGRAM_ID.toBase58().slice(0, 8)}...`);

    // Create ATA instruction
    // const createAtaInstruction = createAssociatedTokenAccountInstruction2022(
    //   botKeypair.publicKey,  // payer
    //   botAta,                // ata address
    //   botKeypair.publicKey,  // owner
    //   mint,                  // mint
    //   TOKEN_2022_PROGRAM_ID  // token program
    // );

    const createAtaInstruction = createAssociatedTokenAccountIdempotentInstruction(
      botKeypair.publicKey,  // payer
      botAta,                // ata address  
      botKeypair.publicKey,  // owner
      mint,                  // mint
      TOKEN_2022_PROGRAM_ID  // Use regular Token Program for ATA creation
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
    
    // Build transaction
    const messageV0 = new TransactionMessage({
      payerKey: botKeypair.publicKey,
      recentBlockhash: blockhash,
      instructions: [createAtaInstruction, buyInstruction] // Create first, then buy
    }).compileToV0Message();
    
    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([botKeypair]);

    console.log(`✅ Built buy transaction for bot ${botPublicKey.slice(0, 8)}...`);
    
    return transaction;
    
  } catch (error: any) {
    console.error(`❌ Failed to build bot transaction:`, error.message);
    return null;
  }
}



































