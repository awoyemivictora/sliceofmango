require('dotenv').config();
import Client, {
  CommitmentLevel,
  SubscribeRequest,
} from "@triton-one/yellowstone-grpc";
import { PUMP_FUN_PROGRAM_ID, PUMPFUN_MINT_AUTHORITY } from "../utils/type";
import { TransactionFormatter } from "../utils/transaction-formatter";
import { parseSwapTransactionOutput } from "../utils/pumpfun_formatted_txn";
import { PumpFunDecoder } from "../utils/decode-parser";
import { PerformanceMonitor } from '../performance-monitor';
import axios from 'axios';
import WebSocket from 'ws';
import { sniperEngine, immediateTokenSniping } from "./sniper-engine";

if (!global.WebSocket) {
    global.WebSocket = WebSocket as any;
}

interface PumpFunTransactionOutput {
  Name: string;
  Symbol: string;
  Uri: string;
  Mint: string;
  Bonding_Curve: string;
  Creator: string;
  VirtualTokenReserves: string;
  VirtualSolReserves: string;
  RealTokenReserves: string;
  TokenTotalSupply: string;
}

const TXN_FORMATTER = new TransactionFormatter();
const pumpFunDecoder = new PumpFunDecoder();
const perfMonitor = new PerformanceMonitor();

class TokenSnipingController {
  private isDetecting = true;
  private isProcessing = false;
  private lastProcessedTime = 0;
  private readonly PROCESS_COOLDOWN = 10 * 60 * 1000; // 10 minutes
  private currentToken: any = null;
  
  async detectAndProcessToken(tokenData: any): Promise<void> {
    if (!this.isDetecting) {
      console.log(`⏭️ Detection paused, waiting for cooldown...`);
      return;
    }
    
    if (this.isProcessing) {
      console.log(`⏭️ Already processing a token, skipping detection...`);
      return;
    }
    
    const now = Date.now();
    const timeSinceLastProcess = now - this.lastProcessedTime;
    
    if (timeSinceLastProcess < this.PROCESS_COOLDOWN) {
      const waitTime = Math.ceil((this.PROCESS_COOLDOWN - timeSinceLastProcess) / 1000);
      console.log(`⏳ Waiting ${waitTime}s until next token...`);
      return;
    }
    
    this.isDetecting = false;
    this.isProcessing = true;
    this.currentToken = tokenData;
    
    try {
      // console.log(`\n🔥🔥🔥 DETECTED NEW PUMP.FUN TOKEN! 🔥🔥🔥`);
      console.log(`🎯 Detected Token: ${tokenData.Name} (${tokenData.Mint})`);
      // console.log(`⏰ Time: ${new Date().toISOString()}`);
      // console.log(`👥 Sniping for ALL connected users...\n`);
      
      const result = await immediateTokenSniping(tokenData);
      
      if (result.success) {
        console.log(`✅✅✅ SNIPE SUCCESSFUL!`);
        console.log(`📦 Bundle ID: ${result.bundleId ? result.bundleId.slice(0, 16) + '...' : 'N/A'}`);
        console.log(`👥 Users: ${result.users.length}`);
      } else {
        console.log(`❌ SNIPE FAILED: ${result.error}`);
      }
      
      this.lastProcessedTime = Date.now();
      this.currentToken = null;
      
    } catch (error: any) {
      console.error(`❌ Token processing error:`, error.message);
      this.currentToken = null;
    } finally {
      this.isProcessing = false;
      
      console.log(`\n⏱️ Starting 10-minute cooldown...`);
      console.log(`📊 Next token detection at: ${new Date(Date.now() + this.PROCESS_COOLDOWN).toISOString()}`);
      
      setTimeout(() => {
        this.isDetecting = true;
        console.log(`\n🔍 Cooldown complete! Ready to detect next token...`);
      }, this.PROCESS_COOLDOWN);
    }
  }
  
  getStatus() {
    const now = Date.now();
    const timeSinceLastProcess = now - this.lastProcessedTime;
    const timeRemaining = Math.max(0, this.PROCESS_COOLDOWN - timeSinceLastProcess);
    
    return {
      isDetecting: this.isDetecting,
      isProcessing: this.isProcessing,
      lastProcessedTime: this.lastProcessedTime,
      lastProcessedFormatted: new Date(this.lastProcessedTime).toISOString(),
      timeSinceLastProcess: timeSinceLastProcess,
      cooldownRemaining: timeRemaining,
      cooldownRemainingFormatted: `${Math.floor(timeRemaining / 60000)}m ${Math.floor((timeRemaining % 60000) / 1000)}s`,
      nextDetectionTime: this.lastProcessedTime + this.PROCESS_COOLDOWN,
      nextDetectionFormatted: new Date(this.lastProcessedTime + this.PROCESS_COOLDOWN).toISOString(),
      currentToken: this.currentToken ? {
        symbol: this.currentToken.Symbol,
        name: this.currentToken.Name,
        mint: this.currentToken.Mint?.slice(0, 8) + '...'
      } : null
    };
  }
}

const tokenController = new TokenSnipingController();

async function handleStream(client: Client, args: SubscribeRequest) {
  // console.log('🚀 ULTRA-FAST INSTANT SNIPER ENGINE STARTED');
  // console.log('🔥 One token at a time processing');
  // console.log('⚡ Instant snipe for ALL connected users');
  // console.log('⏱️  10-minute cooldown after each snipe');
  // console.log('🎯 Detection: ACTIVE\n');
  
  const stream = await client.subscribe();

  const streamClosed = new Promise<void>((resolve, reject) => {
    stream.on("error", (error) => {
      console.log("GRPC Stream Error:", error);
      reject(error);
      stream.end();
    });
    stream.on("end", () => {
      console.log("GRPC Stream Ended");
      resolve();
    });
    stream.on("close", () => {
      console.log("GRPC Stream Closed");
      resolve();
    });
  });

  stream.on("data", async (data) => {
    if (data?.transaction) {
        const startTime = performance.now();
        
        try {
            const txn = TXN_FORMATTER.formTransactionFromJson(
                data.transaction,
                Date.now(),
            );
            
            const signature = txn.transaction.signatures[0];
            
            const parsedTxn = pumpFunDecoder.decodePumpFunTxn(txn);
            if (!parsedTxn) return;
            
            const parsedPumpfunTxn = parseSwapTransactionOutput(parsedTxn) as PumpFunTransactionOutput | undefined;
            if (!parsedPumpfunTxn) return;
            
            const tokenData = {
                ...parsedPumpfunTxn,
                signature: signature,
                timestamp: new Date().toISOString()
            };
            
            const processingTime = performance.now() - startTime;
            perfMonitor.recordMetric('snipeTimes', processingTime);
            
            console.log(`⚡ DETECTED: ${tokenData.Symbol} - ${tokenData.Name} (${processingTime.toFixed(0)}ms)`);
            
            await tokenController.detectAndProcessToken(tokenData);
            
        } catch (error) {
            console.error('Error processing transaction:', error);
        }
    }
  });

  await new Promise<void>((resolve, reject) => {
    stream.write(args, (err: any) => {
      if (err === null || err === undefined) {
        resolve();
      } else {
        reject(err);
      }
    });
  }).catch((reason) => {
    console.error(reason);
    throw reason;
  });

  await streamClosed;
}

// async function periodicBackendReporting() {
//   try {
//     // const health = sniperEngine.getHealthStatus();
//     const controllerStatus = tokenController.getStatus();
//     const performanceReport = perfMonitor.getPerformanceReport();
    
//     const reportData = {
//       timestamp: new Date().toISOString(),
//       engine: {
//         healthScore: health.healthScore,
//         activeUsers: health.activeUsers,
//         successfulSnipes: health.stats.successfulSnipes,
//         totalSnipes: health.stats.totalSnipes,
//         successRate: health.stats.totalSnipes > 0 
//           ? (health.stats.successfulSnipes / health.stats.totalSnipes * 100).toFixed(1)
//           : 0
//       },
//       controller: {
//         isDetecting: controllerStatus.isDetecting,
//         isProcessing: controllerStatus.isProcessing,
//         lastProcessedTime: controllerStatus.lastProcessedFormatted,
//         cooldownRemaining: controllerStatus.cooldownRemainingFormatted,
//         nextDetection: controllerStatus.nextDetectionFormatted
//       },
//       performance: {
//         avgSnipeTime: performanceReport.averages.snipeTime.toFixed(1),
//         uptime: Math.floor(process.uptime() / 60)
//       }
//     };

//     await axios.post(`${process.env.BACKEND_URL}/monitor/engine-report`, reportData, {
//       headers: {
//         'X-API-Key': process.env.ONCHAIN_API_KEY,
//         'Content-Type': 'application/json'
//       },
//       timeout: 3000
//     });
    
//     console.log(`📊 Backend report sent successfully`);
    
//   } catch (error: any) {
//     if (error.code === 'ECONNREFUSED') {
//       console.log('⚠️ Backend unreachable, will retry later');
//     } else {
//       console.error('❌ Backend reporting error:', error.message);
//     }
//   }
// }

import express from 'express';
const app = express();
app.use(express.json());

// app.get('/health', (req, res) => {
//     try {
//         const health = sniperEngine.getHealthStatus();
//         const controllerStatus = tokenController.getStatus();
//         const memory = process.memoryUsage();
        
//         res.json({
//             status: 'ok',
//             engine: {
//                 healthScore: health.healthScore,
//                 activeUsers: health.activeUsers,
//                 cachedKeypairs: health.cachedKeypairs,
//                 successfulSnipes: health.stats.successfulSnipes,
//                 totalSnipes: health.stats.totalSnipes,
//                 lastSnipeTime: health.stats.lastSnipeTime ? new Date(health.stats.lastSnipeTime).toISOString() : null
//             },
//             controller: controllerStatus,
//             system: {
//                 uptime: Math.floor(process.uptime()),
//                 memoryUsageMB: {
//                     rss: Math.floor(memory.rss / 1024 / 1024),
//                     heapTotal: Math.floor(memory.heapTotal / 1024 / 1024),
//                     heapUsed: Math.floor(memory.heapUsed / 1024 / 1024)
//                 }
//             },
//             timestamp: new Date().toISOString()
//         });
//     } catch (error: any) {
//         res.status(500).json({ error: 'Health check failed', message: error.message });
//     }
// });

// app.get('/status', (req, res) => {
//     try {
//         const controllerStatus = tokenController.getStatus();
//         res.json(controllerStatus);
//     } catch (error: any) {
//         res.status(500).json({ error: 'Status check failed', message: error.message });
//     }
// });

// app.get('/performance', (req, res) => {
//     try {
//         const performanceReport = perfMonitor.getPerformanceReport();
//         res.json(performanceReport);
//     } catch (error: any) {
//         res.status(500).json({ error: 'Performance report failed', message: error.message });
//     }
// });

// app.post('/reset-cooldown', (req, res) => {
//     const { apiKey } = req.body;
//     if (apiKey !== process.env.ONCHAIN_API_KEY) {
//         return res.status(401).json({ error: 'Unauthorized' });
//     }
    
//     const status = tokenController.getStatus();
    
//     res.json({ 
//         status: 'cooldown_reset',
//         message: 'Next token can be detected immediately',
//         previousNextDetection: status.nextDetectionFormatted
//     });
// });

// app.post('/emergency-stop', (req, res) => {
//     const { apiKey } = req.body;
//     if (apiKey !== process.env.ONCHAIN_API_KEY) {
//         return res.status(401).json({ error: 'Unauthorized' });
//     }
    
//     sniperEngine.emergencyStop();
//     res.json({ status: 'emergency_stop_initiated', timestamp: new Date().toISOString() });
// });

// const PORT = process.env.HEALTH_PORT || 3001;
// app.listen(PORT, () => {
//     console.log(`📊 Health monitor listening on port ${PORT}`);
// });

async function subscribeCommand(client: Client, args: SubscribeRequest) {
    setInterval(() => {
        // periodicBackendReporting().catch(console.error);
    }, 60000);

    while (true) {
        try {
            console.log('\n🔄 Starting stream subscription...');
            await handleStream(client, args);
        } catch (error: any) {
            console.error("Stream error:", error.message);
            console.log("🔄 Restarting stream in 5 seconds...");
            await new Promise((resolve) => setTimeout(resolve, 5000));
        }
    }
}

const client = new Client(
    process.env.GRPC_URL!,
    process.env.X_TOKEN!,
    undefined,
);

const req: SubscribeRequest = {
    accounts: {},
    slots: {},
    transactions: {
        pumpFun: {
            vote: false,
            failed: false,
            signature: undefined,
            accountInclude: [PUMPFUN_MINT_AUTHORITY.toBase58()],
            accountExclude: [],
            accountRequired: [],
        },
    },
    transactionsStatus: {},
    entry: {},
    blocks: {},
    blocksMeta: {},
    accountsDataSlice: [],
    ping: undefined,
    // commitment: CommitmentLevel.CONFIRMED,
    commitment: CommitmentLevel.PROCESSED,
};

subscribeCommand(client, req).catch(console.error);


