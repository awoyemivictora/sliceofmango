// keyService.ts
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import axios from 'axios';

interface PrivateKeyResponse {
  success: boolean;
  private_key: string; // base58 encoded
  wallet_address: string;
  cached?: boolean;
  timestamp?: string;
}

export class KeyService {
  private static backendUrl = process.env.BACKEND_URL || 'http://localhost:8000';
  private static apiKey = process.env.ONCHAIN_API_KEY || '';
  
  /**
   * Get user private key from backend
   */
  static async getUserPrivateKey(walletAddress: string): Promise<Keypair> {
    try {
      console.log(`🔐 Fetching private key for user: ${walletAddress}`);
      
      const response = await axios.post<PrivateKeyResponse>(
        `${this.backendUrl}/creators/user/get-key-for-token-creation`,
        { wallet_address: walletAddress },
        {
          headers: {
            'X-API-Key': this.apiKey,
            'Content-Type': 'application/json'
          },
          timeout: 15000
        }
      );
      
      if (!response.data.success || !response.data.private_key) {
        throw new Error('Failed to retrieve private key from backend');
      }
      
      // Verify wallet address matches
      if (response.data.wallet_address !== walletAddress) {
        throw new Error('Wallet address mismatch');
      }
      
      // Decode base58 private key
      const secretKey = bs58.decode(response.data.private_key);
      const keypair = Keypair.fromSecretKey(secretKey);
      
      // Verify keypair matches wallet address
      if (keypair.publicKey.toBase58() !== walletAddress) {
        throw new Error('Private key does not match wallet address');
      }
      
      console.log(`✅ Successfully retrieved private key for ${walletAddress.slice(0, 8)}...`);
      return keypair;
      
    } catch (error: any) {
      console.error(`❌ Failed to get private key for ${walletAddress}:`, error.message);
      
      if (error.response?.status === 401) {
        throw new Error('Authentication failed: Invalid API key');
      } else if (error.response?.status === 404) {
        throw new Error(`Wallet ${walletAddress} not found`);
      } else if (error.code === 'ECONNREFUSED') {
        throw new Error('Backend service unavailable');
      } else if (error.code === 'ETIMEDOUT') {
        throw new Error('Backend timeout');
      }
      
      throw new Error(`Private key retrieval failed: ${error.message}`);
    }
  }
  
  /**
   * Get bot private key from backend
   */
  static async getBotPrivateKey(
    userWallet: string,
    botWallet: string
  ): Promise<Keypair> {
    try {
      console.log(`🤖 Fetching private key for bot: ${botWallet}`);
      
      const response = await axios.post<PrivateKeyResponse>(
        `${this.backendUrl}/creators/user/get-bot-private-key`,
        {
          user_wallet: userWallet,
          bot_wallet: botWallet
        },
        {
          headers: {
            'X-API-Key': this.apiKey,
            'Content-Type': 'application/json'
          },
          timeout: 15000
        }
      );
      
      if (!response.data.success || !response.data.private_key) {
        throw new Error('Failed to retrieve bot private key from backend');
      }
      
      // Decode base58 private key
      const secretKey = bs58.decode(response.data.private_key);
      const keypair = Keypair.fromSecretKey(secretKey);
      
      // Verify keypair matches bot wallet address
      if (keypair.publicKey.toBase58() !== botWallet) {
        throw new Error('Bot private key does not match wallet address');
      }
      
      console.log(`✅ Successfully retrieved private key for bot ${botWallet.slice(0, 8)}...`);
      return keypair;
      
    } catch (error: any) {
      console.error(`❌ Failed to get bot private key for ${botWallet}:`, error.message);
      throw new Error(`Bot private key retrieval failed: ${error.message}`);
    }
  }
}


