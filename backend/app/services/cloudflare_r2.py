# app/services/cloudflare_r2.py
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
import uuid
import aiohttp
import asyncio
from io import BytesIO
from typing import Optional
import logging
from app.config import settings

logger = logging.getLogger(__name__)

class CloudflareR2Service:
    """Service for uploading images to Cloudflare R2"""
    
    def __init__(self):
        self.s3_client = None
        self.bucket_name = settings.CLOUDFLARE_R2_BUCKET_NAME
        self.public_url = settings.CLOUDFLARE_R2_PUBLIC_URL
        self._initialize_client()
    
    def _initialize_client(self):
        """Initialize S3 client for R2 - Skip ListBuckets check"""
        try:
            logger.info(f"Initializing R2 client for account: {settings.CLOUDFLARE_R2_ACCOUNT_ID}")
            logger.info(f"Using bucket: {self.bucket_name}")
            
            # IMPORTANT: Make sure credentials are not empty
            if not settings.CLOUDFLARE_R2_ACCESS_KEY_ID:
                logger.error("CLOUDFLARE_R2_ACCESS_KEY_ID is empty!")
                self.s3_client = None
                return
            
            if not settings.CLOUDFLARE_R2_SECRET_ACCESS_KEY:
                logger.error("CLOUDFLARE_R2_SECRET_ACCESS_KEY is empty!")
                self.s3_client = None
                return
            
            # Create the client
            self.s3_client = boto3.client(
                's3',
                endpoint_url=f'https://{settings.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com',
                aws_access_key_id=settings.CLOUDFLARE_R2_ACCESS_KEY_ID,
                aws_secret_access_key=settings.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
                config=Config(
                    s3={
                        'addressing_style': 'virtual',
                        'payload_signing_enabled': False
                    },
                    signature_version='s3v4'
                )
            )
            
            # DON'T test with list_buckets() - it requires ListBuckets permission
            # Instead, try a simple operation that doesn't require ListBuckets
            
            logger.info("R2 client initialized (skipping ListBuckets test)")
            
            # Optional: Try to get bucket location (requires less permissions)
            try:
                # This might work even without ListBuckets
                location = self.s3_client.get_bucket_location(Bucket=self.bucket_name)
                logger.info(f"Bucket location: {location.get('LocationConstraint', 'default')}")
            except:
                # That's okay - we'll find out when we try to upload
                logger.info("Cannot get bucket location (permissions might be bucket-specific)")
                
        except Exception as e:
            logger.error(f"Failed to initialize R2 client: {e}", exc_info=True)
            self.s3_client = None
            
    async def download_image(self, url: str) -> Optional[bytes]:
        """Download image from URL asynchronously"""
        try:
            # Set a timeout for the download
            timeout = aiohttp.ClientTimeout(total=30)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(url) as response:
                    if response.status == 200:
                        content = await response.read()
                        if len(content) > 10 * 1024 * 1024:  # 10MB limit
                            logger.error("Image too large (max 10MB)")
                            return None
                        return content
                    else:
                        logger.error(f"Failed to download image: {response.status}")
                        return None
        except Exception as e:
            logger.error(f"Image download failed: {e}")
            return None
    
    async def upload_image_to_r2(
        self, 
        image_data: bytes, 
        content_type: str = "image/png",
        folder: str = "tokens"
    ) -> Optional[str]:
        """
        Upload image to Cloudflare R2 and return public URL
        """
        if not self.s3_client:
            logger.error("R2 client is not initialized. Attempting to re-initialize...")
            self._initialize_client()
            
            if not self.s3_client:
                logger.error("Failed to initialize R2 client after retry")
                return None
        
        if not image_data or len(image_data) == 0:
            logger.error("No image data to upload")
            return None
        
        try:
            # Generate unique filename
            filename = f"{uuid.uuid4().hex}.png"
            key = f"{folder}/{filename}"
            
            logger.info(f"Uploading {len(image_data)} bytes to R2 bucket: {self.bucket_name}, key: {key}")
            
            # Upload to R2 - NO ACL parameter
            self.s3_client.put_object(
                Bucket=self.bucket_name,
                Key=key,
                Body=image_data,
                ContentType=content_type
            )
            
            # Construct public URL
            public_url = f"{self.public_url}/{key}"
            
            logger.info(f"Image uploaded to R2 successfully: {public_url}")
            return public_url
            
        except ClientError as e:
            logger.error(f"R2 upload failed (ClientError): {e}", exc_info=True)
            
            # Provide detailed error information
            error_code = e.response.get('Error', {}).get('Code', 'Unknown')
            error_message = e.response.get('Error', {}).get('Message', 'Unknown')
            
            logger.error(f"Error details - Code: {error_code}, Message: {error_message}")
            
            # Handle specific errors
            if error_code == "NoSuchBucket":
                logger.error(f"Bucket '{self.bucket_name}' doesn't exist!")
                # You could create it here, or ask user to create it
                # create_bucket_if_not_exists()
                
            elif error_code == "AccessDenied":
                logger.error("Access Denied. Common issues:")
                logger.error("1. Check API token permissions (needs Object Write)")
                logger.error("2. Check if bucket name is correct")
                logger.error("3. Check if API token is for the right account")
                
            return None
            
        except Exception as e:
            logger.error(f"Unexpected error in R2 upload: {e}", exc_info=True)
            return None
    
    async def upload_from_url(self, image_url: str) -> Optional[str]:
        """
        Download image from URL and upload to R2
        """
        if not image_url:
            logger.error("No image URL provided")
            return None
        
        logger.info(f"Downloading image from URL: {image_url[:100]}...")
        
        # Download image
        image_data = await self.download_image(image_url)
        if not image_data:
            logger.error("Failed to download image from URL")
            return None
        
        logger.info(f"Downloaded {len(image_data)} bytes, now uploading to R2...")
        
        # Upload to R2
        return await self.upload_image_to_r2(image_data)
    
    def create_bucket_if_not_exists(self):
        """Create the bucket if it doesn't exist"""
        try:
            if not self.s3_client:
                logger.error("Cannot create bucket: client not initialized")
                return False
            
            # Check if bucket exists
            response = self.s3_client.list_buckets()
            existing_buckets = [b['Name'] for b in response['Buckets']]
            
            if self.bucket_name not in existing_buckets:
                logger.info(f"Creating bucket: {self.bucket_name}")
                self.s3_client.create_bucket(Bucket=self.bucket_name)
                logger.info(f"Bucket created: {self.bucket_name}")
                return True
            else:
                logger.info(f"Bucket already exists: {self.bucket_name}")
                return True
                
        except Exception as e:
            logger.error(f"Failed to create bucket: {e}")
            return False

# Singleton instance
r2_service = CloudflareR2Service()


