// global.d.ts
import { Transaction } from '@solana/web3.js';

declare global {
  interface Window {
    solana?: {
      isPhantom?: boolean;
      isConnected: boolean;
      publicKey: {
        toString: () => string;
      };
      connect: () => Promise<{ publicKey: { toString: () => string } }>;
      disconnect: () => Promise<void>;
      signTransaction: (transaction: Transaction) => Promise<Transaction>;
      on: (event: string, callback: (args: any) => void) => void;
      off: (event: string, callback: (args: any) => void) => void;
    };
  }
}

// This ensures the file is treated as a module
export {};

