import json
import aiohttp
import asyncio
from typing import Dict, Any, Optional
from app.config import settings
import logging

logger = logging.getLogger(__name__)

class IPFSService:
    def __init__(self):
        self.pinata_api_key = settings.PINATA_API_KEY
        self.pinata_secret_key = settings.PINATA_SECRET_KEY
        self.pinata_jwt = settings.PINATA_JWT
        # Use public IPFS gateways that pump.fun can access
        self.gateway_url = "https://gateway.pinata.cloud/ipfs/{cid}"
        self.public_gateway_url = "https://ipfs.io/ipfs/{cid}"  # Public gateway
        self.api_url = "https://api.pinata.cloud/pinning"
        
    async def pin_json(self, json_data: Dict[str, Any], name: str) -> Optional[str]:
        """
        Pin JSON metadata to IPFS via Pinata
        Returns the IPFS CID if successful
        """
        headers = {
            "Authorization": f"Bearer {self.pinata_jwt}",
            "Content-Type": "application/json"
        }
        
        pinata_content = {
            "pinataContent": json_data,
            "pinataMetadata": {
                "name": f"{name}_metadata.json"
            }
        }
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.api_url}/pinJSONToIPFS",
                    headers=headers,
                    json=pinata_content
                ) as response:
                    
                    if response.status == 200:
                        result = await response.json()
                        cid = result.get("IpfsHash")
                        if cid:
                            logger.info(f"Pinned metadata to IPFS with CID: {cid}")
                            return cid
                    else:
                        error_text = await response.text()
                        logger.error(f"Pinata API error: {response.status} - {error_text}")
                        return None
                        
        except Exception as e:
            logger.error(f"Failed to pin to IPFS: {e}")
            return None
    
    async def pin_file_from_url(self, image_url: str, name: str) -> Optional[str]:
        """
        Download image from URL and pin to IPFS
        Returns the IPFS CID if successful
        """
        try:
            # First download the image
            async with aiohttp.ClientSession() as session:
                async with session.get(image_url) as response:
                    if response.status != 200:
                        logger.error(f"Failed to download image: {response.status}")
                        return None
                    
                    # Get content type from response
                    content_type = response.headers.get('Content-Type', 'image/png')
                    extension = self._get_extension_from_content_type(content_type)
                    
                    image_data = await response.read()
                    
                    # Prepare multipart form data
                    form_data = aiohttp.FormData()
                    form_data.add_field('file',
                                    image_data,
                                    filename=f'{name}_image{extension}',
                                    content_type=content_type)
                    
                    form_data.add_field('pinataMetadata',
                                    json.dumps({"name": f"{name}_image{extension}"}))
                    
                    headers = {
                        "Authorization": f"Bearer {self.pinata_jwt}"
                    }
                    
                    # Upload to Pinata
                    async with session.post(
                        f"{self.api_url}/pinFileToIPFS",
                        headers=headers,
                        data=form_data
                    ) as pinata_response:
                        
                        if pinata_response.status == 200:
                            result = await pinata_response.json()
                            cid = result.get("IpfsHash")
                            logger.info(f"Pinned image to IPFS with CID: {cid}")
                            return cid
                        else:
                            error_text = await pinata_response.text()
                            logger.error(f"Pinata file upload error: {error_text}")
                            return None
                            
        except Exception as e:
            logger.error(f"Failed to pin image to IPFS: {e}")
            return None

    def _get_extension_from_content_type(self, content_type: str) -> str:
        """Get file extension from content type"""
        if 'jpeg' in content_type or 'jpg' in content_type:
            return '.jpg'
        elif 'png' in content_type:
            return '.png'
        elif 'gif' in content_type:
            return '.gif'
        elif 'webp' in content_type:
            return '.webp'
        else:
            return '.png'  # default
        
    async def upload_metadata_with_image(self, metadata: Dict[str, Any]) -> Dict[str, Any]:
        """
        Complete workflow:
        1. Upload image to IPFS (if needed)
        2. Create metadata JSON WITHOUT ATTRIBUTES
        3. Upload metadata JSON to IPFS
        4. Return only the metadata URI
        """
        try:
            name = metadata.get("name", "token").replace(" ", "")
            
            # 1. Upload image to IPFS if it's a URL (not already IPFS)
            image_url = metadata.get("image", "")
            image_cid = None
            
            if image_url and not image_url.startswith("ipfs://"):
                # Upload image to IPFS
                image_cid = await self.pin_file_from_url(image_url, name)
                
                if image_cid:
                    # ✅ Update metadata with HTTP URL, not ipfs://
                    # pump.fun needs HTTP URL for the image
                    image_http_url = self.public_gateway_url.format(cid=image_cid)
                    metadata["image"] = image_http_url
                    logger.info(f"✅ Image uploaded to IPFS: {image_http_url}")
                else:
                    # Keep original URL if upload failed
                    logger.warning(f"Failed to upload image to IPFS, keeping original: {image_url}")
            
            # 2. Create clean metadata JSON for pump.fun
            # PUMP.FUN CRITICAL: NO ATTRIBUTES FIELD!
            pumpfun_metadata = {
                "name": metadata.get("name", ""),
                "symbol": metadata.get("symbol", ""),
                "description": metadata.get("description", "Token created via Flash Sniper"),
                "image": metadata.get("image", ""),  # This should now be HTTP URL
                "showName": True,
                "createdOn": "https://pump.fun",
                # Remove optional fields to save space
                # "twitter": metadata.get("twitter", ""),
                # "website": metadata.get("website", "https://pump.fun")
            }
            
            # ✅ OPTIONAL: Make description shorter to save space
            desc = pumpfun_metadata.get("description", "")
            if len(desc) > 100:
                pumpfun_metadata["description"] = desc[:97] + "..."
            
            logger.info(f"📄 Final metadata for IPFS: {json.dumps(pumpfun_metadata, indent=2)}")
            
            # 3. Upload metadata JSON to IPFS
            metadata_cid = await self.pin_json(pumpfun_metadata, name)
            
            if not metadata_cid:
                return {"success": False, "error": "Failed to upload metadata"}
            
            # 4. Return HTTP URL for metadata URI (this is what goes on-chain)
            metadata_uri = self.public_gateway_url.format(cid=metadata_cid)
            
            return {
                "success": True,
                "metadata_cid": metadata_cid,
                "metadata_uri": metadata_uri,  # HTTP URL for on-chain storage
                "image_cid": image_cid,  # Return image CID too
                "full_metadata": pumpfun_metadata  # The actual JSON that was uploaded
            }
            
        except Exception as e:
            logger.error(f"IPFS upload workflow failed: {e}")
            return {"success": False, "error": str(e)}
        
    def get_gateway_url(self, cid: str) -> str:
        """Get HTTP gateway URL from CID"""
        return self.public_gateway_url.format(cid=cid)

# Singleton instance
ipfs_service = IPFSService()

