import { AdvancedBotManager } from './AdvancedBotManager';
import { PublicKey } from '@solana/web3.js';

async function testXOAuth() {
    console.log('🚀 Testing X OAuth 1.0a Integration\n');
    
    // Initialize the bot manager
    const botManager = new AdvancedBotManager();
    
    try {
        // Test 1: Test authentication
        console.log('1️⃣ Testing authentication...');
        // We'll test through the internal method
        
        // Test 2: Test posting a simple tweet
        console.log('\n2️⃣ Testing simple tweet post...');
        
        // Create a mock mint address
        const mockMint = new PublicKey('So11111111111111111111111111111111111111112'); // SOL mint
        
        const tweetContent = `🧪 Testing X OAuth 1.0a integration\n\n` +
                           `✅ This is a test tweet from my bot\n` +
                           `✅ Testing at ${new Date().toLocaleTimeString()}\n` +
                           `#Testing #Bot #OAuth1`;
        
        const result = await botManager.postToX(tweetContent, mockMint);
        
        if (result.success) {
            console.log(`✅ Tweet posted successfully!`);
            console.log(`   Tweet ID: ${result.tweetId}`);
            console.log(`   Reach: ${result.reach}`);
        } else {
            console.log(`❌ Failed to post tweet`);
        }
        
        // Test 3: Test with image
        console.log('\n3️⃣ Testing tweet with image...');
        
        // Test with a known image URL
        const testImageUrl = 'https://picsum.photos/400/400'; // Random test image
        console.log(`   Using test image: ${testImageUrl}`);
        
        // Create mock metadata
        const mockMetadata = {
            name: 'Test Token',
            symbol: 'TEST',
            uri: testImageUrl // Use the test image
        };
        
        // Cache the metadata
        botManager.cacheTokenMetadata(mockMint, mockMetadata);
        
        // Test launch announcement
        console.log(`   Posting launch announcement...`);
        const launchResult = await botManager.postTokenLaunchAnnouncement(mockMint);
        
        if (launchResult.success) {
            console.log(`✅ Launch announcement posted successfully!`);
            console.log(`   Tweet ID: ${launchResult.tweetId}`);
        } else {
            console.log(`❌ Failed to post launch announcement`);
        }
        
    } catch (error) {
        console.error('❌ Test failed with error:', error);
    }
}

// Run the test
testXOAuth();