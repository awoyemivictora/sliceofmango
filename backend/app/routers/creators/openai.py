import base64
from datetime import datetime
from fastapi import APIRouter, File, HTTPException, UploadFile
from typing import Any, Dict, List
import logging
from app.schemas.creators.openai import Attribute, BatchMetadataRequest, BatchMetadataResponse, MetadataRequest, MetadataResponse, TokenMetadata
from openai import OpenAI
import json 
from app.config import settings
import asyncio

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

#=====================================
# Helper Functions
#=====================================

def _get_system_prompt(style: str) -> str:
    """Get system prompt based on style"""
    prompts = {
        "professional": (
            "You are a professional crypto token designer with expertise in branding and marketing. "
            "Create compelling, legitimate-sounding token metadata that would appeal to serious investors. "
            "Focus on utility, technology, and real-world applications."
        ),
        "meme": (
            "You are a creative meme token creator with expertise in viral content and internet culture. "
            "Create fun, engaging, and meme-worthy token metadata that would go viral on social media. "
            "Use humor, pop culture references, and internet slang."
        ),
        "community": (
            "You are a community-focused token designer who understands DAOs and decentralized communities. "
            "Create token metadata that emphasizes community ownership, governance, and collective success. "
            "Focus on inclusivity, transparency, and shared goals."
        ),
        "ai-generated": (
            "You are an innovative AI-powered token creator that blends creativity with technical expertise. "
            "Create unique, forward-thinking token metadata that showcases the potential of AI and blockchain. "
            "Be creative, but maintain credibility."
        ),
        "gaming": (
            "You are a gaming token specialist focused on play-to-earn and GameFi projects. "
            "Create exciting, game-oriented token metadata that appeals to gamers and crypto enthusiasts. "
            "Focus on gaming utility, rewards, and community engagement."
        )
    }
    
    return prompts.get(style, prompts["ai-generated"])

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

# def _generate_image_prompt(metadata_dict: Dict[str, Any]) -> str:
#     """Generate DALL-E prompt from metadata"""
#     name = metadata_dict.get("name", "Crypto Token")
#     description = metadata_dict.get("description", "")
#     category = metadata_dict.get("category", "meme")
    
#     prompts = {
#         "meme": (
#             f"Logo for {name} meme token. {description} "
#             "Vibrant colors, cartoon style, funny mascot, trending on social media, "
#             "professional crypto token logo design, simple, recognizable, on white background"
#         ),
#         "professional": (
#             f"Professional logo for {name} token. {description} "
#             "Clean, modern, geometric design, corporate colors, minimalist, "
#             "cryptocurrency symbol, professional branding, on gradient background"
#         ),
#         "community": (
#             f"Community logo for {name} token. {description} "
#             "Hands together, interconnected nodes, people silhouette, inclusive design, "
#             "warm colors, collaborative imagery, DAO symbol, on soft background"
#         ),
#         "gaming": (
#             f"Gaming logo for {name} token. {description} "
#             "Pixel art, game controller elements, fantasy elements, dynamic action, "
#             "bold colors, retro gaming style, play-to-earn symbol, on dark background"
#         ),
#     }
    
#     return prompts.get(category, prompts["meme"])

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

# ✅ Working
@router.post("/generate-metadata", response_model=MetadataResponse)
async def generate_metadata(request: MetadataRequest):
    """
    Generate AI-powered token metadata
    """
    import time
    start_time = time.time()
    
    try:
        logger.info(f"Generating metadata for request: style={request.style}, keywords={request.keywords}")
        
        # Prepare the user prompt
        user_prompt = f"""
        Create complete token metadata for a Solana token with these specifications:
        
        STYLE: {request.style}
        KEYWORDS: {request.keywords}
        CATEGORY: {request.category}
        THEME: {request.theme or 'crypto innovation'}
        
        Requirements:
        1. Token Name: Creative, memorable, max 20 characters
        2. Token Symbol: 3-6 uppercase characters, catchy
        3. Description: 1-2 compelling sentences explaining the token's purpose/vision
        4. Attributes: 5-7 relevant traits with creative values
        
        Output must be valid JSON with this exact structure:
        {{
            "name": "string",
            "symbol": "string",
            "description": "string",
            "attributes": [
                {{"trait_type": "string", "value": "string"}},
                ...
            ]
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
                
                logger.info(f"Generating DALL-E image with prompt: {image_prompt[:100]}...")
                
                image_response = client.images.generate(
                    model=settings.OPENAI_IMAGE_MODEL,
                    prompt=image_prompt,
                    size="1024x1024",
                    quality="standard",
                    n=1,
                    response_format="url",
                )
                
                image_url = image_response.data[0].url 
                metadata_dict["image_prompt"] = image_prompt
                logger.info(f"DALL-E image generated: {image_url[:50]}...")
                
            except Exception as image_error:
                logger.error(f"DALL-E generation failed: {image_error}")
                # Use a fallback image if DALL-E fails
                image_url = "https://placehold.co/500x400/6366f1/ffffff?text=" + metadata_dict["name"].replace(" ", "+")
        
        # Ensure image URL exists
        if not image_url:
            image_url = "https://placehold.co/600x400/6366f1/ffffff?text=" + metadata_dict["name"].replace(" ", "+")
        
        # Ensure we have attributes
        attributes = metadata_dict.get("attributes", [])
        if not attributes:
            attributes = _get_example_attributes(request.category)
        
        # Build the metadata object
        metadata = TokenMetadata(
            name=metadata_dict["name"],
            symbol=metadata_dict["symbol"],
            description=metadata_dict.get("description", "Token created via Flash Sniper"),
            image=image_url,
            external_url="https://pump.fun",
            attributes=[Attribute(**attr) for attr in attributes],
            image_prompt=metadata_dict.get("image_prompt"),
            created_at=datetime.utcnow()
        )
        
        generation_time = int((time.time() - start_time) * 1000)
        
        logger.info(f"Metadata generated successfully in {generation_time}ms: {metadata.name} ({metadata.symbol})")
        
        # FIX: Return with the correct field name "metadata_for_token" as per schema
        return MetadataResponse(
            success=True,
            metadata_for_token=metadata,  # Changed from "metadata" to "metadata_for_token"
            request_id=chat_response.id,
            generation_time_ms=generation_time
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"AI metadata generation failed: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500, 
            detail=f"AI metadata generation failed: {str(e)}"
        )
        
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


