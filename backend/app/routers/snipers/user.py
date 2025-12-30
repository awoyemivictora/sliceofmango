from datetime import datetime
from fastapi import APIRouter, Body, HTTPException, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional
import logging
from app.database import get_db
from app.dependencies import get_current_user_by_wallet
from app.models import User, Trade
from app.schemas.snipers.trade import TradeLog
from app.schemas.snipers.user import UserBotSettingsResponse, UserBotSettingsUpdate, UserProfile
from app.security import decrypt_private_key_backend, get_current_user
from app.utils.shared import load_bot_state
from app.config import settings as setting_api
from pydantic import BaseModel
import base58
from app.utils import redis_client
from app.utils.jito_manager import jito_tip_manager
from solana.rpc.async_api import AsyncClient
from solders.pubkey import Pubkey
from app.utils.bot_components import websocket_manager


# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


router = APIRouter(
    prefix="/snipers/user",
    tags=['Sniper Users']
)




class BulkUserCheckRequest(BaseModel):
    wallet_addresses: List[str]


# ---- User Profile Endpoint ----
@router.get("/profile", response_model=UserProfile)
async def read_users_me(current_user: User = Depends(get_current_user)):
    """
    Retrieves the authenticated user's profile.
    """
    return UserProfile(
        wallet_address=current_user.wallet_address,
        is_premium=current_user.is_premium
    )
    
#---- User Trade History Endpoint -----
@router.get("/me/trades", response_model=List[TradeLog])
async def get_my_trades(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """
    Retrieves all trade records for the authenticated user.
    """
    try:
        result = await db.execute(
            select(Trade)
            .filter(Trade.user_wallet_address == current_user.wallet_address)
            .order_by(Trade.timestamp.desc())
        )
        trades = result.scalars().all()
        return [TradeLog.from_orm(trade) for trade in trades]
    except Exception as e:
        logger.error(f"Error fetching trades for user {current_user.wallet_address}: {e}")
        raise HTTPException(status_code=500, detail="Error fetching user trade history")
    
@router.get("/active-trades", response_model=List[TradeLog]) # Assuming TradeLog schema matches needed data
async def get_active_trades(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    """
    Retrieves active trade positions for the current user for frontend monitoring.
    """
    # You might need a specific field in your Trade model to indicate 'active' or 'open' status
    # Or query `TokenMetadata` table if it tracks active holdings.
    # For this example, let's assume Trade records can indicate a position is open
    # e.g., if it's a 'buy' trade and no corresponding 'sell' trade has been logged for it yet.
    # A more robust solution might involve a dedicated `UserPosition` table.

    # For simplicity, let's assume you fetch all trades and frontend filters or
    # you query a specific status.
    # If your `Trade` table has `is_open: bool` flag:
    # result = await db.execute(select(Trade).filter_by(user_wallet_address=current_user.wallet_address, is_open=True))
    # Or based on your `token_metadata` table:
    # For now, let's return all trades logged and assume frontend processes it
    # based on `trade_type` and other fields.
    result = await db.execute(select(Trade).filter(Trade.user_wallet_address == current_user.wallet_address).order_by(Trade.timestamp.desc()))
    trades = result.scalars().all()
    # Filter for active positions if your `Trade` model supports it (e.g., `is_sold` flag within `Trade` model)
    active_trades = [
        TradeLog.from_orm(trade) for trade in trades
        if trade.trade_type == "buy" and (trade.profit_usd is None or trade.profit_usd == 0) # Simplified check for 'open'
    ]
    return active_trades

# Endpoint to GET a user's bot settings
@router.get("/settings/{wallet_address}", response_model=UserBotSettingsResponse)
async def get_user_settings(
    wallet_address: str,
    current_user: User = Depends(get_current_user), # Ensures user is authenticated
    db: AsyncSession = Depends(get_db)
):
    """
    Retrieves the bot configuration and filter preferences for the authenticated user.
    """
    # Security check: Ensure the authenticated user is requesting their own settings
    if current_user.wallet_address != wallet_address:
        logger.warning(f"Unauthorized attempt to access settings: User {current_user.wallet_address} tried to access {wallet_address}'s settings.")
        raise HTTPException(
            status_code=403,
            detail="You are not authorized to view these settings."
        )

    user_data = await db.get(User, wallet_address) # Fetch user directly by primary key

    if not user_data:
        logger.error(f"User not found for wallet address: {wallet_address}")
        raise HTTPException(
            status_code=404,
            detail="User not found."
        )

    # Return the user data, Pydantic will handle the mapping to UserBotSettingsResponse
    return user_data

# Endpoint to PUT (update) a user's bot settings
@router.put("/settings/{wallet_address}", response_model=UserBotSettingsResponse)
async def update_user_settings(
    wallet_address: str,
    settings: UserBotSettingsUpdate, # Request body with updated settings
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Updates the bot configuration and filter preferences for the authenticated user.
    """
    # Security check: Ensure the authenticated user is updating their own settings
    if current_user.wallet_address != wallet_address:
        logger.warning(f"Unauthorized attempt to update settings: User {current_user.wallet_address} tried to update {wallet_address}'s settings.")
        raise HTTPException(
            status_code=403,
            detail="You are not authorized to update these settings."
        )

    user_to_update = await db.get(User, wallet_address)

    if not user_to_update:
        logger.error(f"User not found for wallet address: {wallet_address}")
        raise HTTPException(
            status_code=404,
            detail="User not found."
        )

    # Update user fields from the incoming settings
    # Iterate over the Pydantic model's fields and update the ORM object
    # Exclude 'is_premium' from direct update if it's managed by subscription logic
    # Make sure to handle nullable fields (e.g., filter_top_holders_max_pct) correctly
    for field, value in settings.model_dump(exclude_unset=True).items(): # `exclude_unset=True` is useful for PATCH, for PUT all fields are usually sent
        # Only update fields that are not `is_premium` if it's managed separately
        if field == "is_premium":
            continue # Do not allow direct update of premium status via this endpoint
        setattr(user_to_update, field, value)

    # Special handling for boolean filters: ensure they are boolean, not None if passed as such
    # Pydantic usually handles this, but it's good to be explicit
    user_to_update.filter_socials_added = settings.filter_socials_added
    # ... repeat for all boolean filter fields if needed ...
    # user_to_update.filter_liquidity_burnt = settings.filter_liquidity_burnt

    try:
        db.add(user_to_update) # Add to session if not already tracked
        await db.commit()
        await db.refresh(user_to_update) # Refresh to load any changes from DB (e.g., updated_at)
        logger.info(f"User settings updated successfully for {wallet_address}")
        return user_to_update # Return the updated user object
    except Exception as e:
        await db.rollback()
        logger.error(f"Failed to update user settings for {wallet_address}: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to update settings: {str(e)}"
        )

@router.put("/bot-settings", response_model=UserBotSettingsResponse)
async def update_bot_settings(
    settings: UserBotSettingsUpdate,
    current_user: User = Depends(get_current_user_by_wallet),
    db: AsyncSession = Depends(get_db)
):
    for field, value in settings.dict(exclude_unset=True).items():
        if field == "is_premium" and not current_user.is_premium:
            raise HTTPException(status_code=403, detail="Cannot modify premium status.")
        setattr(current_user, field, value)
    await db.merge(current_user)
    await db.commit()
    return current_user

@router.post("/decrypt-key-for-sniper")
async def decrypt_key_for_sniper(
    request: dict,
    api_key: str = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Secure endpoint to decrypt private key for sniper engine.
    Returns base58-encoded key for immediate use.
    """
    # Verify API key
    if not api_key or api_key != setting_api.ONCHAIN_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    
    wallet_address = request.get("wallet_address")
    if not wallet_address:
        raise HTTPException(status_code=400, detail="Wallet address required")
    
    try:
        # Get user from database
        result = await db.execute(
            select(User).where(User.wallet_address == wallet_address)
        )
        user = result.scalar_one_or_none()
        
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        if not user.encrypted_private_key:
            raise HTTPException(status_code=404, detail="User has no private key")
        
        # Decrypt the Fernet-encrypted key
        decrypted_bytes = decrypt_private_key_backend(user.encrypted_private_key)
        
        # Convert to base58 for the sniper engine
        encoded = base58.b58encode(decrypted_bytes)
        # Handle both string and bytes output from base58.b58encode
        if isinstance(encoded, bytes):
            base58_key = encoded.decode('utf-8')
        else:
            base58_key = encoded
        
        # Log for security auditing
        logger.info(f"Private key decrypted for sniper: {wallet_address[:8]}")
        
        return {
            "wallet_address": wallet_address,
            "decrypted_private_key": base58_key,
            "timestamp": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Decryption failed for {wallet_address}: {e}")
        raise HTTPException(status_code=500, detail="Decryption failed")
    
async def get_cached_decrypted_key(wallet_address: str) -> Optional[str]:
    """Get cached base58 key from Redis"""
    try:
        cached_key = await redis_client.get(f"sniper:base58key:{wallet_address}")
        if cached_key:
            # Redis returns bytes, convert to string
            if isinstance(cached_key, bytes):
                return cached_key.decode('utf-8')
            return str(cached_key)
        return None
    except Exception as e:
        logger.error(f"Error retrieving cached key: {e}")
        return None

async def cache_decrypted_key(wallet_address: str, base58_key: str, ttl: int = 300):
    """Cache base58 key in Redis (5 minutes)"""
    await redis_client.setex(
        f"sniper:base58key:{wallet_address}", 
        ttl, 
        base58_key
    )
    
# Endpoint for TypeScript to get ACTIVE users with running bots
@router.get("/active-users")
async def get_active_users(
    api_key: str = None,  # API key for authentication
    db: AsyncSession = Depends(get_db)
):
    """Get all ACTIVE users with running bots and decrypted private keys"""
    # Verify API key
    if not api_key or api_key != setting_api.ONCHAIN_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    
    try:
        # Step 1: Get all users with encrypted private keys
        result = await db.execute(
            select(User).where(
                User.encrypted_private_key.isnot(None)
            )
        )
        all_users = result.scalars().all()
        
        active_users = []
        
        for user in all_users:            
            # Method 1: Check WebSocket connection (most immediate)
            has_ws_connection = user.wallet_address in websocket_manager.active_connections
            
            # Method 2: Check Redis bot state (persistent bots)
            bot_state = await load_bot_state(user.wallet_address)
            has_bot_state = bot_state and bot_state.get("is_running", False)
            
            # Method 3: Check active bot tasks
            from app.main import active_bot_tasks
            has_active_task = user.wallet_address in active_bot_tasks
            
            # User is considered ACTIVE if ANY of these are true
            is_active = has_ws_connection or has_bot_state or has_active_task
            
            if is_active:
                # Get user's SOL balance (optional - can be commented for speed)
                sol_balance = 0
                try:
                    from solana.rpc.async_api import AsyncClient
                    from solders.pubkey import Pubkey
                    from app.config import settings
                    
                    async with AsyncClient(settings.SOLANA_RPC_URL) as client:
                        balance_response = await client.get_balance(Pubkey.from_string(user.wallet_address))
                        sol_balance = balance_response.value / 1_000_000_000
                except Exception:
                    # If balance check fails, still include user but mark balance as 0
                    sol_balance = 0
                
                # Only include users with minimum balance (e.g., 0.1 SOL)
                if sol_balance >= 0.1:
                    # CRITICAL: Decrypt the private key here and send as base58
                    try:
                        # Instead of decrypting each time, check cache first
                        cached_key = await get_cached_decrypted_key(user.wallet_address)
                        if cached_key:
                            base58_key = cached_key
                        else:
                            # The user.encrypted_private_key in DB is Fernet-encrypted
                            # We need to decrypt it first
                            decrypted_bytes = decrypt_private_key_backend(user.encrypted_private_key)
                            # Then convert to base58
                            encoded = base58.b58encode(decrypted_bytes)
                            # Some base58 implementations return string, some return bytes
                            if isinstance(encoded, bytes):
                                base58_key = encoded.decode('utf-8')
                            else:
                                base58_key = encoded
                            await cache_decrypted_key(user.wallet_address, base58_key)
                    except Exception as e:
                        logger.error(f"Failed to process key for {user.wallet_address[:8]}: {e}")
                        continue # Skip this user
                        
                    active_users.append({
                        "wallet_address": user.wallet_address,
                        "buy_amount_sol": user.buy_amount_sol,
                        "buy_slippage_bps": user.buy_slippage_bps,
                        "is_premium": user.is_premium,
                        "encrypted_private_key": base58_key,  # <-- Now, sending base58
                        "sol_balance": sol_balance,
                        
                        # Premium filters
                        "filter_socials_added": user.filter_socials_added,
                        "filter_liquidity_burnt": user.filter_liquidity_burnt,
                        "filter_check_pool_size_min_sol": user.filter_check_pool_size_min_sol,
                        "filter_top_holders_max_pct": user.filter_top_holders_max_pct,
                        "filter_safety_check_period_seconds": user.filter_safety_check_period_seconds,
                        
                        # Bot settings
                        "bot_check_interval_seconds": user.bot_check_interval_seconds,
                        "partial_sell_pct": user.partial_sell_pct,
                        "trailing_sl_pct": user.trailing_sl_pct,
                        "rug_liquidity_drop_pct": user.rug_liquidity_drop_pct,
                        
                        # Activity status
                        "has_ws_connection": has_ws_connection,
                        "has_bot_state": has_bot_state,
                        "has_active_task": has_active_task,
                        "last_heartbeat": bot_state.get("last_heartbeat") if bot_state else None,
                        
                        # Jito tip settings
                        "jito_tip_account": user.jito_tip_account,
                        "jito_current_tip_balance": user.jito_current_tip_balance,
                        "jito_tip_per_tx": user.jito_tip_per_tx or 100_000,
                        "jito_reserved_tip_amount": user.jito_reserved_tip_amount,
                        "jito_tip_account_initialized": user.jito_tip_account_initialized,
                        "needs_jito_funding": not user.jito_tip_account_initialized or (user.jito_current_tip_balance or 0) < (user.jito_reserved_tip_amount or 0.01)
                    })
        
        print(f"📤 Sending {len(active_users)} active users to sniper engine")
        for user_data in active_users:
            print(f"👤 User {user_data['wallet_address'][:8]} - Has private key: {bool(user_data['encrypted_private_key'])}")
        
        return {
            "count": len(active_users),
            "users": active_users,
            "timestamp": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
# Endpoint to get user's encrypted private key (secure)
@router.get("/encrypted-key{wallet_address}")
async def get_encrypted_private_key(
    wallet_address: str, 
    api_key: str = None,
    db: AsyncSession = Depends(get_db)
):
    """Get encrypted private key for a user (secure endpoint)"""
    # Verify API key
    if not api_key or api_key != setting_api.ONCHAIN_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    
    try:
        result = await db.execute(
            select(User).where(User.wallet_address == wallet_address)
        )
        user = result.scalar_one_or_none()
        
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        if not user.encrypted_private_key:
            raise HTTPException(status_code=404, detail="User has no private key")
        
        # Log access for security auditing
        logger.info(f"Private key accessed for {wallet_address[:8]} by on-chain service")
        
        return {
            "wallet_address": wallet_address,
            "encrypted_private_key": user.encrypted_private_key,
            "timestamp": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Endpoint to quickly check if a user is active
@router.get("/check-active/{wallet_address}")
async def check_user_active(
    wallet_address: str,
    api_key: str = None,
    db: AsyncSession = Depends(get_db)
):
    """Quick check if a user is active (for TypeScript)"""
    if not api_key or api_key != setting_api.ONCHAIN_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    
    try:
        # Check WebSocket connection
        has_ws = wallet_address in websocket_manager.active_connections
        
        # Check bot state
        bot_state = await load_bot_state(wallet_address)
        has_state = bot_state and bot_state.get("is_running", False)
        
        # Check active tasks
        from app.main import active_bot_tasks
        has_task = wallet_address in active_bot_tasks
        
        # Get user from DB
        result = await db.execute(
            select(User).where(User.wallet_address == wallet_address)
        )
        user = result.scalar_one_or_none()
        
        has_private_key = user and user.encrypted_private_key is not None 
        has_sufficient_balance = False
        
        if user:
            # Quick balance check
            try:
                from solana.rpc.async_api import AsyncClient
                from solders.pubkey import Pubkey
                
                async with AsyncClient(setting_api.SOLANA_RPC_URL) as client:
                    balance_response = await client.get_balance(Pubkey.from_string(wallet_address))
                    sol_balance = balance_response.value / 1_000_000_000
                    has_sufficient_balance = sol_balance >= (user.buy_amount_sol or 0.1)
            except:
                pass 
        
        return {
            "is_active": has_ws or has_state or has_task,
            "has_ws_connection": has_ws,
            "has_bot_state": has_state,
            "has_active_task": has_task,
            "has_private_key": has_private_key,
            "has_sufficient_balance": has_sufficient_balance,
            "bot_running": has_state,
            "timestamp": datetime.utcnow().isoformat()
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/bulk-check-active")
async def bulk_check_active_users(
    request: BulkUserCheckRequest,
    api_key: str = None,
    db: AsyncSession = Depends(get_db)
):
    """Bulk check if multiple users are active"""
    if not api_key or api_key != setting_api.ONCHAIN_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    
    try:
        results = {}
        
        # Get all users in one query for efficiency
        result = await db.execute(
            select(User).where(User.wallet_address.in_(request.wallet_addresses))
        )
        users = {user.wallet_address: user for user in result.scalars().all()}
        
        for wallet_address in request.wallet_addresses:
            user = users.get(wallet_address)
            
            # Check activity
            has_ws = wallet_address in websocket_manager.active_connections
            bot_state = await load_bot_state(wallet_address)
            has_state = bot_state and bot_state.get("is_running", False)
            from app.main import active_bot_tasks
            has_task = wallet_address in active_bot_tasks
            
            # Check private key
            has_pk = user and user.encrypted_private_key is not None 
            
            # Quick balance check (optional - can be commented for speed)
            has_balance = False 
            if user and has_pk:
                try:
                    from solana.rpc.async_api import AsyncClient
                    from solders.pubkey import Pubkey
                    
                    async with AsyncClient(setting_api.SOLANA_RPC_URL) as client:
                        balance_response = await client.get_balance(Pubkey.from_string(wallet_address))
                        sol_balance = balance_response.value / 1_000_000_000
                        has_balance = sol_balance >= (user.buy_amount_sol or 0.1)
                
                except:
                    has_balance = False 
            
            results[wallet_address] = {
                "is_active": has_ws or has_state or has_task,
                "has_private_key": has_pk,
                "has_sufficient_balance": has_balance,
                "can_snipe": (has_ws or has_state or has_task) and has_pk and has_balance
            }
        
        return {
            "results": results,
            "total": len(results),
            "active_count": sum(1 for r in results.values() if r["is_active"]),
            "can_snipe_count": sum(1 for r in results.values() if r["can_snipe"]),
            "timestamp": datetime.utcnow().isoformat()
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
# Add to app/routers/user.py
@router.get("/websocket-status")
async def get_websocket_status(
    api_key: str = None
):
    """Get current WebSocket connection status"""
    if not api_key or api_key != setting_api.ONCHAIN_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    
    try:
        active_connections = list(websocket_manager.active_connections.keys())
        
        return {
            "active_connections_count": len(active_connections),
            "active_wallets": active_connections,
            "timestamp": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) 


# # Endpoint to initialize Jito tip account for on-chain and frontend
# @router.post("/jito-tip/initialize")
# async def initialize_jito_tip_account(
#     current_user: User = Depends(get_current_user),
#     db: AsyncSession = Depends(get_db)
# ):
#     """
#     Initialize or get user's Jito tip account.
#     Returns whether it's a new account or existing one.
#     """
#     try:
#         async with AsyncClient(setting_api.SOLANA_RPC_URL) as connection:
#             tip_account, is_new = await jito_tip_manager.get_or_create_tip_account(
#                 user=current_user,
#                 db=db,
#                 connection=connection
#             )
            
#             return {
#                 "status": "success",
#                 "tip_account": tip_account,
#                 "is_new_account": is_new,
#                 "message": "Tip account created successfully" if is_new else "Using existing tip account"
#             }
            
#     except Exception as e:
#         raise HTTPException(status_code=500, detail=f"Failed to initialize tip account: {str(e)}")
    

# # Endpoint to fund jito tip account for the user
# @router.post("/jito-tip/fund")
# async def fund_jito_tip_account(
#     request: FundJitoTipRequest,  # Change from amount_sol: float = Body(...)
#     current_user: User = Depends(get_current_user),
#     db: AsyncSession = Depends(get_db)
# ):
#     """
#     Fund the user's Jito tip account.
#     Returns a transaction that needs to be signed by the user.
#     """
#     try:
#         async with AsyncClient(setting_api.SOLANA_RPC_URL) as connection:
#             success = await jito_tip_manager.fund_tip_account(
#                 user=current_user,
#                 db=db,
#                 connection=connection,
#                 amount_sol=request.amount_sol  # Access from request object
#             )
            
#             if success:
#                 return {
#                     "status": "success",
#                     "message": f"Prepared to fund {request.amount_sol} SOL to tip account",
#                     "tip_account": current_user.jito_tip_account,
#                     "amount_sol": request.amount_sol
#                 }
#             else:
#                 raise HTTPException(status_code=400, detail="Failed to prepare funding transaction")
            
#     except Exception as e:
#         raise HTTPException(status_code=500, detail=f"Failed to fund tip account: {str(e)}")
    
    

# # Endpoint to update jito tip settings
# @router.put("/jito-tip/settings")
# async def update_jito_tip_settings(
#     jito_settings: JitoTipSettings,
#     current_user: User = Depends(get_current_user),
#     db: AsyncSession = Depends(get_db)
# ):
#     """ 
#     Update user's Jito tip settings.
#     """
#     try:
#         success = await jito_tip_manager.update_tip_settings(
#             user=current_user,
#             db=db,
#             reserved_amount=jito_settings.reserved_amount,
#             tip_per_tx=jito_settings.tip_per_tx
#         )
        
#         if success:
#             return {
#                 "status": "success",
#                 "message": "Jito tip settings updated",
#                 "reserved_amount": current_user.jito_reserved_tip_amount,
#                 "tip_per_tx": current_user.jito_tip_per_tx
#             }
#         else:
#             raise HTTPException(status_code=400, detail="Failed to update settings")
        
#     except Exception as e:
#         raise HTTPException(status_code=500, detail=f"Failed to update tip settings: {str(e)}")

# # Endpoint to get user's Jito tip info
# @router.get("/jito-tip/info")
# async def get_jito_tip_info(
#     wallet_address: Optional[str] = None,
#     current_user: Optional[User] = Depends(get_current_user, use_cache=False),
#     api_key: Optional[str] = None,
#     db: AsyncSession = Depends(get_db)
# ):
#     """
#     Get user's Jito tip account information.
#     Accessible by user or by on-chain sniper engine with API key.
#     """
#     try:
#         user = None
        
#         # Allow API key access for on-chain sniper engine
#         if api_key and api_key == setting_api.ONCHAIN_API_KEY and wallet_address:
#             # API key access for on-chain engine
#             result = await db.execute(
#                 select(User).where(User.wallet_address == wallet_address)
#             )
#             user = result.scalar_one_or_none()
#         elif current_user:
#             # Normal user access with auth token
#             user = current_user
#         else:
#             raise HTTPException(status_code=401, detail="Authentication required")
        
#         if not user:
#             raise HTTPException(status_code=404, detail="User not found")
            
#         async with AsyncClient(setting_api.SOLANA_RPC_URL) as connection:
#             tip_info = await jito_tip_manager.get_tip_account_info(user, connection)
            
#             # Handle error case
#             if "error" in tip_info:
#                 return {
#                     "status": "error",
#                     "message": tip_info["error"],
#                     "wallet_address": user.wallet_address,
#                     "tip_account": user.jito_tip_account or "",
#                     "initialized": user.jito_tip_account_initialized or False,
#                     "reserved_amount": user.jito_reserved_tip_amount or 0.01,
#                     "tip_per_tx": user.jito_tip_per_tx or 100000,
#                 }
            
#             return {
#                 "status": "success",
#                 "wallet_address": user.wallet_address,
#                 "tip_account": tip_info.get("tip_account", ""),
#                 "current_balance": tip_info.get("current_balance", 0),
#                 "reserved_amount": tip_info.get("reserved_amount", user.jito_reserved_tip_amount or 0.01),
#                 "tip_per_tx": tip_info.get("tip_per_tx", user.jito_tip_per_tx or 100000),
#                 "initialized": tip_info.get("initialized", user.jito_tip_account_initialized or False),
#                 "has_tip_account": tip_info.get("has_tip_account", False),
#                 "status_info": tip_info.get("status", "unknown")
#             }
            
#     except Exception as e:
#         logger.error(f"Failed to get tip info: {str(e)}")
#         return {
#             "status": "error",
#             "message": str(e),
#             "wallet_address": wallet_address or "unknown"
#         }

# # Endpoint to deduct tip amount for user
# @router.post("/jito-tip/deduct")
# async def deduct_jito_tip(
#     wallet_address: str = Body(...),
#     num_transactions: int = Body(..., ge=1),
#     api_key: str = Body(...),
#     db: AsyncSession = Depends(get_db)
# ):
#     """
#     Deduct tip amount after successful transactions.
#     Called by on-chain sniper engine after bundle execution.
#     """
#     try:
#         # Verify API key
#         if api_key != setting_api.ONCHAIN_API_KEY:
#             raise HTTPException(status_code=401, detail="Invalid API key")
        
#         result = await db.execute(
#             select(User).where(User.wallet_address == wallet_address)
#         )
#         user = result.scalar_one_or_none()
        
#         if not user:
#             raise HTTPException(status_code=404, detail="User not found")
        
#         async with AsyncClient(setting_api.SOLANA_RPC_URL) as connection:
#             success = await jito_tip_manager.deduct_tip_from_balance(
#                 user=user,
#                 db=db,
#                 connection=connection,
#                 num_transactions=num_transactions
#             )
            
#             return {
#                 "status": "success" if success else "failed",
#                 "message": "Tip deducted successfully" if success else "Failed to deduct tip",
#                 "wallet_address": wallet_address,
#                 "num_transactions": num_transactions
#             }
#     except Exception as e:
#         raise HTTPException(status_code=500, detail=f"Failed to deduct tip: {str(e)}")


# # Endpoint for on-chain engine to get user Jito info
# @router.get("/jito-tip/{wallet_address}")
# async def get_user_jito_tip_info(
#     wallet_address: str,
#     api_key: str = None,
#     db: AsyncSession = Depends(get_db)
# ):
#     """Get user's Jito tip account info for on-chain auto-funding"""
#     # Verify API key
#     if not api_key or api_key != setting_api.ONCHAIN_API_KEY:
#         raise HTTPException(status_code=401, detail="Invalid API key")
    
#     try:
#         result = await db.execute(
#             select(User).where(User.wallet_address == wallet_address)
#         )
#         user = result.scalar_one_or_none()
        
#         if not user: 
#             raise HTTPException(status_code=404, detail="User not found")
        
#         # Get Jito tip info
#         async with AsyncClient(setting_api.SOLANA_RPC_URL) as connection:
#             tip_info = await jito_tip_manager.get_tip_account_info(user, connection)
            
#             return {
#                 "status": "success",
#                 "wallet_address": wallet_address,
#                 "jito_tip_account": user.jito_tip_account,
#                 "jito_reserved_tip_amount": user.jito_reserved_tip_amount,
#                 "jito_current_tip_balance": user.jito_current_tip_balance,
#                 "jito_tip_per_tx": user.jito_tip_per_tx,
#                 "jito_tip_account_initialized": user.jito_tip_account_initialized,
#                 **tip_info 
#             }
            
#     except Exception as e:
#         raise HTTPException(status_code=500, detail=f"Failed to get tip info: {str(e)}")


# # Endpoint for on-chain to auto-fund user's Jito account
# @router.post("/jito-tip/auto-fund")
# async def auto_fund_jito_tip_account(
#     wallet_address: str = Body(...),
#     api_key: str = Body(...),
#     db: AsyncSession = Depends(get_db)
# ):
#     """Auto-fund user's Jito tip account from their main wallet"""
#     # Verify API key
#     if api_key != setting_api.ONCHAIN_API_KEY:
#         raise HTTPException(status_code=401, detail="Invalid API key")
    
#     try:
#         result = await db.execute(
#             select(User).where(User.wallet_address == wallet_address)
#         )
#         user = result.scalar_one_or_none()
        
#         if not user:
#             raise HTTPException(status_code=404, detail="User not found")
        
#         if not user.jito_tip_account:
#             raise HTTPException(status_code=400, detail="User has no Jito tip account")
        
#         # Get user's decrypted private key
#         if not user.encrypted_private_key:
#             raise HTTPException(status_code=400, detail="User has no private key")
        
#         # Decrypt private key for on-chain use
#         decrypted_bytes = decrypt_private_key_backend(user.encrypted_private_key)
#         base58_key = base58.b58encode(decrypted_bytes)
#         if isinstance(base58_key, bytes):
#             base58_key = base58_key.decode('utf-8')
            
#         # Get reserved amount from user settings
#         reserved_amount = user.jito_reserved_tip_amount or 0.01
        
#         async with AsyncClient(setting_api.SOLANA_RPC_URL) as connection:
#             # Check user's balance first
#             user_balance = await connection.get_balance(
#                 Pubkey.from_string(user.wallet_address)
#             )
#             user_balance_sol = user_balance / 1_000_000_000
            
#             required_lamports = int(reserved_amount * 1_000_000_000)
            
#             if user_balance < required_lamports * 1.1:  # 10% buffer for fees
#                 return {
#                     "status": "failed",
#                     "reason": "insufficient_balance",
#                     "user_balance": user_balance_sol,
#                     "required": reserved_amount,
#                     "message": f"User has insufficient balance: {user_balance_sol:.4f} SOL < {reserved_amount:.4f} SOL"
#                 }
                
#             # Prepare funding transaction
#             success = await jito_tip_manager.fund_tip_account(
#                 user=user,
#                 db=db,
#                 connection=connection,
#                 amount_sol=reserved_amount
#             )
            
#             if success:
#                 # Update user's current tip balance
#                 tip_balance = await connection.get_balance(
#                     Pubkey.from_string(user.jito_tip_account)
#                 )
#                 user.jito_current_tip_balance = tip_balance / 1_000_000_000
#                 await db.commit()
                
#                 return {
#                     "status": "success",
#                     "wallet_address": wallet_address,
#                     "tip_account": user.jito_tip_account,
#                     "funded_amount": reserved_amount,
#                     "new_tip_balance": user.jito_current_tip_balance,
#                     "requires_signature": True,
#                     "message": f"Prepared to fund {reserved_amount} SOL to tip amount"
#                 }
#             else:
#                 return {
#                     "status": "failed",
#                     "reason": "funding_failed",
#                     "message": "Failed to prepare funding transaction"
#                 }
                
#     except Exception as e:
#         raise HTTPException(status_code=500, detail=f"Failed to auto-fund tip account: {str(e)}")
