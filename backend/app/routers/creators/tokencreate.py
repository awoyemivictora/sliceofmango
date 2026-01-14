import asyncio
from datetime import datetime
import json
import logging
from typing import Any, Dict, List, Optional, Tuple
import uuid
import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import BotStatus, TokenMetadata, User, Trade, TokenLaunch, LaunchStatus, BotWallet, LaunchQueue
from app.database import get_db
from app.config import settings
from app.routers.creators.openai import generate_metadata
from app.routers.creators.user import get_sol_balance
from app.schemas.creators.openai import Attribute, MetadataRequest, SimpleMetadataResponse
from app.schemas.creators.tokencreate import AtomicLaunchRequest, AtomicLaunchResponse, CostEstimationResponse, LaunchConfigCreate, LaunchCreate, LaunchHistoryItem, LaunchHistoryResponse, LaunchStatusResponse, QuickLaunchRequest, SellStrategyType
from app.security import get_current_user
from app.utils import redis_client
from app.services.onchain_integration import onchain_client
import random
import numpy as np
from app.utils.bot_components import websocket_manager


# Configure logging
logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/creators/token",
    tags=['token']
)

# ============================================
# LAUNCH MANAGER 
# ============================================

class LaunchCoordinator:
    """Manages token launches for creator mode"""
    
    def __init__(self, launch_id: str, user: User, db: AsyncSession):
        self.launch_id = launch_id
        self.user = user
        self.db = db
        self.status = {
            "launch_id": launch_id,
            "status": LaunchStatus.SETUP,
            "progress": 0,
            "message": "Initializing launch...",
            "current_step": "Setup",
            "started_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
            "estimated_time_remaining": 300
        }
        self.launch_config: Optional[Dict[str, Any]] = None
        self.metadata_for_token: Optional[Dict[str, Any]] = None  # Changed to Dict
        self.mint_address: Optional[str] = None
        self.bot_wallets: List[BotWallet] = []
        self.launch_record: Optional[TokenLaunch] = None
        
    async def prepare_launch(self, config: LaunchConfigCreate) -> bool:
        """Prepare launch with automatic bot funding"""
        try:
            # Store config
            self.launch_config = config.model_dump()
            
            # Create launch record
            await self._create_launch_record()
            await self._update_status(LaunchStatus.SETUP, 10, "Validating configuration...")
            
            # Validate user has creator mode enabled
            if not self.user.creator_enabled:
                raise HTTPException(
                    status_code=403,
                    detail="Creator mode not enabled"
                )
            
            # Check user balance
            total_required = await self._calculate_required_balance(config)
            user_balance = await get_sol_balance(self.user.wallet_address)
            
            if user_balance < total_required:
                raise HTTPException(
                    status_code=400,
                    detail=f"Insufficient balance. Need {total_required} SOL, have {user_balance} SOL"
                )
            
            # ✅ CRITICAL: Use BotFundingManager to ensure bots are funded
            await self._update_status(LaunchStatus.SETUP, 20, "Checking bot wallet funding...")
            
            funding_manager = BotFundingManager(self.user, self.db)
            
            try:
                # This will automatically fund bots if needed
                self.bot_wallets = await funding_manager.ensure_bots_funded(
                    bot_count=config.bot_count,
                    min_balance_per_bot=config.bot_buy_amount,
                    required_amount_per_bot=config.bot_buy_amount * 1.2  # 20% buffer
                )
                
                await self._update_status(LaunchStatus.SETUP, 30, f"✅ {len(self.bot_wallets)} bots funded and ready")
                
            except Exception as e:
                logger.error(f"Bot funding failed: {e}")
                raise HTTPException(
                    status_code=400,
                    detail=f"Failed to prepare bot wallets: {str(e)}"
                )
            
            # Update launch record
            await self._update_launch_with_metadata()
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to prepare launch {self.launch_id}: {e}", exc_info=True)
            await self.db.rollback()
            await self._update_status(LaunchStatus.FAILED, 0, f"Preparation failed: {str(e)}")
            return False
    
    async def _update_user_stats(self, results: Dict[str, Any]):
        """Update user stats after successful launch"""
        try:
            # Update user's creator stats
            self.user.creator_total_launches += 1
            self.user.creator_successful_launches += 1
            self.user.creator_total_profit += results.get("total_profit", 0)
            
            # Calculate new average ROI
            total_launches = self.user.creator_total_launches
            if total_launches > 0:
                self.user.creator_average_roi = self.user.creator_total_profit / total_launches
            
            # Update last launch time
            self.user.creator_last_launch_time = datetime.utcnow()
            
            await self.db.commit()
            
        except Exception as e:
            logger.error(f"Failed to update user stats: {e}")
            # Don't fail the launch if stats update fails
    
    async def execute_launch(self):
        """Execute the complete launch process with atomic-launch"""
        try:
            # Emit launch started event
            from app.utils.bot_components import websocket_manager
            await websocket_manager.broadcast_launch_event(
                launch_id=self.launch_id,
                event="launch_execution_started",
                data={
                    "status": "executing",
                    "message": "Starting launch execution...",
                    "started_at": datetime.utcnow().isoformat()
                }
            )
        
            # Check on-chain service health first
            if not await onchain_client.health_check():
                raise Exception("On-chain service is not available")
            
            # Ensure metadata exists before token creation
            if not self.metadata_for_token:
                logger.warning("No metadata found, ensuring metadata exists...")
                await self._ensure_metadata()
                
            # 1. Create token + creator buy + all bot buys in ONE atomic launch
            await self._update_status(LaunchStatus.ONCHAIN_CREATION, 40, "Creating token with atomic launch...")
            token_result = await self._create_token_onchain()
            
            if not token_result.get("success"):
                error_msg = token_result.get("error", "Unknown error")
                raise Exception(f"Atomic launch failed: {error_msg}")
            
            self.mint_address = token_result.get("mint_address")
            
            # Update launch record
            self.launch_record.mint_address = self.mint_address
            self.launch_record.creator_tx_hash = token_result.get("signatures", [None])[0]
            await self.db.commit()
            
            # Calculate results BEFORE emitting the completion event
            results = await self._calculate_results()
            
            # 2. Skip monitoring for now - just complete the launch
            await self._update_status(LaunchStatus.COMPLETE, 100, "🎉 Atomic launch completed successfully!")
            
            # Emit launch completed event - NOW results is defined
            await websocket_manager.broadcast_launch_event(
                launch_id=self.launch_id,
                event="launch_completed",
                data={
                    "status": "complete",
                    "message": "Launch completed successfully!",
                    "completed_at": datetime.utcnow().isoformat(),
                    "results": results  # This was undefined before
                }
            )
            
            # Update final launch record
            self.launch_record.success = True
            self.launch_record.total_profit = results["total_profit"]
            self.launch_record.roi = results["roi"]
            self.launch_record.duration = results["duration"]
            self.launch_record.completed_at = datetime.utcnow()
            await self.db.commit()
            
            # Update user stats
            await self._update_user_stats(results)
            
            return {
                "success": True,
                "launch_id": self.launch_id,
                "mint_address": self.mint_address,
                "results": results
            }
            
        except Exception as e:
            logger.error(f"Launch {self.launch_id} failed: {e}", exc_info=True)
            
            # Emit launch failed event
            await websocket_manager.broadcast_launch_event(
                launch_id=self.launch_id,
                event="launch_failed",
                data={
                    "status": "failed",
                    "message": f"Launch failed: {str(e)}",
                    "error": str(e),
                    "failed_at": datetime.utcnow().isoformat()
                }
            )
            
            await self._update_status(LaunchStatus.FAILED, 0, f"Launch failed: {str(e)}")
            
            # Update launch record as failed
            if self.launch_record:
                self.launch_record.success = False
                self.launch_record.completed_at = datetime.utcnow()
                self.launch_record.message = str(e)
                await self.db.commit()
            
            return {
                "success": False,
                "launch_id": self.launch_id,
                "error": str(e)
            }
            
    # async def _ensure_metadata(self):
    #     """Ensure metadata exists, generate if not"""
    #     try:
    #         if not self.metadata_for_token:
    #             logger.info(f"No metadata found for launch {self.launch_id}, generating...")
                
    #             if self.launch_config:
    #                 # Try to get from custom_metadata
    #                 custom_metadata = self.launch_config.get("custom_metadata")
    #                 if custom_metadata:
    #                     self.metadata_for_token = custom_metadata
    #                     logger.info(f"Using custom metadata from config")
                        
    #                     # ✅ Ensure URI exists
    #                     if "uri" not in self.metadata_for_token and "metadata_uri" not in self.metadata_for_token:
    #                         # Try to use image as fallback URI
    #                         if "image_url" in self.metadata_for_token:
    #                             self.metadata_for_token["uri"] = self.metadata_for_token["image_url"]
    #                         elif "image" in self.metadata_for_token:
    #                             self.metadata_for_token["uri"] = self.metadata_for_token["image"]
    #                         else:
    #                             self.metadata_for_token["uri"] = "https://placehold.co/600x400"
    #                         logger.info(f"Added fallback URI: {self.metadata_for_token['uri']}")
    #                 elif self.launch_config.get("use_ai_metadata", True):
    #                     # Generate AI metadata
    #                     from app.schemas.creators.openai import MetadataRequest
                        
    #                     metadata_request = MetadataRequest(
    #                         style=self.launch_config.get("metadata_style", "meme"),
    #                         keywords=self.launch_config.get("metadata_keywords", ""),
    #                         category=self.launch_config.get("metadata_category", "meme"),
    #                         theme=f"Launch by {self.user.wallet_address[:8]}...",
    #                         use_dalle=self.launch_config.get("use_dalle_generation", False)
    #                     )
                        
    #                     # Call the OpenAI metadata generation function
    #                     from app.routers.creators.openai import generate_metadata
    #                     response = await generate_metadata(metadata_request)
                        
    #                     if not response or not response.success:
    #                         raise Exception("AI metadata generation failed")
                        
    #                     # ✅ Use the simplified response directly
    #                     self.metadata_for_token = {
    #                         "name": response.name,
    #                         "symbol": response.symbol,
    #                         "metadata_uri": response.metadata_uri,  # This is what goes on-chain
    #                         "image_url": response.image_url,
    #                         "description": response.description
    #                     }
    #                     logger.info(f"AI metadata generated via _ensure_metadata")
                        
    #                 else:
    #                     # Generate basic metadata
    #                     timestamp = int(datetime.utcnow().timestamp())
    #                     self.metadata_for_token = {
    #                         "name": f"Token_{timestamp}",
    #                         "symbol": f"TKN{timestamp % 10000:04d}",
    #                         "image": "https://placehold.co/600x400",
    #                         "uri": "https://placehold.co/600x400",
    #                         "description": "Token created via Flash Sniper",
    #                         "attributes": [
    #                             {"trait_type": "Platform", "value": "Flash Sniper"},
    #                             {"trait_type": "Created", "value": datetime.utcnow().strftime("%Y-%m-%d")},
    #                         ]
    #                     }
    #                     logger.info(f"Created fallback metadata: {self.metadata_for_token['name']}")
            
    #         # ✅ Log what we have
    #         logger.info(f"Final metadata keys: {list(self.metadata_for_token.keys())}")
    #         logger.info(f"Metadata URI: {self.metadata_for_token.get('uri', 'No URI found')}")
    #         logger.info(f"Metadata URI alternative: {self.metadata_for_token.get('metadata_uri', 'No metadata_uri found')}")
            
    #     except Exception as e:
    #         logger.error(f"Failed to ensure metadata: {e}", exc_info=True)
    #         # Fallback metadata
    #         timestamp = int(datetime.utcnow().timestamp())
    #         self.metadata_for_token = {
    #             "name": f"Token_{timestamp}",
    #             "symbol": f"TKN{timestamp % 10000:04d}",
    #             "image": "https://placehold.co/600x400",
    #             "uri": "https://placehold.co/600x400",
    #             "description": "Token created via Flash Sniper"
    #         }

    async def _ensure_metadata(self):
        """Ensure metadata exists, generate if not"""
        try:
            if not self.metadata_for_token:
                logger.info(f"No metadata found for launch {self.launch_id}, generating...")
                
                if self.launch_config:
                    # Get metadata source from config
                    metadata_source = self.launch_config.get("metadata_source", "ai")
                    use_images = self.launch_config.get("use_images", True)
                    style = self.launch_config.get("metadata_style", "trending")
                    
                    if metadata_source == "trending":
                        # Generate from trending
                        async with httpx.AsyncClient(timeout=60.0) as client:
                            response = await client.post(
                                f"{settings.BACKEND_BASE_URL}/ai/generate-from-trending-simple",
                                json={
                                    "style": style,
                                    "use_x_image": use_images
                                },
                                headers={"X-API-Key": settings.ONCHAIN_API_KEY}
                            )
                            
                            if response.status_code == 200:
                                result = response.json()
                                if result.get("success"):
                                    self.metadata_for_token = {
                                        "name": result["name"],
                                        "symbol": result["symbol"],
                                        "metadata_uri": result["metadata_uri"],
                                        "image_url": result["image_url"],
                                        "description": result.get("description", ""),
                                        "source": "trending"
                                    }
                    else:
                        # Generate AI metadata
                        metadata_request = MetadataRequest(
                            style=style,
                            keywords=self.launch_config.get("metadata_keywords", ""),
                            category=self.launch_config.get("metadata_category", "meme"),
                            use_dalle=use_images,
                            theme=f"Launch by {self.user.wallet_address[:8]}..."
                        )
                        
                        response = await generate_metadata(metadata_request, source="ai")
                        
                        if response and response.success:
                            self.metadata_for_token = {
                                "name": response.name,
                                "symbol": response.symbol,
                                "metadata_uri": response.metadata_uri,
                                "image_url": response.image_url,
                                "description": response.description,
                                "source": "ai"
                            }
                            
                            
        except Exception as e:
            logger.error(f"Failed to ensure metadata: {e}", exc_info=True)
            # Fallback metadata
            timestamp = int(datetime.utcnow().timestamp())
            self.metadata_for_token = {
                "name": f"Token_{timestamp}",
                "symbol": f"TKN{timestamp % 10000:04d}",
                "image": "https://placehold.co/600x400",
                "uri": "https://placehold.co/600x400",
                "description": "Token created via Flash Sniper"
            }
                        
    async def _calculate_results(self) -> Dict[str, Any]:
        """Calculate launch results"""
        try:
            # Calculate total investment
            creator_investment = self.launch_config.get("creator_buy_amount", 0.0) if self.launch_config else 0.0
            bot_investment = sum(bot.buy_amount or 0.0 for bot in self.bot_wallets)
            total_investment = creator_investment + bot_investment
            
            # For now, since we're not selling, profit is 0
            # In a real implementation, you would check the current value of tokens
            total_profit = 0.0
            
            # Calculate ROI
            roi = (total_profit / total_investment * 100) if total_investment > 0 else 0.0
            
            # Calculate duration
            if self.launch_record and self.launch_record.started_at:
                duration_seconds = (datetime.utcnow() - self.launch_record.started_at).total_seconds()
                duration = round(duration_seconds, 2)
            else:
                duration = 0
            
            # Determine successful bots
            successful_bots = len([bot for bot in self.bot_wallets if bot.status == "bought"])
            
            return {
                "total_profit": total_profit,
                "roi": roi,
                "duration": duration,
                "total_investment": total_investment,
                "creator_investment": creator_investment,
                "bot_investment": bot_investment,
                "bot_count": len(self.bot_wallets),
                "successful_bots": successful_bots,
                "token_created": self.mint_address is not None,
                "creator_buy_executed": self.launch_record.creator_tx_hash is not None if self.launch_record else False,
                "bot_buys_executed": successful_bots > 0,
                "message": "Atomic launch completed successfully" if self.mint_address else "Launch failed"
            }
            
        except Exception as e:
            logger.error(f"Failed to calculate results: {e}", exc_info=True)
            return {
                "total_profit": 0.0,
                "roi": 0.0,
                "duration": 0,
                "total_investment": 0.0,
                "bot_count": len(self.bot_wallets),
                "successful_bots": 0,
                "error": str(e),
                "message": f"Error calculating results: {str(e)}"
            }
            
    async def _calculate_required_balance(self, config: LaunchConfigCreate) -> float:
        """Calculate required SOL balance for launch"""
        bot_cost = config.bot_count * config.bot_buy_amount
        creator_cost = config.creator_buy_amount
        fees = 0.1  # Estimated fees
        
        return bot_cost + creator_cost + fees
    
    async def _get_metadata(self, config: LaunchConfigCreate):
        """Get or generate metadata using OpenAI"""
        try:
            logger.info(f"Generating metadata for launch {self.launch_id}")
            
            # Convert config to dict for easier access
            config_dict = config.model_dump()
            
            if config_dict.get("custom_metadata"):
                # Use custom metadata provided by user
                custom_data = config_dict["custom_metadata"]
                
                # ✅ Check if custom metadata already has a URI
                if custom_data.get("metadata_uri"):
                    # User provided complete metadata including URI
                    self.metadata_for_token = {
                        "name": custom_data.get("name"),
                        "symbol": custom_data.get("symbol"),
                        "metadata_uri": custom_data.get("metadata_uri"),
                        "image_url": custom_data.get("image_url", custom_data.get("image"))
                    }
                else:
                    # Generate metadata for custom token
                    # You might want to call generate_metadata here with custom data
                    raise Exception("Custom metadata must include metadata_uri for on-chain use")
                    
            elif config_dict.get("use_ai_metadata", True):
                # Generate AI metadata
                metadata_request = MetadataRequest(
                    style=config_dict.get("metadata_style", "meme"),
                    keywords=config_dict.get("metadata_keywords", ""),
                    category=config_dict.get("metadata_category", "meme"),
                    theme=f"Launch by {self.user.wallet_address[:8]}...",
                    use_dalle=config_dict.get("use_dalle_generation", False)
                )
                
                # Call the OpenAI metadata generation function
                response = await generate_metadata(metadata_request)
                
                if not response or not response.success:
                    raise Exception("AI metadata generation failed")
                
                # ✅ Use the simplified response directly
                self.metadata_for_token = {
                    "name": response.name,
                    "symbol": response.symbol,
                    "metadata_uri": response.metadata_uri,  # This is what goes on-chain
                    "image_url": response.image_url,
                    "description": response.description
                }
                
                logger.info(f"AI metadata generated: {self.metadata_for_token['name']} ({self.metadata_for_token['symbol']})")
                logger.info(f"Metadata URI: {self.metadata_for_token['metadata_uri']}")
                
            else:
                # Generate basic metadata
                timestamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
                self.metadata_for_token = {
                    "name": f"Token_{timestamp}",
                    "symbol": f"TKN{timestamp[-4:]}",
                    "description": "Token created via Flash Sniper",
                    "image_url": "https://placehold.co/600x400",
                    # For basic tokens without IPFS, we can use a data URI or placeholder
                    "metadata_uri": f"data:application/json,{json.dumps({
                        'name': f'Token_{timestamp}',
                        'symbol': f'TKN{timestamp[-4:]}',
                        'image': 'https://placehold.co/600x400'
                    })}"
                }
            
            logger.info(f"✅ Metadata ready: {self.metadata_for_token['name']}")
            logger.info(f"✅ Metadata URI: {self.metadata_for_token.get('metadata_uri', 'No URI')}")
            
        except Exception as e:
            logger.error(f"Failed to generate metadata: {e}", exc_info=True)
            # Fallback to basic metadata
            timestamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
            self.metadata_for_token = {
                "name": f"Token_{timestamp}",
                "symbol": f"TKN{timestamp[-4:]}",
                "description": "Token created via Flash Sniper",
                "image_url": "https://placehold.co/600x400",
                "metadata_uri": f"data:application/json,{json.dumps({
                    'name': f'Token_{timestamp}',
                    'symbol': f'TKN{timestamp[-4:]}',
                    'image': 'https://placehold.co/600x400'
                })}"
            }  
    
    async def _get_available_funded_bots(self, count: int, min_balance: float = 0.0001):
        """Get bot wallets that have sufficient balance for buying"""
        from app.routers.creators.user import get_sol_balance
        
        # Get all bots for this user
        stmt = select(BotWallet).where(
            BotWallet.user_wallet_address == self.user.wallet_address
        ).limit(count * 2)  # Get extra in case some don't have enough balance
        
        result = await self.db.execute(stmt)
        all_bots = result.scalars().all()
        
        # Check each bot's actual balance
        available_bots = []
        for bot in all_bots:
            try:
                balance = await get_sol_balance(bot.public_key)
                logger.info(f"Bot {bot.public_key[:8]}...: {balance} SOL (required: {min_balance})")
                
                if balance >= min_balance:
                    available_bots.append(bot)
                    
                    if len(available_bots) >= count:
                        break
                        
            except Exception as e:
                logger.error(f"Failed to check balance for bot {bot.public_key[:8]}: {e}")
                continue
        
        if len(available_bots) < count:
            raise Exception(f"Not enough funded bot wallets. Need {count} with min {min_balance} SOL, found {len(available_bots)}")
        
        self.bot_wallets = available_bots
        return available_bots
   
    async def _get_bot_wallets(self, count: int):
        """Get available bot wallets"""
        from app.models import BotStatus  # Import the enum
        
        # Get bots that are available (PENDING, READY, or FUNDED)
        stmt = select(BotWallet).where(
            BotWallet.user_wallet_address == self.user.wallet_address,
            BotWallet.status.in_([
                BotStatus.PENDING, 
                BotStatus.READY, 
                BotStatus.FUNDED,
                BotStatus.ACTIVE
            ])
        ).limit(count)
        
        result = await self.db.execute(stmt)
        self.bot_wallets = result.scalars().all()
        
        # ✅ ADD DEBUG LOGGING
        logger.info(f"🔍 Found {len(self.bot_wallets)} available bot wallets")
        for i, bot in enumerate(self.bot_wallets):
            logger.info(f"  Bot {i+1}: {bot.public_key[:8]}..., Status: {bot.status}")
            
        if len(self.bot_wallets) < count:
            raise Exception(f"Not enough bot wallets. Need {count}, have {len(self.bot_wallets)}")
        
    async def _create_launch_record(self):
        """Create launch record in database"""
        try:
            launch = TokenLaunch(
                launch_id=self.launch_id,
                user_wallet_address=self.user.wallet_address,
                config=self.launch_config or {},  # Use empty dict if not set yet
                metadata_for_token=None,  # Will be updated later
                status=LaunchStatus.SETUP,
                progress=0,
                message="Launch created",
                current_step="Setup",
                started_at=datetime.utcnow()
            )
            
            self.db.add(launch)
            await self.db.commit()
            self.launch_record = launch # Store the record
            logger.info(f"Created launch record: {self.launch_id}")
        except Exception as e:
            logger.error(f"Failed to create launch record: {e}", exc_info=True)
            raise
    
    async def _update_status(self, status: LaunchStatus, progress: int, message: str):
        """Update launch status"""
        try:
            self.status.update({
                "status": status.value,
                "progress": progress,
                "message": message,
                "current_step": status.value.replace("_", " ").title(),
                "updated_at": datetime.utcnow().isoformat(),
                "estimated_time_remaining": max(0, 300 - (datetime.utcnow() - datetime.fromisoformat(self.status["started_at"])).seconds)
            })

            # Emit WebSocket event
            from app.utils.bot_components import websocket_manager
            await websocket_manager.broadcast_launch_event(
                launch_id=self.launch_id,
                event="status_update",
                data=self.status
            )

            # Update database - handle transaction aborted state
            try:
                stmt = select(TokenLaunch).where(TokenLaunch.launch_id == self.launch_id)
                result = await self.db.execute(stmt)
                launch = result.scalar_one_or_none()
                
                if not launch:
                    logger.error(f"Launch {self.launch_id} not found in database")
                    return
                
                launch.status = status
                launch.progress = progress
                launch.message = message
                launch.current_step = self.status["current_step"]
                
                await self.db.commit()
            except Exception as db_error:
                logger.error(f"Database error updating status: {db_error}")
                # Try to refresh the session if transaction is aborted
                await self.db.rollback()
            
            # Send WebSocket update
            try:
                from app.routers.creators.websocket import send_launch_status_update
                await send_launch_status_update(self.launch_id, self.status)
            except Exception as ws_error:
                logger.error(f"WebSocket error: {ws_error}")
            
            # Update Redis for real-time status
            try:
                await redis_client.setex(
                    f"launch_status:{self.launch_id}",
                    3600,
                    json.dumps(self.status)
                )
            except Exception as redis_error:
                logger.error(f"Redis error: {redis_error}")
                
        except Exception as e:
            logger.error(f"Failed to update status for {self.launch_id}: {e}", exc_info=True)
             
    async def _update_launch_with_metadata(self):
        """Update launch record with generated metadata"""
        try:
            if self.launch_record and self.metadata_for_token:
                self.launch_record.metadata_for_token = self.metadata_for_token
                await self.db.commit()
        except Exception as e:
            logger.error(f"Failed to update launch with metadata: {e}", exc_info=True)
            
    async def _calculate_dynamic_buy_amounts(
        self,
        base_amount: float,
        count: int, 
        variability: float = 0.3,   # ±30% variability by default
        distribution: str = "normal"    # normal, uniform, or log_normal
    ) -> List[float]:
        """
        Generate dynamic buy amounts based on base amount
        Returns a list of amounts with natural variability
        """
        amounts = []
        
        if distribution == "normal":
            # Normal distribution centered around base_amount
            mean = base_amount
            std_dev = base_amount * variability
            
            for _ in range(count):
                amount = np.random.normal(mean, std_dev)
                # Ensure minimum and reasonable bounds
                amount = max(amount, base_amount * 0.1) # Minimum 10% of base
                amount = min(amount, base_amount * 2.0) # Maximum 200% of base
                amounts.append(round(amount, 6))    # Round to 6 decimal places
        
        elif distribution == "uniform":
            # FIXED: Changed (1 - variability) to (1 + variability) for upper bound
            lower = base_amount * (1 - variability)
            upper = base_amount * (1 + variability)  # ✅ FIXED THIS LINE
            
            for _ in range(count):
                amount = np.random.uniform(lower, upper)
                amounts.append(round(amount, 6))
                
        elif distribution == "log_normal":
            # Log-normal distribution (more organic-looking)
            # This creates a distribution where most values are near base_amount
            # but with a long tail of larger values
            sigma = variability # controls spread
            amounts = np.random.lognormal(
                mean=np.log(base_amount),
                sigma=sigma,
                size=count
            ).tolist()
            amounts = [round(a, 6) for a in amounts]
        
        else:
            # Simple random variation
            for _ in range(count):
                variation = random.uniform(1 - variability, 1 + variability)
                amount = base_amount * variation
                amounts.append(round(amount, 6))
                
        # Shuffle to remove any patterns
        random.shuffle(amounts)
        
        logger.info(f"Generated {len(amounts)} dynamic buy amounts:")
        logger.info(f"  Base: {base_amount}")
        logger.info(f"  Min: {min(amounts):.6f}")
        logger.info(f"  Max: {max(amounts):.6f}")
        logger.info(f"  Avg: {sum(amounts)/len(amounts):.6f}")  # ✅ Fixed typo here
        
        return amounts
    
    async def _create_token_onchain(self) -> Dict[str, Any]:
        """Create token with creator buy AND all bot buys in atomic launch"""
        try:
            # Ensure metadata exists
            if not self.metadata_for_token:
                await self._ensure_metadata()
            
            # Extract metadata
            metadata_uri = (
                self.metadata_for_token.get('uri') or
                self.metadata_for_token.get('metadata_uri') or
                self.metadata_for_token.get('image_url') or
                self.metadata_for_token.get('image')
            )
            
            # Generate dynamic amounts
            variability = self.launch_config.get("bot_variability", 0.3)
            distribution = self.launch_config.get("bot_distribution", "normal")
            base_buy_amount = float(self.launch_config.get("bot_buy_amount", 0.0001))
            
            # Generate dynamic amounts
            dynamic_amounts = await self._calculate_dynamic_buy_amounts(
                base_amount=base_buy_amount,
                count=len(self.bot_wallets),
                variability=variability,
                distribution=distribution
            )
            
            # ✅ STORE DYNAMIC AMOUNTS IN BOT WALLETS
            bot_configs = []
            for i, bot in enumerate(self.bot_wallets):
                dynamic_amount = dynamic_amounts[i] if i < len(dynamic_amounts) else base_buy_amount
                    
                # ✅ UPDATE THE BOT'S BUY_AMOUNT FIELD IN DATABASE
                bot.buy_amount = dynamic_amount
                await self.db.commit()  # ✅ COMMIT HERE to save to database
                
                bot_configs.append({
                    "public_key": bot.public_key,
                    "amount_sol": dynamic_amount,  # ✅ This is what botManager should use
                    "buy_amount": dynamic_amount   # ✅ Include both for compatibility
                })
            
            # Emit launch starting event
            from app.utils.bot_components import websocket_manager
            await websocket_manager.broadcast_launch_event(
                launch_id=self.launch_id,
                event="launch_started",
                data={
                    "status": "starting",
                    "message": "Starting atomic launch...",
                    "bot_count": len(bot_configs),
                    "total_amount": sum(bot["amount_sol"] for bot in bot_configs)
                }
            )
            
            # ✅ Call atomic-launch with explicit amounts
            async with httpx.AsyncClient(timeout=300.0) as client:
                payload = {
                    "user_wallet": self.user.wallet_address,
                    "metadata": {
                        "name": self.metadata_for_token.get('name', 'UnknownToken'),
                        "symbol": self.metadata_for_token.get('symbol', 'TKN'),
                        "uri": metadata_uri
                    },
                    "creator_buy_amount": float(self.launch_config.get("creator_buy_amount", 0.001)),
                    "bot_buys": bot_configs,  # ✅ This contains dynamic amounts
                    "use_jito": bool(self.launch_config.get("use_jito_bundle", True)),
                    "slippage_bps": 500,
                    "launch_id": self.launch_id
                }
                
                # Emit token creation starting event
                await websocket_manager.broadcast_launch_event(
                    launch_id=self.launch_id,
                    event="token_creation_started",
                    data={
                        "status": "creating",
                        "message": "Creating token on-chain...",
                        "started_at": datetime.utcnow().isoformat()
                    }
                )
                
                response = await client.post(
                    f"{settings.ONCHAIN_CLIENT_URL}/api/onchain/atomic-launch",
                    json=payload,
                    headers={"X-API-Key": settings.ONCHAIN_API_KEY},
                    timeout=300.0
                )

                if response.status_code != 200:
                    error_text = response.text[:500] if response.text else "No error message"
                    logger.error(f"❌ Atomic launch HTTP error {response.status_code}: {error_text}")
                    
                    # Emit error event
                    await websocket_manager.broadcast_launch_event(
                        launch_id=self.launch_id,
                        event="launch_error",
                        data={
                            "status": "error",
                            "message": f"HTTP {response.status_code}: {error_text}",
                            "error": error_text
                        }
                    )
                    
                    return {"success": False, "error": f"HTTP {response.status_code}: {error_text}"}
                
                result = response.json()
                logger.info(f"✅ Atomic launch response: {result}")
                
                if not result.get("success"):
                    error_msg = result.get("error", "Unknown error")
                    
                    # Emit error event
                    await websocket_manager.broadcast_launch_event(
                        launch_id=self.launch_id,
                        event="launch_error",
                        data={
                            "status": "error",
                            "message": error_msg,
                            "error": error_msg
                        }
                    )
                    
                    return {"success": False, "error": result.get("error", "Unknown error")}
                
                self.mint_address = result.get("mint_address")
                signatures = result.get("signatures", [])
                
                # ✅ IMMEDIATE: Emit token created event via WebSocket
                # This happens BEFORE backend database updates
                await websocket_manager.broadcast_launch_event(
                    launch_id=self.launch_id,
                    event="token_created",
                    data={
                        "success": True,
                        "mint_address": self.mint_address,
                        "name": self.metadata_for_token.get('name', 'UnknownToken'),
                        "symbol": self.metadata_for_token.get('symbol', 'TKN'),
                        "image_url": self.metadata_for_token.get('image_url', ''),
                        "metadata_uri": self.metadata_for_token.get('metadata_uri', ''),
                        "creator_tx_hash": signatures[0] if signatures else None,
                        "bot_count": len(bot_configs),
                        "signatures": signatures,
                        "estimated_cost": result.get("estimated_cost", 0),
                        "message": "Token created successfully",
                        "timestamp": datetime.utcnow().isoformat()
                    }
                )
                
                # Update launch record
                if self.launch_record:
                    self.launch_record.mint_address = self.mint_address
                    self.launch_record.creator_tx_hash = result.get("signatures", [None])[0]
                    await self.db.commit()
                
                logger.info(f"✅ Atomic launch successful: {self.mint_address}")
                
                return result
                    
        except httpx.TimeoutException:
            logger.error("Atomic launch request timed out")
            
            # Emit timeout event
            await websocket_manager.broadcast_launch_event(
                launch_id=self.launch_id,
                event="launch_error",
                data={
                    "status": "error",
                    "message": "Request timed out after 90 seconds",
                    "error": "timeout"
                }
            )
            
            return {"success": False, "error": "Request timed out after 90 seconds"}
        
        except Exception as e:
            logger.error(f"Atomic launch failed: {e}", exc_info=True)
            # Emit error event
            await websocket_manager.broadcast_launch_event(
                launch_id=self.launch_id,
                event="token_creation_failed",
                data={
                    "success": False,
                    "error": str(e),
                    "timestamp": datetime.utcnow().isoformat()
                }
            )
            return {"success": False, "error": str(e)}

            
    async def _fund_bot_wallets(self) -> Dict[str, Any]:
        """Fund bot wallets using on-chain service"""
        try:
            # Check if onchain_client exists and has fund_bots method
            if not hasattr(onchain_client, 'fund_bots'):
                logger.error("onchain_client doesn't have fund_bots method")
                return {"success": False, "error": "onchain_client misconfigured"}
            
            bot_configs = []
            for wallet in self.bot_wallets:
                bot_configs.append({
                    "public_key": wallet.public_key,
                    "buy_amount": self.launch_config["buy_amount"]
                })
            
            # Debug: Log what we're sending
            logger.info(f"Funding {len(bot_configs)} bot wallets")
            
            result = await onchain_client.fund_bots(
                user_wallet=self.user.wallet_address,
                bot_wallets=bot_configs,
                use_jito=self.launch_config.get("use_jito_bundle", True)
            )
            
            # Debug: Log the result
            logger.info(f"Bot funding result: {result}")
            
            if not result.get("success"):
                error_msg = result.get("error", "Unknown error")
                
                # Check if it's a 401 error
                if "401" in str(error_msg):
                    logger.error("⚠️ Bot funding failed with 401 - API key issue!")
                    # Try direct call as fallback
                    return await self._fund_bots_directly(bot_configs)
                
                raise Exception(f"Bot funding failed: {error_msg}")
            
            # Update bot wallet status
            for wallet in self.bot_wallets:
                wallet.status = "funded"
                wallet.funded_amount = self.launch_config["bot_buy_amount"]
                wallet.last_updated = datetime.utcnow()
            
            await self.db.commit()
            
            return result
            
        except Exception as e:
            logger.error(f"Bot funding failed: {e}", exc_info=True)
            return {"success": False, "error": str(e)}
    
    async def _execute_creator_buy(self) -> Dict[str, Any]:
        """Execute creator buy"""
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{settings.ONCHAIN_CLIENT_URL}/api/onchain/buy",
                    json={
                        "action": "buy",
                        "mint_address": self.mint_address,
                        "amount_sol": self.launch_config["creator_buy_amount"],
                        "user_wallet": self.user.wallet_address,
                        "use_jito": self.launch_config.get("use_jito_bundle", True)
                    },
                    headers={"X-API-Key": settings.ONCHAIN_API_KEY}
                )
                
                if response.status_code != 200:
                    return {"success": False, "error": f"HTTP {response.status_code}"}
                
                return response.json()
                
        except Exception as e:
            return {"success": False, "error": str(e)}
        
    async def _execute_bot_buys(self) -> Dict[str, Any]:
        """Execute bot buys using on-chain service"""
        try:
            if not self.mint_address:
                raise Exception("No mint address - token not created yet")
            
            # Prepare bot configs
            bot_configs = []
            for wallet in self.bot_wallets:
                bot_configs.append({
                    "public_key": wallet.public_key,
                    "amount_sol": float(self.launch_config.get("bot_buy_amount", 0.0001))  # ✅ Use "amount_sol"
                })
            
            logger.info(f"🤖 Executing bot buys for {self.mint_address}")
            
            # Call the execute-bot-buys endpoint
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{settings.ONCHAIN_CLIENT_URL}/api/onchain/execute-bot-buys",
                    json={
                        "action": "execute_bot_buys",
                        "mint_address": self.mint_address,
                        "user_wallet": self.user.wallet_address,
                        "bot_wallets": bot_configs,
                        "use_jito": self.launch_config.get("use_jito_bundle", True),
                        "slippage_bps": 500
                    },
                    headers={"X-API-Key": settings.ONCHAIN_API_KEY}
                )
                
                if response.status_code != 200:
                    return {"success": False, "error": f"HTTP {response.status_code}"}
                
                result = response.json()
                
                if not result.get("success"):
                    return {"success": False, "error": result.get("error")}
                
                # Update bot wallets
                for wallet in self.bot_wallets:
                    wallet.status = "bought"
                    wallet.buy_tx_hash = result.get("signatures", [None])[0]
                    wallet.last_updated = datetime.utcnow()
                
                await self.db.commit()
                
                return result
                
        except Exception as e:
            logger.error(f"Bot buys failed: {e}", exc_info=True)
            return {"success": False, "error": str(e)}
    
    async def _execute_creator_buy(self) -> Dict[str, Any]:
        """Execute creator buy using on-chain service"""
        try:
            result = await onchain_client.execute_buy(
                user_wallet=self.user.wallet_address,
                mint_address=self.mint_address,
                amount_sol=self.launch_config["creator_buy_amount"],
                use_jito=self.launch_config.get("use_jito_bundle", True)
            )
            
            if not result.get("success"):
                raise Exception(f"Creator buy failed: {result.get('error')}")
            
            # Record trade
            trade = Trade(
                user_wallet_address=self.user.wallet_address,
                trade_type="creator_buy",
                mint_address=self.mint_address,
                amount_sol=self.launch_config["creator_buy_amount"],
                tx_hash=result.get("signatures", [None])[0],
                bundle_id=result.get("bundle_id"),
                status="completed"
            )
            self.db.add(trade)
            await self.db.commit()
            
            return result
            
        except Exception as e:
            logger.error(f"Creator buy failed: {e}")
            return {"success": False, "error": str(e)}
    
    async def _monitor_and_sell(self):
        """Monitor token and execute sell"""
        try:
            # For now, just return success without actual selling
            # We can implement real selling later
            logger.info(f"Skipping actual sell execution for now (focus on atomic launch)")
            
            # Simulate monitoring
            await asyncio.sleep(2)
            
            return {
                "success": True,
                "message": "Sell monitoring completed (simulated)",
                "note": "Actual selling not implemented yet"
            }
            
        except Exception as e:
            logger.error(f"Monitor and sell failed: {e}")
            return {
                "success": False,
                "error": str(e)
            }
        
    async def _monitor_volume_based(self):
        """Monitor volume-based sell condition"""
        target_volume = self.launch_config.get("sell_volume_target", 5.0)
        # Implement actual volume monitoring
        await asyncio.sleep(5)  # Simulate monitoring
    
    async def _monitor_time_based(self):
        """Monitor time-based sell condition"""
        minutes = self.launch_config.get("sell_time_minutes", 5)
        await asyncio.sleep(minutes * 60)
    
    async def _monitor_price_based(self):
        """Monitor price-based sell condition"""
        target_multiplier = self.launch_config.get("sell_price_target", 2.0)
        # Implement price monitoring
        await asyncio.sleep(5)
    
    async def _execute_sells(self):
        """Execute creator and bot sells"""
        # Execute creator sell
        await self._execute_creator_sell()
        
        # Execute bot sells
        await self._execute_bot_sells()

    async def _execute_creator_sell(self) -> Dict[str, Any]:
        """Execute creator sell"""
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{settings.ONCHAIN_CLIENT_URL}/api/onchain/sell",
                    json={
                        "action": "sell",
                        "mint_address": self.mint_address,
                        "user_wallet": self.user.wallet_address,
                        "use_jito": self.launch_config.get("use_jito_bundle", True)
                    },
                    headers={"X-API-Key": settings.ONCHAIN_API_KEY}
                )
                
                if response.status_code != 200:
                    return {"success": False, "error": f"HTTP {response.status_code}"}
                
                return response.json()
                
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def _execute_bot_sells(self) -> Dict[str, Any]:
        """Execute bot sells"""
        try:
            bot_configs = []
            for wallet in self.bot_wallets:
                bot_configs.append({
                    "public_key": wallet.public_key
                })
            
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{settings.ONCHAIN_CLIENT_URL}/api/onchain/sell",
                    json={
                        "action": "sell",
                        "mint_address": self.mint_address,
                        "bot_wallets": bot_configs,
                        "user_wallet": self.user.wallet_address,
                        "use_jito": self.launch_config.get("use_jito_bundle", True)
                    },
                    headers={"X-API-Key": settings.ONCHAIN_API_KEY}
                )
                
                if response.status_code != 200:
                    return {"success": False, "error": f"HTTP {response.status_code}"}
                
                return response.json()
                
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def _calculate_results(self) -> Dict[str, Any]:
        """Calculate launch results"""
        try:
            # Basic results for atomic launch (token creation + buys)
            return {
                "total_profit": 0.0,  # We don't calculate profit without selling
                "roi": 0.0,
                "duration": 60,  # 1 minute estimate
                "bot_count": len(self.bot_wallets),
                "successful_bots": len(self.bot_wallets),
                "token_created": True,
                "creator_buy_executed": True,
                "bot_buys_executed": True,
                "message": "Atomic launch completed successfully"
            }
        except Exception as e:
            logger.error(f"Failed to calculate results: {e}")
            return {
                "total_profit": 0.0,
                "roi": 0.0,
                "duration": 0,
                "bot_count": len(self.bot_wallets),
                "successful_bots": 0,
                "error": str(e)
            }
            
    async def _calculate_atomic_cost(self) -> float:
        """Calculate cost for atomic launch"""
        if not self.launch_config:
            return 0.0
        
        bot_cost = len(self.pre_funded_bot) * self.launch_config.get("bot_buy_amount", 0.0001)
        creator_cost = self.launch_config.get("creator_buy_amount", 0.001)
        fees = 0.05 # Higher buffer for atomic bundle
        
        return bot_cost + creator_cost + fees
    
    async def _ensure_metadata(self):
        """Ensure metadata exists, generate if not"""
        if not self.metadata_for_token:
            logger.info(f"No metadata found for launch {self.launch_id}, generating...")
            
            if self.launch_config:
                # Try to get from custom_metadata
                custom_metadata = self.launch_config.get("custom_metadata")
                if custom_metadata:
                    self.metadata_for_token = custom_metadata
                    logger.info(f"Using custom metadata from config")
                    
                    # ✅ Ensure URI exists
                    if "uri" not in self.metadata_for_token:
                        # Try to use image as fallback URI
                        self.metadata_for_token["uri"] = self.metadata_for_token.get("image", "https://placehold.co/600x400")
                        logger.info(f"Added fallback URI: {self.metadata_for_token['uri']}")
                else:
                    # Try to generate metadata if not exists
                    try:
                        # Create a config object for metadata generation
                        config_for_metadata = LaunchConfigCreate(**self.launch_config) if isinstance(self.launch_config, dict) else self.launch_config
                        await self._get_metadata(config_for_metadata)
                        logger.info(f"Generated metadata via _get_metadata")
                    except Exception as e:
                        logger.error(f"Failed to generate metadata: {e}")
                        
            # Fallback if still None
            if not self.metadata_for_token:
                timestamp = int(datetime.utcnow().timestamp())
                self.metadata_for_token = {
                    "name": f"Token_{timestamp}",
                    "symbol": f"TKN{timestamp % 10000:04d}",
                    "image": "https://placehold.co/600x400",
                    "uri": "https://placehold.co/600x400",  # ✅ Include URI!
                    "description": "Token created via Flash Sniper",
                    "attributes": [
                        {"trait_type": "Platform", "value": "Flash Sniper"},
                        {"trait_type": "Created", "value": datetime.utcnow().strftime("%Y-%m-%d")},
                    ]
                }
                logger.info(f"Created fallback metadata: {self.metadata_for_token['name']}")
        
        # ✅ Log what we have
        logger.info(f"Final metadata keys: {list(self.metadata_for_token.keys())}")
        logger.info(f"Metadata URI: {self.metadata_for_token.get('uri', 'No URI found')}")
    
   
# ============================================
# BOT FUNDING MANAGER 
# ============================================  

class BotFundingManager:
    """Unified bot funding manager that handles all funding scenarios"""
    
    def __init__(self, user: User, db: AsyncSession):
        self.user = user 
        self.db = db 
        
    async def ensure_bots_funded(
        self,
        bot_count: int,
        min_balance_per_bot: float,
        required_amount_per_bot: float 
    ) -> List[BotWallet]:
        """
        Ensures bot wallets are funded. If not, automatically funds them.
        """
        # Step 1: Get available bots
        available_bots = await self._get_available_bots(bot_count)
        
        # ✅ CRITICAL FIX: Increase buffer for fees AND account for confirmation time
        required_amount_per_bot = required_amount_per_bot + 0.005  # Add 0.005 SOL for rent fees + buffer
        
        logger.info(f"🔍 Checking {len(available_bots)} available bots...")
        logger.info(f"💰 Required amount per bot: {required_amount_per_bot} SOL")
        
        # Step 2: Check which bots need funding
        bots_to_fund = []
        funded_bots = []
        
        for bot in available_bots:
            try:
                current_balance = await get_sol_balance(bot.public_key)
                logger.info(f"   Bot {bot.public_key[:8]}...: {current_balance:.6f} SOL (need {required_amount_per_bot:.6f})")
                
                if current_balance >= required_amount_per_bot:
                    funded_bots.append(bot)
                    logger.info(f"   ✅ Already funded")
                else:
                    bots_to_fund.append({
                        "public_key": bot.public_key,
                        "amount_sol": required_amount_per_bot
                    })
                    logger.info(f"   ❌ Needs funding: {required_amount_per_bot - current_balance:.6f} SOL short")
                    
            except Exception as e:
                logger.error(f"   ❌ Failed to check balance for bot {bot.public_key[:8]}: {e}")
                continue
        
        logger.info(f"📊 Summary: {len(funded_bots)} already funded, {len(bots_to_fund)} need funding")
        
        # Step 3: Fund bots if needed
        if bots_to_fund:
            logger.info(f"💰 Funding {len(bots_to_fund)} bots...")
            
            try:
                # Call on-chain service to fund bots
                funding_result = await self._fund_bots_onchain(bots_to_fund)
                
                if funding_result.get("success"):
                    logger.info(f"✅ Funding request sent successfully")
                    
                    # ✅ CRITICAL: WAIT FOR BLOCKCHAIN CONFIRMATION
                    logger.info(f"⏳ Waiting 3 seconds for funding to confirm on blockchain...")
                    await asyncio.sleep(3)
                    
                    # Re-check balances AFTER confirmation
                    logger.info(f"🔍 Re-checking balances after funding...")
                    funded_bots = []  # Reset and check ALL bots again
                    
                    for bot in available_bots:
                        try:
                            # Add retry logic for balance check
                            for attempt in range(3):
                                balance = await get_sol_balance(bot.public_key)
                                logger.info(f"   Bot {bot.public_key[:8]}... attempt {attempt+1}: {balance:.6f} SOL")
                                
                                if balance >= required_amount_per_bot:
                                    funded_bots.append(bot)
                                    logger.info(f"   ✅ Now funded!")
                                    break
                                    
                                if attempt < 2:  # Not last attempt
                                    await asyncio.sleep(1)  # Wait 1 second before retry
                        except Exception as e:
                            logger.error(f"   ❌ Balance check failed: {e}")
                            continue
                    
                    logger.info(f"✅ Final: {len(funded_bots)} bots confirmed funded")
                
                else:
                    logger.error(f"❌ Bot funding request failed: {funding_result.get('error')}")
                    # Even if funding failed, check if we already have enough bots
                    logger.info(f"📊 Checking if we have enough bots without new funding...")
                    
            except Exception as e:
                logger.error(f"❌ Bot funding error: {e}")
        else:
            logger.info(f"✅ All bots already funded")
        
        # Step 4: Return funded bots
        logger.info(f"📋 Need {bot_count} bots, have {len(funded_bots)} funded bots")
        
        if len(funded_bots) >= bot_count:
            return funded_bots[:bot_count]
        else:
            # Log detailed error
            logger.error(f"❌ Insufficient funded bots!")
            logger.error(f"   Available bots: {[b.public_key[:8] for b in available_bots]}")
            logger.error(f"   Funded bots: {[b.public_key[:8] for b in funded_bots]}")
            logger.error(f"   Balances: {[await get_sol_balance(b.public_key) for b in available_bots[:3]]}")
            
            raise Exception(
                f"Could not get enough funded bots. "
                f"Need {bot_count}, have {len(funded_bots)} funded bots. "
                f"Available bots: {len(available_bots)}, "
                f"Minimum required per bot: {required_amount_per_bot} SOL"
            )

    async def _get_available_bots(self, count: int) -> List[BotWallet]:
        """Get available bot wallets from database"""
        stmt = select(BotWallet).where(
            BotWallet.user_wallet_address == self.user.wallet_address,
            BotWallet.status.in_([
                BotStatus.PENDING,
                BotStatus.READY,
                BotStatus.FUNDED,
                BotStatus.ACTIVE
            ])
        ).limit(count * 2)  # Get extra for buffer
        
        result = await self.db.execute(stmt)
        return result.scalars().all()
    
    async def _fund_bots_onchain(self, bots_to_fund: List[Dict]) -> Dict:
        """Call on-chain service to fund bots"""
        async with httpx.AsyncClient(timeout=60.0) as client:  # Increased timeout
            # ✅ Add 0.001 SOL extra for transaction fees
            enhanced_bots = []
            for bot in bots_to_fund:
                enhanced_bots.append({
                    "public_key": bot["public_key"],
                    "amount_sol": bot["amount_sol"] + 0.001  # Extra for fees
                })
            
            logger.info(f"📤 Sending funding request for {len(enhanced_bots)} bots...")
            for bot in enhanced_bots:
                logger.info(f"   Bot {bot['public_key'][:8]}...: {bot['amount_sol']:.6f} SOL")
            
            response = await client.post(
                f"{settings.ONCHAIN_CLIENT_URL}/api/onchain/fund-bots",
                json={
                    "user_wallet": self.user.wallet_address,
                    "bot_wallets": enhanced_bots,
                    "use_jito": False
                },
                headers={"X-API-Key": settings.ONCHAIN_API_KEY}
            )
            
            logger.info(f"📥 Funding response status: {response.status_code}")
            
            if response.status_code == 200:
                result = response.json()
                logger.info(f"✅ Funding result: {result}")
                return result
            else:
                error_msg = f"HTTP {response.status_code}: {response.text[:200]}"
                logger.error(f"❌ Funding failed: {error_msg}")
                return {
                    "success": False,
                    "error": error_msg
                }
        
        


# ============================================
# ATOMIC LAUNCH
# ============================================

class AtomicLaunchCordinator(LaunchCoordinator):
    """Enhanced coordinator for atomic launches with pre-funded bots"""
    
    def __init__(self, launch_id: str, user: User, db: AsyncSession):
        super().__init__(launch_id, user, db)
        self.pre_funded_bots: List[BotWallet] = []
        self.use_atomic_bundle = True 
        self.max_bots = None 
        
    async def prepare_atomic_launch(
        self,
        config: LaunchConfigCreate,
        use_pre_funded: bool = True,
        max_bots: Optional[int] = None 
    ) -> bool:
        """Prepare for atomic launch with pre-funded bots"""
        try:
            self.launch_config = config.model_dump()
            self.use_atomic_bundle = True 
            self.max_bots = max_bots
            
            # Create launch record
            await self._create_launch_record()
            await self._update_status(LaunchStatus.SETUP, 10, "Validating atomic launch...")
            
            # Validate user
            if not self.user.creator_enabled:
                raise HTTPException(status_code=403, detail="Creator mode not enabled")
            
            # Check if using pre-funded bots
            if use_pre_funded:
                await self._get_pre_funded_bots(config.bot_count)
                if len(self.pre_funded_bots) < config.bot_count:
                    raise HTTPException(status_code=400, detail=f"Not enough pre-funded bots. Need {config.bot_count}, have {len(self.pre_funded_bots)}")
            else:
                # Use regular bots (will be funded during launch)
                await self._get_bot_wallets(config.bot_count)
                self.pre_funded_bots = self.bot_wallets
            
            # Check pre-funding amounts
            await self._validate_pre_funding(config)
            
            # Generate metadata
            await self._get_metadata(config)
            await self._update_status(LaunchStatus.METADATA_GENERATED, 20, "Metadata generated")
            
            # Update launch record
            await self._update_launch_with_metadata()
            
            return True 
        
        except Exception as e:
            logger.error(f"Failed to prepare atomic launch {self.launch_id}: {e}", exc_info=True)
            await self.db.rollback()
            await self._update_status(LaunchStatus.FAILED, 0, f"Preparation failed: {str(e)}")
            return False 

    async def _get_pre_funded_bots(self, count: int):
        """Get bot wallets with actual balance > 0"""
        from app.routers.creators.user import get_sol_balance
        
        # Get ALL bots for this user
        stmt = select(BotWallet).where(
            BotWallet.user_wallet_address == self.user.wallet_address,
            BotWallet.status.in_(["PENDING", "READY", "FUNDED", "ACTIVE"])
        ).order_by(BotWallet.created_at.desc()).limit(count * 3)
        
        result = await self.db.execute(stmt)
        potential_bots = result.scalars().all()
        
        # Check actual balance
        funded_bots = []
        for bot in potential_bots:
            try:
                balance = await get_sol_balance(bot.public_key)
                # Consider bot as pre-funded if it has enough balance for buying
                required_amount = self.launch_config.get("bot_buy_amount", 0.0001) * 1.1  # 10% buffer
                if balance >= required_amount:
                    funded_bots.append(bot)
                    
                    if len(funded_bots) >= count:
                        break
                        
            except Exception as e:
                logger.error(f"Failed to check balance for bot {bot.public_key[:8]}: {e}")
                continue
        
        self.pre_funded_bots = funded_bots
        self.bot_wallets = funded_bots
        return funded_bots

    async def _validate_pre_funding(self, config: LaunchConfigCreate):
        """Validate pre-funded amounts are sufficient"""
        for bot in self.pre_funded_bots:
            if not bot.pre_funded_amount or bot.pre_funded_amount <= config.bot_buy_amount:
                raise HTTPException(status_code=400, detail=f"Bot {bot.public_key[:8]}... has insufficient pre-funding: "
                                                            f"{bot.pre_funded_amount} SOL, need > {config.bot_buy_amount} SOL")
    
    async def execute_atomic_launch(self) -> Dict[str, Any]:
        """Execute atomic launch - CREATE with creator buy, then bot buys"""
        try:
            await self._update_status(LaunchStatus.ONCHAIN_CREATION, 40, "Creating token with creator buy...")
            
            # CRITICAL: Ensure metadata_for_token exists
            if not self.metadata_for_token:
                logger.error(f"No metadata_for_token found for launch {self.launch_id}")
                # Try to generate metadata
                await self._ensure_metadata()
                
                if not self.metadata_for_token:
                    raise Exception("Failed to generate metadata for token creation")
            
            # Step 1: Create token with creator buy and then execute bot armies buys
            token_result = await self._create_token_onchain()
            
            if not token_result.get("success"):
                error_msg = token_result.get("error", "Unknown error")
                raise Exception(f"Token creation with buy failed: {error_msg}")
            
            self.mint_address = token_result.get("mint_address")
            
            # Update launch record
            self.launch_record.mint_address = self.mint_address
            self.launch_record.creator_tx_hash = token_result.get("signature")
            self.launch_record.creator_buy_tx_hash = token_result.get("buy_signature")
            await self.db.commit()
            
            logger.info(f"✅ Token created with creator buy: {self.mint_address}")
            
            # Step 2: Execute bot buys (if we have pre-funded bots)
            # if self.pre_funded_bots:
            #     await self._update_status(LaunchStatus.BUYING, 60, "Executing bot buys...")
                
            #     bot_buy_result = await self._execute_bot_buys()
                
            #     if not bot_buy_result.get("success"):
            #         logger.warning(f"Bot buys partially failed: {bot_buy_result.get('error')}")
            #         # Continue anyway - partial success is okay
            #     else:
            #         self.launch_record.bot_buy_bundle_id = bot_buy_result.get("bundle_id")
            #         await self.db.commit()
            
            # Step 3: Execute sells based on strategy
            await self._update_status(LaunchStatus.MONITORING, 80, "Monitoring performance...")
            sell_result = await self._monitor_and_sell()
            
            if not sell_result.get("success"):
                logger.warning(f"Sell execution failed: {sell_result.get('error')}")
            
            # Step 4: Complete
            await self._update_status(LaunchStatus.COMPLETE, 100, "🎉 Atomic launch completed successfully!")
            
            # Calculate results
            results = await self._calculate_results()
            
            # Update final launch record
            self.launch_record.success = True
            self.launch_record.total_profit = results["total_profit"]
            self.launch_record.roi = results["roi"]
            self.launch_record.duration = results["duration"]
            self.launch_record.completed_at = datetime.utcnow()
            await self.db.commit()
            
            return {
                "success": True,
                "launch_id": self.launch_id,
                "mint_address": self.mint_address,
                "creator_signature": token_result.get("signature"),
                "creator_buy_signature": token_result.get("buy_signature"),
                "bot_buy_bundle_id": self.launch_record.bot_buy_bundle_id,
                "results": results
            }
            
        except Exception as e:
            logger.error(f"Atomic launch {self.launch_id} failed: {e}", exc_info=True)
            await self._update_status(LaunchStatus.FAILED, 0, f"Atomic launch failed: {str(e)}")
            
            if self.launch_record:
                self.launch_record.success = False
                self.launch_record.completed_at = datetime.utcnow()
                self.launch_record.message = str(e)
                await self.db.commit()
            
            return {
                "success": False,
                "launch_id": self.launch_id,
                "error": str(e)
            }
               
    async def _ensure_metadata(self):
        """Ensure metadata exists with proper URI"""
        if not self.metadata_for_token:
            logger.info(f"No metadata found for launch {self.launch_id}, generating...")
            
            if self.launch_config:
                # Try to get from custom_metadata
                custom_metadata = self.launch_config.get("custom_metadata")
                if custom_metadata:
                    self.metadata_for_token = custom_metadata
                    logger.info(f"Using custom metadata from config")
                    
                    # ✅ Check for both 'uri' and 'metadata_uri' fields
                    if "uri" not in self.metadata_for_token and "metadata_uri" in self.metadata_for_token:
                        self.metadata_for_token["uri"] = self.metadata_for_token["metadata_uri"]
                        logger.info(f"Mapped metadata_uri to uri: {self.metadata_for_token['uri']}")
                        
                    if "uri" not in self.metadata_for_token:
                        # Try other fallbacks
                        if "image_url" in self.metadata_for_token:
                            self.metadata_for_token["uri"] = self.metadata_for_token["image_url"]
                        elif "image" in self.metadata_for_token:
                            self.metadata_for_token["uri"] = self.metadata_for_token["image"]
                        else:
                            self.metadata_for_token["uri"] = "https://placehold.co/600x400"
                        logger.info(f"Added fallback URI: {self.metadata_for_token['uri']}")
            
        # ✅ Log what we have
        logger.info(f"Final metadata keys: {list(self.metadata_for_token.keys())}")
        logger.info(f"Metadata URI: {self.metadata_for_token.get('uri', 'No URI found')}")
        
        # ✅ Ensure we have required fields
        required_fields = ['name', 'symbol', 'uri']
        missing = [field for field in required_fields if not self.metadata_for_token.get(field)]
        
        if missing:
            logger.error(f"❌ Missing required metadata fields: {missing}")
            logger.error(f"Available fields: {self.metadata_for_token}")
            raise Exception(f"Missing required metadata fields: {missing}")
        
    async def _execute_atomic_create_and_buy(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Execute atomic create + buy bundle using new endpoint"""
        try:
            # Prepare metadata for token creation
            metadata_from_payload = payload.get("metadata", {})
            
            # Ensure we have required metadata
            if not metadata_from_payload.get("name") or not metadata_from_payload.get("symbol"):
                # Fall back to coordinator metadata
                if self.metadata_for_token:
                    metadata_from_payload = {
                        "name": self.metadata_for_token.get("name"),
                        "symbol": self.metadata_for_token.get("symbol"),
                        "uri": self.metadata_for_token.get("image", "https://placehold.co/600x400"),
                        "description": self.metadata_for_token.get("description", "")
                    }
                else:
                    raise Exception("No metadata available for token creation")
            
            async with httpx.AsyncClient(timeout=300.0) as client:
                # Use the NEW endpoint for atomic token creation with creator buy
                response = await client.post(
                    f"{settings.ONCHAIN_CLIENT_URL}/api/onchain/create-token-with-buy",
                    json={
                        "user_wallet": payload.get("user_wallet", self.user.wallet_address),
                        "metadata": metadata_from_payload,
                        "creator_buy_amount": payload.get("creator_buy_amount", 0.001),
                        "use_jito": payload.get("use_jito", False),  # Don't bundle, we'll handle bot buys separately
                        "creator_override": None  # Use user wallet as creator
                    },
                    headers={"X-API-Key": settings.ONCHAIN_API_KEY}
                )
                
                if response.status_code != 200:
                    error_text = response.text[:500] if response.text else "No error message"
                    return {"success": False, "error": f"HTTP {response.status_code}: {error_text}"}
                
                result = response.json()
                
                if not result.get("success"):
                    return {"success": False, "error": result.get("error", "Unknown error")}
                
                return result
                
        except httpx.TimeoutException:
            logger.error("Atomic create+buy request timed out")
            return {"success": False, "error": "Request timed out"}
        except Exception as e:
            logger.error(f"Atomic create+buy failed: {e}", exc_info=True)
            return {"success": False, "error": str(e)}
        
    async def _execute_atomic_sell(self, launch_result: Dict[str, Any]) -> Dict[str, Any]:
        """Execute atomic sell after successful launch"""
        try:
            # Check if we should sell immediately
            sell_strategy = self.launch_config.get("sell_strategy_type", "volume_based")
            
            if sell_strategy == "immediate":
                await self._update_status(LaunchStatus.SELLING, 90, "Executing immediate sell...")
                
                # Prepare bot wallets for selling
                bot_wallets_for_sell = []
                for bot in self.pre_funded_bots:
                    bot_wallets_for_sell.append({
                        "public_key": bot.public_key
                    })
                
                # Add creator wallet to the sell list
                bot_wallets_for_sell.append({
                    "public_key": self.user.wallet_address,
                    "is_creator": True
                })
                
                payload = {
                    "action": "sell",
                    "user_wallet": self.user.wallet_address,
                    "mint_address": self.mint_address,
                    "bot_wallets": bot_wallets_for_sell,
                    "use_jito": True,
                    "immediate": True
                }
                
                # Call on-chain service for atomic sell
                async with httpx.AsyncClient(timeout=30.0) as client:
                    response = await client.post(
                        f"{settings.ONCHAIN_CLIENT_URL}/api/onchain/sell",
                        json=payload,
                        headers={"X-API-Key": settings.ONCHAIN_API_KEY}
                    )
                    
                    if response.status_code != 200:
                        logger.error(f"Sell failed: HTTP {response.status_code}")
                        return {"success": False, "error": f"HTTP {response.status_code}: {response.text}"}
                    
                    result = response.json()
                    if result.get("success"):
                        self.launch_record.bot_sell_bundle_id = result.get("bundle_id")
                        await self.db.commit()
                        
                        # Update bot wallet statuses
                        for bot in self.pre_funded_bots:
                            bot.status = BotStatus.SOLD
                            bot.sell_tx_hash = result.get("signatures", [None])[0]
                            bot.last_updated = datetime.utcnow()
                        
                        await self.db.commit()
                        logger.info("Atomic sell completed successfully")
                    
                    return result
                    
            else:
                # For other strategies, schedule monitoring
                await self._schedule_sell_monitoring()
                return {"success": True, "message": "Sell monitoring scheduled"}
                
        except Exception as e:
            logger.error(f"Atomic sell failed: {e}")
            return {"success": False, "error": str(e)}
        
    async def _execute_atomic_buys(self) -> Dict[str, Any]:
        """Execute all buys in a single atomic bundle"""
        try:
            # Prepare bot buy configuration
            bot_configs = []
            for bot in self.pre_funded_bots:
                bot_configs.append({
                    "public_key": bot.public_key,
                    "buy_amount": bot.funded_amount or self.launch_config["buy_amount"]
                })
                
                # Call on-chain service for atomic execution
                # This endpoint should handle token creation + all buys atomically

                payload = {
                    "action": "atomic_create_and_buy",
                    "user_wallet": self.user.wallet_address,
                    "metadata": self.metadata_for_token,
                    "mint_address": self.mint_address,  # For buy-only atomic bundle
                    "creator_buy_amount": self.lau["creator_buy_amount"],
                    "bot_wallets": bot_configs,
                    "use_jito": True,
                    "atomic_bundle": True 
                }
                
                async with httpx.AsyncClient(timeout=60.0) as client:
                    response = await client.post(
                        f"{onchain_client.base_url}/api/onchain/atomic-launch",
                        json=payload,
                        headers={"X-API-Key": onchain_client.api_key}
                    )
                    
                    if response.status_code != 200:
                        return {"success": False, "error": f"HTTP {response.status_code}: {response.text}"}
                    
                    return response.json()
                
        except Exception as e:
            logger.error(f"Atomic buy execution failed: {e}", exc_info=True)
            return {"success": False, "error": str(e)}
            
    async def _update_bot_statuses_after_buy(self, buy_result: Dict[str, Any]):
        """Update bot wallet statuses after atomic buy"""
        try:
            signatures = buy_result.get("signatures", [])
            
            # Skip the first signature (creator buy)
            bot_signatures = signatures[1:] if len(signatures) > 1 else []
            
            for i, bot in enumerate(self.pre_funded_bots):
                signature = bot_signatures[i] if i < len(bot_signatures) else None 
                
                bot.status = BotStatus.BUY_EXECUTED
                bot.buy_tx_hash = signature
                bot.current_balance -= (bot.funded_amount or self.launch_config["bot_buy_amount"])
                bot.last_updated = datetime.utcnow()
            
            await self.db.commit()
            
        except Exception as e:
            logger.error(f"Failed to update bot statuses: {e}")
            # Don't fail the whole launch if status update fails




# ====================================
# HELPER FUNCTION
# ====================================
def ensure_metadata_has_uri(metadata: Dict[str, Any]) -> Dict[str, Any]:
    """Ensure metadata has a valid 'uri' — but NEVER overwrite if it already exists"""
    if not metadata:
        return metadata

    # Remove attributes (good)
    if 'attributes' in metadata:
        logger.info("Removing attributes for pump.fun compatibility")
        del metadata['attributes']

    # Only set uri if it's truly missing or invalid
    current_uri = metadata.get('uri', '').strip()
    if not current_uri or not current_uri.startswith(('http://', 'https://', 'ipfs://')):
        if 'image' in metadata and metadata['image'].startswith(('http://', 'https://', 'ipfs://')):
            metadata['uri'] = metadata['image']
            logger.warning(f"uri was missing/invalid → fallback to image: {metadata['uri']}")
        else:
            metadata['uri'] = "https://placehold.co/600x400"
            logger.warning(f"No valid uri or image → using placeholder")
    else:
        logger.info(f"uri already valid, keeping: {current_uri[:80]}...")

    return metadata
   
   
# ============================================
# API ENDPOINTS
# ============================================
@router.post("/launch", response_model=Dict[str, Any])
async def create_token_launch(
    launch_request: LaunchCreate,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Create a new token launch
    """
    try:
        # Generate launch ID
        launch_id = f"launch_{int(datetime.utcnow().timestamp())}_{uuid.uuid4().hex[:8]}"
        
        # Create launch coordinator
        coordinator = LaunchCoordinator(launch_id, current_user, db)
        
        # Prepare launch
        success = await coordinator.prepare_launch(launch_request.config)
        if not success:
            raise HTTPException(status_code=400, detail="Launch preparation failed")
        
        # Schedule launch
        if launch_request.schedule_for:
            # Add to queue for scheduled execution
            queue_item = LaunchQueue(
                user_wallet_address=current_user.wallet_address,
                launch_id=launch_id,
                config=launch_request.config.model_dump(),
                metadata_for_token=coordinator.metadata_for_token.dict() if coordinator.metadata_for_token else None,
                status="scheduled",
                scheduled_for=launch_request.schedule_for,
                priority=launch_request.priority
            )
            
            db.add(queue_item)
            await db.commit()
            
            return {
                "success": True,
                "launch_id": launch_id,
                "scheduled": True,
                "scheduled_for": launch_request.schedule_for.isoformat(),
                "message": "Launch scheduled successfully"
            }
        else:
            # Execute immediately in background
            background_tasks.add_task(coordinator.execute_launch)
            
            return {
                "success": True,
                "launch_id": launch_id,
                "scheduled": False,
                "message": "Launch started in background"
            }
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to create launch: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to create launch: {str(e)}")

# @router.post("/quick-launch", response_model=Dict[str, Any])
# async def quick_launch(
#     request: QuickLaunchRequest,
#     background_tasks: BackgroundTasks,
#     current_user: User = Depends(get_current_user),
#     db: AsyncSession = Depends(get_db)
# ):
#     """
#     Quick launch with minimal configuration
#     """
#     try:
#         logger.info(f"Starting quick launch for user {current_user.wallet_address}")
        
#         # Generate AI metadata
#         metadata_request = MetadataRequest(
#             style=request.style,
#             keywords=request.keywords,
#             category="meme",
#             use_dalle=request.use_dalle
#         )
        
#         # Call the OpenAI metadata generation
#         metadata_response = await generate_metadata(metadata_request)
        
#         if not metadata_response or not metadata_response.success:
#             raise HTTPException(
#                 status_code=500, 
#                 detail="AI metadata generation failed"
#             )
        
#         # ✅ Use the simplified response directly
#         metadata_dict = {
#             "name": metadata_response.name,
#             "symbol": metadata_response.symbol,
#             "description": metadata_response.description,
#             "image_url": metadata_response.image_url,
#             "metadata_uri": metadata_response.metadata_uri  # ✅ This is the key!
#         }
        
#         logger.info(f"✅ AI Metadata generated:")
#         logger.info(f"   Name: {metadata_dict['name']}")
#         logger.info(f"   Symbol: {metadata_dict['symbol']}")
#         logger.info(f"   Metadata URI: {metadata_dict['metadata_uri'][:100]}...")
#         logger.info(f"   Image URL: {metadata_dict['image_url'][:100]}...")
        
#         # Create launch config
#         launch_config = LaunchConfigCreate(
#             use_ai_metadata=False,
#             custom_metadata=metadata_dict,  # ✅ Pass the simplified metadata
#             bot_count=request.bot_count,
#             creator_buy_amount=request.creator_buy_amount,
#             bot_buy_amount=request.bot_buy_amount,
#             sell_strategy_type=request.sell_strategy_type,
#             sell_volume_target=request.sell_volume_target,
#             sell_price_target=request.sell_price_target,
#             sell_time_minutes=request.sell_time_minutes,
#             use_jito_bundle=True,
#             priority=10
#         )
        
#         # Create launch request
#         launch_request = LaunchCreate(
#             config=launch_config,
#             priority=10
#         )
        
#         # Call regular launch endpoint
#         return await create_token_launch(launch_request, background_tasks, current_user, db)
        
#     except Exception as e:
#         logger.error(f"Quick launch failed: {e}", exc_info=True)
#         raise HTTPException(
#             status_code=500, 
#             detail=f"Quick launch failed: {str(e)}"
#         )
   
# @router.post("/quick-launch", response_model=Dict[str, Any])
# async def quick_launch(
#     request: QuickLaunchRequest,
#     background_tasks: BackgroundTasks,
#     use_trending: bool = Query(True, description="Use trending news on X for metadata"),
#     current_user: User = Depends(get_current_user),
#     db: AsyncSession = Depends(get_db)
# ):
#     """
#     Quick launch with optional trending news metadata
#     """
#     try:
#         logger.info(f"Starting quick launch for user {current_user.wallet_address}")
        
#         # Generate metadata - either from trending news or AI
#         if use_trending:
#             # Call the new trending endpoint
#             async with httpx.AsyncClient(timeout=60.0) as client:
#                 response = await client.post(
#                     f"{settings.BACKEND_BASE_URL}/ai/generate-from-trending-simple",
#                     json={
#                         "style": request.style,
#                         "use_x_image": True
#                     },
#                     headers={"X-API-Key": settings.ONCHAIN_API_KEY}
#                 )
                
#                 if response.status_code != 200:
#                     raise HTTPException(
#                         status_code=500, 
#                         detail="Trending metadata generation failed"
#                     )
                
#                 trending_result = response.json()
                
#                 if not trending_result.get("success"):
#                     raise HTTPException(
#                         status_code=500, 
#                         detail="Trending metadata generation failed"
#                     )
                
#                 # Use trending metadata
#                 metadata_dict = {
#                     "name": trending_result["name"],
#                     "symbol": trending_result["symbol"],
#                     "description": trending_result.get("description", ""),
#                     "metadata_uri": trending_result["metadata_uri"],
#                     "image_url": trending_result["image_url"],
#                     "generated_from_trend": True
#                 }
#         else:
#             # Original AI metadata generation
#             metadata_request = MetadataRequest(
#                 style=request.style,
#                 keywords=request.keywords,
#                 category="meme",
#                 use_dalle=request.use_dalle
#             )
            
#             # Call the OpenAI metadata generation function
#             response = await generate_metadata(metadata_request)
            
#             if not response or not response.success:
#                 raise HTTPException(
#                     status_code=500, 
#                     detail="AI metadata generation failed"
#                 )
            
#             metadata_dict = {
#                 "name": response.name,
#                 "symbol": response.symbol,
#                 "metadata_uri": response.metadata_uri,
#                 "image_url": response.image_url,
#                 "description": response.description
#             }
        
#         # Create launch config
#         launch_config = LaunchConfigCreate(
#             use_ai_metadata=False,
#             custom_metadata=metadata_dict,
#             bot_count=request.bot_count,
#             creator_buy_amount=request.creator_buy_amount,
#             bot_buy_amount=request.bot_buy_amount,
#             sell_strategy_type=request.sell_strategy_type,
#             sell_volume_target=request.sell_volume_target,
#             sell_price_target=request.sell_price_target,
#             sell_time_minutes=request.sell_time_minutes,
#             use_jito_bundle=True,
#             priority=10
#         )
        
#         # Create launch request
#         launch_request = LaunchCreate(
#             config=launch_config,
#             priority=10
#         )
        
#         # Call regular launch endpoint
#         return await create_token_launch(launch_request, background_tasks, current_user, db)
        
#     except Exception as e:
#         logger.error(f"Quick launch failed: {e}", exc_info=True)
#         raise HTTPException(
#             status_code=500, 
#             detail=f"Quick launch failed: {str(e)}"
#         )
    
@router.post("/quick-launch", response_model=Dict[str, Any])
async def quick_launch(
    request: QuickLaunchRequest,
    background_tasks: BackgroundTasks,
    metadata_source: str = Query("ai", description="Metadata source: 'ai' or 'trending'"),
    use_images: bool = Query(True, description="Use images from source"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Quick launch with option to generate metadata with AI or X Trends
    """
    try:
        logger.info(f"Starting quick launch for user {current_user.wallet_address}, source: {metadata_source}")
        
        metadata_dict = None
        
        if metadata_source == "trending":
            # Generate metadata from trending news
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    f"{settings.BACKEND_BASE_URL}/ai/generate-from-trending-simple",
                    json={
                        "style": request.style,
                        "use_x_image": use_images
                    },
                    headers={"X-API-Key": settings.ONCHAIN_API_KEY}
                )
                
                if response.status_code != 200:
                    logger.warning(f"Trending metadata failed, falling back to AI: {response.status_code}")
                    metadata_source = "ai"  # Fallback to AI
                else:
                    trending_result = response.json()
                    
                    if trending_result.get("success"):
                        metadata_dict = {
                            "name": trending_result["name"],
                            "symbol": trending_result["symbol"],
                            "description": trending_result.get("description", ""),
                            "metadata_uri": trending_result["metadata_uri"],
                            "image_url": trending_result["image_url"],
                            "generated_from_trend": True
                        }
                    else:
                        logger.warning(f"Trending metadata failed, falling back to AI: {trending_result.get('error')}")
                        metadata_source = "ai"  # Fallback to AI
        
        # If source is AI or trending failed
        if metadata_source == "ai" or not metadata_dict:
            # Generate AI metadata
            metadata_request = MetadataRequest(
                style=request.style,
                keywords=request.keywords,
                category="meme",
                use_dalle=use_images  # For AI, use_dalle controls image generation
            )
            
            # Call the OpenAI metadata generation function
            response = await generate_metadata(metadata_request, source="ai")
            
            if not response or not response.success:
                raise HTTPException(
                    status_code=500, 
                    detail="AI metadata generation failed"
                )
            
            metadata_dict = {
                "name": response.name,
                "symbol": response.symbol,
                "metadata_uri": response.metadata_uri,
                "image_url": response.image_url,
                "description": response.description,
                "generated_from_trend": False
            }
        
        # Create launch config
        launch_config = LaunchConfigCreate(
            use_ai_metadata=False,
            custom_metadata=metadata_dict,
            bot_count=request.bot_count,
            creator_buy_amount=request.creator_buy_amount,
            bot_buy_amount=request.bot_buy_amount,
            sell_strategy_type=request.sell_strategy_type,
            sell_volume_target=request.sell_volume_target,
            sell_price_target=request.sell_price_target,
            sell_time_minutes=request.sell_time_minutes,
            use_jito_bundle=True,
            priority=10,
            metadata_source=metadata_source  # Add metadata source to config
        )
        
        # Create launch request
        launch_request = LaunchCreate(
            config=launch_config,
            priority=10
        )
        
        # Call regular launch endpoint
        result = await create_token_launch(launch_request, background_tasks, current_user, db)
        
        # Add metadata source info to response
        result["metadata_source"] = metadata_source
        result["generated_from_trend"] = metadata_dict.get("generated_from_trend", False)
        
        return result
        
    except Exception as e:
        logger.error(f"Quick launch failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=500, 
            detail=f"Quick launch failed: {str(e)}"
        )    
        
@router.post("/launch-with-metadata-choice", response_model=Dict[str, Any])
async def launch_with_metadata_choice(
    request: QuickLaunchRequest,
    background_tasks: BackgroundTasks,
    metadata_source: str = Query("ai", description="Metadata source: 'ai' or 'trending'"),
    use_images: bool = Query(True, description="Generate/use images from source"),
    style: str = Query("trending", description="Style for metadata generation"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Launch with explicit choice between AI or Trending metadata
    Provides clear feedback about which source was used
    """
    try:
        logger.info(f"Launch with metadata choice: source={metadata_source}, use_images={use_images}")
        
        # Generate metadata based on user choice
        if metadata_source == "trending":
            logger.info("Generating metadata from X Trends...")
            
            # Call the unified metadata generation endpoint
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    f"{settings.BACKEND_BASE_URL}/ai/generate-metadata-unified",
                    json={
                        "style": style,
                        "keywords": request.keywords,
                        "source": "trending",
                        "use_images": use_images,
                        "category": "meme"
                    },
                    headers={"X-API-Key": settings.ONCHAIN_API_KEY}
                )
                
                if response.status_code != 200:
                    raise HTTPException(
                        status_code=500,
                        detail=f"Trending metadata failed: {response.status_code}"
                    )
                
                metadata_result = response.json()
                
                if not metadata_result.get("success"):
                    raise HTTPException(
                        status_code=500,
                        detail=f"Trending metadata failed: {metadata_result.get('error')}"
                    )
                
                metadata_dict = metadata_result["metadata"]
                metadata_dict["generated_from_trend"] = metadata_result.get("generated_from_trend", True)
                source_info = {
                    "source": "trending",
                    "description": "Generated from trending X topics",
                    "image_source": "X tweets" if use_images else "None"
                }
        
        else:  # AI source
            logger.info("Generating AI metadata...")
            
            # Call the OpenAI metadata generation
            metadata_request = MetadataRequest(
                style=style,
                keywords=request.keywords,
                category="meme",
                use_dalle=use_images,
                theme=f"Token created via Flash Sniper"
            )
            
            metadata_response = await generate_metadata(metadata_request, source="ai")
            
            if not metadata_response or not metadata_response.success:
                raise HTTPException(
                    status_code=500,
                    detail="AI metadata generation failed"
                )
            
            metadata_dict = {
                "name": metadata_response.name,
                "symbol": metadata_response.symbol,
                "description": metadata_response.description,
                "metadata_uri": metadata_response.metadata_uri,
                "image_url": metadata_response.image_url,
                "generated_from_trend": False
            }
            
            source_info = {
                "source": "ai",
                "description": "Generated by OpenAI",
                "image_source": "DALL-E" if use_images else "Placeholder"
            }
        
        # Log metadata details
        logger.info(f"✅ Metadata generated from {metadata_source}")
        logger.info(f"   Name: {metadata_dict['name']}")
        logger.info(f"   Symbol: {metadata_dict['symbol']}")
        logger.info(f"   Metadata URI: {metadata_dict.get('metadata_uri', 'Not set')[:100]}...")
        
        # Create launch config
        launch_config = LaunchConfigCreate(
            use_ai_metadata=False,
            custom_metadata=metadata_dict,
            bot_count=request.bot_count,
            creator_buy_amount=request.creator_buy_amount,
            bot_buy_amount=request.bot_buy_amount,
            sell_strategy_type=request.sell_strategy_type,
            sell_volume_target=request.sell_volume_target,
            sell_price_target=request.sell_price_target,
            sell_time_minutes=request.sell_time_minutes,
            use_jito_bundle=True,
            priority=10,
            metadata_source=metadata_source,
            metadata_style=style
        )
        
        # Create launch request
        launch_request = LaunchCreate(
            config=launch_config,
            priority=10
        )
        
        # Call regular launch endpoint
        result = await create_token_launch(launch_request, background_tasks, current_user, db)
        
        # Enhance response with metadata info
        result["metadata_info"] = {
            **source_info,
            "name": metadata_dict["name"],
            "symbol": metadata_dict["symbol"],
            "image_url": metadata_dict.get("image_url", ""),
            "generated_from_trend": metadata_dict.get("generated_from_trend", False)
        }
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Launch with metadata choice failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Launch with metadata choice failed: {str(e)}"
        )
        
        
@router.get("/launch/{launch_id}/status", response_model=LaunchStatusResponse)
async def get_launch_status(
    launch_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get status of a specific launch
    """
    try:
        # Try Redis first
        status_key = f"launch_status:{launch_id}"
        cached_status = await redis_client.get(status_key)
        
        if cached_status:
            status_data = json.loads(cached_status)
            
            # Verify ownership
            stmt = select(TokenLaunch).where(
                TokenLaunch.launch_id == launch_id,
                TokenLaunch.user_wallet_address == current_user.wallet_address
            )
            result = await db.execute(stmt)
            launch = result.scalar_one_or_none()
            
            if not launch:
                raise HTTPException(status_code=404, detail="Launch not found")
            
            return LaunchStatusResponse(**status_data)
        
        # Get from database
        stmt = select(TokenLaunch).where(
            TokenLaunch.launch_id == launch_id,
            TokenLaunch.user_wallet_address == current_user.wallet_address
        )
        result = await db.execute(stmt)
        launch = result.scalar_one_or_none()
        
        if not launch:
            raise HTTPException(status_code=404, detail="Launch not found")
        
        # Build response
        return LaunchStatusResponse(
            launch_id=launch.launch_id,
            status=launch.status,
            progress=launch.progress,
            current_step=launch.current_step,
            message=launch.message,
            mint_address=launch.mint_address,
            metadata_for_token=launch.metadata_for_token,
            creator_tx_hash=launch.creator_tx_hash,
            bot_buy_bundle_id=launch.bot_buy_bundle_id,
            bot_sell_bundle_id=launch.bot_sell_bundle_id,
            started_at=launch.started_at,
            updated_at=launch.started_at,  # Use started_at as fallback
            success=launch.success,
            total_profit=launch.total_profit,
            roi=launch.roi,
            duration=launch.duration
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get launch status: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to get launch status: {str(e)}")

@router.get("/launches", response_model=LaunchHistoryResponse)
async def get_launch_history(
    limit: int = 10,
    offset: int = 0,
    status: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get user's launch history
    """
    try:
        # Build query
        query = select(TokenLaunch).where(
            TokenLaunch.user_wallet_address == current_user.wallet_address
        )
        
        if status:
            query = query.where(TokenLaunch.status == LaunchStatus(status))
        
        # Get total count
        count_query = select(func.count(TokenLaunch.id)).where(
            TokenLaunch.user_wallet_address == current_user.wallet_address
        )
        if status:
            count_query = count_query.where(TokenLaunch.status == LaunchStatus(status))
        
        count_result = await db.execute(count_query)
        total = count_result.scalar()
        
        # Get launches
        query = query.order_by(TokenLaunch.started_at.desc()).offset(offset).limit(limit)
        result = await db.execute(query)
        launches = result.scalars().all()
        
        # Format response
        launch_items = []
        for launch in launches:
            metadata_for_token = launch.metadata_for_token or {}
            launch_items.append(LaunchHistoryItem(
                launch_id=launch.launch_id,
                token_name=metadata_for_token.get("name"),
                token_symbol=metadata_for_token.get("symbol"),
                mint_address=launch.mint_address,
                status=launch.status,
                success=launch.success,
                total_profit=launch.total_profit,
                roi=launch.roi,
                duration=launch.duration,
                started_at=launch.started_at,
                completed_at=launch.completed_at
            ))
        
        return LaunchHistoryResponse(
            launches=launch_items,
            total=total,
            limit=limit,
            offset=offset
        )
        
    except Exception as e:
        logger.error(f"Failed to get launch history: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to get launch history: {str(e)}")

@router.post("/cancel-launch/{launch_id}")
async def cancel_launch(
    launch_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Cancel an ongoing launch
    """
    try:
        # Get launch
        stmt = select(TokenLaunch).where(
            TokenLaunch.launch_id == launch_id,
            TokenLaunch.user_wallet_address == current_user.wallet_address
        )
        result = await db.execute(stmt)
        launch = result.scalar_one_or_none()
        
        if not launch:
            raise HTTPException(status_code=404, detail="Launch not found")
        
        # Check if can be cancelled
        if launch.status in [LaunchStatus.COMPLETE, LaunchStatus.FAILED, LaunchStatus.CANCELLED]:
            raise HTTPException(status_code=400, detail="Launch already completed or failed")
        
        # Update status
        launch.status = LaunchStatus.CANCELLED
        launch.message = "Cancelled by user"
        launch.completed_at = datetime.utcnow()
        
        await db.commit()
        
        # Remove from Redis
        status_key = f"launch_status:{launch_id}"
        await redis_client.delete(status_key)
        
        return {
            "success": True,
            "message": f"Launch {launch_id} cancelled successfully"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to cancel launch: {e}", exc_info=True)
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to cancel launch: {str(e)}")

@router.post("/estimate-cost", response_model=CostEstimationResponse)
async def estimate_launch_cost(
    config: LaunchConfigCreate,
    current_user: User = Depends(get_current_user)
):
    """
    Estimate cost for a launch configuration
    """
    try:
        # Calculate costs
        bot_cost = config.bot_count * config.bot_buy_amount
        creator_cost = config.creator_buy_amount
        
        # Transaction fees
        if config.use_jito_bundle:
            tx_fees = 0.001 * (config.bot_count + 1)
        else:
            tx_fees = 0.002 * (config.bot_count + 1)
        
        total_cost = bot_cost + creator_cost + tx_fees
        
        return CostEstimationResponse(
            total_cost=total_cost,
            recommended_balance=total_cost * 1.2,
            cost_breakdown={
                "bot_wallets": bot_cost,
                "creator_buy": creator_cost,
                "transaction_fees": tx_fees,
                "total": total_cost
            }
        )
        
    except Exception as e:
        logger.error(f"Failed to estimate cost: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to estimate cost: {str(e)}")

@router.post("/atomic-create-and-buy", response_model=Dict[str, Any])
async def atomic_create_and_buy(
    request: Dict[str, Any],
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Simplified atomic create and buy - just token creation with creator buy
    Bot buys will be handled separately
    """
    try:
        # Generate launch ID
        launch_id = f"atomic_simple_{int(datetime.utcnow().timestamp())}_{uuid.uuid4().hex[:8]}"
        
        # Extract metadata from request
        metadata_from_request = request.get("metadata", {})
        
        if not metadata_from_request.get("name") or not metadata_from_request.get("symbol"):
            raise HTTPException(
                status_code=400,
                detail="Metadata must include 'name' and 'symbol'"
            )
        
        # Create launch config
        launch_config = LaunchConfigCreate(
            use_ai_metadata=False,
            custom_metadata=metadata_from_request,
            bot_count=len(request.get("bot_wallets", [])),
            creator_buy_amount=request.get("creator_buy_amount", 0.001),
            bot_buy_amount=request.get("bot_wallets", [{}])[0].get("buy_amount", 0.0001) if request.get("bot_wallets") else 0.0001,
            sell_strategy_type=request.get("sell_strategy", {}).get("type", "volume_based"),
            sell_volume_target=request.get("sell_strategy", {}).get("volume_target", 5.0),
            sell_time_minutes=request.get("sell_strategy", {}).get("time_minutes", 5),
            sell_price_target=request.get("sell_strategy", {}).get("price_target", 2.0),
            use_jito_bundle=False,  # Don't use Jito for atomic token creation
            priority=10
        )
        
        # Create launch coordinator (regular, not atomic)
        coordinator = LaunchCoordinator(launch_id, current_user, db)
        coordinator.launch_config = launch_config.model_dump()
        coordinator.metadata_for_token = launch_config.custom_metadata
        
        # Create launch record
        await coordinator._create_launch_record()
        await coordinator._update_launch_with_metadata()
        
        # Execute token creation with creator buy in background
        background_tasks.add_task(coordinator.execute_launch)
        
        return {
            "success": True,
            "launch_id": launch_id,
            "message": "Atomic token creation with creator buy launched successfully",
            "note": "Bot buys will be executed in separate transactions"
        }
        
    except Exception as e:
        logger.error(f"Atomic create+buy failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Atomic create+buy failed: {str(e)}")
    
@router.post("/atomic-launch", response_model=AtomicLaunchResponse)
async def create_atomic_launch(
    request: AtomicLaunchRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Create an atomic launch with pre-funded bots
    
    This endpoint:
    1. Uses pre-funded bot wallets
    2. Creates token + executes all buys in single atomic bundle
    3. Returns immediately with launch ID
    """
    try:
        # Generate launch ID
        launch_id = f"atomic_{int(datetime.utcnow().timestamp())}_{uuid.uuid4().hex[:8]}"
        
        # Create atomic coordinator
        coordinator = AtomicLaunchCordinator(launch_id, current_user, db)
        
        # Prepare atomic launch
        success = await coordinator.prepare_atomic_launch(
            config=request.launch_config,
            use_pre_funded=request.use_pre_funded,
            max_bots=request.max_bots
        )
        
        if not success:
            raise HTTPException(status_code=400, detail="Atomic launch preparation failed")
        
        # Estimate cost
        estimated_cost = await coordinator._calculate_atomic_cost()
        
        # Execute in background
        background_tasks.add_task(coordinator.execute_atomic_launch)
        
        return AtomicLaunchResponse(
            success=True,
            launch_id=launch_id,
            atomic_bundle=True,
            total_bots_used=len(coordinator.pre_funded_bots),
            total_pre_funded=sum(b.pre_funded_amount or 0 for b in coordinator.pre_funded_bots),
            estimated_cost=estimated_cost,
            message="Atomic launch started in background"
        )
        
    except HTTPException:
        raise 
    except Exception as e:
        logger.error(f"Failed to create atomic launch: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to create atomic launch: {str(e)}")

@router.post("/orchestrated-launch")
async def orchestrated_launch(
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Complete orchestrated launch flow
    1. Auto pre-fund bots based on user settings
    2. Create token
    3. Execute atomic buy bundle
    4. Return complete results
    
    This is the main endpoint for the "Start Orchestrated Launch" button
    """
    try:
        # Get user's saved settings
        bot_count = current_user.default_bot_count or 10
        creator_buy_amount = current_user.default_creator_buy_amount or 0.001
        bot_buy_amount = current_user.default_bot_buy_amount or 0.0001
        
        # Calculate pre-fund amount (buy_amount * 2 for fees)
        pre_fund_amount = bot_buy_amount * 2
        
        # Step 1: Pre-fund bots
        logger.info(f"Starting orchestrated launch for {current_user.wallet_address}")
        logger.info(f"Pre-funding {bot_count} bots with {pre_fund_amount} SOL each")
        
        # Create pre-fund manager
        from app.routers.creators.prefund import BotPreFundingManager
        pre_fund_manager = BotPreFundingManager(current_user, db)
        
        # Get bots to pre-fund
        bots = await pre_fund_manager.get_available_bots(bot_count)
        
        if len(bots) < bot_count:
            raise HTTPException(status_code=400, detail=f"Need {bot_count} bot wallets, only {len(bots)} available")
        
        # Pre-fund bots
        pre_fund_result = await pre_fund_manager.pre_fund_bots(
            bots,
            pre_fund_amount,
            bot_buy_amount
        )
        
        if not pre_fund_result.get("success", False):
            raise HTTPException(status_code=500, detail=f"Pre-funding failed: {pre_fund_result.get('error')}")
        logger.info(f"Pre-funded {len(bots)} bots successfully")
        
        # Step 2: Create launch config using AI metadata
        from app.schemas.creators.openai import MetadataRequest
        metadata_request = MetadataRequest(
            style="ai-generated",
            keywords="crypto, launch, solana",
            category="meme"
        )
        
        metadata_response = await generate_metadata(metadata_request)
        
        if not metadata_response or not metadata_response.metadata_for_token:
            raise HTTPException(
                status_code=500,
                detail="Failed to generate AI metadata"
            )
        
        # Create launch config
        launch_config = LaunchConfigCreate(
            use_ai_metadata=False,
            custom_metadata={
                "name": metadata_response.metadata_for_token.name,
                "symbol": metadata_response.metadata_for_token.symbol,
                "description": metadata_response.metadata_for_token.description,
                "image": metadata_response.metadata_for_token.image,
                "attribute": [
                    attr.dict() for attr in metadata_response.metadata_for_token.attributes
                ]
            },
            bot_count=bot_count,
            creator_buy_amount=creator_buy_amount,
            bot_buy_amount=bot_buy_amount,
            sell_strategy_type="volume_based",
            sell_volume_target=5.0,
            use_jito_bundle=True
        )
        
        # Step 3: Create atomic launch
        atomic_request = AtomicLaunchRequest(
            launch_config=launch_config,
            use_pre_funded=True,
            max_bots=bot_count,
            atomic_bundle=True 
        )
        
        # Create atomic launch
        return await create_atomic_launch(
            atomic_request,
            background_tasks,
            current_user,
            db
        )
        
    except HTTPException:
        raise 
    except Exception as e:
        logger.error(f"Orchestrated launch failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Orchestrated launch failed: {str(e)}")

@router.post("/execute-bot-buys")
async def execute_bot_buys_only(
    request: Dict[str, Any],
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Execute bot buys for an already created token
    """
    try:
        mint_address = request.get("mint_address")
        if not mint_address:
            raise HTTPException(status_code=400, detail="mint_address is required")
        
        # Get the launch record
        stmt = select(TokenLaunch).where(
            TokenLaunch.mint_address == mint_address,
            TokenLaunch.user_wallet_address == current_user.wallet_address
        )
        result = await db.execute(stmt)
        launch = result.scalar_one_or_none()
        
        if not launch:
            raise HTTPException(status_code=404, detail="Token launch not found")
        
        # Create coordinator
        coordinator = LaunchCoordinator(launch.launch_id, current_user, db)
        coordinator.mint_address = mint_address
        coordinator.bot_wallets = []  # Will be populated
        
        # Get bot wallets
        bot_wallet_public_keys = [b["public_key"] for b in request.get("bot_wallets", [])]
        if bot_wallet_public_keys:
            stmt = select(BotWallet).where(
                BotWallet.public_key.in_(bot_wallet_public_keys),
                BotWallet.user_wallet_address == current_user.wallet_address
            )
            result = await db.execute(stmt)
            coordinator.bot_wallets = result.scalars().all()
        
        # Execute bot buys in background
        background_tasks.add_task(coordinator._execute_bot_buys)
        
        return {
            "success": True,
            "message": f"Executing bot buys for {mint_address}",
            "bot_count": len(coordinator.bot_wallets)
        }
        
    except Exception as e:
        logger.error(f"Bot buys execution failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Bot buys execution failed: {str(e)}")
    
@router.post("/notify-creation")
async def notify_token_creation(
    request: Dict[str, Any],
    db: AsyncSession = Depends(get_db)
):
    """
    Webhook endpoint for on-chain service to notify about token creation
    Called ASYNCHRONOUSLY by on-chain service after token creation
    """
    try:
        launch_id = request.get("launch_id")
        mint_address = request.get("mint_address")
        signature = request.get("signature")
        
        if not launch_id or not mint_address:
            return {"success": False, "error": "Missing required fields"}
        
        # Update launch record with token details
        stmt = select(TokenLaunch).where(TokenLaunch.launch_id == launch_id)
        result = await db.execute(stmt)
        launch = result.scalar_one_or_none()
        
        if launch:
            launch.mint_address = mint_address
            launch.creator_tx_hash = signature
            
            # Also emit WebSocket event (redundant but ensures delivery)
            await websocket_manager.broadcast_launch_event(
                launch_id=launch_id,
                event="token_creation_confirmed",
                data={
                    "launch_id": launch_id,
                    "mint_address": mint_address,
                    "signature": signature,
                    "confirmed_at": datetime.utcnow().isoformat()
                }
            )
            
            await db.commit()
        
        return {"success": True}
        
    except Exception as e:
        logger.error(f"Failed to process token creation notification: {e}")
        return {"success": False, "error": str(e)}

@router.post("/generate-from-trend")
async def generate_token_from_trend(
    style: str = Query("trending", description="Metadata style"),
    use_x_image: bool = Query(True, description="Use X/Twitter images"),
    current_user: User = Depends(get_current_user)
):
    """
    Generate token metadata from trending news/X topics
    This is what the frontend "Generate Metadata" button should call
    """
    try:
        logger.info(f"Generating token metadata from trends for user {current_user.wallet_address}")
        
        # Call the OpenAI trending endpoint
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{settings.BACKEND_BASE_URL}/ai/generate-from-trending-simple",
                json={
                    "style": style,
                    "use_x_image": use_x_image
                },
                headers={"X-API-Key": settings.ONCHAIN_API_KEY}
            )
            
            if response.status_code != 200:
                return {
                    "success": False,
                    "error": f"Trending API error: {response.status_code}"
                }
            
            result = response.json()
            
            if result.get("success"):
                return {
                    "success": True,
                    "metadata": {
                        "name": result["name"],
                        "symbol": result["symbol"],
                        "description": result.get("description", ""),
                        "metadata_uri": result["metadata_uri"],
                        "image_url": result["image_url"],
                        "generated_from_trend": True
                    }
                }
            else:
                return {
                    "success": False,
                    "error": result.get("error", "Trending generation failed")
                }
    
    except Exception as e:
        logger.error(f"Failed to generate from trend: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }
        
        

