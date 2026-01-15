# from fastapi import APIRouter, File, UploadFile, Form, Depends, HTTPException
# from fastapi.responses import JSONResponse
# from sqlalchemy.ext.asyncio import AsyncSession
# from app.database import get_db
# from app.security import get_current_user
# from app.models import User
# import httpx
# from app.config import settings
# import logging
# from typing import Optional
# import uuid
# import os
# from pathlib import Path
# import aiofiles

# logger = logging.getLogger(__name__)

# router = APIRouter(
#     prefix="/creators/image",
#     tags=['image-upload']
# )

# # Allowed file types
# ALLOWED_IMAGE_TYPES = {
#     "image/jpeg": "jpg",
#     "image/png": "png",
#     "image/gif": "gif",
#     "image/webp": "webp"
# }

# # Maximum file size (5MB)
# MAX_FILE_SIZE = 5 * 1024 * 1024

# @router.post("/upload-token-image")
# async def upload_token_image(
#     image: UploadFile = File(...),
#     name: str = Form(...),
#     symbol: str = Form(...),
#     description: Optional[str] = Form("Token created via Flash Sniper"),
#     current_user: User = Depends(get_current_user),
#     db: AsyncSession = Depends(get_db)
# ):
#     """
#     Upload token image to IPFS and generate metadata
#     """
#     try:
#         # Validate file type
#         if image.content_type not in ALLOWED_IMAGE_TYPES:
#             raise HTTPException(
#                 status_code=400,
#                 detail=f"Unsupported file type. Allowed: {', '.join(ALLOWED_IMAGE_TYPES.keys())}"
#             )
        
#         # Validate file size
#         contents = await image.read()
#         if len(contents) > MAX_FILE_SIZE:
#             raise HTTPException(
#                 status_code=400,
#                 detail=f"File too large. Maximum size is {MAX_FILE_SIZE // 1024 // 1024}MB"
#             )
        
#         # Reset file pointer
#         await image.seek(0)
        
#         logger.info(f"Uploading token image for user {current_user.wallet_address}")
#         logger.info(f"Token: {name} ({symbol})")
        
#         # Option 1: Upload to IPFS via Pinata (recommended)
#         try:
#             # Upload to Pinata
#             async with httpx.AsyncClient(timeout=30.0) as client:
#                 # Prepare form data
#                 files = {
#                     'file': (image.filename, await image.read(), image.content_type)
#                 }
                
#                 response = await client.post(
#                     "https://api.pinata.cloud/pinning/pinFileToIPFS",
#                     files=files,
#                     headers={
#                         "pinata_api_key": settings.PINATA_API_KEY,
#                         "pinata_secret_api_key": settings.PINATA_SECRET_KEY
#                     }
#                 )
                
#                 await image.seek(0)  # Reset for potential retry
                
#                 if response.status_code != 200:
#                     logger.error(f"Pinata upload failed: {response.status_code} - {response.text}")
#                     raise Exception(f"IPFS upload failed: {response.status_code}")
                
#                 pinata_result = response.json()
#                 ipfs_hash = pinata_result["IpfsHash"]
#                 ipfs_url = f"https://ipfs.io/ipfs/{ipfs_hash}"
                
#                 logger.info(f"✅ Image uploaded to IPFS: {ipfs_url}")
                
#                 # Generate metadata JSON
#                 metadata = {
#                     "name": name,
#                     "symbol": symbol,
#                     "description": description,
#                     "image": ipfs_url,
#                     "external_url": "https://pump.fun",
#                     "attributes": [
#                         {"trait_type": "Created On", "value": "Flash Sniper"},
#                         {"trait_type": "Image Uploaded", "value": "Yes"},
#                         {"trait_type": "Launch Strategy", "value": "Orchestrated Launch"}
#                     ]
#                 }
                
#                 # Upload metadata to IPFS
#                 metadata_response = await client.post(
#                     "https://api.pinata.cloud/pinning/pinJSONToIPFS",
#                     json=metadata,
#                     headers={
#                         "pinata_api_key": settings.PINATA_API_KEY,
#                         "pinata_secret_api_key": settings.PINATA_SECRET_KEY,
#                         "Content-Type": "application/json"
#                     }
#                 )
                
#                 if metadata_response.status_code != 200:
#                     logger.error(f"Metadata upload failed: {metadata_response.status_code}")
#                     # Still return the image URL even if metadata upload fails
#                     metadata_uri = ipfs_url
#                 else:
#                     metadata_result = metadata_response.json()
#                     metadata_hash = metadata_result["IpfsHash"]
#                     metadata_uri = f"https://ipfs.io/ipfs/{metadata_hash}"
#                     logger.info(f"✅ Metadata uploaded to IPFS: {metadata_uri}")
                
#                 return JSONResponse(
#                     status_code=200,
#                     content={
#                         "success": True,
#                         "cid": ipfs_hash,
#                         "image_url": ipfs_url,
#                         "metadata_uri": metadata_uri,
#                         "name": name,
#                         "symbol": symbol,
#                         "description": description
#                     }
#                 )
                
#         except Exception as pinata_error:
#             logger.error(f"Pinata upload failed: {pinata_error}")
            
#             # Option 2: Fallback - store locally and return URL
#             try:
#                 # Generate unique filename
#                 file_extension = ALLOWED_IMAGE_TYPES.get(image.content_type, "jpg")
#                 filename = f"{symbol}_{uuid.uuid4().hex[:8]}.{file_extension}"
                
#                 # Create uploads directory if it doesn't exist
#                 upload_dir = Path("uploads/token_images")
#                 upload_dir.mkdir(parents=True, exist_ok=True)
                
#                 # Save file
#                 file_path = upload_dir / filename
#                 async with aiofiles.open(file_path, "wb") as out_file:
#                     contents = await image.read()
#                     await out_file.write(contents)
                
#                 # Return local URL (you'll need to serve static files)
#                 image_url = f"{settings.BACKEND_BASE_URL}/uploads/token_images/{filename}"
                
#                 logger.info(f"✅ Image saved locally: {image_url}")
                
#                 # Create metadata with local image
#                 metadata_uri = image_url
                
#                 return JSONResponse(
#                     status_code=200,
#                     content={
#                         "success": True,
#                         "cid": filename,
#                         "image_url": image_url,
#                         "metadata_uri": metadata_uri,
#                         "name": name,
#                         "symbol": symbol,
#                         "description": description,
#                         "note": "Using local storage as fallback"
#                     }
#                 )
                
#             except Exception as local_error:
#                 logger.error(f"Local storage also failed: {local_error}")
#                 raise HTTPException(
#                     status_code=500,
#                     detail="Failed to upload image. Please try again later."
#                 )
                
#     except HTTPException:
#         raise
#     except Exception as e:
#         logger.error(f"Image upload failed: {e}", exc_info=True)
#         raise HTTPException(
#             status_code=500,
#             detail=f"Image upload failed: {str(e)}"
#         )


# @router.post("/upload-and-generate-metadata")
# async def upload_and_generate_metadata(
#     image: UploadFile = File(...),
#     name: str = Form(...),
#     symbol: str = Form(...),
#     description: Optional[str] = Form(None),
#     style: str = Form("meme"),
#     keywords: str = Form("crypto, meme, token"),
#     current_user: User = Depends(get_current_user),
#     db: AsyncSession = Depends(get_db)
# ):
#     """
#     Upload image AND generate enhanced metadata using AI
#     """
#     try:
#         # First upload the image
#         upload_result = await upload_token_image(
#             image=image,
#             name=name,
#             symbol=symbol,
#             description=description or f"Token {name} ({symbol})",
#             current_user=current_user,
#             db=db
#         )
        
#         if isinstance(upload_result, JSONResponse):
#             upload_data = upload_result.body
#             if isinstance(upload_data, bytes):
#                 upload_data = upload_data.decode('utf-8')
            
#             import json
#             result = json.loads(upload_data)
            
#             if result.get("success"):
#                 # Now generate enhanced metadata using the uploaded image
#                 from app.schemas.creators.openai import MetadataRequest
#                 from app.routers.creators.openai import generate_metadata
                
#                 metadata_request = MetadataRequest(
#                     name=name,
#                     symbol=symbol,
#                     style=style,
#                     keywords=keywords,
#                     category="meme",
#                     use_dalle=False,  # We already have an image
#                     image_url=result["image_url"],
#                     description=description
#                 )
                
#                 # Generate enhanced metadata
#                 metadata_response = await generate_metadata(metadata_request, source="upload")
                
#                 if metadata_response and metadata_response.success:
#                     # Combine uploaded image with AI metadata
#                     return JSONResponse(
#                         status_code=200,
#                         content={
#                             "success": True,
#                             "name": metadata_response.name or name,
#                             "symbol": metadata_response.symbol or symbol,
#                             "description": metadata_response.description or description,
#                             "metadata_uri": metadata_response.metadata_uri or result["metadata_uri"],
#                             "image_url": result["image_url"],
#                             "attributes": metadata_response.attributes,
#                             "image_prompt": metadata_response.image_prompt,
#                             "generated_with_ai": True,
#                             "uploaded_image": True
#                         }
#                     )
#                 else:
#                     # Return basic metadata with uploaded image
#                     return JSONResponse(
#                         status_code=200,
#                         content={
#                             "success": True,
#                             "name": name,
#                             "symbol": symbol,
#                             "description": description or f"Token {name} ({symbol})",
#                             "metadata_uri": result["metadata_uri"],
#                             "image_url": result["image_url"],
#                             "attributes": [
#                                 {"trait_type": "Image Source", "value": "User Upload"},
#                                 {"trait_type": "Created", "value": "Flash Sniper"}
#                             ],
#                             "generated_with_ai": False,
#                             "uploaded_image": True
#                         }
#                     )
        
#         raise HTTPException(status_code=500, detail="Upload failed")
        
#     except Exception as e:
#         logger.error(f"Upload and generate metadata failed: {e}", exc_info=True)
#         raise HTTPException(
#             status_code=500,
#             detail=f"Failed to process image: {str(e)}"
#         )
        
        
        


from fastapi import APIRouter, File, UploadFile, Form, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.security import get_current_user
from app.models import User
import httpx
from app.config import settings
import logging
from typing import Optional
import uuid
import os
from pathlib import Path
import aiofiles
import json
from app.services.ipfs_service import ipfs_service

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/creators/image",
    tags=['image-upload']
)

# Allowed file types
ALLOWED_IMAGE_TYPES = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp"
}

# Maximum file size (5MB)
MAX_FILE_SIZE = 5 * 1024 * 1024

@router.post("/upload-token-image")
async def upload_token_image(
    image: UploadFile = File(...),
    name: str = Form(...),
    symbol: str = Form(...),
    description: Optional[str] = Form("Token created via sliceofmango"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Upload token image to IPFS and generate complete metadata JSON
    Returns both image_url and metadata_uri for on-chain use
    """
    try:
        # Validate file type
        if image.content_type not in ALLOWED_IMAGE_TYPES:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type. Allowed: {', '.join(ALLOWED_IMAGE_TYPES.keys())}"
            )
        
        # Validate file size
        contents = await image.read()
        if len(contents) > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=400,
                detail=f"File too large. Maximum size is {MAX_FILE_SIZE // 1024 // 1024}MB"
            )
        
        # Reset file pointer
        await image.seek(0)
        
        logger.info(f"Uploading token image for user {current_user.wallet_address}")
        logger.info(f"Token: {name} ({symbol})")
        
        # Option 1: Upload to IPFS via Pinata using ipfs_service (recommended)
        try:
            # Save the uploaded file temporarily
            file_extension = ALLOWED_IMAGE_TYPES.get(image.content_type, "jpg")
            temp_filename = f"{symbol}_{uuid.uuid4().hex[:8]}.{file_extension}"
            
            # Create temp directory if it doesn't exist
            temp_dir = Path("temp_uploads")
            temp_dir.mkdir(parents=True, exist_ok=True)
            temp_path = temp_dir / temp_filename
            
            # Save uploaded file temporarily
            async with aiofiles.open(temp_path, "wb") as out_file:
                await out_file.write(contents)
            
            # Upload image to IPFS using ipfs_service
            logger.info(f"Uploading image to IPFS...")
            
            # First, create a temporary HTTP URL for the file
            # (This is needed because pin_file_from_url expects a URL)
            # Alternatively, we can modify ipfs_service to accept bytes directly
            # For now, we'll use the direct Pinata API
            
            # Reset file pointer again
            await image.seek(0)
            
            # Upload image file to Pinata
            async with httpx.AsyncClient(timeout=30.0) as client:
                # Upload image file
                files = {
                    'file': (image.filename, await image.read(), image.content_type)
                }
                
                logger.info(f"Uploading image file to Pinata...")
                response = await client.post(
                    "https://api.pinata.cloud/pinning/pinFileToIPFS",
                    files=files,
                    headers={
                        "pinata_api_key": settings.PINATA_API_KEY,
                        "pinata_secret_api_key": settings.PINATA_SECRET_KEY
                    }
                )
                
                if response.status_code != 200:
                    logger.error(f"Image upload failed: {response.status_code} - {response.text}")
                    raise Exception(f"IPFS image upload failed: {response.status_code}")
                
                image_result = response.json()
                image_cid = image_result["IpfsHash"]
                image_ipfs_url = f"ipfs://{image_cid}"
                image_http_url = f"https://ipfs.io/ipfs/{image_cid}"
                
                logger.info(f"✅ Image uploaded to IPFS: {image_http_url}")
                
                # ✅ CRITICAL: Prepare complete metadata for pump.fun
                # This should be the exact same format as AI-generated metadata
                complete_metadata = {
                    "name": name,
                    "symbol": symbol,
                    "description": description[:100] if len(description) > 100 else description,
                    "image": image_http_url,  # Use HTTP URL for metadata JSON
                    "showName": True,
                    "createdOn": "https://pump.fun",
                }
                
                logger.info(f"📄 Creating metadata JSON: {json.dumps(complete_metadata, indent=2)}")
                
                # Upload metadata JSON to IPFS
                logger.info(f"Uploading metadata JSON to IPFS...")
                metadata_response = await client.post(
                    "https://api.pinata.cloud/pinning/pinJSONToIPFS",
                    json={
                        "pinataContent": complete_metadata,
                        "pinataMetadata": {
                            "name": f"{name}_{symbol}_metadata.json"
                        }
                    },
                    headers={
                        "pinata_api_key": settings.PINATA_API_KEY,
                        "pinata_secret_api_key": settings.PINATA_SECRET_KEY,
                        "Content-Type": "application/json"
                    }
                )
                
                if metadata_response.status_code != 200:
                    logger.error(f"Metadata upload failed: {metadata_response.status_code}")
                    # If metadata upload fails, we can still return the image
                    metadata_uri = image_http_url
                    logger.warning(f"Using image URL as fallback metadata URI: {metadata_uri}")
                else:
                    metadata_result = metadata_response.json()
                    metadata_cid = metadata_result["IpfsHash"]
                    metadata_uri = f"https://ipfs.io/ipfs/{metadata_cid}"
                    logger.info(f"✅ Metadata uploaded to IPFS: {metadata_uri}")
                
                # Clean up temp file
                try:
                    temp_path.unlink()
                except:
                    pass
                
                # ✅ Return EXACTLY what the frontend needs for custom metadata
                return JSONResponse(
                    status_code=200,
                    content={
                        "success": True,
                        "custom_metadata": {
                            "name": name,
                            "symbol": symbol,
                            "description": description,
                            "image_url": image_http_url,  # HTTP URL for the image
                            "metadata_uri": metadata_uri,  # HTTP URL for the metadata JSON
                            "skip_ai_generation": True  # Tell the launch endpoint to use this metadata
                        },
                        "image_cid": image_cid,
                        "metadata_cid": metadata_cid if metadata_response.status_code == 200 else None,
                        "message": "Image and metadata uploaded successfully to IPFS"
                    }
                )
                
        except Exception as pinata_error:
            logger.error(f"Pinata upload failed: {pinata_error}")
            
            # Option 2: Fallback - store locally and return URL
            try:
                # Generate unique filename
                file_extension = ALLOWED_IMAGE_TYPES.get(image.content_type, "jpg")
                filename = f"{symbol}_{uuid.uuid4().hex[:8]}.{file_extension}"
                
                # Create uploads directory if it doesn't exist
                upload_dir = Path("uploads/token_images")
                upload_dir.mkdir(parents=True, exist_ok=True)
                
                # Save file
                await image.seek(0)
                file_path = upload_dir / filename
                async with aiofiles.open(file_path, "wb") as out_file:
                    contents = await image.read()
                    await out_file.write(contents)
                
                # Return local URL
                image_url = f"{settings.BACKEND_BASE_URL}/uploads/token_images/{filename}"
                metadata_uri = image_url  # Use same URL as fallback
                
                logger.info(f"✅ Image saved locally: {image_url}")
                
                return JSONResponse(
                    status_code=200,
                    content={
                        "success": True,
                        "custom_metadata": {
                            "name": name,
                            "symbol": symbol,
                            "description": description,
                            "image_url": image_url,
                            "metadata_uri": metadata_uri,
                            "skip_ai_generation": True
                        },
                        "note": "Using local storage as fallback"
                    }
                )
                
            except Exception as local_error:
                logger.error(f"Local storage also failed: {local_error}")
                raise HTTPException(
                    status_code=500,
                    detail="Failed to upload image. Please try again later."
                )
                
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Image upload failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Image upload failed: {str(e)}"
        )


@router.post("/upload-and-generate-metadata")
async def upload_and_generate_metadata(
    image: UploadFile = File(...),
    name: str = Form(...),
    symbol: str = Form(...),
    description: Optional[str] = Form(None),
    style: str = Form("meme"),
    keywords: str = Form("crypto, meme, token"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Upload image AND generate enhanced metadata using AI
    """
    try:
        # First upload the image
        upload_result = await upload_token_image(
            image=image,
            name=name,
            symbol=symbol,
            description=description or f"Token {name} ({symbol})",
            current_user=current_user,
            db=db
        )
        
        if isinstance(upload_result, JSONResponse):
            result = upload_result.body
            if isinstance(result, bytes):
                result = result.decode('utf-8')
            
            result = json.loads(result)
            
            if result.get("success"):
                custom_metadata = result.get("custom_metadata", {})
                
                # Now generate enhanced metadata using the uploaded image
                from app.schemas.creators.openai import MetadataRequest
                
                metadata_request = MetadataRequest(
                    style=style,
                    keywords=keywords,
                    category="meme",
                    theme=f"Custom token {name}",
                    use_dalle=False,  # We already have an image
                    existing_image=custom_metadata.get("image_url"),
                    existing_metadata={
                        "name": name,
                        "symbol": symbol,
                        "description": description,
                        "skip_ai_generation": True
                    }
                )
                
                # Call the OpenAI endpoint to generate enhanced metadata
                async with httpx.AsyncClient(timeout=60.0) as client:
                    response = await client.post(
                        f"{settings.BACKEND_BASE_URL}/ai/generate-metadata",
                        json=metadata_request.dict(),
                        headers={"X-API-Key": settings.ONCHAIN_API_KEY}
                    )
                    
                    if response.status_code == 200:
                        ai_metadata = response.json()
                        
                        if ai_metadata.get("success"):
                            # Combine with custom metadata
                            return JSONResponse(
                                status_code=200,
                                content={
                                    "success": True,
                                    "custom_metadata": {
                                        "name": ai_metadata.get("name", name),
                                        "symbol": ai_metadata.get("symbol", symbol),
                                        "description": ai_metadata.get("description", description),
                                        "image_url": ai_metadata.get("image_url", custom_metadata.get("image_url")),
                                        "metadata_uri": ai_metadata.get("metadata_uri", custom_metadata.get("metadata_uri")),
                                        "skip_ai_generation": True
                                    },
                                    "generated_with_ai": True,
                                    "uploaded_image": True
                                }
                            )
                
                # If AI generation fails, return the basic uploaded metadata
                return JSONResponse(
                    status_code=200,
                    content={
                        "success": True,
                        "custom_metadata": custom_metadata,
                        "generated_with_ai": False,
                        "uploaded_image": True
                    }
                )
        
        raise HTTPException(status_code=500, detail="Upload failed")
        
    except Exception as e:
        logger.error(f"Upload and generate metadata failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to process image: {str(e)}"
        )


@router.post("/quick-upload")
async def quick_upload_token_image(
    image: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Quick upload - auto-generate name and symbol based on filename
    """
    try:
        # Generate token name and symbol from filename
        original_name = image.filename
        base_name = Path(original_name).stem
        
        # Clean and format
        clean_name = "".join([c for c in base_name if c.isalnum() or c.isspace()]).strip()
        if not clean_name:
            clean_name = "Token"
        
        name = clean_name[:20]  # Max 20 chars
        symbol = clean_name[:6].upper()  # Max 6 chars, uppercase
        
        # Call the main upload function
        return await upload_token_image(
            image=image,
            name=name,
            symbol=symbol,
            description=f"Token created from {original_name}",
            current_user=current_user,
            db=db
        )
        
    except Exception as e:
        logger.error(f"Quick upload failed: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Quick upload failed: {str(e)}"
        )


@router.get("/test-ipfs-connection")
async def test_ipfs_connection():
    """
    Test IPFS connection and permissions
    """
    try:
        # Test with ipfs_service
        test_data = {
            "test": "IPFS connection test",
            "timestamp": "now"
        }
        
        cid = await ipfs_service.pin_json(test_data, "test_connection")
        
        if cid:
            return {
                "success": True,
                "message": "IPFS connection successful via ipfs_service",
                "cid": cid,
                "gateway_url": ipfs_service.get_gateway_url(cid)
            }
        else:
            return {
                "success": False,
                "message": "ipfs_service failed to connect"
            }
            
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "message": "Check ipfs_service configuration"
        }
        
        
        