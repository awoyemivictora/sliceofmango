import logging
import os
from fastapi import FastAPI, HTTPException, Depends, WebSocket, WebSocketDisconnect, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import json
import asyncio
from typing import Dict, List
from datetime import datetime, timedelta
import base64
from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from dotenv import load_dotenv
import aiohttp
from tenacity import retry, stop_after_attempt, wait_exponential
from solders.pubkey import Pubkey
from solders.transaction import VersionedTransaction
from solana.rpc.async_api import AsyncClient
from app.dependencies import get_current_user_by_wallet
from app.models import Subscription, TokenMetadataArchive, Trade, User, TokenMetadata, NewTokens
from app.database import AsyncSessionLocal, get_db
from app.routers.creators import openai_router, tokencreate_router, creator_user_router, prefund_router, image_upload_router
from app.routers.snipers import auth_router, token_router, trade_router, sniper_user_router
from app.schemas.snipers.bot import LogTradeRequest
from app.schemas.snipers.subscription import SubscriptionRequest
from app.utils.jupiter_api import fetch_jupiter_with_retry, get_jupiter_token_data
from app.utils.profitability_engine import engine as profitability_engine
from app.utils.dexscreener_api import fetch_dexscreener_with_retry, get_dexscreener_data
from app.utils.webacy_api import check_webacy_risk
from app import models, database
from app.config import settings
import redis.asyncio as redis
from app.utils.bot_components import ConnectionManager, check_and_restart_stale_monitors, execute_user_buy, periodic_fee_cleanup, websocket_manager
import logging
import os
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path
from app.utils import redis_client
from collections import deque
from typing import Set
from app.utils.shared import save_bot_state, load_bot_state
from app.routers.creators.websocket import router as websocket_router



# Disable SQLAlchemy logging
logging.config.dictConfig({
    'version': 1,
    'disable_existing_loggers': False,
    'loggers': {
        'sqlalchemy.engine': {'level': 'ERROR', 'handlers': [], 'propagate': False},
        'sqlalchemy.pool': {'level': 'ERROR', 'handlers': [], 'propagate': False},
        'sqlalchemy.dialects': {'level': 'ERROR', 'handlers': [], 'propagate': False},
    }
})

# Load environment variables
load_dotenv()

# === CREATE LOGS DIRECTORY ===
LOG_DIR = Path("logs")
LOG_DIR.mkdir(exist_ok=True)
LOG_FILE = LOG_DIR / "app.log"

# === CONFIGURE ROOT LOGGER (captures EVERYTHING) ===
logger = logging.getLogger()
logger.setLevel(logging.INFO)  # Change to DEBUG if you want everything

# Avoid duplicate handlers if reloaded
if logger.handlers:
    logger.handlers.clear()

# === 1. CONSOLE HANDLER (you still see logs in terminal) ===
console_handler = logging.StreamHandler()
console_handler.setLevel(logging.INFO)
console_formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
console_handler.setFormatter(console_formatter)

# === 2. FILE HANDLER WITH DAILY ROTATION + KEEP 30 DAYS ===
file_handler = TimedRotatingFileHandler(
    filename=LOG_FILE,
    when="midnight",        # New file every day
    interval=1,
    backupCount=30,         # Keep last 30 days
    encoding="utf-8"
)
file_handler.setLevel(logging.INFO)  # or DEBUG
file_formatter = logging.Formatter(
    '%(asctime)s - %(name)s - %(funcName)s:%(lineno)d - %(levelname)s - %(message)s'
)
file_handler.setFormatter(file_formatter)

# === ADD BOTH HANDLERS ===
logger.addHandler(console_handler)
logger.addHandler(file_handler)

# === OPTIONAL: Also log ALL uncaught exceptions ===
def handle_exception(exc_type, exc_value, exc_traceback):
    if issubclass(exc_type, KeyboardInterrupt):
        sys.__excepthook__(exc_type, exc_value, exc_traceback)
        return
    logger.critical("Uncaught exception", exc_info=(exc_type, exc_value, exc_traceback))

import sys
sys.excepthook = handle_exception

# CREATE_DISCRIMINATOR = bytes([200, 75, 54, 125, 27, 41, 169, 156])  # SHA256("global:create")[:8]

# CORRECT Pump.fun instruction discriminators (from program source)
PUMPFUN_CREATE_DISCRIMINATOR = bytes([87, 65, 132, 46, 200, 212, 13, 233])  # SHA256("global:create")[:8]
PUMPFUN_BUY_DISCRIMINATOR = bytes([182, 14, 56, 103, 225, 50, 215, 91])     # SHA256("global:buy")[:8]
PUMPFUN_SELL_DISCRIMINATOR = bytes([106, 111, 121, 90, 32, 193, 137, 177])  # SHA256("global:sell")[:8]

# FastAPI app
app = FastAPI(
    title="FlashSniper API",
    description="A powerful Solana sniping bot with AI analysis and rug pull protection.",
    version="0.2.0",
    # docs_url="/docs" if os.getenv("ENVIRONMENT") != "production" else None,
    # redoc_url="/redoc" if os.getenv("ENVIRONMENT") != "production" else None,
)

if settings.ENVIRONMENT == "development":
    allowed_origins = ["*"]
else:
    allowed_origins = [
        # Production
        "https://flashsnipper.com",
        "https://www.flashsnipper.com",
        "https://flashsnipper.vercel.app",

        # Local development
        "http://localhost:4028",
        "http://127.0.0.1:4028",

        # Optional: extra local ports you use
        "http://localhost:3000",
        "http://localhost:8000",
        "http://localhost:5173",   # Vite default
    ]

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,  
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    max_age=600
)

# General routers for both creators and snipers
app.include_router(auth_router)
# Routers for snipers
app.include_router(token_router)
app.include_router(trade_router)
app.include_router(sniper_user_router)
# Routers for creators
app.include_router(openai_router)
app.include_router(tokencreate_router)
app.include_router(creator_user_router)
app.include_router(prefund_router)
app.include_router(image_upload_router)
# Websocket router to update frontend
app.include_router(websocket_router)



# ===================================================================
# GLOBAL STATE MANAGEMENT
# ===================================================================

# Token processing queue and state tracking
token_processing_queue = deque()
currently_sniping: Set[str] = set()  # Tokens currently being sniped
recently_processed: Set[str] = set()  # Tokens processed in last 60s
max_concurrent_snipes = 1  # Process ONE token at a time

# Pump.fun program constants
PUMPFUN_PROGRAM = settings.PUMPFUN_PROGRAM


async def start_persistent_bot_for_user(wallet_address: str):
    """Start a persistent bot that survives browser closures"""
    if wallet_address in active_bot_tasks and not active_bot_tasks[wallet_address].done():
        logger.info(f"Bot already running for {wallet_address}")
        return
    
    # ========== ADD THIS: Notify sniper engine ==========
    try:
        await user_activation_manager.notify_user_activated(wallet_address)
    except Exception as e:
        logger.error(f"Failed to notify sniper engine: {e}")
    # ========== END ADDITION ==========
    
    async def persistent_bot_loop():
        logger.info(f"Starting persistent bot for {wallet_address}")
        
        while True:
            try:
                # Check if bot should still be running
                state = await load_bot_state(wallet_address)
                if not state or not state.get("is_running", False):
                    logger.info(f"Bot stopped via state for {wallet_address}")
                    break
                
                # Get fresh user data each iteration
                async with AsyncSessionLocal() as db:
                    user_result = await db.execute(
                        select(User).where(User.wallet_address == wallet_address)
                    )
                    user = user_result.scalar_one_or_none()
                    
                    if not user:
                        logger.error(f"User {wallet_address} not found - stopping bot")
                        await save_bot_state(wallet_address, False)
                        break
                    
                    # Check balance - FIXED: Define sol_balance here
                    sol_balance = 0.0
                    try:
                        async with AsyncClient(settings.SOLANA_RPC_URL) as client:
                            balance_response = await client.get_balance(Pubkey.from_string(wallet_address))
                            sol_balance = balance_response.value / 1_000_000_000
                            
                            if sol_balance < 0.1:  # Reduced minimum to 0.1 SOL
                                logger.info(f"Insufficient balance for {wallet_address}: {sol_balance} SOL")
                                # Send alert via WebSocket if connected
                                await websocket_manager.send_personal_message(json.dumps({
                                    "type": "log",
                                    "log_type": "warning",
                                    "message": f"Low balance: {sol_balance:.4f} SOL. Bot paused.",
                                    "timestamp": datetime.utcnow().isoformat()
                                }), wallet_address)
                                await asyncio.sleep(60)  # Check less frequently when low balance
                                continue
                    except Exception as e:
                        logger.error(f"Balance check failed for {wallet_address}: {e}")
                        await asyncio.sleep(30)
                        continue
                    
                    # Process new tokens for this user
                    await process_user_specific_tokens(user, db)  # Use await instead of create_task
                
                # Heartbeat - update every cycle (FIXED: sol_balance is now defined)
                await save_bot_state(wallet_address, True, {
                    "last_cycle": datetime.utcnow().isoformat(),
                    "balance": sol_balance
                })
                
                # Use user's check interval or default
                check_interval = user.sniper_bot_check_interval_seconds if user and user.sniper_bot_check_interval_seconds else 10
                await asyncio.sleep(check_interval)
                
            except asyncio.CancelledError:
                logger.info(f"Persistent bot cancelled for {wallet_address}")
                break
            except Exception as e:
                logger.error(f"Error in persistent bot for {wallet_address}: {e}")
                await asyncio.sleep(30)
        
        # Cleanup
        if wallet_address in active_bot_tasks:
            del active_bot_tasks[wallet_address]
        await save_bot_state(wallet_address, False)
        logger.info(f"Persistent bot stopped for {wallet_address}")
        
    task = asyncio.create_task(persistent_bot_loop())
    active_bot_tasks[wallet_address] = task
    await save_bot_state(wallet_address, True)
    
# Add this to lifespan startup to restore persistent bots
# async def restore_persistent_bots():
#     """Restore all persistent bots on startup"""
#     try:
#         # Get all wallet addresses with active bots
#         keys = await redis_client.keys("bot_state:*")
#         for key in keys:
#             state_data = await redis_client.get(key)
#             if state_data:
#                 state = json.loads(state_data)
#                 if state.get("is_running", False):
#                     wallet_address = key.decode().replace("bot_state:", "")
#                     # Wait a bit before starting to avoid overload
#                     await asyncio.sleep(1)
#                     asyncio.create_task(start_persistent_bot_for_user(wallet_address))
#                     logger.info(f"Restored persistent bot for {wallet_address}")
#     except Exception as e:
#         logger.error(f"Error restoring persistent bots: {e}")

async def restore_persistent_bots():
    """Restore all persistent bots on startup"""
    try:
        # Get all wallet addresses with active bots
        keys = await redis_client.keys("bot_state:*")
        for key in keys:
            # Redis returns strings when decode_responses=True
            # No need to decode!
            key_str = key  # Already a string
            
            state_data = await redis_client.get(key_str)
            if state_data:
                # state_data is already a string (JSON)
                try:
                    state = json.loads(state_data)
                    if state.get("is_running", False):
                        wallet_address = key_str.replace("bot_state:", "")
                        # Wait a bit before starting to avoid overload
                        await asyncio.sleep(1)
                        asyncio.create_task(start_persistent_bot_for_user(wallet_address))
                        logger.info(f"Restored persistent bot for {wallet_address}")
                except json.JSONDecodeError as e:
                    logger.error(f"Invalid JSON in bot state for key {key_str}: {e}")
                    # Delete corrupted state
                    await redis_client.delete(key_str)
                    
    except Exception as e:
        logger.error(f"Error restoring persistent bots: {e}")



# ===================================================================
# LIFESPAN — Start all core services
# ===================================================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        async with database.async_engine.begin() as conn:
            await conn.run_sync(models.Base.metadata.create_all)

        # Core detection loops
        asyncio.create_task(safe_metadata_enrichment_loop())
        asyncio.create_task(restore_persistent_bots())
        
        # Start fee cleanup task
        asyncio.create_task(periodic_fee_cleanup())
        asyncio.create_task(check_and_restart_stale_monitors())

        # logger.info("🚀 FlashSniper STARTED | Detecting Pump.fun + Raydium tokens in <2s")
        
        
        yield
    except Exception as e:
        logger.error(f"Startup failed: {e}")
        raise
    finally:
        for task in active_bot_tasks.values():
            task.cancel()
        await asyncio.gather(*active_bot_tasks.values(), return_exceptions=True)
        
        # Close Redis connection
        from app.utils.redis_client import close_redis_client
        await close_redis_client()
        
        await database.async_engine.dispose()
        

app.router.lifespan_context = lifespan
active_bot_tasks: Dict[str, asyncio.Task] = {}

class UserActivationManager:
    """Manages WebSocket connections to sniper engine for real-time user activation"""
    def __init__(self):
        self.active_sniper_connections: List[WebSocket] = []
    
    async def connect(self, websocket: WebSocket):
        """Sniper engine connects here for activation notifications"""
        await websocket.accept()
        self.active_sniper_connections.append(websocket)
        logger.info(f"📡 Sniper engine connected to activation manager")
    
    async def disconnect(self, websocket: WebSocket):
        """Remove sniper connection"""
        if websocket in self.active_sniper_connections:
            self.active_sniper_connections.remove(websocket)
    
    async def notify_user_activated(self, wallet_address: str):
        """Notify all connected sniper engines when a user activates"""
        message = {
            "type": "user_activated",
            "wallet_address": wallet_address,
            "timestamp": datetime.utcnow().isoformat()
        }
        
        dead_connections = []
        for connection in self.active_sniper_connections:
            try:
                await connection.send_json(message)
                logger.info(f"📢 Sent activation notification for {wallet_address[:8]}")
            except Exception:
                dead_connections.append(connection)
        
        # Clean up dead connections
        for connection in dead_connections:
            self.active_sniper_connections.remove(connection)

# Initialize the manager
user_activation_manager = UserActivationManager() 
        
async def trigger_immediate_snipe(mint_address: str, db: AsyncSession):
    """Trigger immediate snipe for only ACTIVE users (connected via WebSocket)"""
    try:
        # Get only ACTIVE users (connected via WebSocket)
        active_wallets = list(websocket_manager.active_connections.keys())
        
        if not active_wallets:
            logger.info(f"No active WebSocket connections for immediate snipe of {mint_address[:8]}")
            return
        
        logger.info(f"⚡ Found {len(active_wallets)} active WebSocket connections")
        
        # Get user data for active wallets
        users_result = await db.execute(
            select(User).where(
                User.wallet_address.in_(active_wallets),
                User.encrypted_private_key.isnot(None)
            )
        )
        users = users_result.scalars().all()
        
        if not users:
            logger.info(f"No active users with private keys for immediate snipe of {mint_address[:8]}")
            return
        
        logger.info(f"Triggering immediate snipe for {len(users)} ACTIVE users on {mint_address[:8]}")
        
        # Create minimal token data for immediate buy
        minimal_token = TokenMetadata(
            mint_address=mint_address,
            token_symbol="UNKNOWN",
            token_name="Unknown",
            last_checked_at=datetime.utcnow(),
            trading_recommendation="MOONBAG_BUY",  # Force buy
            profitability_confidence=90,
            profitability_score=95,
            price_usd=0.0001,  # Default minimal price
            liquidity_usd=10000,  # Default liquidity
            token_decimals=9,  # Default decimals
        )
        
        # Trigger buy for each ACTIVE user
        for user in users:
            try:
                # Check if user's bot is running (persistent or via bot_state)
                bot_state = await load_bot_state(user.wallet_address)
                is_bot_running = bot_state and bot_state.get("is_running", False) if bot_state else False
                
                if not is_bot_running:
                    logger.info(f"Skipping {user.wallet_address[:8]} - bot not running")
                    continue
                
                # Check if user has enough SOL balance
                async with AsyncClient(settings.SOLANA_RPC_URL) as client:
                    balance_response = await client.get_balance(Pubkey.from_string(user.wallet_address))
                    sol_balance = balance_response.value / 1_000_000_000
                    
                    min_sol = user.buy_amount_sol or 0.1
                    if sol_balance < min_sol:
                        logger.info(f"❌ Skipping {user.wallet_address[:8]} - insufficient balance: {sol_balance:.4f} SOL")
                        
                        # Notify user
                        await websocket_manager.send_personal_message(json.dumps({
                            "type": "log",
                            "log_type": "warning",
                            "message": f"Insufficient balance for immediate snipe: {sol_balance:.4f} SOL < {min_sol} SOL required",
                            "timestamp": datetime.utcnow().isoformat()
                        }), user.wallet_address)
                        continue
                
                logger.info(f"🔄 Executing immediate snipe for {user.wallet_address[:8]} on {mint_address[:8]}")
                
                # Use a separate session for each buy to avoid conflicts
                async with AsyncSessionLocal() as buy_db:
                    # Refresh user in new session
                    buy_user_result = await buy_db.execute(
                        select(User).where(User.wallet_address == user.wallet_address)
                    )
                    buy_user = buy_user_result.scalar_one_or_none()
                    
                    if buy_user:
                        # Create a new TokenMetadata object in the new session
                        buy_token = TokenMetadata(
                            mint_address=mint_address,
                            token_symbol="UNKNOWN",
                            token_name="Unknown",
                            last_checked_at=datetime.utcnow(),
                            trading_recommendation="MOONBAG_BUY",
                            profitability_confidence=90,
                            profitability_score=95,
                            price_usd=0.0001,
                            liquidity_usd=10000,
                            token_decimals=6,
                        )
                        
                        # Execute buy
                        await execute_user_buy(buy_user, buy_token, buy_db, websocket_manager)
                        
                        logger.info(f"✅ Immediate snipe executed for {buy_user.wallet_address[:8]}")
                        
            except Exception as e:
                logger.error(f"❌ Failed immediate snipe for {user.wallet_address[:8]}: {e}")
                
                # Notify user of failure
                await websocket_manager.send_personal_message(json.dumps({
                    "type": "log",
                    "log_type": "error",
                    "message": f"Immediate snipe failed: {str(e)[:100]}",
                    "timestamp": datetime.utcnow().isoformat()
                }), user.wallet_address)
                continue
        
    except Exception as e:
        logger.error(f"❌ Error in trigger_immediate_snipe: {e}")
             
              
# ===================================================================
# 3. OTHER UTIL FUNCTIONS
# ===================================================================
async def broadcast_trade(trade: Trade):
    message = {
        "type": "trade_update",
        "trade": {
            "id": trade.id,
            "trade_type": trade.trade_type,
            "amount_sol": trade.amount_sol or 0,
            "token_symbol": trade.token_symbol or "Unknown",
            "timestamp": trade.created_at.isoformat() if trade.created_at else None,
        }
    }
    await websocket_manager.send_personal_message(json.dumps(message), trade.user_wallet_address)
        
async def run_user_specific_bot_loop(user_wallet_address: str):
    logger.info(f"Starting bot loop for {user_wallet_address}")
    try:
        async with AsyncSessionLocal() as db:
            user_result = await db.execute(select(User).filter(User.wallet_address == user_wallet_address))
            user = user_result.scalar_one_or_none()
            if not user:
                logger.error(f"User {user_wallet_address} not found.")
                await websocket_manager.send_personal_message(
                    json.dumps({"type": "log", "message": "User not found. Stopping bot.", "status": "error"}),
                    user_wallet_address
                )
                return
            while True:
                recent_time_threshold = datetime.utcnow() - timedelta(minutes=30)
                stmt = select(TokenMetadata).filter(TokenMetadata.last_checked_at >= recent_time_threshold).order_by(TokenMetadata.last_checked_at.desc()).limit(10)
                result = await db.execute(stmt)
                tokens = result.scalars().all()
                tasks = [
                    apply_user_filters_and_trade(user, token, db, websocket_manager)
                    for token in tokens
                    if (not await redis_client.exists(f"trade:{user_wallet_address}:{token.mint_address}") and
                        token.trading_recommendation in ["MOONBAG_BUY", "STRONG_BUY", "BUY"] and
                        token.profitability_confidence >= 70)
                ]
                await asyncio.gather(*tasks)
                await asyncio.sleep(user.sniper_bot_check_interval_seconds or 10)
    except asyncio.CancelledError:
        logger.info(f"Bot task for {user_wallet_address} cancelled.")
    except Exception as e:
        logger.error(f"Error in bot loop for {user_wallet_address}: {e}")
        await websocket_manager.send_personal_message(
            json.dumps({"type": "log", "message": f"Bot error: {str(e)}", "status": "error"}),
            user_wallet_address
        )
    finally:
        if user_wallet_address in active_bot_tasks:
            del active_bot_tasks[user_wallet_address]
        logger.info(f"Bot loop for {user_wallet_address} ended.")

async def apply_user_filters_and_trade(user: User, token: TokenMetadata, db: AsyncSession, websocket_manager: ConnectionManager):
    # Prevent double buys - FIXED: Use async Redis
    if await redis_client.exists(f"trade:{user.wallet_address}:{token.mint_address}"):
        logger.info(f"Skipping {token.mint_address[:8]} for {user.wallet_address} — Already trading.")
        return

    # === ONLY BUY MOONBAGS OR STRONG BUYS ===
    if token.trading_recommendation not in ["MOONBAG_BUY", "STRONG_BUY", "BUY"]:
        logger.info(f"Skipping {token.token_symbol or token.mint_address[:8]} — Not a moonbag (got {token.trading_recommendation})")
        return

    if token.profitability_confidence < 70:
        logger.info(f"Skipping {token.token_symbol or token.mint_address[:8]} — Low confidence ({token.profitability_confidence}%)")
        return

    logger.info(f"🚀 MOONBAG DETECTED → {token.token_symbol or token.mint_address[:8]} | Score: {token.profitability_score:.1f} | Buying NOW for {user.wallet_address}!")

    if token.trading_recommendation in ["MOONBAG_BUY", "STRONG_BUY", "BUY"] and token.profitability_confidence >= 70:
        # Check if already bought (active position)
        exists = await db.execute(
            select(Trade).where(
                Trade.user_wallet_address == user.wallet_address,
                Trade.mint_address == token.mint_address,
                Trade.trade_type == "buy",
                Trade.sell_timestamp.is_(None)  # No sell yet
            )
        )
        if exists.scalar_one_or_none():
            logger.info(f"Skipping {token.mint_address[:8]} for {user.wallet_address} — Already holding position.")
            return  # Already holding

        # Set lock to prevent duplicates during async execution
        await redis_client.setex(f"trade:{user.wallet_address}:{token.mint_address}", 300, "1")  # 5min lock

        try:
            # Trigger the buy (this calls execute_jupiter_swap internally with 1% referral fee)
            await execute_user_buy(user, token, db, websocket_manager)
        except Exception as e:
            logger.error(f"Buy execution failed for {user.wallet_address} on {token.mint_address[:8]}: {e}")
            # Notify user via WS
            await websocket_manager.send_personal_message(
                json.dumps({
                    "type": "log",
                    "message": f"Buy failed: {str(e)}",
                    "status": "error",
                    "mint": token.mint_address
                }),
                user.wallet_address
            )
        finally:
            # Always clear lock
            await redis_client.delete(f"trade:{user.wallet_address}:{token.mint_address}")
            
async def update_bot_settings(settings: dict, wallet_address: str, db: AsyncSession):
    try:
        stmt = select(User).filter(User.wallet_address == wallet_address)
        result = await db.execute(stmt)
        user = result.scalar_one_or_none()
        if not user:
            raise ValueError("User not found")
        for key, value in settings.items():
            if key == "is_premium" and not user.is_premium:
                continue
            setattr(user, key, value)
        await db.merge(user)
        await db.commit()
        await websocket_manager.send_personal_message(
            json.dumps({"type": "log", "message": "Bot settings updated", "status": "info"}),
            wallet_address
        )
    except Exception as e:
        logger.error(f"Error updating settings for {wallet_address}: {e}")
        await websocket_manager.send_personal_message(
            json.dumps({"type": "log", "message": f"Settings update error: {str(e)}", "status": "error"}),
            wallet_address
        )

async def handle_signed_transaction(data: dict, wallet_address: str, db: AsyncSession):
    try:
        signed_tx_base64 = data.get("signed_tx_base64")
        if not signed_tx_base64:
            raise ValueError("Missing signed transaction")
        async with AsyncClient(settings.SOLANA_RPC_URL) as client:
            signed_tx = VersionedTransaction.from_bytes(base64.b64decode(signed_tx_base64))
            tx_hash = await client.send_raw_transaction(signed_tx)
            logger.info(f"Transaction sent for {wallet_address}: {tx_hash}")
            await websocket_manager.send_personal_message(
                json.dumps({"type": "log", "message": f"Transaction sent: {tx_hash}", "status": "info"}),
                wallet_address
            )
    except Exception as e:
        logger.error(f"Error handling signed transaction for {wallet_address}: {e}")
        await websocket_manager.send_personal_message(
            json.dumps({"type": "log", "message": f"Transaction error: {str(e)}", "status": "error"}),
            wallet_address
        )
 
async def apply_user_filters(user: User, token_meta: TokenMetadata, db: AsyncSession, websocket_manager: ConnectionManager) -> bool:
    async def log_failure(filter_name: str, details: str = ""):
        symbol = token_meta.token_symbol or token_meta.mint_address[:8]
        msg = f"Token {symbol} failed {filter_name} filter.{f' {details}' if details else ''}"
        logger.info(msg)
        await websocket_manager.send_personal_message(
            json.dumps({
                "type": "log",
                "log_type": "warning",
                "message": msg,
                "timestamp": datetime.utcnow().isoformat()
            }),
            user.wallet_address
        )

    # ===================================================================
    # PREMIUM-ONLY FILTERS (Free users bypass ALL of these)
    # ===================================================================
    if user.is_premium:
        # 1. Socials filter
        if user.filter_socials_added and not token_meta.socials_present:
            await log_failure("Socials Added", "No Twitter/Telegram/Website")
            return False

        # 2. Liquidity burnt
        if user.filter_liquidity_burnt and not getattr(token_meta, "liquidity_burnt", False):
            await log_failure("Liquidity Burnt")
            return False

        # 3. Minimum liquidity (SOL)
        min_liq_sol = user.filter_check_pool_size_min_sol or 0.05
        current_liq = getattr(token_meta, "liquidity_pool_size_sol", 0) or 0
        if current_liq < min_liq_sol:
            await log_failure(
                "Insufficient Liquidity",
                f"{current_liq:.4f} SOL < {min_liq_sol} SOL required"
            )
            return False

        # 4. Token age filter
        if token_meta.pair_created_at:
            age_seconds = datetime.utcnow().timestamp() - token_meta.pair_created_at
            if age_seconds < 15:
                await log_failure("Token Too New", f"Only {int(age_seconds)}s old")
                return False
            if age_seconds > 72 * 3600:
                await log_failure("Token Too Old", ">72h old")
                return False

        # 5. Market cap filter
        if token_meta.market_cap is not None and token_meta.market_cap < 30_000:
            await log_failure("Market Cap Too Low", f"${token_meta.market_cap:,.0f}")
            return False

        # 6. Webacy risk
        if token_meta.webacy_risk_score is not None and token_meta.webacy_risk_score > 50:
            await log_failure("Webacy Risk Too High", f"Score: {token_meta.webacy_risk_score:.1f}")
            return False

        # 7. Premium safety delay & moon potential
        if user.filter_safety_check_period_seconds and token_meta.pair_created_at:
            if age_seconds < user.filter_safety_check_period_seconds:
                await log_failure(
                    "Safety Check Period",
                    f"Waiting {user.filter_safety_check_period_seconds - int(age_seconds)}s"
                )
                return False

        if token_meta.webacy_moon_potential is not None and token_meta.webacy_moon_potential < 80:
            await log_failure("Webacy Moon Potential Too Low", f"{token_meta.webacy_moon_potential:.1f}%")
            return False

    else:
        # ===================================================================
        # FREE USERS → ONLY BASIC TRADING SETTINGS APPLY
        # No liquidity, no socials, no age checks → just buy!
        # ===================================================================
        logger.info(f"FREE USER {user.wallet_address[:8]} → Skipping all advanced filters. Buying with basic settings only.")

    # ===================================================================
    # ALL USERS (free + premium) → Final sanity check
    # ===================================================================
    if not token_meta.price_usd or token_meta.price_usd <= 0:
        await log_failure("No Price", "Token has no valid USD price yet")
        return False

    # ALL FILTERS PASSED → SAFE TO BUY
    return True


# ===================================================================
# LOOP 2:- METADATA ENRICHMENT LOOP 
# ===================================================================
async def safe_metadata_enrichment_loop():
    while True:
        try:
            await metadata_enrichment_loop()
        except Exception as e:
            logger.error(f"Metadata loop crashed: {e}")
            await asyncio.sleep(30)
            
async def metadata_enrichment_loop():
    while True:
        # Process tokens one at a time to avoid conflicts
        async with AsyncSessionLocal() as db:
            stmt = select(NewTokens).where(
                NewTokens.metadata_status == "pending",
                or_(
                    NewTokens.next_reprocess_time.is_(None),
                    NewTokens.next_reprocess_time <= datetime.utcnow()
                )
            ).order_by(NewTokens.timestamp).limit(1)  # Limit to 1 at a time
            
            result = await db.execute(stmt)
            pending = result.scalars().all()

            for token in pending:
                try:
                    # Process each token in its own transaction
                    async with AsyncSessionLocal() as inner_db:
                        await safe_enrich_token(token.mint_address, inner_db)
                except Exception as e:
                    logger.error(f"Failed to process {token.mint_address[:8]}: {e}")
                    continue  # Continue with next token

        await asyncio.sleep(1)  # Shorter sleep, process continuously
        
        
async def safe_enrich_token(mint_address: str, db: AsyncSession):
    try:
        await process_token_logic(mint_address, db)
        
        # Update NewTokens
        new_token_result = await db.execute(
            select(NewTokens).where(NewTokens.mint_address == mint_address)
        )
        token = new_token_result.scalar_one_or_none()
        
        if token:
            token.metadata_status = "processed"
            token.last_metadata_update = datetime.utcnow()
        
        await db.commit()
        
    except Exception as e:
        logger.error(f"Failed to enrich {mint_address}: {e}", exc_info=True)
        try:
            # Ensure we rollback on any error
            if db.is_active:
                await db.rollback()
        except Exception as rollback_error:
            logger.error(f"Rollback failed: {rollback_error}")
        # Leave as pending → will retry automatically
        
        # IMPORTANT: Don't re-use the same session after error
        # The error will bubble up and the session will be cleaned up

def safe_float(value, default=0.0) -> float:
    try:
        return float(value) if value not in (None, "", "null") else default
    except:
        return default
    
@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=4, max=10))
async def process_token_logic(mint_address: str, db: AsyncSession):
    """Process token metadata AFTER immediate snipe"""
    try:
        logger.info(f"📊 Fetching metadata for {mint_address[:8]} (post-snipe)...")
        
        # Get or create token
        result = await db.execute(select(TokenMetadata).where(TokenMetadata.mint_address == mint_address))
        token = result.scalars().first()
        
        if not token:
            token = TokenMetadata(mint_address=mint_address)
            db.add(token)
        
        # 1. Fetch DexScreener data
        dex_data = await fetch_dexscreener_with_retry(mint_address)
        
        if dex_data:
            # Populate DexScreener data
            token.dexscreener_url = dex_data.get("dexscreener_url")
            token.pair_address = dex_data.get("pair_address")
            token.price_usd = safe_float(dex_data.get("price_usd"))
            token.market_cap = safe_float(dex_data.get("market_cap"))
            token.token_name = dex_data.get("token_name")
            token.token_symbol = dex_data.get("token_symbol")
            token.liquidity_usd = safe_float(dex_data.get("liquidity_usd"))
            token.fdv = safe_float(dex_data.get("fdv"))
            token.twitter = dex_data.get("twitter")
            token.telegram = dex_data.get("telegram")
            token.websites = dex_data.get("websites")
            token.socials_present = bool(dex_data.get("twitter") or dex_data.get("telegram") or dex_data.get("websites"))
        
        # 2. Fetch Jupiter data for logo
        try:
            jupiter_data = await asyncio.wait_for(
                get_jupiter_token_data(mint_address),
                timeout=5.0
            )
            
            if jupiter_data and jupiter_data.get("icon"):
                token.token_logo = jupiter_data["icon"]
                token.token_decimals = jupiter_data["decimals"]
                logger.info(f"✅ Jupiter logo & decimals found for {mint_address[:8]}")
                
        except (asyncio.TimeoutError, Exception) as e:
            logger.warning(f"Jupiter fetch failed for {mint_address[:8]}: {e}")
            # Fallback to DexScreener logo
            token.token_logo = f"https://dd.dexscreener.com/ds-logo/solana/{mint_address}.png"
        
        # 3. Fetch Webacy data
        try:
            webacy_data = await check_webacy_risk(mint_address)
            if webacy_data and isinstance(webacy_data, dict):
                token.webacy_risk_score = safe_float(webacy_data.get("risk_score"))
                token.webacy_risk_level = webacy_data.get("risk_level")
                token.webacy_moon_potential = webacy_data.get("moon_potential")
        except Exception as e:
            logger.warning(f"Webacy fetch failed for {mint_address[:8]}: {e}")
        
        # 4. Update timestamp
        token.last_checked_at = datetime.utcnow()
        
        # 5. Send metadata to frontend
        metadata_alert = {
            "type": "token_metadata",
            "mint": mint_address,
            "symbol": token.token_symbol or "UNKNOWN",
            "name": token.token_name or "Unknown",
            "logo": token.token_logo or f"https://dd.dexscreener.com/ds-logo/solana/{mint_address}.png",
            "price_usd": token.price_usd,
            "liquidity_usd": token.liquidity_usd,
            "market_cap": token.market_cap,
            "dexscreener_url": token.dexscreener_url,
            "twitter": token.twitter,
            "telegram": token.telegram,
            "website": token.websites,
            "webacy_risk_score": token.webacy_risk_score,
            "timestamp": datetime.utcnow().isoformat()
        }
        
        # Send to all connected users
        for wallet in list(websocket_manager.active_connections.keys()):
            await websocket_manager.send_personal_message(json.dumps(metadata_alert), wallet)
        
        # Save to database
        await db.commit()
        
        logger.info(f"✅ Metadata fetched for {mint_address[:8]}: {token.token_symbol}")
        
        # Update NewTokens status
        new_token = await db.get(NewTokens, mint_address) or (await db.execute(
            select(NewTokens).where(NewTokens.mint_address == mint_address)
        )).scalar_one_or_none()
        
        if new_token:
            new_token.metadata_status = "completed"
            new_token.last_metadata_update = datetime.utcnow()
            await db.commit()
        
    except Exception as e:
        logger.error(f"Failed to process metadata for {mint_address}: {e}")
        await db.rollback()
            
async def smart_cleanup_and_archive_loop():
    while True:
        try:
            async with AsyncSessionLocal() as db:
                cutoff = datetime.utcnow() - timedelta(hours=72)

                # 1. Find tokens older than 72h that we still have metadata for
                old_tokens = await db.execute(
                    select(TokenMetadata).where(
                        TokenMetadata.pair_created_at < cutoff.timestamp()
                        if TokenMetadata.pair_created_at is not None
                        else TokenMetadata.last_checked_at < cutoff
                    ).limit(200)
                )
                old_tokens = old_tokens.scalars().all()

                for token in old_tokens:
                    # Archive full snapshot
                    archive = TokenMetadataArchive(
                        mint_address=token.mint_address,
                        data=json.dumps(token.__dict__, default=str)  # safe serialization safe
                    )
                    db.add(archive)

                    # Now safe to delete from hot tables
                    await db.execute(delete(NewTokens).where(NewTokens.mint_address == token.mint_address))
                    await db.delete(token)

                await db.commit()

                if old_tokens:
                    logger.info(f"Archived and cleaned {len(old_tokens)} tokens >72h old")

        except Exception as e:
            logger.error(f"Archive/cleanup error: {e}")

        await asyncio.sleep(1800)  # every 30 min
       
async def start_user_bot_task(wallet_address: str):
    """Start a user-specific bot task"""
    if wallet_address in active_bot_tasks:
        logger.info(f"Bot already running for {wallet_address}")
        return
    
    task = asyncio.create_task(run_user_specific_bot_loop(wallet_address))
    active_bot_tasks[wallet_address] = task
    logger.info(f"Started bot task for {wallet_address}")          
 
async def process_user_specific_tokens(user: User, db: AsyncSession):
    """Process recent high-scoring tokens for a specific user"""
    try:
        recent_time = datetime.utcnow() - timedelta(minutes=1000000)

        result = await db.execute(
            select(TokenMetadata)
            .where(
                TokenMetadata.last_checked_at >= recent_time,
                TokenMetadata.trading_recommendation.in_(["MOONBAG_BUY", "STRONG_BUY", "BUY"]),
                TokenMetadata.profitability_confidence >= 70
            )
            .order_by(TokenMetadata.profitability_score.desc())
            .limit(10)
        )

        tokens = result.scalars().all()

        for token in tokens:
            # Skip if already holding
            existing = await db.execute(
                select(Trade).where(
                    Trade.user_wallet_address == user.wallet_address,
                    Trade.mint_address == token.mint_address,
                    Trade.sell_timestamp.is_(None)
                )
            )
            if existing.scalar_one_or_none():
                continue

            # Apply filters + buy if passes
            if await apply_user_filters(user, token, db, websocket_manager):
                # Create a NEW database session for the buy operation to avoid conflicts
                async with AsyncSessionLocal() as buy_db_session:
                    async with buy_db_session.begin():
                        # Refresh the token in the new session
                        buy_token_result = await buy_db_session.execute(
                            select(TokenMetadata).where(TokenMetadata.mint_address == token.mint_address)
                        )
                        buy_token = buy_token_result.scalar_one_or_none()
                        
                        if buy_token:
                            buy_user_result = await buy_db_session.execute(
                                select(User).where(User.wallet_address == user.wallet_address)
                            )
                            buy_user = buy_user_result.scalar_one_or_none()
                            
                            if buy_user:
                                await execute_user_buy(buy_user, buy_token, buy_db_session, websocket_manager)
                                await asyncio.sleep(1)  # Prevent rate limits
                            
    except Exception as e:
        logger.error(f"Error in process_user_specific_tokens for {user.wallet_address}: {e}")
                
# # Add this to lifespan startup to restore persistent bots
# async def restore_persistent_bots():
#     """Restore all persistent bots on startup"""
#     try:
#         # Get all wallet addresses with active bots
#         keys = await redis_client.keys("bot_state:*")
#         for key in keys:
#             state_data = await redis_client.get(key)
#             if state_data:
#                 state = json.loads(state_data)
#                 if state.get("is_running", False):
#                     wallet_address = key.decode().replace("bot_state:", "")
#                     # Wait a bit before starting to avoid overload
#                     await asyncio.sleep(1)
#                     asyncio.create_task(start_persistent_bot_for_user(wallet_address))
#                     logger.info(f"Restored persistent bot for {wallet_address}")
#     except Exception as e:
#         logger.error(f"Error restoring persistent bots: {e}")
        
async def restore_persistent_bots():
    """Restore all persistent bots on startup"""
    try:
        # Get all wallet addresses with active bots
        keys = await redis_client.keys("bot_state:*")
        for key in keys:
            # Handle both string and bytes
            if isinstance(key, bytes):
                key_str = key.decode('utf-8')
            else:
                key_str = str(key)
            
            state_data = await redis_client.get(key_str)
            if state_data:
                # Handle state data type
                if isinstance(state_data, bytes):
                    state_data = state_data.decode('utf-8')
                
                try:
                    state = json.loads(state_data)
                    if state.get("is_running", False):
                        wallet_address = key_str.replace("bot_state:", "")
                        # Wait a bit before starting to avoid overload
                        await asyncio.sleep(1)
                        asyncio.create_task(start_persistent_bot_for_user(wallet_address))
                        logger.info(f"Restored persistent bot for {wallet_address}")
                except json.JSONDecodeError as e:
                    logger.error(f"Invalid JSON in bot state: {e}")
    except Exception as e:
        logger.error(f"Error restoring persistent bots: {e}")

# ===================================================================
# 4. ALL MAIN ENDPOINTS STARTS HERE
# ===================================================================
@app.get("/ping")
async def ping():
    logger.info("Ping received.")
    return {"message": "pong", "status": "ok"}


@app.get("/debug/routes")
async def debug():
    return [{"path": r.path, "name": r.name} for r in app.routes]
        
@app.websocket("/ws/logs/{wallet_address}")
async def websocket_endpoint(websocket: WebSocket, wallet_address: str):
    await websocket_manager.connect(websocket, wallet_address)  # FIXED: Remove extra websocket parameter
    
    try:
         # Send heartbeat every 25 seconds (keep-alive)
        heartbeat_task = asyncio.create_task(send_heartbeat(websocket, wallet_address))
        
        # Send current bot status
        state = await load_bot_state(wallet_address)
        is_running = state.get("is_running", False) if state else False
        
        await websocket.send_json({
            "type": "bot_status",
            "is_running": is_running,
            "message": "Bot is running persistently" if is_running else "Bot is stopped"
        })
        
        # Send recent trades
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Trade)
                .filter_by(user_wallet_address=wallet_address)
                .order_by(Trade.id.desc())
                .limit(50)
            )
            trades = result.scalars().all()
            for trade in trades:
                await websocket.send_json({
                    "type": "trade_update",
                    "trade": {
                        "id": trade.id,
                        "trade_type": trade.trade_type,
                        "amount_sol": trade.amount_sol or 0,
                        "token_symbol": trade.token_symbol or "Unknown",
                        "timestamp": trade.buy_timestamp.isoformat() if trade.buy_timestamp else None,
                    }
                })
        
        # Handle messages with timeout
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                if data:
                    try:
                        message = json.loads(data)
                        
                        # Handle metadata request
                        if message.get("type") == "request_metadata":
                            mint = message.get("mint")
                            if mint:
                                # Trigger metadata fetch
                                asyncio.create_task(fetch_and_send_metadata(mint, wallet_address))
                                
                        await handle_websocket_message(message, wallet_address, websocket)
                    except json.JSONDecodeError:
                        logger.error(f"Invalid WebSocket message from {wallet_address}")
                        
            except asyncio.TimeoutError:
                # Send ping to keep connection alive
                try:
                    await websocket.send_json({"type": "ping", "timestamp": datetime.utcnow().isoformat()})
                except:
                    break  # Connection lost
                      
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for {wallet_address}")
    except Exception as e:
        logger.error(f"WebSocket error for {wallet_address}: {str(e)}")
    finally:
        # Cancel heartbeat task
        if 'heartbeat_task' in locals():
            heartbeat_task.cancel()
        websocket_manager.disconnect(wallet_address)
                 
async def fetch_and_send_metadata(mint_address: str, wallet_address: str):
    """Fetch and send metadata for a specific token to a user"""
    try:
        async with AsyncSessionLocal() as db:
            # Fetch token data
            result = await db.execute(
                select(TokenMetadata).where(TokenMetadata.mint_address == mint_address)
            )
            token = result.scalar_one_or_none()
            
            if token:
                metadata = {
                    "type": "token_metadata_update",
                    "mint": mint_address,
                    "symbol": token.token_symbol or "UNKNOWN",
                    "name": token.token_name or "Unknown",
                    "logo": token.token_logo or f"https://dd.dexscreener.com/ds-logo/solana/{mint_address}.png",
                    "price_usd": token.price_usd,
                    "liquidity_usd": token.liquidity_usd,
                    "dexscreener_url": token.dexscreener_url,
                    "webacy_risk_score": token.webacy_risk_score,
                    "timestamp": datetime.utcnow().isoformat()
                }
                
                await websocket_manager.send_personal_message(json.dumps(metadata), wallet_address)
                
    except Exception as e:
        logger.error(f"Failed to fetch metadata for {mint_address}: {e}")
                   
async def send_heartbeat(websocket: WebSocket, wallet_address: str):
    """Send periodic heartbeat to keep connection alive"""
    while True:
        try:
            await asyncio.sleep(25)  # Send heartbeat every 25 seconds
            await websocket.send_json({
                "type": "heartbeat",
                "timestamp": datetime.utcnow().isoformat(),
                "wallet": wallet_address[:8]
            })
        except:
            break  # Connection lost
        
async def handle_websocket_message(message: dict, wallet_address: str, websocket: WebSocket):
    """Handle different types of WebSocket messages"""
    msg_type = message.get("type")
    
    if msg_type == "start_bot":
        await start_persistent_bot_for_user(wallet_address)
        await websocket.send_json({
            "type": "bot_status", 
            "is_running": True,
            "message": "Bot started successfully"
        })
        
    elif msg_type == "stop_bot":
        await save_bot_state(wallet_address, False)
        await websocket.send_json({
            "type": "bot_status",
            "is_running": False, 
            "message": "Bot stopped successfully"
        })
        
    elif msg_type == "health_response":
        logger.debug(f"Health response from {wallet_address}")
        
    elif msg_type == "settings_update":
        async with AsyncSessionLocal() as db:
            await update_bot_settings(message.get("settings", {}), wallet_address, db)
            
@app.post("/user/update-rpc")
async def update_user_rpc(
    rpc_data: dict,
    current_user: User = Depends(get_current_user_by_wallet),
    db: AsyncSession = Depends(get_db)
):
    if not current_user.is_premium:
        raise HTTPException(status_code=403, detail="Custom RPC is available only for premium users.")
    https_url = rpc_data.get("https")
    wss_url = rpc_data.get("wss")
    if https_url and not https_url.startswith("https://"):
        raise HTTPException(status_code=400, detail="Invalid HTTPS RPC URL")
    if wss_url and not wss_url.startswith("wss://"):
        raise HTTPException(status_code=400, detail="Invalid WSS RPC URL")
    current_user.custom_rpc_https = https_url
    current_user.custom_rpc_wss = wss_url
    await db.merge(current_user)
    await db.commit()
    return {"status": "Custom RPC settings updated."}

@app.get("/wallet/balance/{wallet_address}")
async def get_wallet_balance(wallet_address: str):
    try:
        async with AsyncClient(settings.SOLANA_RPC_URL) as client:
            pubkey = Pubkey.from_string(wallet_address)
            balance_response = await client.get_balance(pubkey)
            lamports = balance_response.value
            sol_balance = lamports / 1_000_000_000
            return {"wallet_address": wallet_address, "sol_balance": sol_balance}
    except Exception as e:
        logger.error(f"Error fetching balance for {wallet_address}: {e}")
        raise HTTPException(status_code=500, detail=f"Error fetching balance: {str(e)}")

@app.post("/trade/log-trade")
async def log_trade(
    trade_data: LogTradeRequest,
    current_user: User = Depends(get_current_user_by_wallet),
    db: AsyncSession = Depends(get_db)
):
    fee_percentage = 0.01
    fee_sol = trade_data.amount_sol * fee_percentage if trade_data.amount_sol else 0
    amount_after_fee = trade_data.amount_sol - fee_sol if trade_data.amount_sol else 0
    trade = Trade(
        user_wallet_address=current_user.wallet_address,
        mint_address=trade_data.mint_address,
        token_symbol=trade_data.token_symbol,
        trade_type=trade_data.trade_type,
        amount_sol=amount_after_fee,
        amount_tokens=trade_data.amount_tokens,
        price_sol_per_token=trade_data.price_sol_per_token,
        price_usd_at_trade=trade_data.price_usd_at_trade,
        buy_tx_hash=trade_data.tx_hash if trade_data.trade_type == "buy" else None,
        sell_tx_hash=trade_data.tx_hash if trade_data.trade_type == "sell" else None,
        profit_usd=trade_data.profit_usd,
        profit_sol=trade_data.profit_sol,
        log_message=trade_data.log_message,
        buy_price=trade_data.buy_price,
        entry_price=trade_data.entry_price,
        stop_loss=trade_data.stop_loss,
        take_profit=trade_data.take_profit,
        token_amounts_purchased=trade_data.token_amounts_purchased,
        token_decimals=trade_data.token_decimals,
        sell_reason=trade_data.sell_reason,
        swap_provider=trade_data.swap_provider,
        buy_timestamp=datetime.utcnow() if trade_data.trade_type == "buy" else None,
        sell_timestamp=datetime.utcnow() if trade_data.trade_type == "sell" else None,
    )
    db.add(trade)
    await db.commit()
    await websocket_manager.send_personal_message(
        json.dumps({"type": "log", "message": f"Applied 1% fee ({fee_sol:.6f} SOL) on {trade_data.trade_type} trade.", "status": "info"}),
        current_user.wallet_address
    )
    return {"status": "Trade logged successfully."}

@app.get("/trade/history")
async def get_trade_history(
    current_user: User = Depends(get_current_user_by_wallet),
    db: AsyncSession = Depends(get_db)
):
    trades = await db.execute(
        select(Trade)
        .filter(Trade.user_wallet_address == current_user.wallet_address)
        .order_by(Trade.buy_timestamp.desc())
    )
    trades = trades.scalars().all()

    result = []
    for trade in trades:
        # Determine which URLs to show based on trade type
        if trade.trade_type == "buy":
            solscan_url = trade.solscan_buy_url or (f"https://solscan.io/tx/{trade.buy_tx_hash}" if trade.buy_tx_hash else None)
        else:
            solscan_url = trade.solscan_sell_url or (f"https://solscan.io/tx/{trade.sell_tx_hash}" if trade.sell_tx_hash else None)
        
        # Prepare explorer URLs object
        explorer_urls = None
        if solscan_url or trade.dexscreener_url or trade.jupiter_url:
            explorer_urls = {
                "solscan": solscan_url,
                "dexScreener": trade.dexscreener_url,
                "jupiter": trade.jupiter_url
            }
        
        # Get token info
        token_symbol = trade.token_symbol
        token_logo = None
        
        if trade.mint_address:
            meta = await db.get(TokenMetadata, trade.mint_address)
            if meta:
                token_symbol = meta.token_symbol or token_symbol
                token_logo = meta.token_logo
        
        # Default logo if none found
        if not token_logo and trade.mint_address:
            token_logo = f"https://dd.dexscreener.com/ds-logo/solana/{trade.mint_address}.png"
        
        trade_data = {
            "id": trade.id,
            "type": trade.trade_type,
            "trade_type": trade.trade_type,
            "amount_sol": trade.amount_sol,
            "amount_tokens": trade.amount_tokens,
            "token_symbol": token_symbol,
            "token": token_symbol,  # For compatibility
            "token_logo": token_logo,
            "timestamp": trade.buy_timestamp.isoformat() if trade.buy_timestamp else trade.sell_timestamp.isoformat(),
            "buy_timestamp": trade.buy_timestamp.isoformat() if trade.buy_timestamp else None,
            "sell_timestamp": trade.sell_timestamp.isoformat() if trade.sell_timestamp else None,
            "profit_sol": trade.profit_sol,
            "mint_address": trade.mint_address,
            "tx_hash": trade.buy_tx_hash if trade.trade_type == "buy" else trade.sell_tx_hash,
            "buy_tx_hash": trade.buy_tx_hash,
            "sell_tx_hash": trade.sell_tx_hash,
            "explorer_urls": explorer_urls
        }
        
        result.append(trade_data)

    return result

@app.post("/subscribe/premium")
async def subscribe_premium(
    subscription_data: SubscriptionRequest,
    current_user: User = Depends(get_current_user_by_wallet),
    db: AsyncSession = Depends(get_db)
):
    try:
        import stripe
        stripe.api_key = settings.STRIPE_SECRET_KEY
        subscription = stripe.Subscription.create(
            customer={"email": subscription_data.email},
            items=[{"price": settings.STRIPE_PREMIUM_PRICE_ID}],
            payment_behavior="default_incomplete",
            expand=["latest_invoice.payment_intent"]
        )
        sub = Subscription(
            user_wallet_address=current_user.wallet_address,
            plan_name="Premium",
            payment_provider_id=subscription.id,
            start_date=datetime.utcnow(),
            end_date=datetime.utcnow() + timedelta(days=30)
        )
        current_user.is_premium = True
        current_user.premium_start_date = datetime.utcnow()
        current_user.premium_end_date = datetime.utcnow() + timedelta(days=30)
        db.add(sub)
        await db.merge(current_user)
        await db.commit()
        return {"status": "Subscription activated", "payment_intent": subscription.latest_invoice.payment_intent}
    except Exception as e:
        logger.error(f"Subscription failed: {e}")
        raise HTTPException(status_code=400, detail=f"Subscription failed: {str(e)}")

@app.websocket("/ws/sniper-activations")
async def sniper_activation_websocket(websocket: WebSocket):
    """
    WebSocket endpoint for sniper engine to receive real-time user activation notifications.
    Called by the TypeScript sniper engine.
    """
    await user_activation_manager.connect(websocket)
    
    try:
        while True:
            # Keep connection alive - sniper engine sends pings
            data = await websocket.receive_text()
            
            try:
                message = json.loads(data)
                if message.get("type") == "ping":
                    # Send pong to keep connection alive
                    await websocket.send_json({
                        "type": "pong",
                        "timestamp": datetime.utcnow().isoformat()
                    })
            except json.JSONDecodeError:
                pass  # Ignore malformed messages
                
    except WebSocketDisconnect:
        logger.info("Sniper activation WebSocket disconnected")
    except Exception as e:
        logger.error(f"Sniper activation WebSocket error: {e}")
    finally:
        await user_activation_manager.disconnect(websocket)
  
  
  
  
  