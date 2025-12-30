# app/routers/tokencreate.py
import asyncio
from datetime import datetime
import json
import logging
from typing import Any, Dict, List, Optional
import uuid
import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import BotStatus, TokenMetadata, User, Trade, TokenLaunch, LaunchStatus, BotWallet, LaunchQueue
from app.database import get_db
from app.config import settings
from app.routers.creators.openai import generate_metadata
from app.routers.creators.user import get_sol_balance
from app.schemas.creators.openai import Attribute, MetadataRequest
from app.schemas.creators.tokencreate import AtomicLaunchRequest, AtomicLaunchResponse, CostEstimationResponse, LaunchConfigCreate, LaunchCreate, LaunchHistoryItem, LaunchHistoryResponse, LaunchStatusResponse, QuickLaunchRequest, SellStrategyType
from app.security import get_current_user
from app.utils import redis_client
from app.services.onchain_integration import onchain_client


# Configure logging
logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/creators/token",
    tags=['token']
)

# ============================================
# LAUNCH MANAGER (UPDATED FOR CREATOR MODE)
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
        """Prepare launch - validate and setup"""
        try:
            # Store config FIRST
            self.launch_config = config.model_dump()
            
            # Create launch record BEFORE any status updates
            await self._create_launch_record()
            
            # Now update status
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
            
            # Get or generate metadata
            # await self._get_metadata(config)
            # await self._update_status(LaunchStatus.METADATA_GENERATED, 20, "Metadata generated")
            
            # Get bot wallets - UPDATED
            await self._get_available_funded_bots(
                config.bot_count, 
                min_balance=config.bot_buy_amount
            )
            await self._update_status(LaunchStatus.SETUP, 30, "Bot wallets prepared")
            
            # Get bot wallets
            await self._get_bot_wallets(config.bot_count)
            await self._update_status(LaunchStatus.SETUP, 30, "Bot wallets prepared")
            
            # Update launch record with metadata
            await self._update_launch_with_metadata()
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to prepare launch {self.launch_id}: {e}", exc_info=True)
            # Rollback any database changes on error
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
        """Execute the complete launch process with better error handling"""
        try:
            # Check on-chain service health first
            if not await onchain_client.health_check():
                raise Exception("On-chain service is not available")
            
            # Ensure metadata exists before token creation
            if not self.metadata_for_token:
                logger.warning("No metadata found, ensuring metadata exists...")
                await self._ensure_metadata()
                
            # 1. Create token on-chain
            await self._update_status(LaunchStatus.ONCHAIN_CREATION, 40, "Creating token...")
            token_result = await self._create_token_onchain()
            
            if not token_result.get("success"):
                error_msg = token_result.get("error", "Unknown error")
                raise Exception(f"Token creation failed: {error_msg}")
            
            self.mint_address = token_result.get("mint_address")
            
            # Update launch record with mint address
            self.launch_record.mint_address = self.mint_address
            self.launch_record.creator_tx_hash = token_result.get("signature")
            # self.launch_record.creator_bundle_id = token_result.get("bundle_id")
            await self.db.commit()
            
            # 2. Fund bot wallets
            await self._update_status(LaunchStatus.FUNDING, 60, "Funding bot wallets...")
            fund_result = await self._fund_bot_wallets()
            
            if not fund_result.get("success"):
                raise Exception(f"Bot funding failed: {fund_result.get('error')}")
            
            # Record funding bundle
            # self.launch_record.funding_bundle_id = fund_result.get("bundle_id")
            # self.launch_record.estimated_cost = fund_result.get("estimated_cost")
            await self.db.commit()
            
            # 3. Execute creator buy
            await self._update_status(LaunchStatus.BUYING, 70, "Executing creator buy...")
            creator_buy_result = await self._execute_creator_buy()
            
            if not creator_buy_result.get("success"):
                raise Exception(f"Creator buy failed: {creator_buy_result.get('error')}")
            
            # 4. Execute bot buys
            await self._update_status(LaunchStatus.BUYING, 80, "Executing bot buys...")
            bot_buy_result = await self._execute_bot_buys()
            
            if not bot_buy_result.get("success"):
                raise Exception(f"Bot buys failed: {bot_buy_result.get('error')}")
            
            # Record bot buy bundle
            self.launch_record.bot_buy_bundle_id = bot_buy_result.get("bundle_id")
            await self.db.commit()
            
            # 5. Monitor and sell
            await self._update_status(LaunchStatus.MONITORING, 90, "Monitoring performance...")
            sell_result = await self._monitor_and_sell()
            
            if not sell_result.get("success"):
                raise Exception(f"Sell execution failed: {sell_result.get('error')}")
            
            # 6. Complete
            await self._update_status(LaunchStatus.COMPLETE, 100, "🎉 Launch completed successfully!")
            
            # Calculate results
            results = await self._calculate_results()
            
            # Update final launch record
            self.launch_record.success = True
            self.launch_record.total_profit = results["total_profit"]
            self.launch_record.roi = results["roi"]
            self.launch_record.duration = results["duration"]
            self.launch_record.completed_at = datetime.utcnow()
            self.launch_record.bot_sell_bundle_id = sell_result.get("bundle_id")
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
                
                # Instead of trying to create TokenMetadata DB model,
                # create a simple dict to store metadata
                self.metadata_for_token = {
                    "name": custom_data.get("name", f"Token_{int(datetime.utcnow().timestamp())}"),
                    "symbol": custom_data.get("symbol", "TKN"),
                    "description": custom_data.get("description", "Token created via Flash Sniper"),
                    "image": custom_data.get("image", "https://placehold.co/600x400"),
                    "attributes": [
                        {"trait_type": "Platform", "value": "Flash Sniper"},
                        {"trait_type": "Created", "value": datetime.utcnow().strftime("%Y-%m-%d")},
                    ]
                }
                
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
                
                if not response or not response.metadata_for_token:
                    raise Exception("AI metadata generation failed")
                
                # Convert Pydantic model to dict
                self.metadata_for_token = response.metadata_for_token.dict()
                logger.info(f"AI metadata generated: {self.metadata_for_token['name']} ({self.metadata_for_token['symbol']})")
                
            else:
                # Generate basic metadata
                timestamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
                self.metadata_for_token = {
                    "name": f"Token_{timestamp}",
                    "symbol": f"TKN{timestamp[-4:]}",
                    "description": "Token created via Flash Sniper",
                    "image": "https://placehold.co/600x400",
                    "attributes": [
                        {"trait_type": "Platform", "value": "Flash Sniper"},
                        {"trait_type": "Created", "value": datetime.utcnow().strftime("%Y-%m-%d")},
                    ]
                }
            
            # Add creator attribution
            self.metadata_for_token["attributes"].append({
                "trait_type": "Creator",
                "value": self.user.wallet_address[:8] + "..."
            })
            
            logger.info(f"Metadata ready: {self.metadata_for_token['name']}")
            
        except Exception as e:
            logger.error(f"Failed to generate metadata: {e}", exc_info=True)
            # Fallback to basic metadata
            timestamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
            self.metadata_for_token = {
                "name": f"Token_{timestamp}",
                "symbol": f"TKN{timestamp[-4:]}",
                "description": "Token created via Flash Sniper",
                "image": "https://placehold.co/600x400",
                "attributes": [
                    {"trait_type": "Platform", "value": "Flash Sniper"},
                    {"trait_type": "Created", "value": datetime.utcnow().strftime("%Y-%m-%d")},
                    {"trait_type": "Creator", "value": self.user.wallet_address[:8] + "..."},
                ]
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
        
        logger.info(f"Found {len(self.bot_wallets)} available bot wallets")
        
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
            
    # Create token + creator buy + bot's buy in a single transaction
    # async def _create_token_onchain(self) -> Dict[str, Any]:
    #     """Create token with atomic creator buy and bot buys"""
    #     try:
    #         # CRITICAL FIX: Ensure metadata exists
    #         if not self.metadata_for_token:
    #             logger.warning(f"metadata_for_token is None for launch {self.launch_id}, generating fallback metadata")
    #             await self._ensure_metadata()
                
    #             # If still None, create basic metadata
    #             if not self.metadata_for_token:
    #                 timestamp = int(datetime.utcnow().timestamp())
    #                 self.metadata_for_token = {
    #                     "name": f"Token_{timestamp}",
    #                     "symbol": f"TKN{timestamp % 10000:04d}",
    #                     "image": "https://placehold.co/600x400",
    #                     "description": "Token created via Flash Sniper"
    #                 }
            
    #         # Use the atomic launch endpoint
    #         bot_configs = []
    #         for bot in self.bot_wallets:
    #             bot_configs.append({
    #                 "public_key": bot.public_key,
    #                 "amount_sol": self.launch_config.get("bot_buy_amount", 0.0001)
    #             })
            
    #         # Check if we have any bots to include
    #         if not bot_configs:
    #             logger.warning(f"No bot wallets found for launch {self.launch_id}")
                
    #         atomic_payload = {
    #             "user_wallet": self.user.wallet_address,
    #             "metadata": {
    #                 "name": self.metadata_for_token.get("name", f"Token_{int(datetime.utcnow().timestamp())}"),
    #                 "symbol": self.metadata_for_token.get("symbol", "TKN"),
    #                 "uri": self.metadata_for_token.get("image", "https://placehold.co/600x400")
    #             },
    #             "creator_buy_amount": self.launch_config.get("creator_buy_amount", 0.001),
    #             "bot_wallets": bot_configs,
    #             "use_jito": self.launch_config.get("use_jito_bundle", True),
    #             "slippage_bps": 500
    #         }
            
    #         logger.info(f"Calling atomic launch with {len(bot_configs)} bots")
    #         logger.info(f"Token metadata: {atomic_payload['metadata']}")
            
    #         async with httpx.AsyncClient(timeout=90.0) as client:
    #             response = await client.post(
    #                 f"{settings.ONCHAIN_CLIENT_URL}/api/onchain/atomic-launch",
    #                 json=atomic_payload,
    #                 headers={"X-API-Key": settings.ONCHAIN_API_KEY}
    #             )
                
    #             if response.status_code != 200:
    #                 return {"success": False, "error": f"HTTP {response.status_code}: {response.text}"}
                
    #             result = response.json()
                
    #             if not result.get("success"):
    #                 return {"success": False, "error": result.get("error", "Unknown error")}
                
    #             self.mint_address = result.get("mint_address")
                
    #             # Update launch record
    #             if self.launch_record:
    #                 self.launch_record.mint_address = self.mint_address
    #                 self.launch_record.atomic_bundle = True
    #                 self.launch_record.bot_buy_bundle_id = result.get("bundle_id")
    #                 await self.db.commit()
                
    #             logger.info(f"✅ Atomic launch successful: {self.mint_address}")
                
    #             return result
                
    #     except Exception as e:
    #         logger.error(f"Atomic launch failed: {e}", exc_info=True)
    #         return {"success": False, "error": str(e)}
        
        
    async def _create_token_onchain(self) -> Dict[str, Any]:
        """Create token with 2-step approach (like top 1% bots)"""
        try:
            # Ensure metadata exists
            if not self.metadata_for_token:
                await self._ensure_metadata()
                
                if not self.metadata_for_token:
                    timestamp = int(datetime.utcnow().timestamp())
                    self.metadata_for_token = {
                        "name": f"Token_{timestamp}",
                        "symbol": f"TKN{timestamp % 10000:04d}",
                        "image": "https://placehold.co/400x400",
                        "description": "Token created via Flash Sniper"
                    }
            
            # Prepare bot configs
            bot_configs = []
            for bot in self.bot_wallets:
                bot_configs.append({
                    "public_key": bot.public_key,
                    "amount_sol": self.launch_config.get("bot_buy_amount", 0.0001)
                })
            
            logger.info(f"🔧 Starting 2-step launch with {len(bot_configs)} bots")
            
            # Call the new 2-step endpoint
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{settings.ONCHAIN_CLIENT_URL}/api/onchain/atomic-launch",  # NEW ENDPOINT
                    json={
                        "user_wallet": self.user.wallet_address,
                        "metadata": {
                            "name": self.metadata_for_token.get("name"),
                            "symbol": self.metadata_for_token.get("symbol"),
                            "uri": self.metadata_for_token.get("image", "https://placehold.co/400x400")
                        },
                        "creator_buy_amount": self.launch_config.get("creator_buy_amount", 0.001),
                        "bot_buys": bot_configs,
                        "use_jito": self.launch_config.get("use_jito_bundle", True),
                        "slippage_bps": 500
                    },
                    headers={"X-API-Key": settings.ONCHAIN_API_KEY}
                )
                
                if response.status_code != 200:
                    error_text = response.text[:200] if response.text else "No error message"
                    return {"success": False, "error": f"HTTP {response.status_code}: {error_text}"}
                
                result = response.json()
                
                if not result.get("success"):
                    return {"success": False, "error": result.get("error", "Unknown error")}
                
                self.mint_address = result.get("mint_address")
                
                # Update launch record
                if self.launch_record:
                    self.launch_record.mint_address = self.mint_address
                    self.launch_record.creator_tx_hash = result.get("signatures", [None])[0]
                    self.launch_record.bot_buy_bundle_id = result.get("bundle_id")
                    self.launch_record.atomic_bundle = True
                    await self.db.commit()
                
                logger.info(f"✅ 2-step launch successful: {self.mint_address}")
                
                return result
                
        except Exception as e:
            logger.error(f"2-step launch failed: {e}", exc_info=True)
            return {"success": False, "error": str(e)}
        
    
    # Update bot funding
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
                    "amount_sol": self.launch_config["bot_buy_amount"]
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
            bot_configs = []
            for wallet in self.bot_wallets:
                bot_configs.append({
                    "public_key": wallet.public_key,
                    "buy_amount": self.launch_config["bot_buy_amount"]
                })
            
            result = await onchain_client.execute_buy(
                user_wallet=self.user.wallet_address,
                mint_address=self.mint_address,
                amount_sol=0,  # Bots have their own SOL
                bot_wallets=bot_configs,
                use_jito=self.launch_config.get("use_jito_bundle", True)
            )
            
            if not result.get("success"):
                raise Exception(f"Bot buys failed: {result.get('error')}")
            
            # Update bot wallets
            for wallet in self.bot_wallets:
                wallet.status = "bought"
                wallet.buy_tx_hash = result.get("signatures", [None])[0]  # Simplified
                wallet.last_updated = datetime.utcnow()
            
            await self.db.commit()
            
            return result
            
        except Exception as e:
            logger.error(f"Bot buys failed: {e}", exc_info=True)
            return {"success": False, "error": str(e)}
    
    # Update buy execution
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
        # Implement monitoring logic based on sell strategy
        sell_strategy = self.launch_config["sell_strategy_type"]
        
        if sell_strategy == SellStrategyType.VOLUME_BASED:
            await self._monitor_volume_based()
        elif sell_strategy == SellStrategyType.TIME_BASED:
            await self._monitor_time_based()
        elif sell_strategy == SellStrategyType.PRICE_TARGET:
            await self._monitor_price_based()
        
        # Execute sells
        await self._execute_sells()
    
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
        # Implement result calculation
        return {
            "total_profit": 0.0,
            "roi": 0.0,
            "duration": 300,
            "bot_count": len(self.bot_wallets),
            "successful_bots": len(self.bot_wallets)
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
                    "description": "Token created via Flash Sniper",
                    "attributes": [
                        {"trait_type": "Platform", "value": "Flash Sniper"},
                        {"trait_type": "Created", "value": datetime.utcnow().strftime("%Y-%m-%d")},
                    ]
                }
                logger.info(f"Created fallback metadata: {self.metadata_for_token['name']}")
            
    
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

@router.post("/quick-launch", response_model=Dict[str, Any])
async def quick_launch(
    request: QuickLaunchRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Quick launch with minimal configuration
    """
    try:
        logger.info(f"Starting quick launch for user {current_user.wallet_address}")
        
        # Generate AI metadata
        metadata_request = MetadataRequest(
            style=request.style,
            keywords=request.keywords,
            category="meme",
            use_dalle=request.use_dalle
        )
        
        # Call the OpenAI metadata generation
        metadata_response = await generate_metadata(metadata_request)
        
        if not metadata_response or not metadata_response.metadata_for_token:
            raise HTTPException(
                status_code=500, 
                detail="AI metadata generation failed"
            )
        
        # Create launch config
        launch_config = LaunchConfigCreate(
            use_ai_metadata=False,  # We already generated it
            custom_metadata={
                "name": metadata_response.metadata_for_token.name,
                "symbol": metadata_response.metadata_for_token.symbol,
                "description": metadata_response.metadata_for_token.description,
                "image": metadata_response.metadata_for_token.image,
                "attributes": [
                    attr.dict() for attr in metadata_response.metadata_for_token.attributes
                ]
            },
            bot_count=request.bot_count,
            creator_buy_amount=request.creator_buy_amount,
            bot_buy_amount=request.bot_buy_amount,
            sell_strategy_type=request.sell_strategy_type,
            sell_volume_target=request.sell_volume_target,
            sell_price_target=request.sell_price_target,
            sell_time_minutes=request.sell_time_minutes,
            metadata_style=request.style,
            use_jito_bundle=True,
            priority=10
        )
        
        # Create launch request
        launch_request = LaunchCreate(
            config=launch_config,
            priority=10  # High priority for quick launches
        )
        
        # Call regular launch endpoint
        return await create_token_launch(launch_request, background_tasks, current_user, db)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Quick launch failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=500, 
            detail=f"Quick launch failed: {str(e)}"
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
    
    # async def _get_pre_funded_bots(self, count: int):
    #     """Get pre-funded bot wallets - check both database flag AND actual balance"""
    #     from app.routers.creators.user import get_sol_balance
        
    #     # First get bots marked as pre-funded
    #     stmt = select(BotWallet).where(
    #         BotWallet.user_wallet_address == self.user.wallet_address,
    #         BotWallet.is_pre_funded == True
    #     ).order_by(BotWallet.created_at.desc()).limit(count * 2)
        
    #     result = await self.db.execute(stmt)
    #     potential_bots = result.scalars().all()
        
    #     # Check actual balance
    #     funded_bots = []
    #     for bot in potential_bots:
    #         try:
    #             balance = await get_sol_balance(bot.public_key)
    #             if balance > 0:
    #                 funded_bots.append(bot)
                    
    #                 if len(funded_bots) >= count:
    #                     break
                        
    #         except Exception as e:
    #             logger.error(f"Failed to check balance for pre-funded bot {bot.public_key[:8]}: {e}")
    #             continue
        
    #     self.pre_funded_bots = funded_bots
    #     self.bot_wallets = funded_bots # For compatibility
    #     return funded_bots

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
    
    # async def execute_atomic_launch(self) -> Dict[str, Any]:
    #     """Execute atomic launch with Jito bundle - CREATE + ALL BUYS"""
    #     try:
    #         await self._update_status(LaunchStatus.ONCHAIN_CREATION, 40, "Creating token atomically...")
            
    #         # CRITICAL: Ensure metadata_for_token exists
    #         if not self.metadata_for_token:
    #             logger.error(f"No metadata_for_token found for launch {self.launch_id}")
    #             logger.error(f"Launch config: {self.launch_config}")
    #             raise Exception("No metadata generated for token creation")
            
    #         # Prepare atomic payload - ensure metadata has required fields
    #         metadata_for_api = {
    #             "name": self.metadata_for_token.get("name", f"Token_{int(datetime.utcnow().timestamp())}"),
    #             "symbol": self.metadata_for_token.get("symbol", "TKN"),
    #             "description": self.metadata_for_token.get("description", "Token created via Flash Sniper"),
    #             "image": self.metadata_for_token.get("image", "https://placehold.co/600x400")
    #         }
            
    #         atomic_payload = {
    #             "action": "atomic_create_and_buy",
    #             "user_wallet": self.user.wallet_address,
    #             "metadata": metadata_for_api,  # Use the processed metadata
    #             "creator_buy_amount": self.launch_config.get("creator_buy_amount", 0.001),
    #             "bot_wallets": [],  # We'll populate this
    #             "use_jito": True,
    #             "atomic_bundle": True,
    #             "sell_strategy": {
    #                 "type": self.launch_config.get("sell_strategy_type", "volume_based"),
    #                 "volume_target": self.launch_config.get("sell_volume_target", 5.0),
    #                 "time_minutes": self.launch_config.get("sell_time_minutes", 5),
    #                 "price_target": self.launch_config.get("sell_price_target", 2.0)
    #             }
    #         }
            
    #         # Prepare bot wallets for atomic bundle
    #         for bot in self.pre_funded_bots:
    #             atomic_payload["bot_wallets"].append({
    #                 "public_key": bot.public_key,
    #                 "buy_amount": self.launch_config.get("bot_buy_amount", 0.0001)
    #             })
            
    #         logger.info(f"Atomic payload prepared with {len(atomic_payload['bot_wallets'])} bots")
    #         logger.info(f"Token metadata: {metadata_for_api}")
            
    #         # Call atomic launch endpoint
    #         result = await self._execute_atomic_create_and_buy(atomic_payload)
            
    #         if not result.get("success"):
    #             error_msg = result.get("error", "Unknown error")
    #             raise Exception(f"Atomic launch failed: {error_msg}")
            
    #         self.mint_address = result.get("mint_address")
            
    #         # Update launch record
    #         self.launch_record.mint_address = self.mint_address
    #         self.launch_record.creator_tx_hash = result.get("creator_signature")
    #         self.launch_record.bot_buy_bundle_id = result.get("bundle_id")
    #         self.launch_record.atomic_bundle = True
    #         await self.db.commit()
            
    #         # Update bot statuses
    #         await self._update_bot_statuses_after_atomic_launch(result)
            
    #         # Execute sell immediately (if configured)
    #         await self._execute_atomic_sell(result)
            
    #         await self._update_status(LaunchStatus.COMPLETE, 100, "🎉 Atomic launch completed successfully!")
            
    #         results = {
    #             "total_profit": result.get("estimated_profit", 0.0),
    #             "roi": result.get("estimated_roi", 0.0),
    #             "duration": int((datetime.utcnow() - self.launch_record.started_at).total_seconds()),
    #             "bot_count": len(self.pre_funded_bots),
    #             "atomic_bundle": True
    #         }
            
    #         # Update final launch record
    #         self.launch_record.success = True
    #         self.launch_record.total_profit = results["total_profit"]
    #         self.launch_record.roi = results["roi"]
    #         self.launch_record.duration = results["duration"]
    #         self.launch_record.completed_at = datetime.utcnow()
    #         await self.db.commit()
            
    #         return {
    #             "success": True,
    #             "launch_id": self.launch_id,
    #             "mint_address": self.mint_address,
    #             "atomic_bundle": True,
    #             "total_bots_used": len(self.pre_funded_bots),
    #             "signatures": result.get("signatures", []),
    #             "bundle_id": result.get("bundle_id"),
    #             "results": results
    #         }
            
    #     except Exception as e:
    #         logger.error(f"Atomic launch {self.launch_id} failed: {e}", exc_info=True)
    #         await self._update_status(LaunchStatus.FAILED, 0, f"Atomic launch failed: {str(e)}")
            
    #         if self.launch_record:
    #             self.launch_record.success = False
    #             self.launch_record.completed_at = datetime.utcnow()
    #             self.launch_record.message = str(e)
    #             await self.db.commit()
            
    #         return {
    #             "success": False,
    #             "launch_id": self.launch_id,
    #             "error": str(e)
    #         }
        
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
            
            # Step 1: Create token with creator buy
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
            if self.pre_funded_bots:
                await self._update_status(LaunchStatus.BUYING, 60, "Executing bot buys...")
                
                bot_buy_result = await self._execute_bot_buys()
                
                if not bot_buy_result.get("success"):
                    logger.warning(f"Bot buys partially failed: {bot_buy_result.get('error')}")
                    # Continue anyway - partial success is okay
                else:
                    self.launch_record.bot_buy_bundle_id = bot_buy_result.get("bundle_id")
                    await self.db.commit()
            
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
        """Ensure metadata exists, generate if not"""
        if not self.metadata_for_token:
            logger.info(f"No metadata found for launch {self.launch_id}, generating...")
            
            if self.launch_config:
                # Try to get from custom_metadata
                custom_metadata = self.launch_config.get("custom_metadata")
                if custom_metadata:
                    self.metadata_for_token = custom_metadata
                    logger.info(f"Using custom metadata from config")
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
                    "description": "Token created via Flash Sniper",
                    "attributes": [
                        {"trait_type": "Platform", "value": "Flash Sniper"},
                        {"trait_type": "Created", "value": datetime.utcnow().strftime("%Y-%m-%d")},
                    ]
                }
                logger.info(f"Created fallback metadata: {self.metadata_for_token['name']}")
                
                 
    # async def _execute_atomic_create_and_buy(self, payload: Dict[str, Any]) -> Dict[str, Any]:
    #     """Execute atomic create + buy bundle"""
    #     try:
    #         async with httpx.AsyncClient(timeout=60.0) as client:
    #             response = await client.post(
    #                 f"{settings.ONCHAIN_CLIENT_URL}/api/onchain/atomic-create-and-buy",
    #                 json=payload,
    #                 headers={"X-API-Key": settings.ONCHAIN_API_KEY}
    #             )
                
    #             if response.status_code != 200:
    #                 return {"success": False, "error": f"HTTP {response.status_code}: {response.text}"}
                
    #             return response.json()
                
    #     except Exception as e:
    #         logger.error(f"Atomic create+buy failed: {e}")
    #         return {"success": False, "error": str(e)}
        
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
            
            async with httpx.AsyncClient(timeout=90.0) as client:
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
                    "buy_amount": bot.funded_amount or self.launch_config["bot_buy_amount"]
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
# API ENDPOINTS
# ====================================
# @router.post("/atomic-create-and-buy", response_model=Dict[str, Any])
# async def atomic_create_and_buy(
#     request: Dict[str, Any],
#     background_tasks: BackgroundTasks,
#     current_user: User = Depends(get_current_user),
#     db: AsyncSession = Depends(get_db)
# ):
#     """
#     Execute atomic token creation and buy bundle
#     """
#     try:
#         # Generate launch ID
#         launch_id = f"atomic_{int(datetime.utcnow().timestamp())}_{uuid.uuid4().hex[:8]}"
        
#         # Get metadata from request (this is the key fix)
#         metadata_from_request = request.get("metadata", {})
        
#         # Create launch config using the provided metadata
#         launch_config = LaunchConfigCreate(
#             use_ai_metadata=False,
#             custom_metadata={
#                 "name": metadata_from_request.get("name", f"Atomic_Token_{int(datetime.utcnow().timestamp())}"),
#                 "symbol": metadata_from_request.get("symbol", "ATOMIC"),
#                 "description": metadata_from_request.get("description", "Token created via atomic launch"),
#                 "image": metadata_from_request.get("image", "https://placehold.co/600x400")
#             },
#             bot_count=len(request.get("bot_wallets", [])),
#             creator_buy_amount=request.get("creator_buy_amount", 0.001),
#             bot_buy_amount=request.get("bot_wallets", [{}])[0].get("buy_amount", 0.0001) if request.get("bot_wallets") else 0.0001,
#             sell_strategy_type=request.get("sell_strategy", {}).get("type", "volume_based"),
#             sell_volume_target=request.get("sell_strategy", {}).get("volume_target", 5.0),
#             sell_time_minutes=request.get("sell_strategy", {}).get("time_minutes", 5),
#             sell_price_target=request.get("sell_strategy", {}).get("price_target", 2.0),
#             use_jito_bundle=request.get("use_jito", True),
#             priority=10
#         )
        
#         # Create atomic coordinator
#         coordinator = AtomicLaunchCordinator(launch_id, current_user, db)
        
#         # Set the pre-funded bots from the request
#         coordinator.pre_funded_bots = []
#         for bot_data in request.get("bot_wallets", []):
#             # Find or create bot wallet record
#             bot_result = await db.execute(
#                 select(BotWallet).where(
#                     BotWallet.public_key == bot_data["public_key"],
#                     BotWallet.user_wallet_address == current_user.wallet_address
#                 )
#             )
#             bot = bot_result.scalar_one_or_none()
            
#             if bot:
#                 coordinator.pre_funded_bots.append(bot)
        
#         # CRITICAL FIX: Set metadata on coordinator BEFORE creating launch record
#         coordinator.metadata_for_token = launch_config.custom_metadata
#         coordinator.launch_config = launch_config.model_dump()
        
#         # Create launch record
#         await coordinator._create_launch_record()
#         await coordinator._update_launch_with_metadata()
        
#         # Execute atomic launch in background
#         background_tasks.add_task(coordinator.execute_atomic_launch)
        
#         return {
#             "success": True,
#             "launch_id": launch_id,
#             "message": "Atomic create+buy launched successfully",
#             "atomic_bundle": True
#         }
        
#     except Exception as e:
#         logger.error(f"Atomic create+buy failed: {e}", exc_info=True)
#         raise HTTPException(status_code=500, detail=f"Atomic create+buy failed: {str(e)}")
   
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
    



