import { Connection, Keypair, SystemProgram, PublicKey, TransactionMessage, VersionedTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { jitoBundleSender } from './jito_bundles/jito-integration';

const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC_URL, 'confirmed');

async function testJito() {
    console.log('🧪 Testing Jito Bundle Submission...');
    
    // Initialize Jito
    await jitoBundleSender.initialize();
    
    // Create a test transaction (simple transfer)
    const testKeypair = Keypair.generate();
    const { blockhash } = await connection.getLatestBlockhash();
    
    const transferIx = SystemProgram.transfer({
        fromPubkey: testKeypair.publicKey,
        toPubkey: new PublicKey('96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5'), // Jito tip account
        lamports: 1000 // Small amount
    });
    
    const messageV0 = new TransactionMessage({
        payerKey: testKeypair.publicKey,
        recentBlockhash: blockhash,
        instructions: [transferIx]
    }).compileToV0Message();
    
    const testTx = new VersionedTransaction(messageV0);
    testTx.sign([testKeypair]);
    
    // Send test bundle
    console.log('📤 Sending test bundle to Jito...');
    const result = await jitoBundleSender.sendBundle([testTx], connection);
    
    if (result.success) {
        console.log(`✅ Test bundle submitted: ${result.bundleId}`);
        console.log('⏳ Listening for bundle results (30 seconds)...');
        
        // Wait a bit to see results
        await new Promise(resolve => setTimeout(resolve, 30000));
    } else {
        console.error(`❌ Test failed: ${result.error}`);
    }
    
    console.log('🧪 Test complete!');
}

testJito().catch(console.error);


