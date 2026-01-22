// xOAuth1Client.ts
import OAuth from 'oauth-1.0a';
import crypto from 'crypto';
import { URLSearchParams } from 'url';

export class XOAuth1Client {
    private oauth: OAuth;
    private token: {
        key: string;
        secret: string;
    };

    constructor(
        consumerKey: string,
        consumerSecret: string,
        accessTokenKey: string,
        accessTokenSecret: string
    ) {
        this.oauth = new OAuth({
            consumer: {
                key: consumerKey,
                secret: consumerSecret
            },
            signature_method: 'HMAC-SHA1',
            hash_function: (base_string: string, key: string) => {
                return crypto
                    .createHmac('sha1', key)
                    .update(base_string)
                    .digest('base64');
            },
        });

        this.token = {
            key: accessTokenKey,
            secret: accessTokenSecret
        };
    }

    private async makeRequest(url: string, method: string, params?: Record<string, any>): Promise<any> {
        console.log(`🔍 ${method} ${url}`);
        
        // For OAuth 1.0a, we MUST use query parameters or form data, NOT JSON body
        const requestData = {
            url,
            method,
            data: params || {}
        };

        // Generate OAuth signature
        const authHeader = this.oauth.toHeader(this.oauth.authorize(requestData, this.token));
        
        const headers: HeadersInit = {
            ...authHeader,
            'User-Agent': 'FlashSnipperBot/1.0'
        };

        let finalUrl = url;
        let body: string | undefined;
        
        if (params && Object.keys(params).length > 0) {
            if (method === 'GET') {
                // For GET, add to URL
                const queryParams = new URLSearchParams(params);
                finalUrl = `${url}?${queryParams.toString()}`;
            } else {
                // For POST, use form data (NOT JSON!)
                const formData = new URLSearchParams();
                Object.entries(params).forEach(([key, value]) => {
                    if (Array.isArray(value)) {
                        // Handle arrays
                        formData.append(key, value.join(','));
                    } else if (typeof value === 'object') {
                        // Handle objects (stringify)
                        formData.append(key, JSON.stringify(value));
                    } else {
                        formData.append(key, value.toString());
                    }
                });
                body = formData.toString();
                headers['Content-Type'] = 'application/x-www-form-urlencoded';
            }
        }

        console.log(`📝 Using form data: ${body ? body.substring(0, 100) + '...' : 'none'}`);

        const response = await fetch(finalUrl, {
            method,
            headers,
            body
        });

        const responseText = await response.text();
        console.log(`🔍 Status: ${response.status}`);
        
        if (!response.ok) {
            console.error(`❌ Error: ${responseText}`);
            throw new Error(`HTTP ${response.status}: ${responseText}`);
        }

        return responseText ? JSON.parse(responseText) : {};
    }

    async postTweet(text: string, mediaIds?: string[]): Promise<string> {
        console.log(`🐦 Posting: "${text.substring(0, 50)}..."`);
        
        // Use v1.1 API - it works better with OAuth 1.0a
        const params: Record<string, any> = {
            status: text
        };

        if (mediaIds && mediaIds.length > 0) {
            params.media_ids = mediaIds.join(',');
        }

        console.log(`📝 Params:`, params);

        try {
            const response = await this.makeRequest(
                'https://api.x.com/1.1/statuses/update.json',
                'POST',
                params
            );

            console.log(`✅ Tweet posted! ID: ${response.id_str}`);
            console.log(`🔗 https://x.com/i/status/${response.id_str}`);
            return response.id_str;
            
        } catch (error) {
            console.error(`❌ Failed to post tweet:`, error);
            throw error;
        }
    }

    async uploadMedia(imageBuffer: Buffer, mimeType: string): Promise<string> {
        console.log(`⬆️ Uploading ${mimeType} (${imageBuffer.length} bytes)...`);
        
        // Use v1.1 chunked upload (most reliable)
        
        // Step 1: INIT
        const initResponse = await this.makeRequest(
            'https://upload.x.com/1.1/media/upload.json',
            'POST',
            {
                command: 'INIT',
                total_bytes: imageBuffer.length,
                media_type: mimeType,
                media_category: 'tweet_image'
            }
        );

        const mediaId = initResponse.media_id_string;
        console.log(`📦 Init: ${mediaId}`);

        // Step 2: APPEND in chunks
        const chunkSize = 1024 * 1024; // 1MB chunks
        let segmentIndex = 0;

        for (let i = 0; i < imageBuffer.length; i += chunkSize) {
            const chunk = imageBuffer.slice(i, i + chunkSize);
            const base64Chunk = chunk.toString('base64');

            await this.makeRequest(
                'https://upload.x.com/1.1/media/upload.json',
                'POST',
                {
                    command: 'APPEND',
                    media_id: mediaId,
                    media_data: base64Chunk,
                    segment_index: segmentIndex
                }
            );

            segmentIndex++;
            console.log(`📊 Chunk ${segmentIndex} uploaded`);
        }

        // Step 3: FINALIZE
        const finalizeResponse = await this.makeRequest(
            'https://upload.x.com/1.1/media/upload.json',
            'POST',
            {
                command: 'FINALIZE',
                media_id: mediaId
            }
        );

        console.log(`✅ Media uploaded: ${mediaId}`);
        return mediaId;
    }

    async likeTweet(tweetId: string): Promise<void> {
        // Likes work with v2 API
        const userId = await this.getUserId();
        
        // For v2, we need to use JSON body
        await fetch(`https://api.x.com/2/users/${userId}/likes`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${await this.getBearerToken()}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                tweet_id: tweetId
            })
        });
        
        console.log(`❤️ Liked tweet ${tweetId}`);
    }

    async getUserId(): Promise<string> {
        const response = await this.makeRequest(
            'https://api.x.com/2/users/me',
            'GET'
        );
        
        return response.data.id;
    }

    private async getBearerToken(): Promise<string> {
        // Get App-Only Bearer token for v2 endpoints that need it
        const auth = btoa(`${process.env.X_CONSUMER_KEY!}:${process.env.X_CONSUMER_SECRET!}`);
        
        const response = await fetch('https://api.x.com/oauth2/token', {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
            },
            body: 'grant_type=client_credentials'
        });
        
        const data = await response.json();
        return data.access_token;
    }
}