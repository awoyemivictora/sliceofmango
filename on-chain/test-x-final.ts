// test-x-final.ts
import * as dotenv from 'dotenv';
import OAuth from 'oauth-1.0a';
import crypto from 'crypto';

import { XOAuth1Client } from './creators/xOAuth1Client';

dotenv.config();


async function testDirectCurl() {
    console.log('🧪 Testing with direct curl-like approach\n');
    
    // Use the exact curl example from X docs
    const consumerKey = process.env.X_CONSUMER_KEY!;
    const consumerSecret = process.env.X_CONSUMER_SECRET!;
    const accessToken = process.env.X_ACCESS_TOKEN!;
    const accessTokenSecret = process.env.X_ACCESS_TOKEN_SECRET!;
    
    console.log('1️⃣ Testing OAuth 1.0a signature generation...');
    
    const OAuth = require('oauth-1.0a');
    const crypto = require('crypto');
    
    const oauth = new OAuth({
        consumer: { key: consumerKey, secret: consumerSecret },
        signature_method: 'HMAC-SHA1',
        hash_function: (base_string: string, key: string) => {
            return crypto.createHmac('sha1', key).update(base_string).digest('base64');
        },
    });
    
    const token = { key: accessToken, secret: accessTokenSecret };
    
    // Test with simple status
    const status = 'Hello from FlashSnipper at ' + new Date().toLocaleTimeString();
    
    const requestData = {
        url: 'https://api.x.com/1.1/statuses/update.json',
        method: 'POST',
        data: { status }
    };
    
    const authHeader = oauth.toHeader(oauth.authorize(requestData, token));
    
    console.log('2️⃣ Making request...');
    
    // Use form data (x-www-form-urlencoded)
    const formData = new URLSearchParams();
    formData.append('status', status);
    
    const response = await fetch(requestData.url, {
        method: 'POST',
        headers: {
            ...authHeader,
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'FlashSnipperBot/1.0'
        },
        body: formData.toString()
    });
    
    const responseText = await response.text();
    console.log(`Status: ${response.status}`);
    console.log(`Response: ${responseText}`);
    
    if (response.ok) {
        const data = JSON.parse(responseText);
        console.log(`✅ SUCCESS! Tweet posted!`);
        console.log(`Tweet ID: ${data.id_str}`);
        console.log(`Link: https://x.com/i/status/${data.id_str}`);
        console.log(`Text: ${data.text}`);
    } else {
        console.error('❌ Failed:', responseText);
    }
}

testDirectCurl();