import { 
  Connection, 
  Keypair, 
  PublicKey, 
  TransactionMessage, 
  VersionedTransaction 
} from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { 
  PumpFunInstructionBuilder, 
  BondingCurveMath, 
  BondingCurveFetcher,
  TOKEN_2022_PROGRAM_ID
} from '../pumpfun/pumpfun-idl-client';
import { jitoBundleSender } from '../jito_bundles/jito-integration';
import { BuyRequest } from '../types/api';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { KeyService } from './keyService';

interface BuyExecutionResponse {
  success: boolean;
  bundle_id?: string;
  signatures?: string[];
  error?: string;
  estimated_cost?: number;
  transaction?: VersionedTransaction; // For atomic bundling
}

export async function executeBuy(
  connection: Connection,
  request: BuyRequest
): Promise<BuyExecutionResponse> {
  try {
    console.log(`🎯 Executing buy for token: ${request.mint_address}`);
    console.log(`   User: ${request.user_wallet}`);
    console.log(`   Amount: ${request.amount_sol} SOL`);
    
    // Validate request
    if (!request.mint_address || !request.user_wallet) {
      throw new Error('Missing required parameters');
    }
    
    const mint = new PublicKey(request.mint_address);
    const userWallet = new PublicKey(request.user_wallet);
    
    // Fetch bonding curve to get creator
    console.log(`📊 Fetching bonding curve...`);
    const bondingCurve = await BondingCurveFetcher.fetch(connection, mint, true);
    if (!bondingCurve) {
      throw new Error('Bonding curve not found for token');
    }
    
    const creator = BondingCurveFetcher.getCreator(bondingCurve);
    console.log(`✅ Creator: ${creator.toBase58().slice(0, 8)}...`);
    
    // Get user private key from backend service
    console.log(`🔐 Retrieving user private key...`);
    const userKeypair = await KeyService.getUserPrivateKey(request.user_wallet);
    
    // Verify wallet matches
    if (userKeypair.publicKey.toBase58() !== request.user_wallet) {
      throw new Error('User wallet does not match provided private key');
    }
    
    // Calculate amounts
    const solIn = BigInt(Math.floor(request.amount_sol * LAMPORTS_PER_SOL));
    const slippageBps = request.slippage_bps || 500;
    
    console.log(`💰 Calculating expected tokens...`);
    // Calculate expected tokens
    const expectedTokens = BondingCurveMath.calculateTokensForSol(
      bondingCurve.virtual_sol_reserves,
      bondingCurve.virtual_token_reserves,
      solIn
    );
    
    const minTokensOut = BondingCurveMath.applySlippage(expectedTokens, slippageBps);
    
    console.log(`   Input: ${request.amount_sol} SOL`);
    console.log(`   Expected tokens: ${expectedTokens}`);
    console.log(`   Min tokens (with ${slippageBps/100}% slippage): ${minTokensOut}`);
    
    // Get user ATA
    console.log(`🔍 Getting user ATA...`);
    const userAta = getAssociatedTokenAddressSync(
      mint,
      userWallet,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    
    console.log(`✅ User ATA: ${userAta.toBase58().slice(0, 8)}...`);
    
    // Create buy instruction
    console.log(`🔧 Building buy instruction...`);
    const buyInstruction = PumpFunInstructionBuilder.buildBuyExactSolIn(
      userWallet,
      mint,
      userAta,
      creator,
      solIn,
      minTokensOut
    );
    
    // Get blockhash and build transaction
    console.log(`📊 Getting blockhash...`);
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    
    const messageV0 = new TransactionMessage({
      payerKey: userWallet,
      recentBlockhash: blockhash,
      instructions: [buyInstruction]
    }).compileToV0Message();
    
    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([userKeypair]);
    
    console.log(`✅ Transaction built (size: ${transaction.serialize().length} bytes)`);
    
    // If Jito is requested and we're not bundling (for atomic launch)
    if (request.use_jito && (request.action as string) !== 'atomic_buy' && (request.action as string) !== 'execute_bot_buys') {
      try {
        console.log('🚀 Sending via Jito bundle...');
        const result = await jitoBundleSender.sendBundle([transaction], connection);
        
        if (result.success) {
          console.log(`✅ Jito bundle sent successfully`);
          return {
            success: true,
            bundle_id: result.bundleId,
            transaction: (request.action as string) === 'atomic_buy' || (request.action as string) === 'execute_bot_buys' ? transaction : undefined,
            estimated_cost: request.amount_sol
          };
        } else {
          console.log('🔄 Jito failed, falling back to RPC...');
        }
      } catch (jitoError: any) {
        console.error('Jito execution failed:', jitoError.message);
      }
    }
    
    // RPC fallback (or if Jito is not requested)
    console.log('📤 Sending via RPC...');
    
    // First simulate to catch errors
    console.log(`🔍 Simulating transaction...`);
    const simulation = await connection.simulateTransaction(transaction, {
      replaceRecentBlockhash: true,
      commitment: 'processed'
    });
    
    if (simulation.value.err) {
      console.error('❌ Simulation failed:', simulation.value.err);
      throw new Error(`Transaction simulation failed: ${JSON.stringify(simulation.value.err)}`);
    }
    
    console.log(`✅ Simulation successful. Sending transaction...`);
    const signature = await connection.sendTransaction(transaction, {
      skipPreflight: false,
      maxRetries: 3,
      preflightCommitment: 'confirmed'
    });
    
    console.log(`✅ Transaction sent: ${signature.slice(0, 16)}...`);
    
    // Wait for confirmation with timeout
    console.log(`⏳ Waiting for confirmation...`);
    const timeout = 60000; // 60 seconds
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        const status = await connection.getSignatureStatus(signature, {
          searchTransactionHistory: false
        });
        
        if (status.value?.confirmationStatus === 'confirmed' || 
            status.value?.confirmationStatus === 'finalized') {
          console.log(`✅ Transaction confirmed!`);
          break;
        }
        
        if (status.value?.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.error(`Confirmation check failed:`, error);
      }
    }
    
    // Final check
    const finalStatus = await connection.getSignatureStatus(signature);
    if (finalStatus.value?.err) {
      throw new Error(`Transaction failed on-chain: ${JSON.stringify(finalStatus.value.err)}`);
    }
    
    return {
      success: true,
      signatures: [signature],
      transaction: request.action === 'atomic_buy' ? transaction : undefined,
      estimated_cost: request.amount_sol
    };
    
  } catch (error: any) {
    console.error(`❌ Buy execution failed:`, error.message);
    
    // Enhanced error logging
    if (error.logs) {
      console.error(`Transaction logs:`);
      error.logs.forEach((log: string, i: number) => {
        console.error(` ${i}: ${log}`);
      });
    }
    
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Execute buy for a bot wallet (separate function for clarity)
 */
export async function executeBotBuy(
  connection: Connection,
  userWallet: string, // Owner of the bot
  botWallet: string,  // Bot's wallet address
  mintAddress: string,
  amountSol: number,
  useJito: boolean = true,
  slippageBps: number = 500
): Promise<BuyExecutionResponse> {
  try {
    console.log(`🤖 Executing bot buy:`);
    console.log(`   Bot: ${botWallet}`);
    console.log(`   Token: ${mintAddress}`);
    console.log(`   Amount: ${amountSol} SOL`);
    
    // Get bot private key from backend
    console.log(`🔐 Retrieving bot private key...`);
    const botKeypair = await KeyService.getBotPrivateKey(userWallet, botWallet);
    
    // Verify bot wallet matches
    if (botKeypair.publicKey.toBase58() !== botWallet) {
      throw new Error('Bot wallet does not match provided private key');
    }
    
    // Reuse the main executeBuy function but with bot's key
    // We'll need to adjust the request for the bot
    const botRequest: BuyRequest = {
      action: 'buy',
      mint_address: mintAddress,
      user_wallet: botWallet,
      amount_sol: amountSol,
      use_jito: useJito,
      slippage_bps: slippageBps
    };
    
    // For bot buys, we need to override the key retrieval
    // We'll create a modified version that uses the provided keypair
    return await executeBuyWithKeypair(
      connection,
      botRequest,
      botKeypair
    );
    
  } catch (error: any) {
    console.error(`❌ Bot buy execution failed:`, error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Internal function to execute buy with a specific keypair
 */
async function executeBuyWithKeypair(
  connection: Connection,
  request: BuyRequest,
  keypair: Keypair
): Promise<BuyExecutionResponse> {
  try {
    const mint = new PublicKey(request.mint_address);
    const userWallet = keypair.publicKey;
    
    // Fetch bonding curve
    const bondingCurve = await BondingCurveFetcher.fetch(connection, mint, true);
    if (!bondingCurve) {
      throw new Error('Bonding curve not found for token');
    }
    
    const creator = BondingCurveFetcher.getCreator(bondingCurve);
    
    // Calculate amounts
    const solIn = BigInt(Math.floor(request.amount_sol * LAMPORTS_PER_SOL));
    const slippageBps = request.slippage_bps || 500;
    
    const expectedTokens = BondingCurveMath.calculateTokensForSol(
      bondingCurve.virtual_sol_reserves,
      bondingCurve.virtual_token_reserves,
      solIn
    );
    
    const minTokensOut = BondingCurveMath.applySlippage(expectedTokens, slippageBps);
    
    // Get user ATA
    const userAta = getAssociatedTokenAddressSync(
      mint,
      userWallet,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    
    // Create buy instruction
    const buyInstruction = PumpFunInstructionBuilder.buildBuyExactSolIn(
      userWallet,
      mint,
      userAta,
      creator,
      solIn,
      minTokensOut
    );
    
    // Get blockhash and build transaction
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    
    const messageV0 = new TransactionMessage({
      payerKey: userWallet,
      recentBlockhash: blockhash,
      instructions: [buyInstruction]
    }).compileToV0Message();
    
    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([keypair]);
    
    // Execute transaction
    if (request.use_jito) {
      try {
        const result = await jitoBundleSender.sendBundle([transaction], connection);
        
        if (result.success) {
          return {
            success: true,
            bundle_id: result.bundleId,
            transaction: request.action === 'atomic_buy' ? transaction : undefined,
            estimated_cost: request.amount_sol
          };
        }
      } catch (jitoError) {
        console.error('Jito execution failed:', jitoError);
      }
    }
    
    // RPC fallback
    const signature = await connection.sendTransaction(transaction, {
      skipPreflight: false,
      maxRetries: 3,
      preflightCommitment: 'confirmed'
    });
    
    // Wait for confirmation
    const confirmation = await connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight: (await connection.getLatestBlockhash('confirmed')).lastValidBlockHeight
    }, 'confirmed');
    
    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }
    
    return {
      success: true,
      signatures: [signature],
      transaction: request.action === 'atomic_buy' ? transaction : undefined,
      estimated_cost: request.amount_sol
    };
    
  } catch (error: any) {
    console.error(`❌ Buy execution failed:`, error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

