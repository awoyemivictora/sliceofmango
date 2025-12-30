
// ============== TO CREATE THE TOKEN + CREATOR BUY + BOT'S BUY (ALL IN ONE TRANSACTION) ========
// // NEW: True atomic bundle creator
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
    
//     // 1. Get user private key
//     const userPrivateKey = await getDecryptedPrivateKey(
//       request.user_wallet,
//       process.env.ONCHAIN_API_KEY || ''
//     );
//     const secretKey = bs58.decode(userPrivateKey);
//     const userKeypair = Keypair.fromSecretKey(secretKey);
    
//     // 2. Generate mint keypair
//     const mintKeypair = Keypair.generate();
//     const mint = mintKeypair.publicKey;
    
//     // 3. Get SAME blockhash for ALL transactions
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

// // Helper function to build token creation + buy transaction
// async function buildTokenCreationWithBuyTx(
//   connection: Connection,
//   userKeypair: Keypair,
//   mintKeypair: Keypair,
//   metadata: any,
//   creatorBuyAmount: number,
//   blockhash: string
// ): Promise<VersionedTransaction> {
//   const mint = mintKeypair.publicKey;
  
//   // Get all PDAs
//   const mintAuthority = PumpFunPda.getMintAuthority();
//   const bondingCurve = PumpFunPda.getBondingCurve(mint);
//   const associatedBondingCurve = PumpFunPda.getAssociatedBondingCurveForCreate(bondingCurve, mint);
//   const global = PumpFunPda.getGlobal();
//   const metadataAccount = PumpFunPda.getMetadata(mint);
//   const eventAuthority = PumpFunPda.getEventAuthority();
  
//   // Get creator ATA
//   const { getAssociatedTokenAddressSync } = require('@solana/spl-token');
//   const creatorAta = getAssociatedTokenAddressSync(
//     mint,
//     userKeypair.publicKey,
//     false,
//     TOKEN_2022_PROGRAM_ID
//   );
  
//   // Calculate buy parameters
//   const creatorBuyAmountLamports = BigInt(Math.floor(creatorBuyAmount * LAMPORTS_PER_SOL));
  
//   // For a new token, bonding curve starts with:
//   const initialSolReserves = BigInt(Math.floor(0.01 * LAMPORTS_PER_SOL)); // 0.01 SOL
//   const initialTokenSupply = BigInt(1_000_000_000_000); // 1M tokens
  
//   // Calculate expected tokens for creator buy
//   const expectedTokens = BondingCurveMath.calculateTokensForSol(
//     initialSolReserves,
//     initialTokenSupply,
//     creatorBuyAmountLamports
//   );
  
//   const minTokensOut = BondingCurveMath.applySlippage(expectedTokens, 100); // 1% slippage
  
//   console.log(`   Creator buy: ${creatorBuyAmount} SOL for ~${expectedTokens} tokens`);
  
//   // Create instructions array
//   const instructions: TransactionInstruction[] = [];
  
//   // 1. Create token instruction
//   const createInstruction = PumpFunInstructionBuilder.buildCreate(
//     userKeypair,
//     mintKeypair,
//     metadata.name,
//     metadata.symbol,
//     metadata.uri || metadata.image,
//     userKeypair.publicKey
//   );
  
//   // 2. Creator buy instruction
//   const buyInstruction = PumpFunInstructionBuilder.buildBuyExactSolIn(
//     userKeypair.publicKey,
//     mint,
//     creatorAta,
//     userKeypair.publicKey, // Creator
//     creatorBuyAmountLamports,
//     minTokensOut
//   );
  
//   instructions.push(createInstruction, buyInstruction);
  
//   // Build transaction
//   const messageV0 = new TransactionMessage({
//     payerKey: userKeypair.publicKey,
//     recentBlockhash: blockhash,
//     instructions
//   }).compileToV0Message();
  
//   const transaction = new VersionedTransaction(messageV0);
//   transaction.sign([userKeypair, mintKeypair]);
  
//   return transaction;
// }

// // Helper function to build bot buy transaction
// async function buildBotBuyTransaction(
//   connection: Connection,
//   userWallet: string,
//   botPublicKey: string,
//   mint: PublicKey,
//   buyAmount: number,
//   slippageBps: number,
//   blockhash: string
// ): Promise<VersionedTransaction | null> {
//   try {
//     // Get bot private key from backend
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
    
//     // Get bonding curve data
//     const { BondingCurveFetcher } = require('../pumpfun/pumpfun-idl-client');
//     const bondingCurve = await BondingCurveFetcher.fetch(connection, mint, true);
//     if (!bondingCurve) {
//       console.error(`❌ Bonding curve not found for ${mint.toBase58()}`);
//       return null;
//     }
    
//     const creator = BondingCurveFetcher.getCreator(bondingCurve);
    
//     // Calculate buy parameters
//     const solIn = BigInt(Math.floor(buyAmount * LAMPORTS_PER_SOL));
//     const expectedTokens = BondingCurveMath.calculateTokensForSol(
//       bondingCurve.virtual_sol_reserves,
//       bondingCurve.virtual_token_reserves,
//       solIn
//     );
    
//     const minTokenOut = BondingCurveMath.applySlippage(expectedTokens, slippageBps);
    
//     // Get bot ATA
//     const { getAssociatedTokenAddressSync } = require('@solana/spl-token');
//     const botAta = getAssociatedTokenAddressSync(
//       mint,
//       botKeypair.publicKey,
//       false,
//       TOKEN_2022_PROGRAM_ID
//     );
    
//     // Create buy instruction
//     const buyInstruction = PumpFunInstructionBuilder.buildBuyExactSolIn(
//       botKeypair.publicKey,
//       mint,
//       botAta,
//       creator,
//       solIn,
//       minTokenOut
//     );
    
//     // Build transaction
//     const messageV0 = new TransactionMessage({
//       payerKey: botKeypair.publicKey,
//       recentBlockhash: blockhash,
//       instructions: [buyInstruction]
//     }).compileToV0Message();
    
//     const transaction = new VersionedTransaction(messageV0);
//     transaction.sign([botKeypair]);
    
//     return transaction;
    
//   } catch (error: any) {
//     console.error(`❌ Failed to build bot transaction:`, error.message);
//     return null;
//   }
// }


// ================ TO CREATE THE TOKEN + CREATOR BUY (IN TRANSACTION 1) & BOT'S BUYS (IN TRANSACTION 2)===
// In botManager.ts - Replace the existing createCompleteLaunchBundle function

/**
 * 🚀 TOP 1% PERFORMANCE: 2-Step Atomic Launch
 * 
 * Step 1: Create token + creator buy (single transaction)
 * Step 2: Immediately execute bot buys (Jito bundle)
 * 
 * This mimics professional sniper bot behavior:
 * 1. Fast token creation
 * 2. Immediate bot army deployment
 */
export async function createTwoStepLaunch(
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
    console.log(`🚀 TOP 1% LAUNCH: Starting 2-step process for ${request.user_wallet}`);
    
    // ========================
    // STEP 1: TOKEN CREATION + CREATOR BUY
    // ========================
    console.log(`📝 STEP 1: Creating token with creator buy...`);
    
    // Get user private key
    const userPrivateKey = await getDecryptedPrivateKey(
      request.user_wallet,
      process.env.ONCHAIN_API_KEY || ''
    );
    const secretKey = bs58.decode(userPrivateKey);
    const userKeypair = Keypair.fromSecretKey(secretKey);
    
    // Generate mint
    const mintKeypair = Keypair.generate();
    const mint = mintKeypair.publicKey;
    
    // Get blockhash for STEP 1
    const { blockhash: step1Blockhash } = await connection.getLatestBlockhash('confirmed');
    
    // Build minimal token creation + creator buy transaction
    const step1Tx = await buildMinimalTokenCreationWithBuy(
      connection,
      userKeypair,
      mintKeypair,
      request.metadata,
      request.creator_buy_amount,
      step1Blockhash
    );
    
    // Send STEP 1 immediately
    console.log(`📤 Sending token creation transaction...`);
    const step1Signature = await connection.sendTransaction(step1Tx, {
      skipPreflight: false,
      maxRetries: 3,
      preflightCommitment: 'confirmed'
    });
    
    console.log(`✅ Token creation sent: ${step1Signature.slice(0, 16)}...`);
    
    // Quick confirmation check
    const confirmStart = Date.now();
    let step1Confirmed = false;
    
    while (Date.now() - confirmStart < 5000) { // 5 second timeout
      try {
        const status = await connection.getSignatureStatus(step1Signature);
        if (status.value?.confirmationStatus === 'confirmed') {
          step1Confirmed = true;
          console.log(`✅ Token created successfully!`);
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch {
        // Continue checking
      }
    }
    
    if (!step1Confirmed) {
      console.log(`⚠️ Token creation still confirming, proceeding anyway...`);
    }
    
    // ========================
    // STEP 2: BOT ARMY DEPLOYMENT
    // ========================
    console.log(`🤖 STEP 2: Deploying ${request.bot_buys.length} bot buys...`);
    
    // Use same blockhash for all bot transactions
    const { blockhash: step2Blockhash } = await connection.getLatestBlockhash('confirmed');
    
    // Prepare all bot buy transactions
    const botTransactions: VersionedTransaction[] = [];
    
    // Get bonding curve info ONCE (more efficient)
    const { BondingCurveFetcher } = require('../pumpfun/pumpfun-idl-client');
    const bondingCurve = await BondingCurveFetcher.fetch(connection, mint, true);
    
    if (!bondingCurve) {
      throw new Error('Bonding curve not found for token');
    }
    
    const creator = BondingCurveFetcher.getCreator(bondingCurve);
    
    // Prepare ALL bot transactions in parallel
    const botPromises = request.bot_buys.map(async (bot) => {
      try {
        return await buildFastBotBuyTransaction(
          connection,
          request.user_wallet,
          bot.public_key,
          mint,
          bot.amount_sol,
          request.slippage_bps || 500,
          step2Blockhash,
          bondingCurve,
          creator
        );
      } catch (error) {
        console.error(`Failed to prepare bot ${bot.public_key.slice(0, 8)}...:`, error.message);
        return null;
      }
    });
    
    const botResults = await Promise.all(botPromises);
    botResults.forEach((tx) => {
      if (tx) botTransactions.push(tx);
    });
    
    console.log(`✅ Prepared ${botTransactions.length} bot transactions`);
    
    // ========================
    // EXECUTE BOT BUNDLE
    // ========================
    if (botTransactions.length > 0) {
      // OPTION 1: Jito Bundle (Fastest)
      if (request.use_jito !== false) {
        try {
          console.log(`🚀 Sending bot bundle via Jito (${botTransactions.length} txs)...`);
          const jitoResult = await jitoBundleSender.sendBundle(botTransactions, connection);
          
          if (jitoResult.success) {
            console.log(`✅ Bot bundle sent via Jito!`);
            return {
              success: true,
              bundle_id: jitoResult.bundleId,
              signatures: [step1Signature],
              mint_address: mint.toBase58(),
              estimated_cost: request.creator_buy_amount + 
                            request.bot_buys.reduce((sum, bot) => sum + bot.amount_sol, 0)
            };
          }
        } catch (jitoError) {
          console.error('Jito failed:', jitoError);
        }
      }
      
      // OPTION 2: Parallel RPC Sends (Backup)
      console.log(`📤 Sending bot buys via parallel RPC...`);
      const botSignatures: string[] = [];
      
      // Send transactions in parallel batches
      const batchSize = 5;
      for (let i = 0; i < botTransactions.length; i += batchSize) {
        const batch = botTransactions.slice(i, i + batchSize);
        const batchPromises = batch.map(tx => 
          connection.sendTransaction(tx, {
            skipPreflight: false,
            maxRetries: 2,
            preflightCommitment: 'confirmed'
          }).catch(e => null)
        );
        
        const batchResults = await Promise.all(batchPromises);
        batchResults.forEach(sig => {
          if (sig) {
            botSignatures.push(sig);
            console.log(`   Bot buy sent: ${sig.slice(0, 16)}...`);
          }
        });
        
        // Small delay between batches
        if (i + batchSize < botTransactions.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      console.log(`✅ Sent ${botSignatures.length} bot buys`);
      
      return {
        success: true,
        signatures: [step1Signature, ...botSignatures],
        mint_address: mint.toBase58(),
        estimated_cost: request.creator_buy_amount + 
                      request.bot_buys.reduce((sum, bot) => sum + bot.amount_sol, 0)
      };
    }
    
    // No bots case
    return {
      success: true,
      signatures: [step1Signature],
      mint_address: mint.toBase58(),
      estimated_cost: request.creator_buy_amount
    };
    
  } catch (error: any) {
    console.error(`❌ 2-Step launch failed:`, error.message);
    return {
      success: false,
      error: error.message
    };
  }
}


// ──────────────────────────────────────────────────────────────────────────────
//  NEW HELPER – buildCreateV2
// ──────────────────────────────────────────────────────────────────────────────
function buildCreateV2(
  user: Keypair,
  mint: Keypair,
  name: string,
  symbol: string,
  uri: string
): TransactionInstruction {
  const mintPub = mint.publicKey;

  const mintAuthority = PumpFunPda.getMintAuthority();
  const bondingCurve = PumpFunPda.getBondingCurve(mintPub);
  const associatedBondingCurve = getAssociatedTokenAddressSync(
    mintPub,
    bondingCurve,
    true,
    TOKEN_2022_PROGRAM_ID
  );
  const global = PumpFunPda.getGlobal();
  const metadata = PumpFunPda.getMetadata(mintPub);
  const eventAuthority = PumpFunPda.getEventAuthority();

  name = name.slice(0, 32);
  symbol = symbol.slice(0, 10);
  uri = uri.slice(0, 200);

  const nameBuf = Buffer.from(name, 'utf8');
  const symBuf = Buffer.from(symbol, 'utf8');
  const uriBuf = Buffer.from(uri, 'utf8');

  const args = Buffer.alloc(4 + nameBuf.length + 4 + symBuf.length + 4 + uriBuf.length + 32);
  let offset = 0;
  args.writeUInt32LE(nameBuf.length, offset); offset += 4;
  nameBuf.copy(args, offset); offset += nameBuf.length;
  args.writeUInt32LE(symBuf.length, offset); offset += 4;
  symBuf.copy(args, offset); offset += symBuf.length;
  args.writeUInt32LE(uriBuf.length, offset); offset += 4;
  uriBuf.copy(args, offset); offset += uriBuf.length;
  user.publicKey.toBuffer().copy(args, offset);

  const data = Buffer.concat([PumpFunInstructionBuilder.CREATE_V2_DISCRIMINATOR, args]);

  return new TransactionInstruction({
    programId: PUMP_FUN_PROGRAM_ID,
    keys: [
      { pubkey: mintPub,               isSigner: true,  isWritable: true },
      { pubkey: mintAuthority,         isSigner: false, isWritable: false },
      { pubkey: bondingCurve,          isSigner: false, isWritable: true },
      { pubkey: associatedBondingCurve,isSigner: false, isWritable: true },
      { pubkey: global,                isSigner: false, isWritable: true },
      { pubkey: MPL_TOKEN_METADATA_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: metadata,              isSigner: false, isWritable: true },
      { pubkey: user.publicKey,        isSigner: true,  isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: eventAuthority,        isSigner: false, isWritable: false },
      { pubkey: PUMP_FUN_PROGRAM_ID,   isSigner: false, isWritable: false },
    ],
    data,
  });
}


/**
 * 🏗️ Build CORRECT token creation + buy transaction
 * This ensures all accounts are properly initialized
 */
async function buildMinimalTokenCreationWithBuy(
  connection: Connection,
  userKeypair: Keypair,
  mintKeypair: Keypair,
  metadata: any,
  creatorBuyAmount: number,
  blockhash: string
): Promise<VersionedTransaction> {
  const mint = mintKeypair.publicKey;

  const bondingCurve = PumpFunPda.getBondingCurve(mint);
  const associatedBondingCurve = getAssociatedTokenAddressSync(
    mint,
    bondingCurve,
    true,
    TOKEN_2022_PROGRAM_ID
  );

  const creatorAta = getAssociatedTokenAddressSync(
    mint,
    userKeypair.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  const creatorBuyLamports = BigInt(Math.floor(creatorBuyAmount * LAMPORTS_PER_SOL));
  const initialSol = BigInt(Math.floor(0.01 * LAMPORTS_PER_SOL));
  const initialTokens = BigInt(1_000_000_000_000);

  const expected = BondingCurveMath.calculateTokensForSol(initialSol, initialTokens, creatorBuyLamports);
  const minTokensOut = BondingCurveMath.applySlippage(expected, 100);

  const createIx = buildCreateV2(
    userKeypair,
    mintKeypair,
    metadata.name ?? '',
    metadata.symbol ?? '',
    metadata.uri ?? 'a'
  );

  const buyIx = PumpFunInstructionBuilder.buildBuyExactSolIn(
    userKeypair.publicKey,
    mint,
    creatorAta,
    userKeypair.publicKey,
    creatorBuyLamports,
    minTokensOut
  );

  const messageV0 = new TransactionMessage({
    payerKey: userKeypair.publicKey,
    recentBlockhash: blockhash,
    instructions: [createIx, buyIx],
  }).compileToV0Message();

  const tx = new VersionedTransaction(messageV0);
  tx.sign([userKeypair, mintKeypair]);
  return tx;
}


/**
 * ⚡ Build FAST bot buy transaction (pre-computed bonding curve)
 */
async function buildFastBotBuyTransaction(
  connection: Connection,
  userWallet: string,
  botPublicKey: string,
  mint: PublicKey,
  buyAmount: number,
  slippageBps: number,
  blockhash: string,
  bondingCurve: any,
  creator: PublicKey,
  launchId?: string // Add launchId parameter
): Promise<VersionedTransaction | null> {
  try {
    let botSecretKey: Uint8Array;
    
    // Try cached key first (if launchId provided)
    if (launchId) {
      try {
        const backendurl = process.env.BACKEND_URL || 'http://localhost:8000';
        const cacheResponse = await axios.get(
          `${backendurl}/creators/user/get-cached-bot-key`,
          {
            params: {
              launch_id: launchId,
              bot_public_key: botPublicKey
            },
            headers: {
              'X-API-Key': process.env.ONCHAIN_API_KEY,
            },
            timeout: 2000
          }
        );
        
        if (cacheResponse.data.success && cacheResponse.data.private_key_base58) {
          botSecretKey = bs58.decode(cacheResponse.data.private_key_base58);
        }
      } catch (cacheError) {
        // Fall back to regular method
        console.log(`No cached key for ${botPublicKey.slice(0, 8)}..., using regular method`);
      }
    }
    
    // If no cached key, use regular method
    if (!botSecretKey) {
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
          },
          timeout: 5000
        }
      );
      
      if (!botResponse.data.success || !botResponse.data.private_key_base58) {
        throw new Error('Failed to get bot private key');
      }
      
      botSecretKey = bs58.decode(botResponse.data.private_key_base58);
    }
    
    const botKeypair = Keypair.fromSecretKey(botSecretKey!);
    
    // Verify wallet
    if (botKeypair.publicKey.toBase58() !== botPublicKey) {
      throw new Error('Bot key mismatch');
    }
    
    // Calculate buy using pre-fetched bonding curve
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
    
    // Build minimal transaction
    const messageV0 = new TransactionMessage({
      payerKey: botKeypair.publicKey,
      recentBlockhash: blockhash,
      instructions: [buyInstruction]
    }).compileToV0Message();
    
    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([botKeypair]);
    
    return transaction;
    
  } catch (error: any) {
    console.error(`Bot ${botPublicKey.slice(0, 8)}... failed:`, error.message);
    return null;
  }
}



