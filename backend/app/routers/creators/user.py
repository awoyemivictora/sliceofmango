# app/routers/creators/user.py
import base64
from datetime import datetime
import os
import uuid
from fastapi import APIRouter, Body, HTTPException, Depends, BackgroundTasks, Header
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
import logging
import base58
import json
from app.utils.bot_components import websocket_manager
from app.database import AsyncSessionLocal, get_db
from app.models import BotStatus, User, UserRole, BotWallet, Trade, TokenLaunch
from app.schemas.creators.tokencreate import (
    CostEstimationRequest, CostEstimationResponse, 
    UserResponse, UserUpdate, LaunchHistoryItem, LaunchHistoryResponse
)
from app.utils import redis_client
from app.config import settings
from app.security import encrypt_private_key_backend, get_current_user
from solana.rpc.async_api import AsyncClient
from solders.pubkey import Pubkey
from solders.keypair import Keypair

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/creators/user",
    tags=['Creator Users']
)

# ============================================
# HELPER FUNCTIONS
# ============================================

async def get_sol_balance(wallet_address: str) -> float:
    """Get SOL balance for a wallet with timeout"""
    try:
        if not wallet_address or len(wallet_address) < 32:
            logger.warning(f"Invalid wallet address format: {wallet_address}")
            return 0.0
        
        import asyncio
        
        async with AsyncClient(
            settings.SOLANA_RPC_URL,
            timeout=10,  # 10 second timeout
        ) as client:
            try:
                # Add timeout wrapper
                pubkey = Pubkey.from_string(wallet_address)
                
                # Use asyncio.wait_for to add timeout
                balance_response = await asyncio.wait_for(
                    client.get_balance(pubkey),
                    timeout=10.0
                )
                
                if balance_response.value is None:
                    return 0.0
                    
                return balance_response.value / 1_000_000_000
                
            except asyncio.TimeoutError:
                logger.error(f"Timeout getting balance for {wallet_address[:8]}...")
                return 0.0
            except Exception as rpc_error:
                logger.error(f"RPC error for {wallet_address[:8]}: {rpc_error}")
                return 0.0
                
    except Exception as e:
        logger.error(f"Failed to get balance for {wallet_address[:8]}: {e}")
        return 0.0


async def cache_decrypted_key(wallet_address: str, base58_key: str, ttl: int = 300):
    """Cache decrypted key in Redis"""
    await redis_client.setex(
        f"creator:base58key:{wallet_address}", 
        ttl, 
        base58_key
    )

async def get_cached_decrypted_key(wallet_address: str) -> Optional[str]:
    """Get cached decrypted key from Redis"""
    try:
        cached_key = await redis_client.get(f"creator:base58key:{wallet_address}")
        if cached_key:
            return cached_key.decode('utf-8') if isinstance(cached_key, bytes) else str(cached_key)
        return None
    except Exception as e:
        logger.error(f"Error retrieving cached key: {e}")
        return None

# ============================================
# USER PROFILE ENDPOINTS
# ============================================

@router.get("/profile", response_model=UserResponse)
async def get_creator_profile(
    current_user: User = Depends(get_current_user)
):
    """Get creator profile information"""
    try:
        return UserResponse(
            wallet_address=current_user.wallet_address,
            role=current_user.role,
            is_premium=current_user.is_premium,
            premium_end_date=current_user.premium_end_date,
            creator_enabled=current_user.creator_enabled,
            creator_total_launches=current_user.creator_total_launches,
            creator_successful_launches=current_user.creator_successful_launches,
            creator_total_profit=current_user.creator_total_profit,
            creator_average_roi=current_user.creator_average_roi,
            creator_wallet_balance=current_user.creator_wallet_balance,
            creator_min_balance_required=current_user.creator_min_balance_required,
            created_at=current_user.created_at if hasattr(current_user, 'created_at') else datetime.utcnow()
        )
    except Exception as e:
        logger.error(f"Failed to get creator profile: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get profile: {str(e)}")

@router.put("/settings", response_model=UserResponse)
async def update_creator_settings(
    settings: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Update creator settings"""
    try:
        # Update user fields
        update_data = settings.model_dump(exclude_unset=True)
        
        # Handle role transitions
        if 'role' in update_data:
            role = update_data['role']
            if role == UserRole.CREATOR and not current_user.creator_enabled:
                update_data['creator_enabled'] = True
                # Start bot wallet generation in background
                asyncio.create_task(generate_bot_wallets_for_user(current_user.wallet_address, db))
            elif role == UserRole.SNIPER:
                update_data['creator_enabled'] = False
        
        # Update user in database
        stmt = update(User).where(
            User.wallet_address == current_user.wallet_address
        ).values(**update_data)
        
        await db.execute(stmt)
        await db.commit()
        
        # Refresh and return updated user
        stmt = select(User).where(User.wallet_address == current_user.wallet_address)
        result = await db.execute(stmt)
        updated_user = result.scalar_one()
        
        # Notify frontend of settings update
        await websocket_manager.send_personal_message(
            json.dumps({
                "type": "settings_updated",
                "message": "Creator settings updated successfully",
                "timestamp": datetime.utcnow().isoformat()
            }),
            current_user.wallet_address
        )
        
        return updated_user
        
    except Exception as e:
        logger.error(f"Failed to update creator settings: {e}", exc_info=True)
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to update settings: {str(e)}")

# ============================================
# CREATOR MODE MANAGEMENT
# ============================================

@router.post("/enable-creator")
async def enable_creator_mode(
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Enable creator mode for user"""
    try:
        # Check if user has encrypted private key
        if not current_user.encrypted_private_key:
            raise HTTPException(
                status_code=400,
                detail="User must have encrypted private key to enable creator mode"
            )
        
        # Check user balance
        balance = await get_sol_balance(current_user.wallet_address)
        min_balance = current_user.creator_min_balance_required or 0.0001
        
        if balance < min_balance:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient balance. Need {min_balance} SOL, have {balance:.2f} SOL"
            )
        
        # Update user to creator role
        stmt = update(User).where(
            User.wallet_address == current_user.wallet_address
        ).values(
            role=UserRole.CREATOR,
            creator_enabled=True,
            creator_wallet_balance=balance
        )
        
        await db.execute(stmt)
        await db.commit()
        
        # Start bot wallet generation in background
        background_tasks.add_task(generate_bot_wallets_for_user, current_user.wallet_address, db)
        
        # Notify user
        await websocket_manager.send_personal_message(
            json.dumps({
                "type": "creator_mode_enabled",
                "message": "Creator mode enabled. Bot wallets will be generated in background.",
                "balance": balance,
                "timestamp": datetime.utcnow().isoformat()
            }),
            current_user.wallet_address
        )
        
        return {
            "success": True,
            "message": "Creator mode enabled. Bot wallets will be generated in background.",
            "role": UserRole.CREATOR.value,
            "balance": balance
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to enable creator mode: {e}", exc_info=True)
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to enable creator mode: {str(e)}")

@router.post("/disable-creator")
async def disable_creator_mode(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Disable creator mode for user"""
    try:
        # Update user to sniper role
        stmt = update(User).where(
            User.wallet_address == current_user.wallet_address
        ).values(
            role=UserRole.SNIPER,
            creator_enabled=False
        )
        
        await db.execute(stmt)
        await db.commit()
        
        # Notify user
        await websocket_manager.send_personal_message(
            json.dumps({
                "type": "creator_mode_disabled",
                "message": "Creator mode disabled",
                "timestamp": datetime.utcnow().isoformat()
            }),
            current_user.wallet_address
        )
        
        return {
            "success": True,
            "message": "Creator mode disabled",
            "role": UserRole.SNIPER.value
        }
        
    except Exception as e:
        logger.error(f"Failed to disable creator mode: {e}", exc_info=True)
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to disable creator mode: {str(e)}")

# ============================================
# BOT WALLET MANAGEMENT
# ============================================

# @router.get("/bot-wallets")
# async def get_creator_bot_wallets(
#     current_user: User = Depends(get_current_user),
#     db: AsyncSession = Depends(get_db)
# ):
#     """Get user's bot wallets with secure private key access"""
#     try:
#         if not current_user.creator_enabled:
#             raise HTTPException(
#                 status_code=403,
#                 detail="Creator mode not enabled"
#             )
        
#         stmt = select(BotWallet).where(
#             BotWallet.user_wallet_address == current_user.wallet_address
#         ).order_by(BotWallet.created_at.desc())
        
#         result = await db.execute(stmt)
#         bot_wallets = result.scalars().all()
        
#         # Calculate stats
#         total_bots = len(bot_wallets)
#         active_bots = sum(1 for w in bot_wallets if w.status.value != "FAILED")
#         funded_bots = sum(1 for w in bot_wallets if w.funded_amount)
#         total_funded = sum(w.funded_amount or 0 for w in bot_wallets)
#         total_profit = sum(w.profit or 0 for w in bot_wallets)
        
#         # Format response with secure private key handling
#         wallets_data = []
#         for wallet in bot_wallets:
#             # Generate a temporary token for private key access (1-time use, 5 min expiry)
#             private_key_token = base64.urlsafe_b64encode(os.urandom(32)).decode('utf-8')
            
#             # Store encrypted private key in Redis with short TTL
#             await redis_client.setex(
#                 f"bot_key:{private_key_token}",
#                 300,  # 5 minutes
#                 wallet.encrypted_private_key.encode('utf-8') if isinstance(wallet.encrypted_private_key, str) else wallet.encrypted_private_key
#             )
            
#             wallets_data.append({
#                 "id": wallet.id,  # This is an INTEGER, not a UUID
#                 "public_key": wallet.public_key,
#                 "private_key_token": private_key_token,  # Token to retrieve private key
#                 "status": wallet.status.value,
#                 "buy_amount": wallet.buy_amount,
#                 "funded_amount": wallet.funded_amount,
#                 "current_balance": wallet.current_balance,
#                 "token_balance": wallet.token_balance,
#                 "profit": wallet.profit,
#                 "roi": wallet.roi,
#                 "buy_tx_hash": wallet.buy_tx_hash,
#                 "sell_tx_hash": wallet.sell_tx_hash,
#                 "launch_id": wallet.launch_id,
#                 "created_at": wallet.created_at.isoformat() if wallet.created_at else None,
#                 "last_updated": wallet.last_updated.isoformat() if wallet.last_updated else None
#             })
        
#         return {
#             "success": True,
#             "bot_wallets": wallets_data,
#             "total": total_bots,
#             "active": active_bots,
#             "funded": funded_bots,
#             "total_funded": total_funded,
#             "total_profit": total_profit,
#             "average_profit": total_profit / funded_bots if funded_bots > 0 else 0
#         }
        
#     except HTTPException:
#         raise
#     except Exception as e:
#         logger.error(f"Failed to get bot wallets: {e}", exc_info=True)
#         raise HTTPException(status_code=500, detail=f"Failed to get bot wallets: {str(e)}")

@router.get("/bot-wallets")
async def get_creator_bot_wallets(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get user's bot wallets with secure private key access"""
    try:
        if not current_user.creator_enabled:
            raise HTTPException(
                status_code=403,
                detail="Creator mode not enabled"
            )
        
        stmt = select(BotWallet).where(
            BotWallet.user_wallet_address == current_user.wallet_address
        ).order_by(BotWallet.created_at.desc())
        
        result = await db.execute(stmt)
        bot_wallets = result.scalars().all()
        
        # Calculate stats
        total_bots = len(bot_wallets)
        active_bots = sum(1 for w in bot_wallets if w.status.value != "FAILED")
        funded_bots = sum(1 for w in bot_wallets if w.funded_amount)
        total_funded = sum(w.funded_amount or 0 for w in bot_wallets)
        total_profit = sum(w.profit or 0 for w in bot_wallets)
        
        # Format response with secure private key handling
        wallets_data = []
        for wallet in bot_wallets:
            # Fetch REAL-TIME balance from Solana network
            current_balance = await get_sol_balance(wallet.public_key)
            
            # Determine if wallet is pre-funded
            is_pre_funded = current_balance >= (wallet.buy_amount or 0.0001)
            pre_funded_amount = wallet.funded_amount if is_pre_funded else 0
            
            # Generate a temporary token for private key access
            private_key_token = base64.urlsafe_b64encode(os.urandom(32)).decode('utf-8')
            
            # Store encrypted private key in Redis with short TTL
            await redis_client.setex(
                f"bot_key:{private_key_token}",
                300,  # 5 minutes
                wallet.encrypted_private_key.encode('utf-8') if isinstance(wallet.encrypted_private_key, str) else wallet.encrypted_private_key
            )
            
            # Determine status based on real balance
            status = wallet.status.value
            if current_balance > 0 and status == "PENDING":
                status = "FUNDED"
            elif current_balance > 0 and status in ["READY", "ACTIVE"]:
                status = "FUNDED"
            
            wallets_data.append({
                "id": wallet.id,
                "public_key": wallet.public_key,
                "private_key_token": private_key_token,
                "status": status,
                "buy_amount": wallet.buy_amount,
                "funded_amount": wallet.funded_amount,
                "current_balance": current_balance,  # REAL-TIME BALANCE
                "token_balance": wallet.token_balance,
                "profit": wallet.profit,
                "roi": wallet.roi,
                "buy_tx_hash": wallet.buy_tx_hash,
                "sell_tx_hash": wallet.sell_tx_hash,
                "launch_id": wallet.launch_id,
                "created_at": wallet.created_at.isoformat() if wallet.created_at else None,
                "last_updated": wallet.last_updated.isoformat() if wallet.last_updated else None,
                "is_pre_funded": is_pre_funded,
                "pre_funded_amount": pre_funded_amount,
                "pre_funded_tx_hash": wallet.pre_funded_tx_hash if hasattr(wallet, 'pre_funded_tx_hash') else None
            })
        
        return {
            "success": True,
            "bot_wallets": wallets_data,
            "total": total_bots,
            "active": active_bots,
            "funded": funded_bots,
            "total_funded": total_funded,
            "total_profit": total_profit,
            "average_profit": total_profit / funded_bots if funded_bots > 0 else 0
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get bot wallets: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to get bot wallets: {str(e)}")
    
@router.post("/refresh-bot-balances")
async def refresh_bot_wallet_balances(
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
):
    """Refresh bot wallet balances from blockchain"""
    try:
        if not current_user.creator_enabled:
            raise HTTPException(status_code=403, detail="Creator mode not enabled")
        
        # Start balance refresh in background - REMOVE THE 'db' PARAMETER
        background_tasks.add_task(update_bot_wallet_balances, current_user.wallet_address)
        
        return {
            "success": True,
            "message": "Bot wallet balances refresh started in background",
            "timestamp": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Failed to refresh bot balances: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to refresh balances: {str(e)}")
    
async def update_bot_wallet_balances(wallet_address: str):
    """Background task to update bot wallet balances"""
    # Create a new session for the background task
    async with AsyncSessionLocal() as session:
        try:
            stmt = select(BotWallet).where(
                BotWallet.user_wallet_address == wallet_address
            )
            result = await session.execute(stmt)
            bot_wallets = result.scalars().all()
            
            updated_count = 0
            for wallet in bot_wallets:
                try:
                    balance = await get_sol_balance(wallet.public_key)
                    
                    # Update if balance changed
                    if wallet.current_balance != balance:
                        wallet.current_balance = balance
                        wallet.last_updated = datetime.utcnow()
                        
                        # Update status if needed
                        if balance > 0 and wallet.status.value == "PENDING":
                            wallet.status = "FUNDED"
                            wallet.funded_amount = wallet.buy_amount
                        
                        updated_count += 1
                        
                except Exception as e:
                    logger.error(f"Failed to update balance for {wallet.public_key[:8]}: {e}")
                    continue
            
            if updated_count > 0:
                await session.commit()
                logger.info(f"Updated {updated_count} bot wallet balances for {wallet_address[:8]}...")
            
            # Notify user via WebSocket
            await websocket_manager.send_personal_message(
                json.dumps({
                    "type": "bot_balances_updated",
                    "message": f"Updated {updated_count} bot wallet balances",
                    "updated_count": updated_count,
                    "timestamp": datetime.utcnow().isoformat()
                }),
                wallet_address
            )
            
        except Exception as e:
            logger.error(f"Failed to update bot wallet balances: {e}")
            await session.rollback()
        finally:
            await session.close()
            
@router.post("/generate-bot-wallets")
async def generate_creator_bot_wallets(
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    count: int = 10
):
    """Generate new bot wallets for creator"""
    try:
        if not current_user.creator_enabled:
            raise HTTPException(
                status_code=403,
                detail="Creator mode not enabled"
            )
        
        if count < 5 or count > 50:
            raise HTTPException(
                status_code=400,
                detail="Count must be between 5 and 50"
            )
        
        # Check user balance
        balance = await get_sol_balance(current_user.wallet_address)
        estimated_cost = count * (current_user.default_bot_buy_amount or 0.0001)
        
        if balance < estimated_cost * 1.5:  # 50% buffer
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient balance. Need {estimated_cost * 1.5:.2f} SOL for {count} bots, have {balance:.2f} SOL"
            )
        
        # Start generation in background
        background_tasks.add_task(generate_bot_wallets_for_user, current_user.wallet_address, db, count)
        
        # Notify user
        await websocket_manager.send_personal_message(
            json.dumps({
                "type": "bot_wallets_generating",
                "message": f"Generating {count} bot wallets in background",
                "count": count,
                "estimated_cost": estimated_cost,
                "timestamp": datetime.utcnow().isoformat()
            }),
            current_user.wallet_address
        )
        
        return {
            "success": True,
            "message": f"Generating {count} bot wallets in background",
            "count": count,
            "estimated_cost": estimated_cost,
            "task_started": True
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to generate bot wallets: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate bot wallets: {str(e)}")

@router.post("/get-bot-private-key")
async def get_bot_wallet_private_key(
    request: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get decrypted private key for a specific bot wallet (one-time use)"""
    try:
        # Accept both formats
        token = request.get("private_key_token")
        bot_wallet_address = request.get("bot_wallet")
        wallet_id = request.get("wallet_id")
        
        if not token and not bot_wallet_address:
            raise HTTPException(status_code=400, detail="Token or bot wallet address required")
        
        # If bot_wallet_address is provided, get the bot wallet
        if bot_wallet_address:
            stmt = select(BotWallet).where(
                BotWallet.public_key == bot_wallet_address,
                BotWallet.user_wallet_address == request.get("user_wallet")
            )
            result = await db.execute(stmt)
            bot_wallet = result.scalar_one_or_none()
            
            if not bot_wallet:
                raise HTTPException(status_code=404, detail="Bot wallet not found")
            
            wallet_id = bot_wallet.id

        # Debug: Log what we're receiving
        logger.info(f"Received wallet_id: {wallet_id}, type: {type(wallet_id)}")
        
        # Handle the wallet_id - it should be an integer
        try:
            # Convert to integer
            if isinstance(wallet_id, str):
                wallet_id_int = int(wallet_id)
            elif isinstance(wallet_id, int):
                wallet_id_int = wallet_id
            else:
                raise HTTPException(status_code=400, detail="Wallet ID must be a number")
                
        except (ValueError, TypeError) as e:
            logger.error(f"Invalid wallet ID format: {wallet_id} - {e}")
            raise HTTPException(status_code=400, detail=f"Invalid wallet ID format. Expected a number, got: {wallet_id}")
        
        # Verify the bot wallet belongs to the user
        stmt = select(BotWallet).where(
            BotWallet.id == wallet_id_int,
            BotWallet.user_wallet_address == current_user.wallet_address
        )
        result = await db.execute(stmt)
        bot_wallet = result.scalar_one_or_none()
        
        if not bot_wallet:
            logger.error(f"Bot wallet not found or doesn't belong to user. ID: {wallet_id_int}, User: {current_user.wallet_address}")
            raise HTTPException(status_code=404, detail="Bot wallet not found or doesn't belong to you")
        
        # Get encrypted private key from Redis
        encrypted_key_data = await redis_client.get(f"bot_key:{token}")
        if not encrypted_key_data:
            logger.error(f"Token expired or invalid: {token[:10]}...")
            raise HTTPException(status_code=404, detail="Token expired or invalid. Please refresh the page to get a new token.")
        
        # Delete the token immediately (one-time use)
        await redis_client.delete(f"bot_key:{token}")
        
        # Decrypt the private key
        from app.security import decrypt_private_key_backend
        
        # Handle different types of encrypted_key_data
        if isinstance(encrypted_key_data, bytes):
            encrypted_key_str = encrypted_key_data.decode('utf-8')
        else:
            encrypted_key_str = str(encrypted_key_data)
        
        try:
            private_key_bytes = decrypt_private_key_backend(encrypted_key_str)
        except Exception as decrypt_error:
            logger.error(f"Failed to decrypt private key: {decrypt_error}")
            raise HTTPException(status_code=500, detail="Failed to decrypt private key")
        
        # Convert to base58 for frontend display
        base58_key = base58.b58encode(private_key_bytes).decode('utf-8')
        
        # Log for security auditing
        logger.info(f"Bot wallet private key accessed successfully. Wallet: {bot_wallet.public_key[:8]}..., User: {current_user.wallet_address[:8]}...")
        
        return {
            "success": True,
            "public_key": bot_wallet.public_key,
            "private_key_base58": base58_key,
            "timestamp": datetime.utcnow().isoformat(),
            "note": "This private key will only be shown once. Save it securely."
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get bot private key: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to retrieve private key: {str(e)}")
    
# In app/routers/creators/user.py - Add caching endpoint

@router.post("/cache-bot-keys-for-launch")
async def cache_bot_keys_for_launch(
    request: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Cache bot private keys for fast atomic launch"""
    try:
        launch_id = request.get("launch_id")
        bot_wallet_ids = request.get("bot_wallet_ids", [])
        
        if not launch_id or not bot_wallet_ids:
            raise HTTPException(status_code=400, detail="Launch ID and bot wallet IDs required")
        
        # Get bot wallets
        stmt = select(BotWallet).where(
            BotWallet.id.in_(bot_wallet_ids),
            BotWallet.user_wallet_address == current_user.wallet_address
        )
        result = await db.execute(stmt)
        bot_wallets = result.scalars().all()
        
        cached_keys = {}
        
        for bot in bot_wallets:
            try:
                # Decrypt the private key
                from app.security import decrypt_private_key_backend
                import base58
                
                decrypted_bytes = decrypt_private_key_backend(bot.encrypted_private_key)
                base58_key = base58.b58encode(decrypted_bytes).decode('utf-8')
                
                # Cache in Redis
                cache_key = f"bot_key:launch:{launch_id}:{bot.public_key}"
                await redis_client.setex(cache_key, 300, base58_key)  # 5 minute TTL
                
                cached_keys[bot.public_key] = "cached"
                
            except Exception as e:
                logger.error(f"Failed to cache key for {bot.public_key[:8]}: {e}")
                continue
        
        logger.info(f"Cached {len(cached_keys)} bot keys for launch {launch_id}")
        
        return {
            "success": True,
            "cached_count": len(cached_keys),
            "launch_id": launch_id,
            "timestamp": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Failed to cache bot keys: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to cache bot keys: {str(e)}")


@router.get("/get-cached-bot-key")
async def get_cached_bot_key(
    launch_id: str,
    bot_public_key: str,
    api_key: str = Header(None, alias="X-API-Key"),
):
    """Get cached bot private key for launch"""
    # Verify API key
    expected_api_key = settings.ONCHAIN_API_KEY
    if not api_key or api_key != expected_api_key:
        raise HTTPException(status_code=401, detail="Invalid API key")
    
    try:
        cache_key = f"bot_key:launch:{launch_id}:{bot_public_key}"
        cached_key = await redis_client.get(cache_key)
        
        if not cached_key:
            raise HTTPException(status_code=404, detail="Cached key not found")
        
        # Delete after reading (one-time use)
        await redis_client.delete(cache_key)
        
        if isinstance(cached_key, bytes):
            cached_key = cached_key.decode('utf-8')
        
        return {
            "success": True,
            "private_key_base58": cached_key,
            "bot_public_key": bot_public_key,
            "launch_id": launch_id,
            "timestamp": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Failed to get cached bot key: {e}")
        raise HTTPException(status_code=500, detail="Failed to get cached key")
    
# ============================================
# BALANCE & STATS ENDPOINTS
# ============================================
@router.get("/balance")
async def get_creator_balance(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get creator wallet balance and stats"""
    try:
        # Get current SOL balance
        wallet_balance = await get_sol_balance(current_user.wallet_address)
        
        # Get bot wallets
        stmt = select(BotWallet).where(
            BotWallet.user_wallet_address == current_user.wallet_address
        )
        result = await db.execute(stmt)
        bot_wallets = result.scalars().all()
        
        # Use saved user settings (with defaults as fallback)
        bot_count = current_user.default_bot_count or 5
        bot_buy_amount = current_user.default_bot_buy_amount or 0.0001
        creator_buy_amount = current_user.default_creator_buy_amount or 0.0001
        
        # Calculate required balances based on SAVED user settings
        bot_reserve_needed = bot_count * bot_buy_amount
        creator_buy_needed = creator_buy_amount
        buffer = 0.2  # 0.2 SOL buffer for fees
        
        total_required = bot_reserve_needed + creator_buy_needed + buffer
        
        # Calculate bot stats
        total_bot_balance = sum(wallet.current_balance for wallet in bot_wallets)
        total_bot_token_balance = sum(wallet.token_balance or 0 for wallet in bot_wallets)
        total_bot_profit = sum(wallet.profit or 0 for wallet in bot_wallets)
        
        # Get recent launches
        launch_stmt = select(TokenLaunch).where(
            TokenLaunch.user_wallet_address == current_user.wallet_address
        ).order_by(TokenLaunch.started_at.desc()).limit(5)
        
        launch_result = await db.execute(launch_stmt)
        recent_launches = launch_result.scalars().all()
        
        recent_launches_data = []
        for launch in recent_launches:
            recent_launches_data.append({
                "launch_id": launch.launch_id,
                "mint_address": launch.mint_address,
                "status": launch.status.value,
                "success": launch.success,
                "total_profit": launch.total_profit,
                "roi": launch.roi,
                "started_at": launch.started_at.isoformat() if launch.started_at else None
            })
        
        return {
            "success": True,
            "wallet_balance": wallet_balance,
            "creator_wallet_balance": current_user.creator_wallet_balance,
            "creator_min_balance_required": current_user.creator_min_balance_required,
            "bot_total_balance": total_bot_balance,
            "bot_total_token_balance": total_bot_token_balance,
            "bot_total_profit": total_bot_profit,
            "bot_count": len(bot_wallets),
            "active_bots": sum(1 for w in bot_wallets if w.status.value not in ["FAILED", "PENDING"]),
            "balance_sufficient": wallet_balance >= total_required,
            "required_balance": total_required,
            "recent_launches": recent_launches_data,
            "breakdown": {
                "bot_reserve": bot_reserve_needed,
                "creator_buy": creator_buy_needed,
                "fees_buffer": buffer,
                "total": total_required
            },
            "user_settings": {  # Add this for debugging
                "default_bot_count": bot_count,
                "default_bot_buy_amount": bot_buy_amount,
                "default_creator_buy_amount": creator_buy_amount
            }
        }
        
    except Exception as e:
        logger.error(f"Failed to get creator balance: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to get balance: {str(e)}")
    

@router.post("/update-settings")
async def update_creator_settings(
    settings: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Update creator settings from frontend"""
    try:
        # Extract relevant settings
        updates = {}
        
        if 'botCount' in settings:
            updates['default_bot_count'] = settings['botCount']
        
        if 'botWalletBuyAmount' in settings:
            updates['default_bot_buy_amount'] = settings['botWalletBuyAmount']
        
        if 'creatorBuyAmount' in settings:
            updates['default_creator_buy_amount'] = settings['creatorBuyAmount']
        
        if 'sellTiming' in settings:
            # Convert frontend sell timing to backend format
            sell_timing = settings['sellTiming']
            if sell_timing == 'volume-based':
                updates['default_sell_strategy_type'] = 'volume_based'
            elif sell_timing == 'time-based':
                updates['default_sell_strategy_type'] = 'time_based'
            elif sell_timing == 'price-target':
                updates['default_sell_strategy_type'] = 'price_target'
        
        if 'sellVolumeTarget' in settings:
            updates['default_sell_volume_target'] = settings['sellVolumeTarget']
        
        if 'sellTimeMinutes' in settings:
            updates['default_sell_time_minutes'] = settings['sellTimeMinutes']
        
        if 'sellPriceTarget' in settings:
            updates['default_sell_price_target'] = settings['sellPriceTarget']
        
        if updates:
            # Update user in database
            stmt = update(User).where(
                User.wallet_address == current_user.wallet_address
            ).values(**updates)
            
            await db.execute(stmt)
            await db.commit()
            
            # Refresh user data
            result = await db.execute(
                select(User).where(User.wallet_address == current_user.wallet_address)
            )
            updated_user = result.scalar_one()
            
            return {
                "success": True,
                "message": "Settings updated successfully",
                "settings": {
                    "default_bot_count": updated_user.default_bot_count,
                    "default_bot_buy_amount": updated_user.default_bot_buy_amount,
                    "default_creator_buy_amount": updated_user.default_creator_buy_amount,
                    "default_sell_strategy_type": updated_user.default_sell_strategy_type,
                }
            }
        else:
            return {
                "success": True,
                "message": "No settings to update",
                "settings": {}
            }
            
    except Exception as e:
        logger.error(f"Failed to update settings: {e}", exc_info=True)
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to update settings: {str(e)}")

@router.get("/stats")
async def get_creator_stats(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get creator statistics"""
    try:
        from sqlalchemy import func
        
        # Get trade stats
        trade_stmt = select(
            func.count(Trade.id).label('total_trades'),
            func.sum(Trade.profit_sol).label('total_profit'),
            func.avg(Trade.profit_sol).label('avg_profit')
        ).where(
            Trade.user_wallet_address == current_user.wallet_address,
            Trade.trade_type.in_(["creator_buy", "creator_sell", "bot_buy", "bot_sell"])
        )
        
        trade_result = await db.execute(trade_stmt)
        trade_stats = trade_result.first()
        
        # Get bot wallet stats
        bot_stmt = select(
            func.count(BotWallet.id).label('total_bots'),
            func.sum(BotWallet.profit).label('bot_total_profit'),
            func.avg(BotWallet.profit).label('bot_avg_profit')
        ).where(BotWallet.user_wallet_address == current_user.wallet_address)
        
        bot_result = await db.execute(bot_stmt)
        bot_stats = bot_result.first()
        
        # Get launch stats
        launch_stmt = select(
            func.count(TokenLaunch.id).label('total_launches'),
            func.sum(TokenLaunch.total_profit).label('launch_total_profit'),
            func.avg(TokenLaunch.roi).label('launch_avg_roi'),
            func.avg(TokenLaunch.duration).label('avg_duration')
        ).where(
            TokenLaunch.user_wallet_address == current_user.wallet_address,
            TokenLaunch.status == "complete"
        )
        
        launch_result = await db.execute(launch_stmt)
        launch_stats = launch_result.first()
        
        return {
            "success": True,
            "user": {
                "wallet_address": current_user.wallet_address,
                "role": current_user.role.value,
                "creator_enabled": current_user.creator_enabled,
                "is_premium": current_user.is_premium,
                "total_launches": current_user.creator_total_launches,
                "successful_launches": current_user.creator_successful_launches,
                "creator_total_profit": current_user.creator_total_profit,
                "creator_average_roi": current_user.creator_average_roi
            },
            "trades": {
                "total_trades": trade_stats.total_trades or 0,
                "total_profit": float(trade_stats.total_profit or 0),
                "average_profit": float(trade_stats.avg_profit or 0)
            },
            "bots": {
                "total_bots": bot_stats.total_bots or 0,
                "total_profit": float(bot_stats.bot_total_profit or 0),
                "average_profit": float(bot_stats.bot_avg_profit or 0)
            },
            "launches": {
                "total_launches": launch_stats.total_launches or 0,
                "total_profit": float(launch_stats.launch_total_profit or 0),
                "average_roi": float(launch_stats.launch_avg_roi or 0),
                "average_duration": int(launch_stats.avg_duration or 0)
            }
        }
        
    except Exception as e:
        logger.error(f"Failed to get creator stats: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to get stats: {str(e)}")

# ============================================
# ON-CHAIN INTEGRATION ENDPOINTS
# ============================================

# @router.post("/decrypt-key-for-onchain")
# async def decrypt_key_for_onchain(
#     request: dict,
#     api_key: str = Header(None),
#     db: AsyncSession = Depends(get_db)
# ):
#     """
#     Secure endpoint to decrypt private key for on-chain service.
#     Returns base58-encoded key for immediate use.
#     """
#     # Verify API key
#     if not api_key or api_key != settings.ONCHAIN_API_KEY:
#         raise HTTPException(status_code=401, detail="Invalid API key")
    
#     wallet_address = request.get("wallet_address")
#     if not wallet_address:
#         raise HTTPException(status_code=400, detail="Wallet address required")
    
#     try:
#         # Check cache first
#         cached_key = await get_cached_decrypted_key(wallet_address)
#         if cached_key:
#             return {
#                 "wallet_address": wallet_address,
#                 "decrypted_private_key": cached_key,
#                 "cached": True,
#                 "timestamp": datetime.utcnow().isoformat()
#             }
        
#         # Get user from database
#         result = await db.execute(
#             select(User).where(User.wallet_address == wallet_address)
#         )
#         user = result.scalar_one_or_none()
        
#         if not user:
#             raise HTTPException(status_code=404, detail="User not found")
        
#         if not user.encrypted_private_key:
#             raise HTTPException(status_code=404, detail="User has no private key")
        
#         if not user.creator_enabled:
#             raise HTTPException(status_code=403, detail="Creator mode not enabled")
        
#         # Decrypt the Fernet-encrypted key
#         from app.security import decrypt_private_key_backend
#         decrypted_bytes = decrypt_private_key_backend(user.encrypted_private_key)
        
#         # Convert to base58
#         base58_key = base58.b58encode(decrypted_bytes).decode('utf-8')
        
#         # Cache for future use
#         await cache_decrypted_key(wallet_address, base58_key)
        
#         # Log for security auditing
#         logger.info(f"Private key decrypted for on-chain: {wallet_address[:8]}")
        
#         return {
#             "wallet_address": wallet_address,
#             "decrypted_private_key": base58_key,
#             "cached": False,
#             "timestamp": datetime.utcnow().isoformat()
#         }
        
#     except Exception as e:
#         logger.error(f"Decryption failed for {wallet_address}: {e}")
#         raise HTTPException(status_code=500, detail="Decryption failed")

@router.post("/get-key-for-token-creation")
async def get_key_for_token_creation(
    request: dict,
    api_key: str = Header(None, alias="X-API-Key"),
    db: AsyncSession = Depends(get_db)
):
    """
    Simplified endpoint for token creation
    Returns exactly what the TypeScript expects
    """
    # DEBUG EVERYTHING
    logger.info("=" * 50)
    logger.info("🔍 get-key-for-token-creation CALLED")
    logger.info(f"🔍 Headers: X-API-Key: {api_key}")
    logger.info(f"🔍 Request body: {request}")
    logger.info(f"🔍 Expected API key from settings: {settings.ONCHAIN_API_KEY}")
    logger.info("=" * 50)
    
    # Verify API key
    expected_api_key = settings.ONCHAIN_API_KEY # This should match TypeScript's API key
    
    # Debug: Log what we received
    logger.info(f"🔍 Received API key: {api_key[:10] if api_key else 'None'}")
    logger.info(f"🔍 Expected API key: {expected_api_key[:10] if expected_api_key else 'None'}")
    
    if not api_key or api_key != expected_api_key:
        logger.error(f"Invalid API key. Expected: {expected_api_key[:10]}..., Got: {api_key}")
        raise HTTPException(status_code=401, detail="Invalid API key")
    
    wallet_address = request.get("wallet_address")
    if not wallet_address:
        raise HTTPException(status_code=400, detail="Wallet address required")
    
    try:
        # Get user from database
        stmt = select(User).where(User.wallet_address == wallet_address)
        result = await db.execute(stmt)
        user = result.scalar_one_or_none()
        
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        if not user.encrypted_private_key:
            raise HTTPException(status_code=404, detail="User has no private key")
        
        if not user.creator_enabled:
            raise HTTPException(status_code=403, detail="Creator mode not enabled")
        
        # Decrypt the key
        from app.security import decrypt_private_key_backend
        decrypted_bytes = decrypt_private_key_backend(user.encrypted_private_key)
        
        # Convert to base58
        import base58
        base58_key = base58.b58encode(decrypted_bytes).decode('utf-8')
        
        # Return simplified response
        return {
            "success": True,
            "private_key": base58_key,  # Exactly what TypeScript expects
            "wallet_address": wallet_address,
            "timestamp": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Failed to get key for token creation: {e}")
        raise HTTPException(status_code=500, detail="Failed to get private key")
    
@router.get("/active-creators")
async def get_active_creators(
    api_key: str = Header(None),
    db: AsyncSession = Depends(get_db)
):
    """Get all ACTIVE creators for on-chain service"""
    # Verify API key
    if not api_key or api_key != settings.ONCHAIN_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    
    try:
        # Get all creators with encrypted private keys
        result = await db.execute(
            select(User).where(
                User.creator_enabled == True,
                User.encrypted_private_key.isnot(None)
            )
        )
        all_creators = result.scalars().all()
        
        active_creators = []
        
        for user in all_creators:
            # Check if user has active WebSocket connection
            has_ws_connection = user.wallet_address in websocket_manager.active_connections
            
            # Check if user has sufficient balance
            balance = await get_sol_balance(user.wallet_address)
            min_balance = user.creator_min_balance_required
            
            if balance < min_balance:
                continue  # Skip users with insufficient balance
            
            # Get bot wallet count
            bot_stmt = select(func.count(BotWallet.id)).where(
                BotWallet.user_wallet_address == user.wallet_address
            )
            bot_result = await db.execute(bot_stmt)
            bot_count = bot_result.scalar() or 0
            
            # Get cached decrypted key
            cached_key = await get_cached_decrypted_key(user.wallet_address)
            if not cached_key:
                try:
                    from app.security import decrypt_private_key_backend
                    decrypted_bytes = decrypt_private_key_backend(user.encrypted_private_key)
                    cached_key = base58.b58encode(decrypted_bytes).decode('utf-8')
                    await cache_decrypted_key(user.wallet_address, cached_key)
                except Exception as e:
                    logger.error(f"Failed to decrypt key for {user.wallet_address[:8]}: {e}")
                    continue
            
            active_creators.append({
                "wallet_address": user.wallet_address,
                "is_premium": user.is_premium,
                "encrypted_private_key": cached_key,
                "sol_balance": balance,
                
                # Creator settings
                "default_bot_count": user.default_bot_count,
                "default_bot_buy_amount": user.default_bot_buy_amount,
                "default_creator_buy_amount": user.default_creator_buy_amount,
                "default_sell_strategy_type": user.default_sell_strategy_type,
                
                # Bot stats
                "bot_count": bot_count,
                "creator_total_launches": user.creator_total_launches,
                "creator_successful_launches": user.creator_successful_launches,
                "creator_total_profit": user.creator_total_profit,
                
                # Activity status
                "has_ws_connection": has_ws_connection,
                "last_launch_time": user.creator_last_launch_time.isoformat() if user.creator_last_launch_time else None,
                
                # Jito settings
                "jito_tip_account": user.jito_tip_account,
                "jito_current_tip_balance": user.jito_current_tip_balance,
                "jito_tip_per_tx": user.jito_tip_per_tx or 100_000,
                "jito_tip_account_initialized": user.jito_tip_account_initialized
            })
        
        logger.info(f"📤 Sending {len(active_creators)} active creators to on-chain service")
        
        return {
            "count": len(active_creators),
            "creators": active_creators,
            "timestamp": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Failed to get active creators: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

# ============================================
# LAUNCH HISTORY ENDPOINTS
# ============================================

@router.get("/launch-history", response_model=LaunchHistoryResponse)
async def get_creator_launch_history(
    limit: int = 10,
    offset: int = 0,
    status: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get creator's launch history"""
    try:
        # Build query
        query = select(TokenLaunch).where(
            TokenLaunch.user_wallet_address == current_user.wallet_address
        )
        
        if status:
            query = query.where(TokenLaunch.status == status)
        
        # Get total count
        count_query = select(func.count(TokenLaunch.id)).where(
            TokenLaunch.user_wallet_address == current_user.wallet_address
        )
        if status:
            count_query = count_query.where(TokenLaunch.status == status)
        
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
                status=launch.status.value,
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
            offset=offset,
            success=True
        )
        
    except Exception as e:
        logger.error(f"Failed to get launch history: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to get launch history: {str(e)}")

# ============================================
# BACKGROUND TASKS
# ============================================

import asyncio



async def generate_bot_wallets_for_user(
    wallet_address: str,
    db: AsyncSession,
    count: int = 5
):
    """Background task to generate bot wallets for user"""
    try:
        logger.info(f"Generating {count} bot wallets for user {wallet_address}")
        
        # DEBUG: Check what SQLAlchemy is generating
        from sqlalchemy import inspect
        from app.models import BotWallet
        
        # Get the column info
        inspector = inspect(BotWallet)
        status_column = inspector.columns['status']
        logger.info(f"BotWallet.status type: {status_column.type}")
        logger.info(f"BotWallet.status enum values: {status_column.type.enums}")
        
        # Get user to decrypt master key
        stmt = select(User).where(User.wallet_address == wallet_address)
        result = await db.execute(stmt)
        user = result.scalar_one()
        
        if not user.encrypted_private_key:
            logger.error(f"User {wallet_address} has no encrypted private key")
            return
        
        # Get existing bot wallets to know how many new ones to generate
        existing_stmt = select(BotWallet).where(
            BotWallet.user_wallet_address == wallet_address,
            BotWallet.status.in_([
                "PENDING",      # Uppercase
                "READY",        # Uppercase
                "FUNDED",       # Uppercase
                "ACTIVE"        # Uppercase
            ])
        )

        # DEBUG: Print the SQL
        logger.info(f"SQL: {existing_stmt}")
        
        existing_result = await db.execute(existing_stmt)
        existing_wallets = existing_result.scalars().all()
        
        # Calculate how many new wallets to generate
        existing_count = len(existing_wallets)
        if existing_count >= count:
            logger.info(f"User already has {existing_count} bot wallets, no new ones needed")
            return
        
        new_wallets_needed = count - existing_count
        logger.info(f"Generating {new_wallets_needed} new bot wallets (already have {existing_count})")
        
        bot_wallets = []
        
        for i in range(new_wallets_needed):
            # Generate keypair
            keypair = Keypair()
            public_key = str(keypair.pubkey())
            private_key_bytes = bytes(keypair)
            
            # ✅ CRITICAL FIX: Encrypt bot wallet private key with backend master key
            # (same encryption used for user wallets)
            encrypted_private_key = encrypt_private_key_backend(private_key_bytes)
            
            # Create bot wallet
            bot_wallet = BotWallet(
                user_wallet_address=wallet_address,
                public_key=public_key,
                encrypted_private_key=encrypted_private_key,  # Store encrypted!
                buy_amount=user.default_bot_buy_amount or 0.0001,
                status="PENDING"    # Use string literal
            )
            
            bot_wallets.append(bot_wallet)
        
        # Save to database
        db.add_all(bot_wallets)
        await db.commit()
        
        logger.info(f"Generated {len(bot_wallets)} new bot wallets for user {wallet_address}")
        
        # Notify user
        await websocket_manager.send_personal_message(
            json.dumps({
                "type": "bot_wallets_generated",
                "message": f"Successfully generated {new_wallets_needed} new bot wallets",
                "new_count": new_wallets_needed,
                "total_count": existing_count + new_wallets_needed,
                "timestamp": datetime.utcnow().isoformat()
            }),
            wallet_address
        )
        
        # Auto-fund the new bot wallets if user has sufficient balance
        # await auto_fund_bot_wallets(wallet_address, db, bot_wallets)
        
    except Exception as e:
        logger.error(f"Failed to generate bot wallets for {wallet_address}: {e}", exc_info=True)
        await db.rollback()
        
        # Notify user of failure
        await websocket_manager.send_personal_message(
            json.dumps({
                "type": "bot_wallets_failed",
                "message": f"Failed to generate bot wallets: {str(e)[:100]}",
                "timestamp": datetime.utcnow().isoformat()
            }),
            wallet_address
        )
        

# async def auto_fund_bot_wallets(
#     wallet_address: str,
#     db: AsyncSession,
#     bot_wallets: list[BotWallet]
# ):
#     """Automatically fund newly created bot wallets from user's main wallet"""
#     try:
#         from app.security import decrypt_private_key_backend
        
#         # Get user
#         stmt = select(User).where(User.wallet_address == wallet_address)
#         result = await db.execute(stmt)
#         user = result.scalar_one()
        
#         # Get user's SOL balance
#         user_balance = await get_sol_balance(wallet_address)
        
#         # Calculate total funding needed
#         total_funding_needed = sum(wallet.buy_amount for wallet in bot_wallets)
        
#         if user_balance < total_funding_needed * 1.1:  # 10% buffer for fees
#             logger.warning(f"Insufficient balance to auto-fund bot wallets. Need {total_funding_needed:.4f} SOL, have {user_balance:.4f} SOL")
            
#             # Update wallets to insufficient_funds status
#             for wallet in bot_wallets:
#                 wallet.status = "insufficient_funds"
#             await db.commit()
            
#             await websocket_manager.send_personal_message(
#                 json.dumps({
#                     "type": "bot_funding_failed",
#                     "message": f"Insufficient balance to fund {len(bot_wallets)} bots. Need {total_funding_needed:.4f} SOL",
#                     "timestamp": datetime.utcnow().isoformat()
#                 }),
#                 wallet_address
#             )
#             return
        
#         # Decrypt user's private key for funding transactions
#         user_private_key_bytes = decrypt_private_key_backend(user.encrypted_private_key)
#         user_keypair = Keypair.from_bytes(user_private_key_bytes)
        
#         # Fund each bot wallet
#         successful_funding = 0
#         from solana.rpc.async_api import AsyncClient
#         from solders.system_program import transfer, TransferParams
#         from solders.commitment_config import CommitmentLevel
        
#         async with AsyncClient(settings.SOLANA_RPC_URL) as client:
#             for wallet in bot_wallets:
#                 try:
#                     # Create transfer instruction
#                     transfer_ix = transfer(
#                         TransferParams(
#                             from_pubkey=user_keypair.pubkey(),
#                             to_pubkey=Pubkey.from_string(wallet.public_key),
#                             lamports=int(wallet.buy_amount * 1_000_000_000)
#                         )
#                     )
                    
#                     # Sign and send transaction
#                     recent_blockhash = (await client.get_latest_blockhash()).value.blockhash
#                     transaction = Transaction(
#                         recent_blockhash=recent_blockhash,
#                         payer=user_keypair.pubkey(),
#                         instructions=[transfer_ix]
#                     )
                    
#                     transaction.sign(user_keypair)
                    
#                     # Send transaction
#                     tx_hash = await client.send_transaction(transaction)
                    
#                     # Wait for confirmation
#                     await client.confirm_transaction(
#                         tx_hash.value,
#                         commitment=CommitmentLevel("confirmed")
#                     )
                    
#                     # Update wallet status
#                     wallet.status = "funded"
#                     wallet.funded_amount = wallet.buy_amount
#                     wallet.current_balance = wallet.buy_amount
#                     successful_funding += 1
                    
#                     logger.info(f"Funded bot wallet {wallet.public_key[:8]}... with {wallet.buy_amount} SOL")
                    
#                     # Small delay between transactions
#                     await asyncio.sleep(0.5)
                    
#                 except Exception as e:
#                     logger.error(f"Failed to fund bot wallet {wallet.public_key[:8]}...: {e}")
#                     wallet.status = "funding_failed"
#                     continue
        
#         await db.commit()
        
#         # Notify user
#         await websocket_manager.send_personal_message(
#             json.dumps({
#                 "type": "bot_funding_complete",
#                 "message": f"Successfully funded {successful_funding}/{len(bot_wallets)} bot wallets",
#                 "funded_count": successful_funding,
#                 "total_amount": successful_funding * (bot_wallets[0].buy_amount if bot_wallets else 0),
#                 "timestamp": datetime.utcnow().isoformat()
#             }),
#             wallet_address
#         )
        
#     except Exception as e:
#         logger.error(f"Auto-funding failed: {e}", exc_info=True)
        
        

    