// services/index.ts
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

// Create a master health check endpoint
const masterApp = express();
const MASTER_PORT = process.env.MASTER_PORT || 3000;

masterApp.use(express.json());

// Health check endpoint that checks both services
masterApp.get('/health', (req, res) => {
  res.json({
    status: 'master_healthy',
    services: {
      creators: 'running',
      snipers: 'running'
    },
    timestamp: new Date().toISOString()
  });
});

// Start master server
masterApp.listen(MASTER_PORT, () => {
  console.log(`🎮 Master controller running on port ${MASTER_PORT}`);
  console.log(`📡 Health endpoint: http://localhost:${MASTER_PORT}/health`);
});

// Function to start a service
function startService(serviceName: string, scriptPath: string) {
  console.log(`🚀 Starting ${serviceName} service...`);
  
  const service = spawn('ts-node', [scriptPath], {
    stdio: 'pipe',
    shell: true,
    env: { ...process.env }
  });

  // Log service output
  service.stdout.on('data', (data) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${serviceName}] ${data.toString().trim()}`);
  });

  service.stderr.on('data', (data) => {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [${serviceName} ERROR] ${data.toString().trim()}`);
  });

  service.on('close', (code) => {
    console.log(`⚠️ ${serviceName} service exited with code ${code}`);
    console.log(`🔄 Restarting ${serviceName} in 5 seconds...`);
    
    setTimeout(() => {
      startService(serviceName, scriptPath);
    }, 5000);
  });

  service.on('error', (error) => {
    console.error(`❌ Failed to start ${serviceName}:`, error);
  });

  return service;
}

// Start both services
console.log('==========================================');
console.log('🚀 Starting On-Chain Services');
console.log('==========================================');

const creatorsService = startService('creators', path.join(__dirname, '../creators/index.ts'));
// const snipersService = startService('snipers', path.join(__dirname, '../snipers/index.ts'));

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n🛑 Received SIGINT. Shutting down services...');
  creatorsService.kill();
  // snipersService.kill();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM. Shutting down services...');
  creatorsService.kill();
  // snipersService.kill();
  process.exit(0);
});

// Monitor memory usage
setInterval(() => {
  const memoryUsage = process.memoryUsage();
  const memoryMB = {
    rss: Math.round(memoryUsage.rss / 1024 / 1024),
    heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
    heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024)
  };
  
  console.log(`📊 Memory Usage: RSS ${memoryMB.rss}MB, Heap ${memoryMB.heapUsed}/${memoryMB.heapTotal}MB`);
}, 60000);


