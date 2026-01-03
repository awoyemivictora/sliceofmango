// import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
// import bs58 from 'bs58';
// import { BondingCurveMath, PumpFunInstructionBuilder, PumpFunPda, TOKEN_2022_PROGRAM_ID, TokenCreationManager } from '../pumpfun/pumpfun-idl-client';
// import { BuyRequest, CreateTokenRequest } from '../types/api';
// import { jitoBundleSender } from '../jito_bundles/jito-integration';
// import axios from 'axios';
// import * as crypto from 'crypto';


// interface CreateTokenResponse {
//   success: boolean;
//   signature?: string;
//   mint_address?: string;
//   error?: string;
//   buy_signature?: string;
// }


// async function decryptFernetKey(encryptedKey: string, fernetKey: string): Promise<Buffer> {
//   try {
//     // Decode base64
//     const encryptedData = Buffer.from(encryptedKey, 'base64');
    
//     // Fernet format: Version (1 byte) + Timestamp (8 bytes) + IV (16 bytes) + Ciphertext + HMAC (32 bytes)
//     const version = encryptedData.slice(0, 1);
//     const timestamp = encryptedData.slice(1, 9);
//     const iv = encryptedData.slice(9, 25);
//     const ciphertext = encryptedData.slice(25, -32);
//     const hmac = encryptedData.slice(-32);
    
//     // Verify HMAC
//     const signingKey = crypto.createHmac('sha256', fernetKey).update(fernetKey).digest();
//     const verificationHmac = crypto.createHmac('sha256', signingKey)
//       .update(Buffer.concat([version, timestamp, iv, ciphertext]))
//       .digest();
    
//     if (!crypto.timingSafeEqual(hmac, verificationHmac)) {
//       throw new Error('HMAC verification failed');
//     }
    
//     // Decrypt
//     const encryptionKey = crypto.createHash('sha256').update(signingKey.slice(16)).digest();
//     const decipher = crypto.createDecipheriv('aes-128-cbc', encryptionKey, iv);
//     const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    
//     return decrypted;
//   } catch (error: any) {
//     console.error(`❌ Fernet decryption failed: ${error.message}`);
//     throw error;
//   }
// }

// async function getPrivateKeyFromBackend(
//   walletAddress: string, 
//   apiKey: string
// ): Promise<Keypair> {
//   try {
//     const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000';
//     // Add this before the axios call to debug
//     // console.log('🔧 Request details:', {
//     //   url: `${backendUrl}/creators/user/decrypt-key-for-onchain`,
//     //   walletAddress,
//     //   apiKey: apiKey ? `${apiKey.substring(0, 10)}...` : 'undefined'
//     // });
//     const response = await axios.post(
//       `${backendUrl}/creators/user/get-key-for-token-creation`,  // New endpoint
//       { wallet_address: walletAddress },
//       {
//         headers: {
//           'X-API-Key': apiKey,
//           'Content-Type': 'application/json'
//         }
//       }
//     );
    
//     if (response.data && response.data.success && response.data.private_key) {
//       // Decode base58 private key
//       const secretKey = bs58.decode(response.data.private_key);
//       return Keypair.fromSecretKey(secretKey);
//     }
    
//     throw new Error('No private key returned from backend');
//   } catch (error: any) {
//     console.error(`❌ Failed to get private key: ${error.message}`);
//     throw error;
//   }
// }

// export async function createToken(
//   connection: Connection,
//   request: CreateTokenRequest
// ): Promise<CreateTokenResponse> {
//   try {
//     console.log(`🎯 Creating token: ${request.metadata.name} (${request.metadata.symbol})`);
    
//     let userKeypair: Keypair;
    
//     // Method 1: If encrypted key is provided, decrypt it
//     if (request.encrypted_private_key) {
//       console.log('🔐 Using provided encrypted private key');
//       const fernetKey = process.env.BACKEND_AES_MASTER_KEY;
//       if (!fernetKey) {
//         throw new Error('BACKEND_AES_MASTER_KEY environment variable not set');
//       }
      
//       const decryptedBytes = await decryptFernetKey(
//         request.encrypted_private_key, 
//         fernetKey
//       );
      
//       userKeypair = Keypair.fromSecretKey(decryptedBytes);
//     } 
//     // Method 2: Fetch private key from backend API
//     else {
//       console.log('🔑 Fetching private key from backend API');
//       userKeypair = await getPrivateKeyFromBackend(
//         request.user_wallet,
//         process.env.ONCHAIN_API_KEY || ''
//       );
//     }
    
//     // Verify user wallet matches
//     if (userKeypair.publicKey.toBase58() !== request.user_wallet) {
//       throw new Error('User wallet does not match provided private key');
//     }

//     // Generate mint keypair HERE
//     const mintKeypair = Keypair.generate();
//     const mintAddress = mintKeypair.publicKey;
//     console.log(`🔑 Generated mint: ${mintAddress.toBase58()}`);

//     // Create token config
//     const tokenConfig = {
//       name: request.metadata.name,
//       symbol: request.metadata.symbol,
//       uri: request.metadata.uri,
//       creatorOverride: request.creator_override ? new PublicKey(request.creator_override) : undefined
//     };
    
//     console.log(`🔧 Token config:`, tokenConfig);
    
//     // Create token using existing TokenCreationManager
//     const result = await TokenCreationManager.createNewToken(
//       connection,
//       userKeypair,
//       mintKeypair,
//       tokenConfig
//     );
    
//     if (!result.success) {
//       throw new Error(result.error || 'Token creation failed');
//     }
    
//     return {
//       success: true,
//       signature: result.signature,
//       mint_address: result.mint?.toBase58()
//     };
    
//   } catch (error: any) {
//     console.error(`❌ Token creation failed:`, error.message);
//     return {
//       success: false,
//       error: error.message
//     };
//   }
// }

// export async function createTokenWithCreatorBuy(
//     connection: Connection,
//     request: CreateTokenRequest & { creator_buy_amount: number }
// ): Promise<CreateTokenResponse> {
//     try {
//         console.log(`🎯 Creating token with creator buy: ${request.metadata.name}`);
        
//         // Get user private key
//         const userKeypair = await getPrivateKeyFromBackend(
//             request.user_wallet,
//             process.env.ONCHAIN_API_KEY || ''
//         );
        
//         // Generate mint keypair HERE
//         const mintKeypair = Keypair.generate();
//         const mintAddress = mintKeypair.publicKey;
//         console.log(`🔑 Generated mint: ${mintAddress.toBase58()}`);
        
//         // Create token config
//         const tokenConfig = {
//             name: request.metadata.name,
//             symbol: request.metadata.symbol,
//             uri: request.metadata.uri,
//             creatorOverride: request.creator_override ? new PublicKey(request.creator_override) : undefined
//         };
        
//         // First, create the token WITH THE PROVIDED MINTPAIR
//         const createResult = await TokenCreationManager.createNewToken(
//             connection,
//             userKeypair,
//             mintKeypair, // Pass the mintKeypair
//             tokenConfig
//         );
        
//         if (!createResult.success || !createResult.mint) {
//             return {
//                 success: false,
//                 error: createResult.error || 'Token creation failed'
//             };
//         }
        
//         console.log(`✅ Token created: ${createResult.mint.toBase58()}`);
        
//         // Wait a moment for the bonding curve to be created
//         console.log(`⏳ Waiting for bonding curve creation...`);
//         await new Promise(resolve => setTimeout(resolve, 2000));
        
//         // Immediately execute creator buy
//         console.log(`🔄 Executing creator buy...`);
        
//         const buyRequest: BuyRequest = {
//             action: 'buy',
//             mint_address: createResult.mint.toBase58(), // Use the actual mint
//             user_wallet: request.user_wallet,
//             amount_sol: request.creator_buy_amount,
//             use_jito: false,
//             slippage_bps: 500
//         };
        
//         const { executeBuy } = require('./buyExecution');
//         const buyResult = await executeBuy(connection, buyRequest);
        
//         if (!buyResult.success) {
//             throw new Error(`Creator buy failed: ${buyResult.error}`);
//         }
        
//         return {
//             success: true,
//             signature: createResult.signature,
//             mint_address: createResult.mint.toBase58(),
//             buy_signature: buyResult.signatures?.[0]
//         };
        
//     } catch (error: any) {
//         console.error(`❌ Token creation with buy failed:`, error.message);
//         return {
//             success: false,
//             error: error.message
//         };
//     }
// }



// // Add this to your tokenCreation.ts file


// // export async function createTokenWithInitialBuy(
// //   connection: Connection,
// //   request: {
// //     user_wallet: string;
// //     metadata: {
// //       name: string;
// //       symbol: string;
// //       uri: string;
// //       description?: string;
// //     };
// //     initial_buy_amount: number; // Creator's initial buy amount
// //     use_jito?: boolean;
// //     creator_override?: string;
// //   }
// // ): Promise<{
// //   success: boolean;
// //   mint_address?: string;
// //   signatures?: string[];
// //   error?: string;
// // }> {
// //   try {
// //     // Get user private key
// //     const userKeypair = await getPrivateKeyFromBackend(
// //       request.user_wallet,
// //       process.env.ONCHAIN_API_KEY || ''
// //     );
    
// //     // Generate mint keypair
// //     const mintKeypair = Keypair.generate();
// //     const mint = mintKeypair.publicKey;
    
// //     // Get all PDAs needed
// //     const mintAuthority = PumpFunPda.getMintAuthority();
// //     const bondingCurve = PumpFunPda.getBondingCurve(mint);
// //     const associatedBondingCurve = PumpFunPda.getAssociatedBondingCurveForCreate(bondingCurve, mint);
// //     const global = PumpFunPda.getGlobal();
// //     const metadataAccount = PumpFunPda.getMetadata(mint);
// //     const eventAuthority = PumpFunPda.getEventAuthority();
    
// //     // Get creator ATA (for receiving tokens from initial buy)
// //     const { getAssociatedTokenAddressSync } = require('@solana/spl-token');
// //     const creatorAta = getAssociatedTokenAddressSync(
// //       mint,
// //       userKeypair.publicKey,
// //       false,
// //       TOKEN_2022_PROGRAM_ID
// //     );
    
// //     // Calculate initial buy parameters
// //     const initialSolReserves = BigInt(Math.floor(0.01 * LAMPORTS_PER_SOL)); // 0.01 SOL initial reserves
// //     const initialTokenSupply = BigInt(1_000_000_000_000); // 1M tokens with 6 decimals
// //     const creatorBuyAmount = BigInt(Math.floor(request.initial_buy_amount * LAMPORTS_PER_SOL));
    
// //     // Calculate tokens creator should get
// //     const virtualSolReserves = initialSolReserves;
// //     const virtualTokenReserves = initialTokenSupply;
    
// //     const expectedTokens = BondingCurveMath.calculateTokensForSol(
// //       virtualSolReserves,
// //       virtualTokenReserves,
// //       creatorBuyAmount
// //     );
    
// //     const minTokensOut = BondingCurveMath.applySlippage(expectedTokens, 100); // 1% slippage
    
// //     console.log(`🔧 Creating token with initial buy:`);
// //     console.log(`   Mint: ${mint.toBase58()}`);
// //     console.log(`   Creator: ${userKeypair.publicKey.toBase58()}`);
// //     console.log(`   Initial buy: ${request.initial_buy_amount} SOL for ~${expectedTokens} tokens`);
    
// //     // Get blockhash
// //     const { blockhash } = await connection.getLatestBlockhash('confirmed');
    
// //     // Build custom instruction that combines create + buy
// //     // This is the CRITICAL part - we need to understand pump.fun's program
// //     // Since pump.fun doesn't expose a "create with buy" instruction,
// //     // we need to bundle create and buy transactions
    
// //     // Alternative: Use versioned transactions with multiple instructions
// //     const instructions: TransactionInstruction[] = [];
    
// //     // 1. Create token instruction
// //     const createInstruction = PumpFunInstructionBuilder.buildCreate(
// //       userKeypair,
// //       mintKeypair,
// //       request.metadata.name,
// //       request.metadata.symbol,
// //       request.metadata.uri,
// //       userKeypair.publicKey
// //     );
    
// //     // 2. Buy instruction (immediately after creation)
// //     const buyInstruction = PumpFunInstructionBuilder.buildBuyExactSolIn(
// //       userKeypair.publicKey,
// //       mint,
// //       creatorAta,
// //       userKeypair.publicKey, // Creator
// //       creatorBuyAmount,
// //       minTokensOut
// //     );
    
// //     instructions.push(createInstruction, buyInstruction);
    
// //     // Build transaction
// //     const messageV0 = new TransactionMessage({
// //       payerKey: userKeypair.publicKey,
// //       recentBlockhash: blockhash,
// //       instructions
// //     }).compileToV0Message();
    
// //     const transaction = new VersionedTransaction(messageV0);
// //     transaction.sign([userKeypair, mintKeypair]);
    
// //     console.log(`✅ Transaction built with ${instructions.length} instructions`);
    
// //     // Send as bundle
// //     if (request.use_jito) {
// //       try {
// //         const result = await jitoBundleSender.sendBundle([transaction], connection);
        
// //         if (result.success) {
// //           return {
// //             success: true,
// //             mint_address: mint.toBase58(),
// //             signatures: [result.bundleId],
// //             error: undefined
// //           };
// //         }
// //       } catch (jitoError) {
// //         console.error('Jito failed:', jitoError);
// //       }
// //     }
    
// //     // Fallback to RPC
// //     const signature = await connection.sendTransaction(transaction, {
// //       skipPreflight: false,
// //       maxRetries: 3,
// //       preflightCommitment: 'confirmed'
// //     });
    
// //     // Wait for confirmation
// //     await connection.confirmTransaction({
// //       signature,
// //       blockhash,
// //       lastValidBlockHeight: (await connection.getLatestBlockhash('confirmed')).lastValidBlockHeight
// //     }, 'confirmed');
    
// //     return {
// //       success: true,
// //       mint_address: mint.toBase58(),
// //       signatures: [signature]
// //     };
    
// //   } catch (error: any) {
// //     console.error(`❌ Token creation with buy failed:`, error.message);
// //     return {
// //       success: false,
// //       error: error.message
// //     };
// //   }
// // }




// tokenCreation.ts - Updated to accept only URI
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { BondingCurveMath, PumpFunInstructionBuilder, PumpFunPda, TOKEN_2022_PROGRAM_ID, TokenCreationManager } from '../pumpfun/pumpfun-idl-client';
import { BuyRequest, CreateTokenRequest } from '../types/api';
import { jitoBundleSender } from '../jito_bundles/jito-integration';
import axios from 'axios';
import * as crypto from 'crypto';


interface CreateTokenResponse {
  success: boolean;
  signature?: string;
  mint_address?: string;
  error?: string;
  buy_signature?: string;
}


async function decryptFernetKey(encryptedKey: string, fernetKey: string): Promise<Buffer> {
  try {
    // Decode base64
    const encryptedData = Buffer.from(encryptedKey, 'base64');
    
    // Fernet format: Version (1 byte) + Timestamp (8 bytes) + IV (16 bytes) + Ciphertext + HMAC (32 bytes)
    const version = encryptedData.slice(0, 1);
    const timestamp = encryptedData.slice(1, 9);
    const iv = encryptedData.slice(9, 25);
    const ciphertext = encryptedData.slice(25, -32);
    const hmac = encryptedData.slice(-32);
    
    // Verify HMAC
    const signingKey = crypto.createHmac('sha256', fernetKey).update(fernetKey).digest();
    const verificationHmac = crypto.createHmac('sha256', signingKey)
      .update(Buffer.concat([version, timestamp, iv, ciphertext]))
      .digest();
    
    if (!crypto.timingSafeEqual(hmac, verificationHmac)) {
      throw new Error('HMAC verification failed');
    }
    
    // Decrypt
    const encryptionKey = crypto.createHash('sha256').update(signingKey.slice(16)).digest();
    const decipher = crypto.createDecipheriv('aes-128-cbc', encryptionKey, iv);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    
    return decrypted;
  } catch (error: any) {
    console.error(`❌ Fernet decryption failed: ${error.message}`);
    throw error;
  }
}

async function getPrivateKeyFromBackend(
  walletAddress: string, 
  apiKey: string
): Promise<Keypair> {
  try {
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000';
    
    const response = await axios.post(
      `${backendUrl}/creators/user/get-key-for-token-creation`,
      { wallet_address: walletAddress },
      {
        headers: {
          'X-API-Key': apiKey,
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (response.data && response.data.success && response.data.private_key) {
      // Decode base58 private key
      const secretKey = bs58.decode(response.data.private_key);
      return Keypair.fromSecretKey(secretKey);
    }
    
    throw new Error('No private key returned from backend');
  } catch (error: any) {
    console.error(`❌ Failed to get private key: ${error.message}`);
    throw error;
  }
}

export async function createToken(
  connection: Connection,
  request: CreateTokenRequest
): Promise<CreateTokenResponse> {
  try {
    console.log('🎯 Creating new pump.fun token...');
    
    // ✅ CRITICAL: We only need name, symbol, and URI from metadata
    const { name, symbol, uri } = request.metadata;
    
    if (!name || !symbol || !uri) {
      throw new Error('Metadata must include name, symbol, and uri');
    }
    
    console.log(`📄 Token metadata:`);
    console.log(`   Name: ${name}`);
    console.log(`   Symbol: ${symbol}`);
    console.log(`   URI: ${uri}`);
    
    // Verify the URI is a valid URL (IPFS or HTTP)
    if (!uri.startsWith('http') && !uri.startsWith('ipfs://')) {
      console.warn(`⚠️ URI may not be valid: ${uri}`);
      // Continue anyway, pump.fun will handle validation
    }
    
    // Get user private key
    let userKeypair: Keypair;
    
    if (request.encrypted_private_key) {
      console.log('🔐 Using provided encrypted private key');
      const fernetKey = process.env.BACKEND_AES_MASTER_KEY;
      if (!fernetKey) {
        throw new Error('BACKEND_AES_MASTER_KEY environment variable not set');
      }
      
      const decryptedBytes = await decryptFernetKey(
        request.encrypted_private_key, 
        fernetKey
      );
      
      userKeypair = Keypair.fromSecretKey(decryptedBytes);
    } else {
      console.log('🔑 Fetching private key from backend API');
      userKeypair = await getPrivateKeyFromBackend(
        request.user_wallet,
        process.env.ONCHAIN_API_KEY || ''
      );
    }
    
    // Verify wallet matches
    if (userKeypair.publicKey.toBase58() !== request.user_wallet) {
      throw new Error('Wallet address does not match provided private key');
    }
    
    // Generate mint keypair
    const mintKeypair = Keypair.generate();
    const mint = mintKeypair.publicKey;
    
    console.log(`🔑 Mint: ${mint.toBase58()}`);
    console.log(`🔑 Creator: ${userKeypair.publicKey.toBase58()}`);
    
    // Get blockhash
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    
    // ✅ BUILD CREATE V2 INSTRUCTION WITH ONLY NAME, SYMBOL, URI
    const createV2Instruction = PumpFunInstructionBuilder.buildCreateV2(
      userKeypair,
      mintKeypair,
      name,
      symbol,
      uri, // ✅ Only the URI - it contains all metadata
      false, // is_mayhem_mode
      request.creator_override ? new PublicKey(request.creator_override) : userKeypair.publicKey
    );
    
    console.log(`✅ CREATE_V2 instruction built`);
    
    // Create transaction with just the create instruction
    const messageV0 = new TransactionMessage({
      payerKey: userKeypair.publicKey,
      recentBlockhash: blockhash,
      instructions: [createV2Instruction]
    }).compileToV0Message();
    
    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([userKeypair, mintKeypair]);
    
    const txSize = transaction.serialize().length;
    console.log(`📏 Transaction size: ${txSize} bytes`);
    
    if (txSize > 1232) {
      throw new Error(`Transaction too large: ${txSize} bytes. Max is 1232 bytes.`);
    }
    
    // Send transaction
    console.log(`📤 Sending transaction...`);
    const signature = await connection.sendTransaction(transaction, {
      skipPreflight: false,
      maxRetries: 3,
      preflightCommitment: 'confirmed'
    });
    
    console.log(`✅ Transaction sent: ${signature.slice(0, 16)}...`);
    console.log(`⏳ Waiting for confirmation...`);
    
    // Quick confirmation
    const confirmation = await connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight
    }, 'confirmed');
    
    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }
    
    console.log(`🎉 Token created successfully!`);
    console.log(`🔗 Explorer: https://solscan.io/tx/${signature}`);
    
    return {
      success: true,
      signature,
      mint_address: mint.toBase58()
    };
    
  } catch (error: any) {
    console.error(`❌ Token creation failed:`, error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

export async function createTokenWithCreatorBuy(
    connection: Connection,
    request: CreateTokenRequest & { creator_buy_amount: number }
): Promise<CreateTokenResponse> {
    try {
        console.log('🎯 Creating token with immediate creator buy...');
        
        // ✅ CRITICAL: Only extract name, symbol, URI
        const { name, symbol, uri } = request.metadata;
        
        if (!name || !symbol || !uri) {
            throw new Error('Metadata must include name, symbol, and uri');
        }
        
        console.log(`📄 Token metadata:`);
        console.log(`   Name: ${name}`);
        console.log(`   Symbol: ${symbol}`);
        console.log(`   URI: ${uri}`);
        
        // Get user private key
        const userKeypair = await getPrivateKeyFromBackend(
            request.user_wallet,
            process.env.ONCHAIN_API_KEY || ''
        );
        
        if (userKeypair.publicKey.toBase58() !== request.user_wallet) {
            throw new Error('Wallet address does not match provided private key');
        }
        
        // Generate mint keypair
        const mintKeypair = Keypair.generate();
        const mint = mintKeypair.publicKey;
        
        console.log(`🔑 Mint: ${mint.toBase58()}`);
        console.log(`💰 Creator buy amount: ${request.creator_buy_amount} SOL`);
        
        // Get blockhash
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
        
        // ✅ USE THE SIMPLE BUILDER FROM botManager.ts (import it)
        // First, let's try using the TokenCreationManager approach
        console.log(`🔄 Using simplified approach...`);
        
        // Create token config
        const tokenConfig = {
            name: name,
            symbol: symbol,
            uri: uri,
            creatorOverride: request.creator_override ? new PublicKey(request.creator_override) : undefined
        };
        
        console.log(`🔧 Token config:`, tokenConfig);
        
        // First, create the token WITH THE PROVIDED MINTPAIR
        const createResult = await TokenCreationManager.createNewToken(
            connection,
            userKeypair,
            mintKeypair,
            tokenConfig
        );
        
        if (!createResult.success || !createResult.mint) {
            return {
                success: false,
                error: createResult.error || 'Token creation failed'
            };
        }
        
        console.log(`✅ Token created: ${createResult.mint.toBase58()}`);
        
        // Wait a moment for the bonding curve to be created
        console.log(`⏳ Waiting for bonding curve creation...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Immediately execute creator buy
        console.log(`🔄 Executing creator buy...`);
        
        const buyRequest: BuyRequest = {
            action: 'buy',
            mint_address: createResult.mint.toBase58(),
            user_wallet: request.user_wallet,
            amount_sol: request.creator_buy_amount,
            use_jito: false,
            slippage_bps: 500
        };
        
        const { executeBuy } = require('./buyExecution');
        const buyResult = await executeBuy(connection, buyRequest);
        
        if (!buyResult.success) {
            throw new Error(`Creator buy failed: ${buyResult.error}`);
        }
        
        return {
            success: true,
            signature: createResult.signature,
            mint_address: createResult.mint.toBase58(),
            buy_signature: buyResult.signatures?.[0]
        };
        
    } catch (error: any) {
        console.error(`❌ Create with buy failed:`, error.message);
        return {
            success: false,
            error: error.message
        };
    }
}
