from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict, Any
from datetime import datetime



# =========== AI ===========
class MetadataRequest(BaseModel):
    """Request model for metadata generation"""
    style: str = Field(
        default="ai-generated",
        description="Syle of the metadata: 'professional', 'meme', 'community', or 'ai-generated'",
    )
    keywords: str = Field(
        default="",
        description="Keywords to guide generation (e.g., 'dog, meme, solana')"
    )
    category: str = Field(
        default="meme",
        description="Token category: 'meme', 'utility', 'community', 'gaming'",
    )
    theme: Optional[str] = Field(
        default=None,
        description="Specific theme or narrative for the token"
    ) 
    use_dalle: bool = Field(
        default=True,
        description="Whether to generate an image with DALL-E" 
    )
    existing_image: Optional[str] = Field(
        default=None,
        description="Existing image URL to use instead of generating new"
    )
    
class Attribute(BaseModel):
    """Single attribute for token metadata"""
    trait_type: str 
    value: str 
    
class TokenMetadata(BaseModel):
    """Complete token metadata response"""
    name: str = Field(description="Token name (max 20 characters)")
    symbol: str = Field(description="Token symbol (3-6 uppercase characters)")
    description: str = Field(description="Compelling token description")
    image: str = Field(description="URL or base64 image data")
    external_url: str = Field(default="https://pump.fun", description="External website URL")
    attributes: List[Attribute] = Field(default_factory=list, description="Token attributes")
    image_prompt: Optional[str] = Field(default=None, description="DALL-E prompt used")
    created_at: datetime = Field(default_factory=datetime.utcnow, description="Generation timestamp")
    
class MetadataResponse(BaseModel):
    "API response wrapper"
    success: bool = Field(default=True)
    metadata_for_token: TokenMetadata = Field(description="Generated metadata")
    request_id: Optional[str] = Field(default=None, description="OpenAI request ID")
    generation_time_ms: Optional[int] = Field(default=None, description="Time taken for generation")
    
class BatchMetadataRequest(BaseModel):
    """Request for batch metadata generation"""
    count: int = Field(default=5, ge=1, le=20, description="Number of metadata sets to generate")
    base_keywords: str = Field(default="crypto, solana, meme", description="Base keywords")
    styles: List[str] = Field(default=["meme", "professional", "ai-generated"], description="Styles to use")
    
class BatchMetadataResponse(BaseModel):
    """Batch generation response"""
    success: bool = Field(default=True)
    metadata_list: List[TokenMetadata] = Field(description="List of generated metadata")
    total_count: int = Field(description="Total generated")
    request_id: List[str] = Field(default_factory=list, description="OpenAI request IDs")
    
    





