import base64
from datetime import datetime, timedelta
import time
from fastapi import APIRouter, File, HTTPException, UploadFile, Query
from typing import Any, Dict, List, Optional
import logging
import httpx
from app.schemas.creators.openai import Attribute, BatchMetadataRequest, BatchMetadataResponse, MetadataRequest, SimpleMetadataResponse, TokenMetadata
from openai import OpenAI
import json 
from app.config import settings
import asyncio
from app.services.cloudflare_r2 import r2_service
from app.services.ipfs_service import ipfs_service
import aiohttp
import re

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/ai",
    tags=['ai']
)

# Initialize OpenAI client with modern SDK
client = OpenAI(
    api_key=settings.OPENAI_API_KEY,
    timeout=30.0,    # 30 second timeout
    max_retries=3,  # Retry failed requests
)

# ===================== SIMPLIFIED X TREND ANALYZER ====================


class SimpleXAnalyzer:
    """Simplified X analyzer that just gets trending topics for token creation"""
    
    def __init__(self):
        self.session = None
        self.bearer_token = getattr(settings, 'X_BEARER_TOKEN', '')
    
    async def get_session(self):
        if not self.session:
            self.session = aiohttp.ClientSession()
        return self.session
    
    async def close_session(self):
        if self.session:
            await self.session.close()
    
    async def get_usa_trending_for_tokens(self) -> List[Dict]:
        """
        Get trending USA topics with images for token creation
        Focuses on crypto, politics, influencers, viral topics
        """
        try:
            if not self.bearer_token:
                logger.warning("No X bearer token configured")
                return []
            
            session = await self.get_session()
            
            # SEARCH 1: Get trending crypto/meme coin tweets WITH IMAGES
            crypto_trends = await self._search_trending_tweets_with_media(
                session, 
                "crypto OR bitcoin OR ethereum OR solana OR memecoin OR doge OR shib",
                max_results=15
            )
            
            # SEARCH 2: Get trending USA politics/news WITH IMAGES
            usa_trends = await self._search_trending_tweets_with_media(
                session,
                "USA OR America OR election OR politics lang:en",
                max_results=10
            )
            
            # SEARCH 3: Get trending influencers/celebrities WITH IMAGES
            influencer_trends = await self._search_trending_tweets_with_media(
                session,
                "elon musk OR mrbeast OR influencer OR celebrity",
                max_results=10
            )
            
            # Combine all trends
            all_trends = crypto_trends + usa_trends + influencer_trends
            
            # Remove duplicates and sort by engagement
            unique_trends = {}
            for trend in all_trends:
                key = trend['text'][:50]  # First 50 chars as key
                if key not in unique_trends:
                    unique_trends[key] = trend
            
            # Sort by engagement (likes + retweets)
            sorted_trends = sorted(
                unique_trends.values(),
                key=lambda x: x['engagement_score'],
                reverse=True
            )
            
            # logger.info(f"✅ Found {len(sorted_trends)} trending topics WITH ACTUAL IMAGES for token creation")
            
            # Log the first few trends with their image URLs
            for i, trend in enumerate(sorted_trends[:3]):
                logger.info(f"  Trend {i+1}: {trend['text'][:50]}... (image: {trend.get('image_url', 'NO IMAGE!')})")
            
            return sorted_trends[:10]  # Return top 10
            
        except Exception as e:
            logger.error(f"Failed to get trending topics: {e}")
            return []
    
    async def _search_trending_tweets_with_media(self, session, query: str, max_results: int = 10) -> List[Dict]:
        """Search for trending tweets with media/images - ONLY INCLUDE TWEETS WITH ACTUAL IMAGES"""
        try:
            url = "https://api.x.com/2/tweets/search/recent"
            
            headers = {
                'Authorization': f'Bearer {self.bearer_token}',
                'Content-Type': 'application/json'
            }
            
            # DEBUG: Log the query
            # logger.info(f"Searching tweets with query: {query}")

            # Use a query that's more likely to return images
            # Using both has:images and has:media for better results
            params = {
                'query': f"{query} has:images -is:retweet",
                'max_results': min(max_results, 100),
                'tweet.fields': 'text,created_at,public_metrics,attachments',
                'media.fields': 'url,preview_image_url,type,media_key,height,width,variants',
                'expansions': 'author_id,attachments.media_keys',
                'user.fields': 'username,name,verified'
            }
            
            async with session.get(url, headers=headers, params=params, timeout=15) as response:
                if response.status == 200:
                    data = await response.json()
                    
                    tweets = []
                    tweet_data = data.get('data', [])
                    users = {user['id']: user for user in data.get('includes', {}).get('users', [])}
                    media_items = data.get('includes', {}).get('media', [])
                    
                    # DEBUG: Log raw media items
                    logger.info(f"Raw media items: {json.dumps(media_items, indent=2)}")

                    # Create a dictionary of media by media_key
                    media = {}
                    for media_item in media_items:
                        media_key = media_item.get('media_key')
                        if media_key:
                            media[media_key] = media_item
                    
                    # logger.info(f"Found {len(tweet_data)} tweets and {len(media)} media items")
                    
                    for tweet in tweet_data:
                        user_id = tweet.get('author_id')
                        user = users.get(user_id, {})
                        
                        metrics = tweet.get('public_metrics', {})
                        engagement_score = (
                            metrics.get('like_count', 0) * 1 +
                            metrics.get('retweet_count', 0) * 2 +
                            metrics.get('reply_count', 0) * 3
                        )
                        
                        # logger.info(f"Tweet engagement - likes: {metrics.get('like_count', 0)}, retweets: {metrics.get('retweet_count', 0)}, replies: {metrics.get('reply_count', 0)}, score: {engagement_score}")
                        
                        # DEBUG: Log tweet details
                        tweet_text_short = tweet.get('text', '')[:50]
                        # logger.info(f"Processing tweet: '{tweet_text_short}...'")

                        # Extract image URL if tweet has media
                        image_url = None
                        attachments = tweet.get('attachments', {})
                        media_keys = attachments.get('media_keys', [])
                        
                        # logger.info(f"Tweet has media_keys: {media_keys}")

                        # Check if ANY of the media items is a photo
                        has_photo = False
                        for media_key in media_keys:
                            media_item = media.get(media_key)
                            if media_item and media_item.get('type') == 'photo':
                                has_photo = True
                                break
                        
                        # logger.info(f"Tweet has photo: {has_photo}")
                        
                        # If tweet doesn't have any photos, skip it
                        if not has_photo:
                            # logger.info(f"Skipping tweet - no photos")
                            continue
                        
                        # Now extract the actual image URL
                        for media_key in media_keys:
                            media_item = media.get(media_key)
                            if media_item and media_item.get('type') == 'photo':
                                # First try to get the URL directly
                                image_url = media_item.get('url')
                                preview_url = media_item.get('preview_image_url')
                                
                                # logger.info(f"Photo URL: {image_url}")
                                # logger.info(f"Preview URL: {preview_url}")

                                # If no direct URL, try preview_image_url
                                if not image_url:
                                    image_url = media_item.get('preview_image_url')
                                
                                # If still no URL, check variants (for different quality/size)
                                if not image_url and 'variants' in media_item:
                                    variants = media_item.get('variants', [])
                                    for variant in variants:
                                        if variant.get('content_type', '').startswith('image/'):
                                            image_url = variant.get('url')
                                            if image_url:
                                                # logger.info(f"Found variant URL: {image_url}")
                                                break
                                
                                # If we have a media_key but no URL, construct a Twitter URL
                                if not image_url and media_key:
                                    # Common Twitter image URL pattern
                                    image_url = f"https://pbs.twimg.com/media/{media_key}?format=jpg&name=large"
                                    # logger.info(f"Constructed URL: {image_url}")
                                    
                                if image_url:
                                    # logger.info(f"Found image URL for tweet: {image_url}")
                                    # logger.info(f"✅ FINAL image URL for tweet: {image_url}")
                                    break
                        
                        # Only include tweets with decent engagement AND an image URL
                        # if engagement_score >= 1 and image_url:
                        if image_url:
                            tweets.append({
                                'text': tweet.get('text', ''),
                                'created_at': tweet.get('created_at', ''),
                                'user': {
                                    'username': user.get('username', ''),
                                    'name': user.get('name', ''),
                                    'verified': user.get('verified', False)
                                },
                                'metrics': metrics,
                                'engagement_score': engagement_score,
                                'image_url': image_url,  # This should NOT be None now
                                'source': 'twitter_search'
                            })
                            logger.info(f"✅ Added tweet with image URL: {image_url[:100]}...")
                        else:
                            logger.info(f"❌ Skipped tweet - engagement_score: {engagement_score}, image_url: {image_url}")
                    
                    # Log how many tweets we actually found with images
                    # logger.info(f"✅ Found {len(tweets)} tweets with actual images")
                    return tweets
                else:
                    error_text = await response.text()
                    logger.warning(f"Twitter search API error: {response.status} - {error_text}")
                    return []
                
        except Exception as e:
            logger.error(f"Twitter search error: {e}", exc_info=True)
            return []
        
    def extract_token_ideas(self, tweet_text: str) -> Dict[str, List[str]]:
        """Extract token name and symbol ideas from tweet text"""
        import re
        
        # Clean text
        clean_text = re.sub(r'https?://\S+|@\w+|#\w+', '', tweet_text)
        clean_text = re.sub(r'\s+', ' ', clean_text).strip()
        
        # Get words
        words = re.findall(r'\b[A-Z][a-z]*\b|\b[a-z]{3,}\b', clean_text)
        
        # Extract potential token names
        token_names = []
        
        # Try to find noun phrases (simple approach)
        for i in range(len(words) - 1):
            if words[i].istitle() and words[i+1].istitle():
                token_names.append(f"{words[i]}{words[i+1]}")
        
        # Add single capitalized words
        capitalized = [w for w in words if w.istitle() and len(w) > 2]
        token_names.extend(capitalized)
        
        # Generate symbols
        symbols = []
        for name in token_names[:3]:
            # Take first 3-4 letters for symbol
            clean_name = re.sub(r'[^a-zA-Z]', '', name)
            if len(clean_name) >= 3:
                symbols.append(clean_name[:4].upper())
        
        # Add common meme coin symbols if tweet is about memes
        if any(word in clean_text.lower() for word in ['meme', 'doge', 'pepe', 'shib']):
            symbols.extend(['PEPE', 'DOGE', 'BONK', 'WIF'])
        
        # Remove duplicates
        token_names = list(set(token_names))[:5]
        symbols = list(set(symbols))[:5]
        
        return {
            'names': token_names,
            'symbols': symbols,
            'context': clean_text[:100]  # First 100 chars for context
        }
    
    def _categorize_trend(self, text: str) -> str:
        """Categorize trend based on content"""
        text_lower = text.lower()
        
        if any(word in text_lower for word in ['crypto', 'bitcoin', 'ethereum', 'solana', 'memecoin']):
            return 'crypto'
        elif any(word in text_lower for word in ['election', 'trump', 'biden', 'politics', 'usa']):
            return 'politics'
        elif any(word in text_lower for word in ['elon', 'mrbeast', 'influencer', 'celebrity']):
            return 'influencer'
        elif any(word in text_lower for word in ['meme', 'doge', 'pepe', 'funny']):
            return 'meme'
        else:
            return 'viral'



# Initialize simple analyzer
simple_x_analyzer = SimpleXAnalyzer()

# ===================== HELPER FUNCTIONS (outside class) ====================

def categorize_trend(text: str) -> str:
    """Categorize trend based on content - standalone function for endpoints"""
    text_lower = text.lower()
    
    if any(word in text_lower for word in ['crypto', 'bitcoin', 'ethereum', 'solana', 'memecoin']):
        return 'crypto'
    elif any(word in text_lower for word in ['election', 'trump', 'biden', 'politics', 'usa']):
        return 'politics'
    elif any(word in text_lower for word in ['elon', 'mrbeast', 'influencer', 'celebrity']):
        return 'influencer'
    elif any(word in text_lower for word in ['meme', 'doge', 'pepe', 'funny']):
        return 'meme'
    else:
        return 'viral'


async def download_and_upload_to_ipfs(image_url: str) -> Optional[str]:
    """
    Download image from URL and upload to IPFS
    """
    try:
        if not image_url:
            logger.warning("No image URL provided")
            return None
        
        # logger.info(f"Attempting to download image from: {image_url}")
        
        # Headers to mimic a browser
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
        }
        
        # Add referer for Twitter URLs
        if 'twimg.com' in image_url or 'twitter.com' in image_url:
            headers['Referer'] = 'https://twitter.com/'
        
        async with aiohttp.ClientSession(headers=headers) as session:
            async with session.get(image_url, timeout=15) as resp:
                if resp.status == 200:
                    image_data = await resp.read()
                    
                    # Check if it's a valid image
                    content_length = len(image_data)
                    content_type = resp.headers.get('Content-Type', '')
                    
                    # logger.info(f"✅ Successfully downloaded image: {content_length} bytes, {content_type}")
                    
                    if content_length < 1024:
                        logger.warning(f"Image too small: {content_length} bytes")
                        return None
                    
                    # Save the image temporarily and upload to IPFS
                    timestamp = int(time.time())
                    
                    # Use the correct method from ipfs_service
                    image_cid = await ipfs_service.pin_file_from_url(image_url, f"x_trend_image_{timestamp}")
                    
                    if image_cid:
                        ipfs_url = f"ipfs://{image_cid}"
                        # logger.info(f"✅ Successfully uploaded tweet image to IPFS: {image_cid}")
                        return ipfs_url
                    else:
                        logger.warning("Failed to upload image to IPFS")
                        # Return the original URL as fallback
                        return image_url
                else:
                    logger.warning(f"Failed to download image: HTTP {resp.status}")
                    return None
                    
    except Exception as e:
        logger.error(f"Failed to process image: {e}", exc_info=True)
        return None
      
# ===================== SIMPLIFIED ENDPOINTS ====================

@router.get("/trending-for-tokens")
async def get_trending_for_tokens():
    """
    Get trending topics specifically for token creation
    Simple endpoint that just returns trending topics
    """
    try:
        trends = await simple_x_analyzer.get_usa_trending_for_tokens()
        
        if not trends:
            return {
                "success": False,
                "message": "No trending topics found. Check your X API token.",
                "trends": []
            }
        
        # Extract token ideas from each trend
        analyzed_trends = []
        for trend in trends[:8]:  # Top 8 trends
            token_ideas = simple_x_analyzer.extract_token_ideas(trend['text'])
            
            analyzed_trends.append({
                'trend_text': trend['text'][:200],  # First 200 chars
                'user': trend['user']['username'],
                'engagement': trend['engagement_score'],
                'created_at': trend['created_at'],
                'token_ideas': token_ideas,
                'category': categorize_trend(trend['text'])  # Use standalone function
            })
        
        return {
            "success": True,
            "trends": analyzed_trends,
            "count": len(analyzed_trends),
            "timestamp": datetime.utcnow().isoformat()
        }
    
    except Exception as e:
        logger.error(f"Trending for tokens error: {e}")
        return {
            "success": False,
            "error": str(e),
            "trends": []
        }

@router.post("/generate-from-trending")
async def generate_metadata_from_trending(
    use_x_image: bool = True,
    style: str = "trending"
):
    """
    ONE-CLICK endpoint: Generate token metadata from trending topics
    This is what your frontend button should call
    """
    try:
        # logger.info("Generating metadata from trending topics...")
        
        # Step 1: Get trending topics WITH IMAGES
        trends = await simple_x_analyzer.get_usa_trending_for_tokens()
        
        if not trends:
            # Fallback to AI-only generation
            logger.warning("No trending topics found, using AI-only generation")
            metadata_request = MetadataRequest(
                keywords="viral crypto meme token",
                style=style,
                category="meme",
                use_dalle=False  # No DALL-E, use placeholder
            )
            return await generate_metadata(metadata_request)
        
        # Step 2: Find a trend WITH AN IMAGE (skip ones without images)
        selected_trend = None
        
        # Only use trends that actually have image URLs
        trends_with_images = [t for t in trends if t.get('image_url')]
        
        if use_x_image:
            if trends_with_images:
                # Use the trend with highest engagement that has an image
                selected_trend = trends_with_images[0]
                # logger.info(f"✅ Selected trend with image: {selected_trend['image_url'][:100]}...")
            else:
                logger.warning("⚠️ No trends with images found at all! Will use placeholder")
                selected_trend = trends[0]  # Fallback to top trend
        else:
            # If user doesn't want X images, just take the top trend
            selected_trend = trends[0]
        
        trend_text = selected_trend['text']
        engagement = selected_trend['engagement_score']
        tweet_image_url = selected_trend.get('image_url')
        
        # logger.info(f"Using trend: {trend_text[:100]}... (engagement: {engagement})")
        
        # Log whether we found an image
        if tweet_image_url:
            # logger.info(f"✅ Found tweet image: {tweet_image_url}")
            image_available = True
        else:
            logger.info("❌ No image available for this tweet")
            image_available = False
        
        # Step 3: Extract token ideas from trend
        token_ideas = simple_x_analyzer.extract_token_ideas(trend_text)
        
        # Step 4: Download image if available AND user wants it
        downloaded_image_url = None
        
        if use_x_image and tweet_image_url and image_available:
            try:
                # logger.info(f"Downloading and uploading tweet image: {tweet_image_url}")
                
                # Use the working pin_file_from_url method
                image_cid = await ipfs_service.pin_file_from_url(
                    tweet_image_url, 
                    f"trend_image_{int(time.time())}"
                )
                
                if image_cid:
                    # Convert to HTTP URL instead of ipfs:// URL
                    downloaded_image_url = ipfs_service.public_gateway_url.format(cid=image_cid)
                    # logger.info(f"✅ Uploaded tweet image to IPFS: {downloaded_image_url}")
                else:
                    logger.warning("Failed to upload image to IPFS, will use placeholder")
            except Exception as e:
                logger.error(f"Failed to process tweet image: {e}")
        elif not tweet_image_url and use_x_image:
            logger.info("Tweet has no image, will use placeholder")
        
 
        # Step 5: Create metadata request with trend context
        metadata_request = MetadataRequest(
            keywords=f"{token_ideas['context']}, trending, viral",
            style=style,
            category="meme",  # Default to meme for trending tokens
            theme=f"Token based on trending topic: {trend_text[:50]}...",
            use_dalle=False,  # ALWAYS set to False - we're using X images or placeholders
            existing_image=downloaded_image_url,  # This could be ipfs:// URL or None
            trend_context=f"Trending on X: {trend_text[:100]}..."
        )
        
        # Step 6: Generate metadata (this will use your existing IPFS flow)
        # logger.info("Generating metadata with trend context...")
        metadata_response = await generate_metadata(metadata_request)
        
        # Step 7: Enhance response with trend info
        if metadata_response.success:
            response_data = {
                "success": True,
                "trend_used": {
                    "text": trend_text[:200],
                    "engagement": engagement,
                    "user": selected_trend['user']['username'],
                    "category": categorize_trend(trend_text),
                    "image_available": bool(tweet_image_url),
                    "image_source": "X tweet" if tweet_image_url else "none",
                    "image_searched": use_x_image
                },
                "token_ideas_from_trend": token_ideas,
                "metadata": {
                    "name": metadata_response.name,
                    "symbol": metadata_response.symbol,
                    "description": metadata_response.description,
                    "metadata_uri": metadata_response.metadata_uri,
                    "image_url": metadata_response.image_url
                },
                "marketing_tips": [
                    f"Tweet about this token with #{metadata_response.symbol}",
                    f"Reference the trending topic: {trend_text[:50]}...",
                    f"Post during USA peak hours (12-4 PM EST)",
                    f"Use hashtags: #memecoin #crypto #{metadata_response.symbol.lower()}",
                    f"Credit original tweet by @{selected_trend['user']['username']}" if selected_trend['user']['username'] else ""
                ],
                "generated_at": datetime.utcnow().isoformat()
            }
            
            # Add image info if available
            if tweet_image_url:
                response_data["trend_used"]["original_image_url"] = tweet_image_url
            
            return response_data
        else:
            raise Exception("Metadata generation failed")
    
    except Exception as e:
        logger.error(f"Failed to generate from trending: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate metadata from trending topics: {str(e)}"
        )
        

@router.post("/generate-from-trending-simple")
async def generate_metadata_from_trending_simple(
    style: str = "trending",
    use_x_image: bool = True
) -> SimpleMetadataResponse:
    """
    Simplified version specifically for token creation
    Returns just the metadata needed for token launch
    """
    try:
        # Call the existing trending endpoint
        trending_response = await generate_metadata_from_trending(
            use_x_image=use_x_image,
            style=style
        )
        
        # ✅ FIX: trending_response should already be a dict from generate_metadata_from_trending
        # Check if it has the right structure
        if isinstance(trending_response, dict) and trending_response.get("success"):
            # Extract metadata from the response
            metadata = trending_response.get("metadata", {})
            
            return SimpleMetadataResponse(
                success=True,
                name=metadata.get("name", "TrendingToken"),
                symbol=metadata.get("symbol", "TRND"),
                metadata_uri=metadata.get("metadata_uri", ""),
                image_url=metadata.get("image_url", ""),
                description=metadata.get("description", "Token based on trending topic"),
                generation_time_ms=trending_response.get("generation_time_ms", 0)
            )
        elif hasattr(trending_response, 'success'):  # Handle if it's a SimpleMetadataResponse
            return trending_response
        else:
            raise HTTPException(status_code=500, detail="Failed to generate from trending")
    
    except Exception as e:
        logger.error(f"Failed to generate from trending simple: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate from trending: {str(e)}"
        )
         
@router.post("/quick-generate")
async def quick_generate_metadata(
    style: str = "trending",
    use_x_image: bool = True  # Changed parameter name
):
    """
    Super simple endpoint for frontend "Generate" button
    Just calls generate_from_trending with defaults
    """
    return await generate_metadata_from_trending(
        use_x_image=use_x_image,  # Updated parameter
        style=style
    )

#=====================================
# Helper Functions
#=====================================

def _get_system_prompt(style: str, trend_context: str = "") -> str:
    """Get system prompt based on style with trend context"""
    trend_context_prompt = ""
    if trend_context:
        trend_context_prompt = f"""
        CURRENT TRENDING TOPIC: {trend_context}
        IMPORTANT: Create a token that capitalizes on this trending news/event.
        Make it timely, relevant, and leverage the current hype.
        """
    
    prompts = {
        "professional": (
            f"""You are a professional crypto token designer with expertise in branding and marketing. 
            Create compelling, legitimate-sounding token metadata that would appeal to serious investors.
            {trend_context_prompt}
            Focus on utility, technology, and real-world applications while being relevant to current trends."""
        ),
        "meme": (
            f"""You are a creative meme token creator with expertise in viral content and internet culture.
            {trend_context_prompt}
            Create fun, engaging, and meme-worthy token metadata that would go viral on social media.
            Use humor, pop culture references, and internet slang. Make it TIMELY and relevant to what's trending RIGHT NOW."""
        ),
        "community": (
            f"""You are a community-focused token designer who understands DAOs and decentralized communities.
            {trend_context_prompt}
            Create token metadata that emphasizes community ownership, governance, and collective success.
            Focus on inclusivity, transparency, and shared goals around the current trending topic."""
        ),
        "ai-generated": (
            f"""You are an innovative AI-powered token creator that blends creativity with technical expertise.
            {trend_context_prompt}
            Create unique, forward-thinking token metadata that showcases the potential of AI and blockchain.
            Be creative, but maintain credibility while leveraging the current trend."""
        ),
        "gaming": (
            f"""You are a gaming token specialist focused on play-to-earn and GameFi projects.
            {trend_context_prompt}
            Create exciting, game-oriented token metadata that appeals to gamers and crypto enthusiasts.
            Focus on gaming utility, rewards, and community engagement related to the trend."""
        ),
        "trending": (
            f"""You are a viral token creator who specializes in EXPLOSIVE social media growth.
            TRENDING TOPIC: {trend_context}
            
            CRITICAL INSTRUCTIONS:
            1. Create a token that IMMEDIATELY capitalizes on this trending topic
            2. Make it highly shareable and meme-able
            3. Use language that references the specific trend
            4. Optimize for social media virality
            5. Include subtle references that trend followers will recognize
            6. Create urgency - this is trending RIGHT NOW
            
            The token should feel TIMELY and RELEVANT to what's happening this very moment."""
        )
    }
    
    return prompts.get(style, prompts["trending" if trend_context else "ai-generated"])

def _get_example_attributes(category: str) -> List[Dict[str, str]]:
    """Get example attributes based on category"""
    base_attributes = [
        {"trait_type": "AI Generated", "value": "Yes"},
        {"trait_type": "Blockchain", "value": "Solana"},
        {"trait_type": "Launch Type", "value": "Pump.fun"},
    ]
    
    category_attributes = {
        "meme": [
            {"trait_type": "Meme Tier", "value": "God Tier"},
            {"trait_type": "Viral Potential", "value": "Maximum"},
            {"trait_type": "Community Energy", "value": "100%"},
        ],
        "utility": [
            {"trait_type": "Utility Score", "value": "High"},
            {"trait_type": "Tokenomics", "value": "Sustainable"},
            {"trait_type": "Use Case", "value": "Multi-purpose"},
        ],
        "gaming": [
            {"trait_type": "Game Genre", "value": "Play-to-Earn"},
            {"trait_type": "NFT Integration", "value": "Yes"},
            {"trait_type": "Reward System", "value": "Dynamic"},
        ],
        "community": [
            {"trait_type": "DAO Ready", "value": "Yes"},
            {"trait_type": "Governance", "value": "Decentralized"},
            {"trait_type": "Community Size", "value": "Growing"},
        ],
    }
    
    return base_attributes + category_attributes.get(category, [])

def _generate_image_prompt(metadata_dict: Dict[str, Any]) -> str:
    """Generate DALL-E prompt from metadata - SAFE VERSION"""
    name = metadata_dict.get("name", "Crypto Token")
    description = metadata_dict.get("description", "")
    category = metadata_dict.get("category", "meme")
    
    # Remove any crypto/trading terms from descriptions
    safe_description = description.replace("token", "symbol").replace("crypto", "digital")
    
    prompts = {
        "meme": (
            f"Minimalist cartoon character mascot logo, simple design, friendly appearance, "
            f"vibrant colors, clean white background, no text, no financial symbols, "
            f"appropriate for all audiences, vector art style"
        ),
        "professional": (
            f"Abstract geometric logo design, clean lines, modern aesthetics, "
            f"professional color palette, gradient background, minimalist, "
            f"no text, no currency symbols, corporate branding style"
        ),
        "community": (
            f"Abstract interconnected nodes or hands logo, warm colors, "
            f"collaborative symbolism, soft background, inclusive design, "
            f"no text, vector illustration style"
        ),
        "gaming": (
            f"Stylized game controller or shield logo, bold colors, "
            f"dynamic elements, dark background with subtle gradients, "
            f"no text, video game icon style"
        ),
    }
    
    # Always add safety disclaimer
    base_prompt = prompts.get(category, prompts["meme"])
    safety_addendum = ", safe for work, appropriate content, no financial references"
    
    return base_prompt + safety_addendum

#=====================================
# AI Endpoints
#=====================================

# ✅ Working    
@router.get("/test")
async def test_endpoint():
    """Simple test endpoint to verify OpenAI connectivity"""
    try:
        # Test OpenAI API
        test_response = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[{"role": "user", "content": "Say 'Hello from Flash Sniper'"}],
            max_tokens=10,
        )
        
        return {
            "success": True,
            "message": "OpenAI API is working",
            "response": test_response.choices[0].message.content,
            "model": test_response.model,
            "timestamp": datetime.utcnow().isoformat(),
        }
    
    except Exception as e:
        logger.error(f"OpenAI test failed: {e}")
        return {
            "success": False,
            "message": f"OpenAI API test failed: {str(e)}",
            "timestamp": datetime.utcnow().isoformat(),
        }
         
@router.post("/generate-metadata", response_model=SimpleMetadataResponse)
async def generate_metadata(
    request: MetadataRequest,
    source: str = Query("ai", description="Metadata source: 'ai' or 'trending'")
):
    """
    Generate AI-powered token metadata with IPFS storage
    Option to use AI or X Trends as source
    """
    import time
    start_time = time.time()
    
    try:
        # ✅ ADD DEBUG LOGGING
        # logger.info(f"🔍 DEBUG: Starting generate_metadata")
        # logger.info(f"🔍 DEBUG: use_dalle = {request.use_dalle}")
        # logger.info(f"🔍 DEBUG: existing_image = {request.existing_image}")
        # logger.info(f"🔍 DEBUG: source = {source}")

        # CHOOSE SOURCE: AI or Trending
        if source == "trending":
            # logger.info(f"Generating metadata from X Trends...")
            
            # Step 1: Get trending topics WITH IMAGES
            trends = await simple_x_analyzer.get_usa_trending_for_tokens()
            
            if not trends:
                logger.warning("No trending topics found, falling back to AI generation")
                source = "ai"  # Fallback to AI
            else:
                # Step 2: Find a trend WITH AN IMAGE
                selected_trend = None
                trends_with_images = [t for t in trends if t.get('image_url')]
                
                if request.use_dalle:  # Note: use_dalle param becomes use_x_image for trends
                    if trends_with_images:
                        selected_trend = trends_with_images[0]
                        # logger.info(f"✅ Selected trend with image: {selected_trend['image_url'][:100]}...")
                    else:
                        logger.warning("⚠️ No trends with images found! Will use placeholder")
                        selected_trend = trends[0]
                else:
                    selected_trend = trends[0]
                
                trend_text = selected_trend['text']
                engagement = selected_trend['engagement_score']
                tweet_image_url = selected_trend.get('image_url')
                
                # logger.info(f"Using trend: {trend_text[:100]}... (engagement: {engagement})")
                
                # Step 3: Extract token ideas from trend
                token_ideas = simple_x_analyzer.extract_token_ideas(trend_text)
                
                # Step 4: Download image if available
                downloaded_image_url = None
                
                if request.use_dalle and tweet_image_url:
                    try:
                        # logger.info(f"Downloading and uploading tweet image: {tweet_image_url}")
                        image_cid = await ipfs_service.pin_file_from_url(
                            tweet_image_url, 
                            f"trend_image_{int(time.time())}"
                        )
                        
                        if image_cid:
                            downloaded_image_url = ipfs_service.public_gateway_url.format(cid=image_cid)
                            # logger.info(f"✅ Uploaded tweet image to IPFS: {downloaded_image_url}")
                        else:
                            logger.warning("Failed to upload image to IPFS, will use placeholder")
                    except Exception as e:
                        logger.error(f"Failed to process tweet image: {e}")
                
                # Step 5: Create metadata request with trend context
                request.keywords = f"{token_ideas['context']}, trending, viral"
                request.theme = f"Token based on trending topic: {trend_text[:50]}..."
                request.existing_image = downloaded_image_url
                request.trend_context = f"Trending on X: {trend_text[:100]}..."
                request.use_dalle = False  # Always False for trends
                # logger.info(f"Generating metadata with trend context: {request.trend_context}")
        
        # For AI source or fallback
        else:
            # logger.info(f"Generating AI metadata with style: {request.style}")
            if not request.keywords:
                request.keywords = "crypto, blockchain, innovation"
            if not request.theme:
                request.theme = "crypto innovation"
        
        # Prepare the user prompt with trend context
        trend_text = f"\nTRENDING CONTEXT: {request.trend_context}" if request.trend_context else ""
        
        user_prompt = f"""
        Create complete token metadata for a Solana token with these specifications:
        
        STYLE: {request.style}
        KEYWORDS: {request.keywords}
        CATEGORY: {request.category}
        THEME: {request.theme or 'crypto innovation'}{trend_text}
        
        IMPORTANT: {f"Make this token relevant to this trending topic: {request.trend_context}" if request.trend_context else ""}
        
        Requirements:
        1. Token Name: Creative, memorable, max 20 characters
        2. Token Symbol: 3-6 uppercase characters, catchy
        3. Description: 1-2 compelling sentences explaining the token's purpose/vision
        
        Output must be valid JSON with this exact structure:
        {{
            "name": "string",
            "symbol": "string",
            "description": "string",
        }}
        """
        
        # Use standard chat completions API
        chat_response = client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[
                {
                    "role": "system", 
                    "content": _get_system_prompt(request.style)
                },
                {
                    "role": "user", 
                    "content": user_prompt
                }
            ],
            response_format={"type": "json_object"},
            temperature=0.8,
            max_tokens=1000,
        )
        
        # Parse the JSON response
        content = chat_response.choices[0].message.content
        
        if not content:
            logger.error("Empty response from OpenAI")
            raise HTTPException(status_code=500, detail="Empty response from OpenAI")
        
        try:
            metadata_dict = json.loads(content)
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse OpenAI response as JSON: {e}")
            logger.error(f"Raw response: {content}")
            # Try to extract JSON from the response
            import re
            json_match = re.search(r'\{.*\}', content, re.DOTALL)
            if json_match:
                metadata_dict = json.loads(json_match.group())
            else:
                # Create fallback metadata
                metadata_dict = {
                    "name": f"{request.style.capitalize()}Token",
                    "symbol": "TKN",
                    "description": f"A {request.style} token on Solana blockchain",
                    "attributes": _get_example_attributes(request.category)
                }
        
        # Validate required fields
        if not metadata_dict.get("name") or not metadata_dict.get("symbol"):
            logger.error(f"Missing required fields in metadata: {metadata_dict}")
            metadata_dict["name"] = metadata_dict.get("name", f"{request.style.capitalize()}Token")
            metadata_dict["symbol"] = metadata_dict.get("symbol", "TKN")
        
        # Ensure symbol is uppercase
        metadata_dict["symbol"] = metadata_dict["symbol"].upper()
        
        # Generate or use image
        image_url = request.existing_image
        
        if request.use_dalle and not request.existing_image:
            try:
                # Generate DALL-E image
                image_prompt = _generate_image_prompt({
                    **metadata_dict,
                    "category": request.category
                })
                
                # logger.info(f"Generating DALL-E image with prompt: {image_prompt[:100]}...")
                
                image_response = client.images.generate(
                    model=settings.OPENAI_IMAGE_MODEL,
                    prompt=image_prompt,
                    size="1024x1024",
                    quality="standard",
                    n=1,
                    response_format="url",
                )
                
                openai_image_url = image_response.data[0].url 
                metadata_dict["image_prompt"] = image_prompt
                image_url = openai_image_url
                # logger.info(f"DALL-E image generated: {openai_image_url}")
                
            except Exception as image_error:
                logger.error(f"DALL-E generation failed: {image_error}")
                image_url = "https://placehold.co/500x400/6366f1/ffffff?text=" + metadata_dict["name"].replace(" ", "+")
        
        # Ensure image URL exists
        if not image_url:
            image_url = "https://placehold.co/600x400/6366f1/ffffff?text=" + metadata_dict["name"].replace(" ", "+")
        
        # ✅ CRITICAL FIX: After generating metadata, upload to IPFS
        complete_metadata = {
            "name": metadata_dict["name"],
            "symbol": metadata_dict["symbol"],
            "description": metadata_dict.get("description", "Token created via Flash Sniper"),
            "image": image_url,  # This will be updated to IPFS if uploaded
            "external_url": "https://pump.fun",
            "showName": True,
            "createdOn": "https://pump.fun",
            "twitter": "",
            "website": "https://pump.fun",
        }
        
        # Upload to IPFS
        # logger.info("Uploading metadata and image to IPFS...")
        ipfs_result = await ipfs_service.upload_metadata_with_image(complete_metadata)
        
        if not ipfs_result["success"]:
            logger.warning(f"IPFS upload failed: {ipfs_result.get('error')}")
            # Fallback: use direct URLs
            metadata_uri = None
            image_url_for_onchain = image_url  # Use original image URL
        else:
            # ✅ CRITICAL: Use the METADATA URI for on-chain, not the image URI!
            metadata_uri = ipfs_result["metadata_uri"]  # This is https://ipfs.io/ipfs/Qmb2FKs9LykhZtuqpmjpocqMvWFWbRgzLn91RnMM89hb3E
            image_url_for_onchain = ipfs_result["full_metadata"]["image"]  # Get HTTP URL from IPFS
            # logger.info(f"✅ Metadata uploaded to IPFS: {metadata_uri}")
            # logger.info(f"✅ Image URL: {image_url_for_onchain}")
            # logger.info(f"✅ METADATA URI (for on-chain): {metadata_uri}")  # DEBUG LOG

        generation_time = int((time.time() - start_time) * 1000)
        
        logger.info(f"✅ Metadata generated successfully in {generation_time}ms")
        logger.info(f"📄 Token Name: {metadata_dict['name']}")
        logger.info(f"📄 Token Symbol: {metadata_dict['symbol']}")
        logger.info(f"🔗 Image URL: {image_url_for_onchain}")
        logger.info(f"🔗 METADATA URI (for on-chain): {metadata_uri}")
        
        # ✅ RETURN SIMPLIFIED RESPONSE WITH JUST WHAT WE NEED
        return SimpleMetadataResponse(
            success=True,
            name=metadata_dict["name"],
            symbol=metadata_dict["symbol"],
            metadata_uri=metadata_uri,  # This is the KEY field for on-chain
            image_url=image_url_for_onchain,
            description=metadata_dict.get("description"),
            request_id=chat_response.id,
            generation_time_ms=generation_time
        )
        
    except Exception as e:
        logger.error(f"AI metadata generation failed: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500, 
            detail=f"AI metadata generation failed: {str(e)}"
        )
       
# Frontend will call this
@router.post("/generate-metadata-unified")
async def generate_metadata_unified(
    style: str = "trending",
    keywords: str = "",
    source: str = "trending",
    use_images: bool = True,
    category: str = "meme",
    use_dalle: bool = False
):
    """
    Unified endpoint for frontend - supports both AI and Trending generation
    """
    try:
        # logger.info(f"📡 Unified metadata generation called with source: {source}")
        
        if source == "trending":
            logger.info("🚀 Generating metadata from X Trends...")
            
            # Call the trending endpoint with proper parameters
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    f"{settings.BACKEND_BASE_URL}/ai/generate-from-trending-simple",
                    json={
                        "style": style,
                        "use_x_image": use_images  # ✅ Fixed: Correct parameter name
                    },
                    headers={"X-API-Key": settings.ONCHAIN_API_KEY}
                )
                
                if response.status_code != 200:
                    logger.error(f"Trending API error: {response.status_code}")
                    return {
                        "success": False,
                        "error": f"Trending API error: {response.status_code}",
                        "source": "trending"
                    }
                
                result = response.json()  # ✅ This should be a dict
                
                # ✅ FIX: Handle the SimpleMetadataResponse object properly
                if isinstance(result, dict) and result.get("success"):
                    return {
                        "success": True,
                        "source": "trending",
                        "metadata": {
                            "name": result["name"],
                            "symbol": result["symbol"],
                            "description": result.get("description", ""),
                            "metadata_uri": result["metadata_uri"],
                            "image_url": result["image_url"]
                        },
                        "generated_from_trend": True
                    }
                else:
                    logger.error(f"Trending generation failed: {result}")
                    return {
                        "success": False,
                        "error": "Trending generation failed",
                        "source": "trending"
                    }
                    
        else:  # AI source
            # logger.info("🤖 Generating AI metadata...")
            
            # Call the AI endpoint with correct parameters
            metadata_request = MetadataRequest(
                style=style,
                keywords=keywords,
                category=category,
                use_dalle=use_dalle, 
                theme=f"Token created via Flash Sniper"
            )
            
            # ✅ FIX: Call generate_metadata directly instead of HTTP
            response = await generate_metadata(metadata_request, source="ai")
            
            if not response or not response.success:
                return {
                    "success": False,
                    "error": "AI metadata generation failed",
                    "source": "ai"
                }
            
            return {
                "success": True,
                "source": "ai",
                "metadata": {
                    "name": response.name,
                    "symbol": response.symbol,
                    "description": response.description,
                    "metadata_uri": response.metadata_uri,
                    "image_url": response.image_url
                },
                "generated_from_trend": False
            }
            
    except Exception as e:
        logger.error(f"Unified generation failed: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e),
            "source": source
        }
        
          
# ✅ Working    
@router.post("/generate-metadata-batch", response_model=BatchMetadataResponse)
async def generate_metadata_batch(request: BatchMetadataRequest) -> BatchMetadataResponse:
    """
    Generate multiple metadata sets in batch
    """
    async def generate_single(keywords: str, style: str) -> TokenMetadata:
        """Generate single metadata asynchronously"""
        metadata_req = MetadataRequest(
            keywords=keywords,
            style=style,
            category="meme",
            use_dalle=False,    # Don't generate images in batch to save time/credits
        )
        
        response = await generate_metadata(metadata_req)
        return response.metadata_for_token  # Changed to access the correct field
    
    try:
        logger.info(f"Starting batch generation for {request.count} items")
        
        # Create batch tasks
        tasks = []
        for i in range(request.count):
            style = request.styles[i % len(request.styles)]
            keywords = f"{request.base_keywords}, variation {i+1}"
            
            # Create async task
            tasks.append(generate_single(keywords, style))
        
        # Execute all tasks concurrently with a limit
        semaphore = asyncio.Semaphore(3)  # Limit to 3 concurrent requests
        
        async def limited_generate(task):
            async with semaphore:
                return await task
        
        limited_tasks = [limited_generate(task) for task in tasks]
        metadata_list = await asyncio.gather(*limited_tasks, return_exceptions=True)
        
        # Filter out failures
        successful_metadata = []
        request_ids = []
        
        for i, result in enumerate(metadata_list):
            if isinstance(result, Exception):
                logger.error(f"Batch generation failed for item {i+1}: {result}")
                continue 
            successful_metadata.append(result)
        
        logger.info(f"Batch generation completed: {len(successful_metadata)}/{request.count} successful")
        
        return BatchMetadataResponse(
            success=True,
            metadata_list=successful_metadata,
            total_count=len(successful_metadata),
            request_id=request_ids,
        )
        
    except Exception as e:
        logger.error(f"Batch generation failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch generation failed: {str(e)}")
    
# ✅ Working    
@router.post("/analyze-image")
async def analyze_image(file: UploadFile = File(...)):
    """
    Analyze an uploaded image and suggest token metadata based on it
    """
    try:
        # Read and encode image
        image_data = await file.read()
        base64_image = base64.b64encode(image_data).decode('utf-8')
        
        # Use vision model to analyze image
        response = client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": "You are a crypto token analyst. Analyze images and suggest appropriate token metadata."
                },
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": """
                         Analyze this image and suggest token metadata:
                         1. What kind of token would this image represent?
                         2. Suggest a creative token name (max 20 chars)
                         3. Suggest a token symbol (3-6 uppercase chars)
                         4. Write a compelling description
                         5. Suggest 5 relevant attributes with values
                         
                         Output as JSON with keys: analysis, name, symbol, description, attributes
                        """
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{base64_image}"
                            }
                        }
                    ]
                }
            ],
            max_tokens=1000,
            response_format={"type": "json_object"},
        )
        
        content = response.choices[0].message.content 
        if not content:
            raise HTTPException(status_code=500, detail="Empty response from OpenAI")
        
        analysis = json.loads(content)
        
        return {
            "success": True, 
            "analysis": analysis.get("analysis", ""),
            "suggestions": {
                "name": analysis.get("name", ""),
                "symbol": analysis.get("symbol", ""),
                "description": analysis.get("description", ""),
                "attributes": analysis.get("attributes", []),
            },
            "request_id": response.id,
        }
        
    except Exception as e:
        logger.error(f"Image analysis failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Image analysis failed: {str(e)}")

# ✅ Working    
@router.post("/optimize-metadata")
async def optimize_metadata(existing_metadata: Dict[str, Any]):
    """
    Optimize existing metadata using AI
    """
    try:
        chat_response = client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": """
                    You are a crypto marketing expert specializing in token optimization.
                    Improve the given token metadata to be more engaging, professional, and marketable.
                    Maintain the original intent but enhance clarity, appeal, and SEO-friendliness.
                    """
                },
                {
                    "role": "user",
                    "content": f"""
                    Optimize this token metadata:
                    {json.dumps(existing_metadata, indent=2)}
                    
                    Provide:
                    1. Improved name (if needed)
                    2. Improved symbol (if needed)
                    3. Enhanced description
                    4. Better attributes
                    5. Explanation of changes
                    
                    Output as JSON with: original, optimized, changes_explanation
                    """
                }
            ],
            response_format={"type": "json_object"},
            temperature=0.7,
            max_tokens=1000,
        )
        
        content = chat_response.choices[0].message.content
        if not content:
            raise HTTPException(status_code=500, detail="Empty response from OpenAI")
        
        optimization = json.loads(content)
        
        return {
            "success": True,
            "original": existing_metadata,
            "optimized": optimization.get("optimized", {}),
            "changes_explanation": optimization.get("changes_explanation", ""),
            "request_id": chat_response.id,
        }
        
    except Exception as e:
        logger.error(f"Metadata optimization failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Metadata optimization failed: {str(e)}")

# ✅ Working    
@router.get("/styles")
async def get_available_styles():
    """Get available metadata generation styles"""
    return {
        "success": True,
        "styles": [
            {
                "id": "professional",
                "name": "Professional",
                "description": "Corporate, serious, utility-focused tokens",
                "best_for": ["Utility tokens", "Enterprise projects", "Serious investors"]
            },
            {
                "id": "meme",
                "name": "Meme",
                "description": "Fun, viral, community-driven meme tokens",
                "best_for": ["Meme coins", "Social tokens", "Community projects"]
            },
            {
                "id": "community",
                "description": "DAO-focused, community-owned tokens",
                "best_for": ["DAOs", "Governance tokens", "Community projects"]
            },
            {
                "id": "ai-generated",
                "name": "AI Generated",
                "description": "Innovative, futuristic, AI-themed tokens",
                "best_for": ["AI projects", "Tech-focused tokens", "Innovation"]
            },
            {
                "id": "gaming",
                "name": "Gaming",
                "description": "Play-to-earn, game-related tokens",
                "best_for": ["GameFi", "NFT gaming", "Esports"]
            }
        ]
    }

# ✅ Working    
@router.post("/health")
async def health_check():
    """Check OpenAI health and credits"""
    try:
        # Simple test to verify API connectivity
        test_response = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[{"role": "user", "content": "Say 'OK' if you're working."}],
            max_tokens=5,
        )
        
        # Try to get usage info (note: may require specific permissions)
        # For now, just verify the API responds
        return {
            "success": True,
            "status": "operational",
            "openai_response": test_response.choices[0].message.content,
            "model": test_response.model,
            "timestamp": datetime.utcnow().isoformat(),
        }
    
    except Exception as e:
        return {
            "success": False,
            "status": "error",
            "error": str(e),
            "timestamp": datetime.utcnow().isoformat(),
        }
        
# ✅ Working    
@router.post("/upload-and-generate")
async def upload_and_generate_metadata(
    file: UploadFile = File(...),
    style: str = "ai-generate",
    keywords: str = ""
): 
    """
    Upload an image and generate complete metadata based on it
    """
    try:
        # Step 1: Analyze image
        analysis_response = await analyze_image(file)
        
        if not analysis_response["success"]:
            raise HTTPException(status_code=500, detail="Image analysis failed")
        
        suggestions = analysis_response["suggestions"]
        
        # Reset file pointer for reading
        await file.seek(0)
        image_data = await file.read()
        base64_image = base64.b64encode(image_data).decode('utf-8')
        
        # Step 2: Generate complete metadata using suggestions
        metadata_request = MetadataRequest(
            style=style,
            keywords=f"{keywords}, {suggestions['name']}",
            category="meme",    # Default for image-based tokens
            theme=suggestions.get("description", ""),
            use_dalle=False,    # We already have an image
            existing_image=f"data:image/jpeg;base64,{base64_image}"
        )
        
        # Generate metadata
        metadata_response = await generate_metadata(metadata_request)
        
        return {
            "success": True,
            "image_analysis": analysis_response,
            "generated_metadata": metadata_response.metadata_for_token.dict(),
            "combined": {
                "name": metadata_response.metadata_for_token.name,
                "symbol": metadata_response.metadata_for_token.symbol,
                "description": metadata_response.metadata_for_token.description,
                "image": f"data:image/jpeg;base64,{base64_image}",
                "attributes": [
                    {"trait_type": "Source", "value": "Image Upload"},
                    {"trait_type": "Analysis Based", "value": "Yes"},
                    *[attr.dict() for attr in metadata_response.metadata_for_token.attributes]
                ]
            }
        }
        
    except Exception as e:
        logger.error(f"Upload and generation failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Upload and generation failed: {str(e)}")



# ===================== CLOUDFLARE R2 BUCKET IMAGE TESTING ====================
@router.get("/simple-r2-test")
async def simple_r2_test_fixed():
    """Test R2 without requiring ListBuckets permission"""
    try:
        import boto3
        from botocore.config import Config
        
        # Create client directly
        s3 = boto3.client(
            's3',
            endpoint_url=f'https://{settings.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com',
            aws_access_key_id=settings.CLOUDFLARE_R2_ACCESS_KEY_ID,
            aws_secret_access_key=settings.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
            config=Config(s3={'addressing_style': 'virtual'})
        )
        
        # Try to upload a small test file instead of listing buckets
        test_key = f"test-connection-{int(time.time())}.txt"
        
        try:
            # Try to put an object (this tests write permission)
            s3.put_object(
                Bucket=settings.CLOUDFLARE_R2_BUCKET_NAME,
                Key=test_key,
                Body=b'Test connection to R2',
                ContentType='text/plain'
            )
            
            logger.info(f"Successfully uploaded test file: {test_key}")
            
            # Try to read it back (tests read permission)
            response = s3.get_object(
                Bucket=settings.CLOUDFLARE_R2_BUCKET_NAME,
                Key=test_key
            )
            content = response['Body'].read()
            
            # Clean up
            s3.delete_object(
                Bucket=settings.CLOUDFLARE_R2_BUCKET_NAME,
                Key=test_key
            )
            
            return {
                "success": True,
                "message": "R2 connection successful!",
                "test": "Write, read, and delete operations all work",
                "bucket": settings.CLOUDFLARE_R2_BUCKET_NAME,
                "account_id": settings.CLOUDFLARE_R2_ACCOUNT_ID
            }
            
        except Exception as e:
            error_code = ""
            if hasattr(e, 'response'):
                error_code = e.response.get('Error', {}).get('Code', '')
            
            return {
                "success": False,
                "message": f"Failed to upload to bucket: {str(e)}",
                "error_code": error_code,
                "suggestion": "Check if bucket exists and token has write permissions",
                "bucket": settings.CLOUDFLARE_R2_BUCKET_NAME
            }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "account_id": settings.CLOUDFLARE_R2_ACCOUNT_ID,
            "bucket_name": settings.CLOUDFLARE_R2_BUCKET_NAME,
            "suggestion": "Check credentials and account ID"
        }      
     
     
# ===================== IPFS IMAGE TESTING ====================

@router.post("/upload-to-ipfs")
async def upload_to_ipfs(metadata: TokenMetadata):
    """
    Upload existing metadata to IPFS
    """
    try:
        # Convert metadata to IPFS format
        metadata_dict = metadata.to_ipfs_metadata()
        
        # Upload to IPFS
        result = await ipfs_service.upload_metadata_with_image(metadata_dict)
        
        if not result["success"]:
            raise HTTPException(status_code=500, detail=f"IPFS upload failed: {result.get('error')}")
        
        # Update metadata with IPFS info
        metadata.ipfs_cid = result["metadata_cid"]
        metadata.ipfs_uri = result["metadata_uri"]
        
        if result["image_cid"]:
            metadata.image = f"ipfs://{result['image_cid']}"
        
        return {
            "success": True,
            "metadata": metadata.dict(),
            "ipfs_cid": result["metadata_cid"],
            "ipfs_uri": result["metadata_uri"],
            "gateway_url": ipfs_service.get_gateway_url(result["metadata_cid"])
        }
        
    except Exception as e:
        logger.error(f"IPFS upload failed: {e}")
        raise HTTPException(status_code=500, detail=f"IPFS upload failed: {str(e)}")

@router.get("/ipfs-test")
async def test_ipfs_connection():
    """
    Test Pinata IPFS connection
    """
    try:
        # Try to pin a simple test JSON
        test_data = {
            "test": "This is a test from Flash Sniper",
            "timestamp": datetime.utcnow().isoformat()
        }
        
        cid = await ipfs_service.pin_json(test_data, "test_connection")
        
        if cid:
            return {
                "success": True,
                "message": "IPFS connection successful",
                "cid": cid,
                "gateway_url": ipfs_service.get_gateway_url(cid),
                "ipfs_uri": f"ipfs://{cid}"
            }
        else:
            return {
                "success": False,
                "message": "Failed to connect to IPFS"
            }
            
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "message": "Check your Pinata credentials"
        }


    