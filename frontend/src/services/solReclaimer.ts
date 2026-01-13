// import {
//   Connection,
//   PublicKey,
//   Transaction,
//   VersionedTransaction,
//   TransactionMessage,
//   SystemProgram,
//   LAMPORTS_PER_SOL,
// } from "@solana/web3.js";
// import {
//   createCloseAccountInstruction,
//   TOKEN_PROGRAM_ID,
// } from "@solana/spl-token";
// import { 
//   TokenAccount, 
//   ReclaimResult, 
//   ReclaimEstimate 
// } from "../types/solana";
// import { 
//   SOL_RENT_PER_ACCOUNT,
// } from "../types/solana";

// // Token 2022 Program ID (Proof of Potato only handles Token 2022)
// const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

// // Platform fee destination (Proof of Potato's wallet)
// const FEE_DESTINATION = new PublicKey("8HXZFCMojkMLPmsod8HMow61hZEss59ec2rSu999wrMp");

// export class SolReclaimer {
//   public connection: Connection;

//   constructor(rpcUrl?: string) {
//     const endpoint = rpcUrl || 
//                      import.meta.env.VITE_SHFYT_RPC || 
//                      "https://api.mainnet-beta.solana.com";
    
//     this.connection = new Connection(endpoint, "confirmed");
//   }

//   // Get ALL token accounts (both Token Program and Token 2022)
//   async getTokenAccounts(walletAddress: string): Promise<TokenAccount[]> {
//     const owner = new PublicKey(walletAddress);
    
//     try {
//       const accounts: TokenAccount[] = [];
      
//       // Get Token Program accounts
//       const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
//         owner,
//         { programId: TOKEN_PROGRAM_ID }
//       );
      
//       // Get Token 2022 Program accounts
//       const token2022Accounts = await this.connection.getParsedTokenAccountsByOwner(
//         owner,
//         { programId: TOKEN_2022_PROGRAM_ID }
//       );
      
//       // Process Token Program accounts
//       for (const accountInfo of tokenAccounts.value) {
//         try {
//           const account = this.processTokenAccount(accountInfo, owner, TOKEN_PROGRAM_ID);
//           accounts.push(account);
//         } catch (error) {
//           console.error(`Error processing token account:`, error);
//         }
//       }
      
//       // Process Token 2022 Program accounts
//       for (const accountInfo of token2022Accounts.value) {
//         try {
//           const account = this.processTokenAccount(accountInfo, owner, TOKEN_2022_PROGRAM_ID);
//           accounts.push(account);
//         } catch (error) {
//           console.error(`Error processing token 2022 account:`, error);
//         }
//       }
      
//       console.log(`Found ${accounts.length} total accounts (${tokenAccounts.value.length} token + ${token2022Accounts.value.length} token2022)`);
      
//       return accounts;
//     } catch (error) {
//       console.error("Error fetching token accounts:", error);
//       throw error;
//     }
//   }

//   private processTokenAccount(
//     accountInfo: any,
//     owner: PublicKey,
//     programId: PublicKey
//   ): TokenAccount {
//     const info = accountInfo.account.data.parsed.info;
//     const mint = info.mint;
//     const tokenAmount = info.tokenAmount;
    
//     // Check if it's an NFT (decimals = 0)
//     const isNFT = tokenAmount.decimals === 0;
    
//     // Check if account is empty
//     const isEmpty = tokenAmount.uiAmount === 0;
    
//     // Account can be closed if:
//     // 1. Empty (uiAmount === 0)
//     // 2. Not frozen
//     // 3. Not an NFT account
//     const isFrozen = !!info.freezeAuthority;
//     const closeable = isEmpty && !isFrozen && !isNFT;
    
//     return {
//       pubkey: accountInfo.pubkey.toString(),
//       mint: mint,
//       owner: owner.toString(),
//       tokenAmount: {
//         uiAmount: tokenAmount.uiAmount || 0,
//         decimals: tokenAmount.decimals,
//         amount: tokenAmount.amount,
//       },
//       initialized: accountInfo.account.lamports > 0,
//       frozen: isFrozen,
//       closeable,
//       estimatedRent: SOL_RENT_PER_ACCOUNT,
//       isNFT,
//       isEmpty,
//       programId: programId.toString(),
//     };
//   }

//   // Get reclaimable accounts - ONLY Token 2022 accounts
//   getReclaimableAccounts(accounts: TokenAccount[]): TokenAccount[] {
//     return accounts.filter(account => 
//       account.closeable && 
//       account.isEmpty && 
//       !account.isNFT &&
//       !account.frozen &&
//       account.initialized &&
//       account.programId === TOKEN_2022_PROGRAM_ID.toString() // Only Token 2022
//     );
//   }

//   // Get reclaim estimate (0.5% fee like Proof of Potato)
//   getReclaimEstimate(accounts: TokenAccount[]): ReclaimEstimate {
//     const reclaimableAccounts = this.getReclaimableAccounts(accounts);
//     const estimatedTotalSol = reclaimableAccounts.length * SOL_RENT_PER_ACCOUNT;
//     const feeAmount = estimatedTotalSol * 0.005; // 0.5% fee
//     const transactionFees = 0.000009; // Estimated transaction fee
//     const netGain = estimatedTotalSol - feeAmount - transactionFees;

//     return {
//       totalAccounts: accounts.length,
//       reclaimableAccounts: reclaimableAccounts.length,
//       estimatedTotalSol,
//       feePercentage: 0.5, // 0.5% like Proof of Potato
//       feeAmount,
//       netGain,
//     };
//   }

//   // Simple reclaim without Lighthouse (to test)
//   async reclaimSol(
//     accounts: TokenAccount[],
//     walletPublicKey: PublicKey,
//     signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>
//   ): Promise<ReclaimResult[]> {
//     const reclaimableAccounts = this.getReclaimableAccounts(accounts);
    
//     if (reclaimableAccounts.length === 0) {
//       console.log("No reclaimable Token 2022 accounts found");
//       return [];
//     }
    
//     try {
//       // Calculate amounts
//       const totalReclaimed = reclaimableAccounts.length * SOL_RENT_PER_ACCOUNT;
//       const feeAmount = totalReclaimed * 0.005;
//       const netAmount = totalReclaimed - feeAmount;
      
//       console.log(`Reclaiming ${reclaimableAccounts.length} Token 2022 accounts`);
//       console.log(`Total: ${totalReclaimed} SOL, Fee: ${feeAmount} SOL, Net: ${netAmount} SOL`);
      
//       // Get latest blockhash
//       const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
      
//       // Create instructions
//       const instructions = [];
      
//       // 1. Compute Budget: SetComputeUnitLimit (160,000 units)
//       instructions.push({
//         programId: new PublicKey('ComputeBudget111111111111111111111111111111'),
//         keys: [],
//         data: Buffer.from(new Uint8Array([2, 160, 134, 2, 0])),
//       });
      
//       // 2. Compute Budget: SetComputeUnitPrice (0.025 lamports per CU)
//       instructions.push({
//         programId: new PublicKey('ComputeBudget111111111111111111111111111111'),
//         keys: [],
//         data: Buffer.from(new Uint8Array([3, 0, 98, 0, 0, 0, 0, 0, 0])),
//       });
      
//       // 3. Close token accounts (limit to 12 per transaction like Proof of Potato)
//       const accountsToClose = reclaimableAccounts.slice(0, 12);
//       for (const account of accountsToClose) {
//         const closeInstruction = createCloseAccountInstruction(
//           new PublicKey(account.pubkey),
//           walletPublicKey, // destination
//           walletPublicKey, // owner
//           [],
//           TOKEN_2022_PROGRAM_ID
//         );
        
//         instructions.push(closeInstruction);
//       }
      
//       // 4. Fee transfer to platform (0.5% of reclaimed)
//       if (feeAmount > 0) {
//         const feeLamports = Math.floor(feeAmount * LAMPORTS_PER_SOL);
        
//         const transferInstruction = SystemProgram.transfer({
//           fromPubkey: walletPublicKey,
//           toPubkey: FEE_DESTINATION,
//           lamports: feeLamports,
//         });
        
//         instructions.push(transferInstruction);
//       }
      
//       console.log(`Creating transaction with ${instructions.length} instructions`);
      
//       // Create Legacy Transaction instead of VersionedTransaction
//       const transaction = new Transaction();
//       transaction.recentBlockhash = blockhash;
//       transaction.feePayer = walletPublicKey;
      
//       // Add all instructions
//       instructions.forEach(instruction => {
//         // For system instructions, convert to TransactionInstruction
//         if (instruction.programId.equals(new PublicKey('ComputeBudget111111111111111111111111111111'))) {
//           transaction.add({
//             programId: instruction.programId,
//             keys: [],
//             data: Buffer.from(instruction.data),
//           });
//         } else if (instruction.programId.equals(SystemProgram.programId)) {
//           // For transfer instruction
//           transaction.add(instruction);
//         } else {
//           // For close account instruction
//           transaction.add(instruction);
//         }
//       });
      
//       // Sign the transaction
//       console.log('Requesting wallet signature...');
      
//       // Try with legacy transaction signing
//       const signedTransaction = await signTransaction(transaction as any);
      
//       // Send transaction
//       const signature = await this.connection.sendRawTransaction(
//         signedTransaction.serialize(),
//         {
//           skipPreflight: false,
//           preflightCommitment: 'confirmed',
//         }
//       );
      
//       console.log(`Transaction sent: ${signature}`);
      
//       // Wait for confirmation
//       await this.connection.confirmTransaction(
//         {
//           signature,
//           blockhash,
//           lastValidBlockHeight,
//         },
//         'confirmed'
//       );
      
//       console.log('Transaction confirmed!');
      
//       return [{
//         success: true,
//         signature,
//         reclaimedSol: totalReclaimed,
//         closedAccounts: accountsToClose.length,
//         feePaid: feeAmount,
//       }];
      
//     } catch (error: any) {
//       console.error('Error in reclaimSol:', error);
      
//       return [{
//         success: false,
//         reclaimedSol: 0,
//         closedAccounts: 0,
//         feePaid: 0,
//         error: error.message || 'Transaction failed',
//         signature: error.signature || '',
//       }];
//     }
//   }
// }























import {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
  TransactionMessage,
  SystemProgram,
  LAMPORTS_PER_SOL,
  TransactionInstruction,
  ComputeBudgetProgram
} from "@solana/web3.js";
import {
  createCloseAccountInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { 
  TokenAccount, 
  ReclaimResult, 
  ReclaimEstimate 
} from "../types/solana";
import { 
  SOL_RENT_PER_ACCOUNT,
} from "../types/solana";

// Token 2022 Program ID (Proof of Potato only handles Token 2022)
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

// Platform fee destination (Proof of Potato's wallet)
const FEE_DESTINATION = new PublicKey("8HXZFCMojkMLPmsod8HMow61hZEss59ec2rSu999wrMp");

export class SolReclaimer {
  public connection: Connection;

  constructor(rpcUrl?: string) {
    const endpoint = rpcUrl || 
                     import.meta.env.VITE_SHFYT_RPC || 
                     "https://api.mainnet-beta.solana.com";
    
    this.connection = new Connection(endpoint, "confirmed");
  }

  // Get ALL token accounts (both Token Program and Token 2022)
  async getTokenAccounts(walletAddress: string): Promise<TokenAccount[]> {
    const owner = new PublicKey(walletAddress);
    
    try {
      const accounts: TokenAccount[] = [];
      
      // Get Token Program accounts
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
        owner,
        { programId: TOKEN_PROGRAM_ID }
      );
      
      // Get Token 2022 Program accounts
      const token2022Accounts = await this.connection.getParsedTokenAccountsByOwner(
        owner,
        { programId: TOKEN_2022_PROGRAM_ID }
      );
      
      // Process Token Program accounts
      for (const accountInfo of tokenAccounts.value) {
        try {
          const account = this.processTokenAccount(accountInfo, owner, TOKEN_PROGRAM_ID);
          accounts.push(account);
        } catch (error) {
          console.error(`Error processing token account:`, error);
        }
      }
      
      // Process Token 2022 Program accounts
      for (const accountInfo of token2022Accounts.value) {
        try {
          const account = this.processTokenAccount(accountInfo, owner, TOKEN_2022_PROGRAM_ID);
          accounts.push(account);
        } catch (error) {
          console.error(`Error processing token 2022 account:`, error);
        }
      }
      
      console.log(`Found ${accounts.length} total accounts (${tokenAccounts.value.length} token + ${token2022Accounts.value.length} token2022)`);
      
      return accounts;
    } catch (error) {
      console.error("Error fetching token accounts:", error);
      throw error;
    }
  }

  private processTokenAccount(
    accountInfo: any,
    owner: PublicKey,
    programId: PublicKey
  ): TokenAccount {
    const info = accountInfo.account.data.parsed.info;
    const mint = info.mint;
    const tokenAmount = info.tokenAmount;
    
    // Check if it's an NFT (decimals = 0)
    const isNFT = tokenAmount.decimals === 0;
    
    // Check if account is empty
    const isEmpty = tokenAmount.uiAmount === 0;
    
    // Account can be closed if:
    // 1. Empty (uiAmount === 0)
    // 2. Not frozen
    // 3. Not an NFT account
    const isFrozen = !!info.freezeAuthority;
    const closeable = isEmpty && !isFrozen && !isNFT;
    
    return {
      pubkey: accountInfo.pubkey.toString(),
      mint: mint,
      owner: owner.toString(),
      tokenAmount: {
        uiAmount: tokenAmount.uiAmount || 0,
        decimals: tokenAmount.decimals,
        amount: tokenAmount.amount,
      },
      initialized: accountInfo.account.lamports > 0,
      frozen: isFrozen,
      closeable,
      estimatedRent: SOL_RENT_PER_ACCOUNT,
      isNFT,
      isEmpty,
      programId: programId.toString(),
    };
  }

  // Get reclaimable accounts - ONLY Token 2022 accounts
  getReclaimableAccounts(accounts: TokenAccount[]): TokenAccount[] {
    return accounts.filter(account => 
      account.closeable && 
      account.isEmpty && 
      !account.isNFT &&
      !account.frozen &&
      account.initialized &&
      account.programId === TOKEN_2022_PROGRAM_ID.toString() // Only Token 2022
    );
  }

  // Get reclaim estimate (0.5% fee like Proof of Potato)
  getReclaimEstimate(accounts: TokenAccount[]): ReclaimEstimate {
    const reclaimableAccounts = this.getReclaimableAccounts(accounts);
    const estimatedTotalSol = reclaimableAccounts.length * SOL_RENT_PER_ACCOUNT;
    const feeAmount = estimatedTotalSol * 0.005; // 0.5% fee
    const transactionFees = 0.000009; // Estimated transaction fee
    const netGain = estimatedTotalSol - feeAmount - transactionFees;

    return {
      totalAccounts: accounts.length,
      reclaimableAccounts: reclaimableAccounts.length,
      estimatedTotalSol,
      feePercentage: 0.5, // 0.5% like Proof of Potato
      feeAmount,
      netGain,
    };
  }

  // Simple reclaim without Lighthouse (to test)
//   async reclaimSol(
//   accounts: TokenAccount[],
//   walletPublicKey: PublicKey,
//   signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>
// ): Promise<ReclaimResult[]> {
//   const reclaimableAccounts = this.getReclaimableAccounts(accounts);
  
//   if (reclaimableAccounts.length === 0) {
//     console.log("No reclaimable Token 2022 accounts found");
//     return [];
//   }
  
//   try {
//     // Calculate amounts
//     const totalReclaimed = reclaimableAccounts.length * SOL_RENT_PER_ACCOUNT;
//     const feeAmount = totalReclaimed * 0.005;
//     const netAmount = totalReclaimed - feeAmount;
    
//     console.log(`Reclaiming ${reclaimableAccounts.length} Token 2022 accounts`);
//     console.log(`Total: ${totalReclaimed} SOL, Fee: ${feeAmount} SOL, Net: ${netAmount} SOL`);
    
//     // Get latest blockhash
//     const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
    
//     // Create instructions
//     const instructions: any[] = [];
    
//     // 1. Compute Budget: SetComputeUnitLimit (160,000 units)
//     instructions.push({
//       programId: new PublicKey('ComputeBudget111111111111111111111111111111'),
//       keys: [],
//       data: Buffer.from([2, 160, 134, 2, 0]), // Use Buffer.from with array
//     });
    
//     // 2. Compute Budget: SetComputeUnitPrice (0.025 lamports per CU)
//     instructions.push({
//       programId: new PublicKey('ComputeBudget111111111111111111111111111111'),
//       keys: [],
//       data: Buffer.from([3, 0, 98, 0, 0, 0, 0, 0, 0]), // Use Buffer.from with array
//     });
    
//     // 3. Close token accounts (limit to 12 per transaction like Proof of Potato)
//     const accountsToClose = reclaimableAccounts.slice(0, 12);
//     for (const account of accountsToClose) {
//       const closeInstruction = createCloseAccountInstruction(
//         new PublicKey(account.pubkey),
//         walletPublicKey, // destination
//         walletPublicKey, // owner
//         [],
//         TOKEN_2022_PROGRAM_ID
//       );
      
//       instructions.push(closeInstruction);
//     }
    
//     // 4. Fee transfer to platform (0.5% of reclaimed)
//     if (feeAmount > 0) {
//       const feeLamports = Math.floor(feeAmount * LAMPORTS_PER_SOL);
      
//       const transferInstruction = SystemProgram.transfer({
//         fromPubkey: walletPublicKey,
//         toPubkey: FEE_DESTINATION,
//         lamports: feeLamports,
//       });
      
//       instructions.push(transferInstruction);
//     }
    
//     console.log(`Creating transaction with ${instructions.length} instructions`);
    
//     // Create Legacy Transaction instead of VersionedTransaction
//     const transaction = new Transaction();
//     transaction.recentBlockhash = blockhash;
//     transaction.feePayer = walletPublicKey;
    
//     // Add all instructions
//     instructions.forEach(instruction => {
//       // For compute budget instructions
//       if (instruction.programId.equals(new PublicKey('ComputeBudget111111111111111111111111111111'))) {
//         // Create proper TransactionInstruction
//         const txInstruction = new TransactionInstruction({
//           programId: instruction.programId,
//           keys: instruction.keys,
//           data: instruction.data,
//         });
//         transaction.add(txInstruction);
//       } else {
//         // For regular instructions
//         transaction.add(instruction);
//       }
//     });
    
//     // Sign the transaction
//     console.log('Requesting wallet signature...');
    
//     // Try with legacy transaction signing
//     const signedTransaction = await signTransaction(transaction as any);
    
//     // Send transaction
//     const signature = await this.connection.sendRawTransaction(
//       signedTransaction.serialize(),
//       {
//         skipPreflight: false,
//         preflightCommitment: 'confirmed',
//       }
//     );
    
//     console.log(`Transaction sent: ${signature}`);
    
//     // Wait for confirmation
//     await this.connection.confirmTransaction(
//       {
//         signature,
//         blockhash,
//         lastValidBlockHeight,
//       },
//       'confirmed'
//     );
    
//     console.log('Transaction confirmed!');
    
//     return [{
//       success: true,
//       signature,
//       reclaimedSol: totalReclaimed,
//       closedAccounts: accountsToClose.length,
//       feePaid: feeAmount,
//     }];
    
//   } catch (error: any) {
//     console.error('Error in reclaimSol:', error);
    
//     return [{
//       success: false,
//       reclaimedSol: 0,
//       closedAccounts: 0,
//       feePaid: 0,
//       error: error.message || 'Transaction failed',
//       signature: error.signature || '',
//     }];
//   }
// }

  async reclaimSol(
    accounts: TokenAccount[],
    walletPublicKey: PublicKey,
    signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>
  ): Promise<ReclaimResult[]> {
    const reclaimableAccounts = this.getReclaimableAccounts(accounts);
    
    if (reclaimableAccounts.length === 0) {
      console.log("No reclaimable Token 2022 accounts found");
      return [];
    }
    
    try {
      // Calculate amounts
      const totalReclaimed = reclaimableAccounts.length * SOL_RENT_PER_ACCOUNT;
      const feeAmount = totalReclaimed * 0.005;
      const netAmount = totalReclaimed - feeAmount;
      
      console.log(`Reclaiming ${reclaimableAccounts.length} Token 2022 accounts`);
      console.log(`Total: ${totalReclaimed} SOL, Fee: ${feeAmount} SOL, Net: ${netAmount} SOL`);
      
      // Get latest blockhash
      const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
      
      // Create Transaction
      const transaction = new Transaction();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = walletPublicKey;
      
      // ========== STANDARD INDUSTRY APPROACH ==========
      // 1. Add compute budget instructions (official method from @solana/web3.js)
      transaction.add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 160000 })
      );
      transaction.add(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 25000 }) // 0.025 lamports
      );
      // ===============================================
      
      // 2. Close token accounts (limit to 12 per transaction like Proof of Potato)
      const accountsToClose = reclaimableAccounts.slice(0, 12);
      for (const account of accountsToClose) {
        const closeInstruction = createCloseAccountInstruction(
          new PublicKey(account.pubkey),
          walletPublicKey, // destination
          walletPublicKey, // owner
          [],
          TOKEN_2022_PROGRAM_ID
        );
        
        transaction.add(closeInstruction);
      }
      
      // 3. Fee transfer to platform (0.5% of reclaimed)
      if (feeAmount > 0) {
        const feeLamports = Math.floor(feeAmount * LAMPORTS_PER_SOL);
        
        const transferInstruction = SystemProgram.transfer({
          fromPubkey: walletPublicKey,
          toPubkey: FEE_DESTINATION,
          lamports: feeLamports,
        });
        
        transaction.add(transferInstruction);
      }
      
      console.log(`Created transaction with ${transaction.instructions.length} instructions`);
      
      // Sign the transaction
      console.log('Requesting wallet signature...');
      
      const signedTransaction = await signTransaction(transaction as any);
      
      // Send transaction
      const signature = await this.connection.sendRawTransaction(
        signedTransaction.serialize(),
        {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
          maxRetries: 5,
        }
      );
      
      console.log(`Transaction sent: ${signature}`);
      
      // Wait for confirmation
      await this.connection.confirmTransaction(
        {
          signature,
          blockhash,
          lastValidBlockHeight,
        },
        'confirmed'
      );
      
      console.log('Transaction confirmed!');
      
      return [{
        success: true,
        signature,
        reclaimedSol: totalReclaimed,
        closedAccounts: accountsToClose.length,
        feePaid: feeAmount,
      }];
      
    } catch (error: any) {
      console.error('Error in reclaimSol:', error);
      
      return [{
        success: false,
        reclaimedSol: 0,
        closedAccounts: 0,
        feePaid: 0,
        error: error.message || 'Transaction failed',
        signature: error.signature || '',
      }];
    }
  }
}



