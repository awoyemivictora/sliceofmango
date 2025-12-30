import { 
  Connection, 
  Keypair, 
  PublicKey, 
  TransactionMessage, 
  VersionedTransaction 
} from '@solana/web3.js';
import { getAssociatedTokenAddressSync, getAccount } from '@solana/spl-token';
import { 
  PumpFunInstructionBuilder, 
  BondingCurveMath, 
  BondingCurveFetcher,
  TOKEN_2022_PROGRAM_ID
} from '../pumpfun/pumpfun-idl-client';
import { jitoBundleSender } from '../jito_bundles/jito-integration';
import { SellRequest } from '../types/api';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { KeyService } from './keyService';

interface SellExecutionResponse {
  success: boolean;
  bundle_id?: string;
  signatures?: string[];
  error?: string;
  estimated_cost?: number;
  transaction?: VersionedTransaction; // For atomic bundling
}

export async function executeSell(
  connection: Connection,
  request: SellRequest
): Promise<SellExecutionResponse> {
  try {
    console.log(`🎯 Executing sell for token: ${request.mint_address}`);
    console.log(`   User: ${request.user_wallet}`);
    
    // Validate request
    if (!request.mint_address || !request.user_wallet) {
      throw new Error('Missing required parameters');
    }
    
    const mint = new PublicKey(request.mint_address);
    const userWallet = new PublicKey(request.user_wallet);
    
    // Fetch bonding curve
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
    
    // Get user token balance
    console.log(`🔍 Getting user ATA...`);
    const userAta = getAssociatedTokenAddressSync(
      mint,
      userWallet,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    
    console.log(`✅ User ATA: ${userAta.toBase58().slice(0, 8)}...`);
    
    let tokenAccount;
    try {
      tokenAccount = await getAccount(connection, userAta);
      console.log(`💰 Token balance: ${tokenAccount.amount} tokens`);
    } catch {
      throw new Error('User token account not found');
    }
    
    const tokenBalance = tokenAccount.amount;
    if (tokenBalance === 0n) {
      throw new Error('No tokens to sell');
    }
    
    // Calculate expected SOL output
    console.log(`🧮 Calculating expected SOL output...`);
    const expectedSol = BondingCurveMath.calculateSolForTokens(
      bondingCurve.virtual_sol_reserves,
      bondingCurve.virtual_token_reserves,
      tokenBalance
    );
    
    const slippageBps = request.slippage_bps || 500;
    const minSolOut = BondingCurveMath.applySlippage(expectedSol, slippageBps);
    
    console.log(`   Tokens to sell: ${tokenBalance}`);
    console.log(`   Expected SOL: ${Number(expectedSol) / LAMPORTS_PER_SOL}`);
    console.log(`   Min SOL (with ${slippageBps/100}% slippage): ${Number(minSolOut) / LAMPORTS_PER_SOL}`);
    
    // Create sell instruction
    console.log(`🔧 Building sell instruction...`);
    const sellInstruction = PumpFunInstructionBuilder.buildSell(
      userWallet,
      mint,
      userAta,
      creator,
      tokenBalance,
      minSolOut
    );
    
    // Get blockhash and build transaction
    console.log(`📊 Getting blockhash...`);
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    
    const messageV0 = new TransactionMessage({
      payerKey: userWallet,
      recentBlockhash: blockhash,
      instructions: [sellInstruction]
    }).compileToV0Message();
    
    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([userKeypair]);
    
    console.log(`✅ Transaction built (size: ${transaction.serialize().length} bytes)`);
    
    // Execute transaction
    if (request.use_jito) {
      try {
        console.log('🚀 Sending via Jito bundle...');
        const result = await jitoBundleSender.sendBundle([transaction], connection);
        
        if (result.success) {
          console.log(`✅ Jito bundle sent successfully`);
          return {
            success: true,
            bundle_id: result.bundleId,
            estimated_cost: 0 // Selling costs minimal fees
          };
        } else {
          console.log('🔄 Jito failed, falling back to RPC...');
        }
      } catch (jitoError: any) {
        console.error('Jito execution failed:', jitoError.message);
      }
    }
    
    // RPC fallback
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
      estimated_cost: 0
    };
    
  } catch (error: any) {
    console.error(`❌ Sell execution failed:`, error.message);
    
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
 * Execute sell for a bot wallet
 */
export async function executeBotSell(
  connection: Connection,
  userWallet: string, // Owner of the bot
  botWallet: string,  // Bot's wallet address
  mintAddress: string,
  useJito: boolean = true,
  slippageBps: number = 500,
  sellPercentage: number = 100 // Percentage of tokens to sell
): Promise<SellExecutionResponse> {
  try {
    console.log(`🤖 Executing bot sell:`);
    console.log(`   Bot: ${botWallet}`);
    console.log(`   Token: ${mintAddress}`);
    console.log(`   Sell percentage: ${sellPercentage}%`);
    
    // Get bot private key from backend
    console.log(`🔐 Retrieving bot private key...`);
    const botKeypair = await KeyService.getBotPrivateKey(userWallet, botWallet);
    
    // Verify bot wallet matches
    if (botKeypair.publicKey.toBase58() !== botWallet) {
      throw new Error('Bot wallet does not match provided private key');
    }
    
    const mint = new PublicKey(mintAddress);
    const botPublicKey = botKeypair.publicKey;
    
    // Get bot token balance
    const botAta = getAssociatedTokenAddressSync(
      mint,
      botPublicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    
    let tokenAccount;
    try {
      tokenAccount = await getAccount(connection, botAta);
      console.log(`💰 Bot token balance: ${tokenAccount.amount} tokens`);
    } catch {
      throw new Error('Bot token account not found');
    }
    
    const tokenBalance = tokenAccount.amount;
    if (tokenBalance === 0n) {
      throw new Error('Bot has no tokens to sell');
    }
    
    // Calculate amount to sell based on percentage
    const tokensToSell = sellPercentage === 100 ? 
      tokenBalance : 
      (tokenBalance * BigInt(sellPercentage)) / 100n;
    
    console.log(`   Tokens to sell: ${tokensToSell} (${sellPercentage}% of ${tokenBalance})`);
    
    // Fetch bonding curve
    const bondingCurve = await BondingCurveFetcher.fetch(connection, mint, true);
    if (!bondingCurve) {
      throw new Error('Bonding curve not found for token');
    }
    
    const creator = BondingCurveFetcher.getCreator(bondingCurve);
    
    // Calculate expected SOL output
    const expectedSol = BondingCurveMath.calculateSolForTokens(
      bondingCurve.virtual_sol_reserves,
      bondingCurve.virtual_token_reserves,
      tokensToSell
    );
    
    const minSolOut = BondingCurveMath.applySlippage(expectedSol, slippageBps);
    
    console.log(`   Expected SOL: ${Number(expectedSol) / LAMPORTS_PER_SOL}`);
    console.log(`   Min SOL: ${Number(minSolOut) / LAMPORTS_PER_SOL}`);
    
    // Create sell instruction
    const sellInstruction = PumpFunInstructionBuilder.buildSell(
      botPublicKey,
      mint,
      botAta,
      creator,
      tokensToSell,
      minSolOut
    );
    
    // Get blockhash and build transaction
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    
    const messageV0 = new TransactionMessage({
      payerKey: botPublicKey,
      recentBlockhash: blockhash,
      instructions: [sellInstruction]
    }).compileToV0Message();
    
    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([botKeypair]);
    
    // Execute transaction
    if (useJito) {
      try {
        const result = await jitoBundleSender.sendBundle([transaction], connection);
        
        if (result.success) {
          return {
            success: true,
            bundle_id: result.bundleId,
            estimated_cost: 0
          };
        }
      } catch (jitoError) {
        console.error('Bot Jito execution failed:', jitoError);
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
      throw new Error(`Bot transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }
    
    return {
      success: true,
      signatures: [signature],
      estimated_cost: 0
    };
    
  } catch (error: any) {
    console.error(`❌ Bot sell execution failed:`, error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

