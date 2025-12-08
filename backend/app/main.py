# import logging
# import os
# from fastapi import FastAPI, HTTPException, Depends, WebSocket, WebSocketDisconnect, Request, Response
# from fastapi.middleware.cors import CORSMiddleware
# from fastapi.staticfiles import StaticFiles
# from contextlib import asynccontextmanager
# import json
# import asyncio
# import traceback
# from typing import Dict, Optional
# from datetime import datetime, timedelta
# import grpc
# import base58
# import base64
# from sqlalchemy import delete, or_, select
# from sqlalchemy.ext.asyncio import AsyncSession
# from dotenv import load_dotenv
# import aiohttp
# from tenacity import retry, stop_after_attempt, wait_exponential
# from solders.pubkey import Pubkey
# from solders.keypair import Keypair
# from solders.transaction import VersionedTransaction
# from solana.rpc.async_api import AsyncClient
# from app.dependencies import get_current_user_by_wallet
# from app.models import Subscription, TokenMetadataArchive, Trade, User, TokenMetadata, NewTokens
# from app.database import AsyncSessionLocal, get_db
# from app.schemas import LogTradeRequest, SubscriptionRequest
# from app.utils.jupiter_api import fetch_jupiter_with_retry, get_jupiter_token_data
# from app.utils.profitability_engine import engine as profitability_engine
# from app.utils.dexscreener_api import fetch_dexscreener_with_retry, get_dexscreener_data
# from app.utils.webacy_api import check_webacy_risk
# from app import models, database
# from app.config import settings
# from app.security import decrypt_private_key_backend
# import redis.asyncio as redis
# from app.utils.bot_components import ConnectionManager, check_and_restart_stale_monitors, execute_user_buy, websocket_manager
# import logging
# import os
# from logging.handlers import TimedRotatingFileHandler
# from pathlib import Path
# # Add generated stubs
# import sys
# sys.path.append('app/generated')
# from app.generated.geyser_pb2 import SubscribeRequest, GetVersionRequest, CommitmentLevel
# from app.generated.geyser_pb2_grpc import GeyserStub

# # Disable SQLAlchemy logging
# logging.config.dictConfig({
#     'version': 1,
#     'disable_existing_loggers': False,
#     'loggers': {
#         'sqlalchemy.engine': {'level': 'ERROR', 'handlers': [], 'propagate': False},
#         'sqlalchemy.pool': {'level': 'ERROR', 'handlers': [], 'propagate': False},
#         'sqlalchemy.dialects': {'level': 'ERROR', 'handlers': [], 'propagate': False},
#     }
# })

# # Load environment variables
# load_dotenv()

# # === CREATE LOGS DIRECTORY ===
# LOG_DIR = Path("logs")
# LOG_DIR.mkdir(exist_ok=True)
# LOG_FILE = LOG_DIR / "app.log"

# # === CONFIGURE ROOT LOGGER (captures EVERYTHING) ===
# logger = logging.getLogger()
# logger.setLevel(logging.INFO)  # Change to DEBUG if you want everything

# # Avoid duplicate handlers if reloaded
# if logger.handlers:
#     logger.handlers.clear()

# # === 1. CONSOLE HANDLER (you still see logs in terminal) ===
# console_handler = logging.StreamHandler()
# console_handler.setLevel(logging.INFO)
# console_formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
# console_handler.setFormatter(console_formatter)

# # === 2. FILE HANDLER WITH DAILY ROTATION + KEEP 30 DAYS ===
# file_handler = TimedRotatingFileHandler(
#     filename=LOG_FILE,
#     when="midnight",        # New file every day
#     interval=1,
#     backupCount=30,         # Keep last 30 days
#     encoding="utf-8"
# )
# file_handler.setLevel(logging.INFO)  # or DEBUG
# file_formatter = logging.Formatter(
#     '%(asctime)s - %(name)s - %(funcName)s:%(lineno)d - %(levelname)s - %(message)s'
# )
# file_handler.setFormatter(file_formatter)

# # === ADD BOTH HANDLERS ===
# logger.addHandler(console_handler)
# logger.addHandler(file_handler)

# # === OPTIONAL: Also log ALL uncaught exceptions ===
# def handle_exception(exc_type, exc_value, exc_traceback):
#     if issubclass(exc_type, KeyboardInterrupt):
#         sys.__excepthook__(exc_type, exc_value, exc_traceback)
#         return
#     logger.critical("Uncaught exception", exc_info=(exc_type, exc_value, exc_traceback))

# import sys
# sys.excepthook = handle_exception

# # Redis client
# redis_client = redis.Redis(host=os.getenv("REDIS_HOST", "localhost"), port=6379, db=0)

# # FastAPI app
# app = FastAPI(
#     title="FlashSniper API",
#     description="A powerful Solana sniping bot with AI analysis and rug pull protection.",
#     version="0.2.0",
# )

# if settings.ENVIRONMENT == "development":
#     allowed_origins = ["*"]
# else:
#     allowed_origins = [
#         # Production
#         "https://flashsnipper.com",
#         "https://www.flashsnipper.com",
#         "https://flashsnipper.vercel.app",

#         # Local development
#         "http://localhost:4028",
#         "http://127.0.0.1:4028",

#         # Optional: extra local ports you use
#         "http://localhost:3000",
#         "http://localhost:8000",
#         "http://localhost:5173",   # Vite default
#     ]

# # CORS middleware
# app.add_middleware(
#     CORSMiddleware,
#     allow_origins=allowed_origins,  
#     allow_credentials=True,
#     allow_methods=["*"],
#     allow_headers=["*"],
#     max_age=600
# )

# # Import routers AFTER app creation to avoid circular imports
# from app.routers import auth, token, trade, user, util

# # Include routers
# app.include_router(auth.router)
# app.include_router(token.router)
# app.include_router(trade.router)
# app.include_router(user.router)
# app.include_router(util.router)



# # Persistent bot storage (Redis)
# async def save_bot_state(wallet_address: str, is_running: bool, settings: dict = None):
#     """Save bot state to Redis for persistence"""
#     state = {
#         "is_running": is_running,
#         "last_heartbeat": datetime.utcnow().isoformat(),
#         "settings": settings or {}
#     }
#     await redis_client.setex(f"bot_state:{wallet_address}", 86400, json.dumps(state))  # 24h TTL

# async def load_bot_state(wallet_address: str) -> Optional[dict]:
#     """Load bot state from Redis"""
#     state_data = await redis_client.get(f"bot_state:{wallet_address}")
#     if state_data:
#         return json.loads(state_data)
#     return None

# async def start_persistent_bot_for_user(wallet_address: str):
#     """Start a persistent bot that survives browser closures"""
#     if wallet_address in active_bot_tasks and not active_bot_tasks[wallet_address].done():
#         logger.info(f"Bot already running for {wallet_address}")
#         return
    
#     async def persistent_bot_loop():
#         logger.info(f"Starting persistent bot for {wallet_address}")
        
#         while True:
#             try:
#                 # Check if bot should still be running
#                 state = await load_bot_state(wallet_address)
#                 if not state or not state.get("is_running", False):
#                     logger.info(f"Bot stopped via state for {wallet_address}")
#                     break
                
#                 # Get fresh user data each iteration
#                 async with AsyncSessionLocal() as db:
#                     user_result = await db.execute(
#                         select(User).where(User.wallet_address == wallet_address)
#                     )
#                     user = user_result.scalar_one_or_none()
                    
#                     if not user:
#                         logger.error(f"User {wallet_address} not found - stopping bot")
#                         await save_bot_state(wallet_address, False)
#                         break
                    
#                     # Check balance - FIXED: Define sol_balance here
#                     sol_balance = 0.0
#                     try:
#                         async with AsyncClient(settings.SOLANA_RPC_URL) as client:
#                             balance_response = await client.get_balance(Pubkey.from_string(wallet_address))
#                             sol_balance = balance_response.value / 1_000_000_000
                            
#                             if sol_balance < 0.1:  # Reduced minimum to 0.1 SOL
#                                 logger.info(f"Insufficient balance for {wallet_address}: {sol_balance} SOL")
#                                 # Send alert via WebSocket if connected
#                                 await websocket_manager.send_personal_message(json.dumps({
#                                     "type": "log",
#                                     "log_type": "warning",
#                                     "message": f"Low balance: {sol_balance:.4f} SOL. Bot paused.",
#                                     "timestamp": datetime.utcnow().isoformat()
#                                 }), wallet_address)
#                                 await asyncio.sleep(60)  # Check less frequently when low balance
#                                 continue
#                     except Exception as e:
#                         logger.error(f"Balance check failed for {wallet_address}: {e}")
#                         await asyncio.sleep(30)
#                         continue
                    
#                     # Process new tokens for this user
#                     await process_user_specific_tokens(user, db)  # Use await instead of create_task
                
#                 # Heartbeat - update every cycle (FIXED: sol_balance is now defined)
#                 await save_bot_state(wallet_address, True, {
#                     "last_cycle": datetime.utcnow().isoformat(),
#                     "balance": sol_balance
#                 })
                
#                 # Use user's check interval or default
#                 check_interval = user.bot_check_interval_seconds if user and user.bot_check_interval_seconds else 10
#                 await asyncio.sleep(check_interval)
                
#             except asyncio.CancelledError:
#                 logger.info(f"Persistent bot cancelled for {wallet_address}")
#                 break
#             except Exception as e:
#                 logger.error(f"Error in persistent bot for {wallet_address}: {e}")
#                 await asyncio.sleep(30)
        
#         # Cleanup
#         if wallet_address in active_bot_tasks:
#             del active_bot_tasks[wallet_address]
#         await save_bot_state(wallet_address, False)
#         logger.info(f"Persistent bot stopped for {wallet_address}")
        
#     task = asyncio.create_task(persistent_bot_loop())
#     active_bot_tasks[wallet_address] = task
#     await save_bot_state(wallet_address, True)
    
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

# # ===================================================================
# # LIFESPAN — Start all core services
# # ===================================================================
# @asynccontextmanager
# async def lifespan(app: FastAPI):
#     try:
#         async with database.async_engine.begin() as conn:
#             await conn.run_sync(models.Base.metadata.create_all)

#         # Core detection loops
#         asyncio.create_task(safe_hybrid_grpc_loop())           # ← PUMPFUN + RAYDIUM
#         asyncio.create_task(safe_metadata_enrichment_loop())
#         asyncio.create_task(restore_persistent_bots())
#         asyncio.create_task(check_and_restart_stale_monitors())

#         logger.info("🚀 FlashSniper STARTED | Detecting Pump.fun + Raydium tokens in <2s")
#         yield
#     except Exception as e:
#         logger.error(f"Startup failed: {e}")
#         raise
#     finally:
#         for task in active_bot_tasks.values():
#             task.cancel()
#         await asyncio.gather(*active_bot_tasks.values(), return_exceptions=True)
#         await redis_client.close()
#         await database.async_engine.dispose()

# app.router.lifespan_context = lifespan
# active_bot_tasks: Dict[str, asyncio.Task] = {}


# # ===================================================================
# # 2a. HYBRID gRPC LOOP — Pump.fun + Raydium (95%+ coverage)
# # ===================================================================
# def create_grpc_channel(endpoint: str, token: str) -> grpc.aio.Channel:
#     endpoint = endpoint.replace('http://', '').replace('https://', '')
#     logger.info(f"Creating gRPC channel to {endpoint} with token: {token[:8]}...")
#     auth_creds = grpc.metadata_call_credentials(
#         lambda context, callback: callback((("x-token", token),), None)
#     )
#     ssl_creds = grpc.ssl_channel_credentials()
#     options = (
#         ('grpc.ssl_target_name_override', endpoint.split(':')[0]),
#         ('grpc.default_authority', endpoint.split(':')[0]),
#         ('grpc.keepalive_time_ms', 10000),
#         ('grpc.keepalive_timeout_ms', 5000),
#         ('grpc.keepalive_permit_without_calls', 1),
#     )
#     combined_creds = grpc.composite_channel_credentials(ssl_creds, auth_creds)
#     channel = grpc.aio.secure_channel(endpoint, combined_creds, options=options)
#     logger.info(f"gRPC channel created: {endpoint}")
#     return channel

# async def safe_hybrid_grpc_loop():
#     while True:
#         try:
#             await hybrid_grpc_subscription_loop()
#         except Exception as e:
#             logger.error(f"Hybrid gRPC loop crashed: {e}")
#             await asyncio.sleep(10)

# # Main hybrid listener
# async def hybrid_grpc_subscription_loop():
#     PUMPFUN_PROGRAM = settings.PUMPFUN_PROGRAM
#     RAYDIUM_PROGRAM = settings.RAYDIUM_PROGRAM
#     RAYDIUM_FEE_ACCOUNT = settings.RAYDIUM_FEE_ACCOUNT

#     grpc_url = settings.GRPC_URL
#     grpc_token = settings.GRPC_TOKEN

#     while True:
#         channel = None
#         try:
#             logger.info(f"Starting HYBRID gRPC (Pump.fun + Raydium) → {grpc_url}")
#             channel = create_grpc_channel(grpc_url, grpc_token)
#             stub = GeyserStub(channel)

#             subscribe_request = SubscribeRequest(
#                 accounts={
#                     "pumpfun_complete": {
#                         "owner": [PUMPFUN_PROGRAM],
#                         "filters": [
#                             {
#                                 "memcmp": {
#                                     "offset": 1,
#                                     "bytes": bytes([1])  # ← FIXED: Raw bytes for 0x01 (complete=True)
#                                 }
#                             }
#                         ],
#                     }
#                 },
#                 transactions={
#                     "raydium_pools": {
#                         "vote": False,
#                         "failed": False,
#                         "account_include": [RAYDIUM_PROGRAM, RAYDIUM_FEE_ACCOUNT],
#                     }
#                 },
#                 commitment=CommitmentLevel.PROCESSED,
#             )

#             async for response in stub.Subscribe(iter([subscribe_request])):
#                 # FIXED: Check for account updates (field is 'account', not 'update_account')
#                 if hasattr(response, 'account') and response.account:
#                     await handle_pumpfun_completion(response.account)

#                 # FIXED: Check for transaction updates (field is 'transaction')
#                 if hasattr(response, 'transaction') and response.transaction:
#                     await handle_raydium_transaction(response.transaction)

#         except grpc.aio.AioRpcError as e:
#             logger.error(f"gRPC error: {e.code()} → {e.details()}")
#             await asyncio.sleep(10)
#         except Exception as e:
#             logger.error(f"Hybrid loop error: {e}")
#             await asyncio.sleep(10)
#         finally:
#             if channel:
#                 await channel.close()
#             await asyncio.sleep(5)
       
# async def handle_pumpfun_completion(update):
#     try:
#         account = update.account
#         if not account or not account.data or len(account.data) < 33:
#             return

#         # Mint is at offset 0 (32 bytes)
#         mint_bytes = account.data[:32]
#         mint = base58.b58encode(mint_bytes).decode()
#         if len(mint) != 44:
#             return

#         logger.info(f"PUMPFUN → RAYDIUM MIGRATION | {mint[:8]}...")

#         async with AsyncSessionLocal() as db:
#             # Dedupe
#             exists = await db.execute(select(NewTokens).where(NewTokens.mint_address == mint))
#             if exists.scalar_one_or_none():
#                 return

#             new_token = NewTokens(
#                 mint_address=mint,
#                 pool_id=base58.b58encode(account.pubkey).decode(),
#                 timestamp=datetime.utcnow(),
#                 signature="pumpfun_complete",
#                 tx_type="pumpfun_migration",
#                 metadata_status="pending",
#                 next_reprocess_time=datetime.utcnow() + timedelta(seconds=3),  # FAST
#                 dexscreener_processed=False,
#             )
#             db.add(new_token)
#             await db.commit()

#             # Immediate analysis
#             asyncio.create_task(safe_enrich_token(mint, db))

#             # Alert frontend
#             alert = {
#                 "type": "new_token",
#                 "source": "pumpfun",
#                 "mint": mint,
#                 "message": "Pump.fun token just completed bonding curve!"
#             }
#             for wallet in websocket_manager.active_connections.keys():
#                 await websocket_manager.send_personal_message(json.dumps(alert), wallet)

#     except Exception as e:
#         logger.error(f"Pump.fun handler error: {e}")

# async def handle_raydium_transaction(tx_info):
#     try:
#         # 1. Get signature
#         if not tx_info.transaction or not tx_info.transaction.signature:
#             return
#         signature = base58.b58encode(tx_info.transaction.signature).decode()

#         # 2. Get slot (top-level in new format)
#         slot = getattr(tx_info, "slot", 0)

#         # 3. Critical: Correct path to parsed message
#         if not hasattr(tx_info.transaction, "transaction"):
#             return
#         parsed_tx = tx_info.transaction.transaction
#         if not hasattr(parsed_tx, "message"):
#             return
#         message = parsed_tx.message
#         if not hasattr(message, "account_keys"):
#             return

#         accounts = [base58.b58encode(key).decode() for key in message.account_keys]

#         # 4. Raydium program check
#         if settings.RAYDIUM_PROGRAM not in accounts:
#             return

#         # 5. Extract pool creations
#         pool_infos = await find_raydium_pool_creations(tx_info, accounts, signature, slot)
#         if pool_infos:
#             logger.info(f"Raydium pool detected → {len(pool_infos)} pool(s) | Tx: {signature}")
#             await process_pool_creations(pool_infos)

#     except Exception as e:
#         logger.error(f"Raydium tx handler error: {e}", exc_info=True)      

# async def find_raydium_pool_creations(tx_info, accounts, signature, slot):
#     """Extract Raydium pool creation information from transaction"""
#     program_id = settings.RAYDIUM_PROGRAM
#     pool_infos = []
    
#     try:
#         # Check if Raydium program is in the accounts
#         if program_id not in accounts:
#             return pool_infos

#         # Get instructions from the transaction
#         instructions = []
#         main_instructions = []
        
#         # Main instructions
#         if (hasattr(tx_info, 'transaction') and tx_info.transaction and
#             hasattr(tx_info.transaction, 'transaction') and tx_info.transaction.transaction and
#             hasattr(tx_info.transaction.transaction, 'message') and tx_info.transaction.transaction.message and
#             hasattr(tx_info.transaction.transaction.message, 'instructions')):
            
#             main_instructions = tx_info.transaction.transaction.message.instructions
#             instructions.extend(main_instructions)

#         # Inner instructions from meta
#         if (hasattr(tx_info, 'transaction') and tx_info.transaction and
#             hasattr(tx_info.transaction, 'meta') and tx_info.transaction.meta and
#             hasattr(tx_info.transaction.meta, 'inner_instructions')):
            
#             for inner_instr in tx_info.transaction.meta.inner_instructions:
#                 if hasattr(inner_instr, 'instructions'):
#                     inner_instructions = inner_instr.instructions
#                     instructions.extend(inner_instructions)

#         pool_creation_count = 0
        
#         # Define Raydium instruction opcodes
#         raydium_opcodes = {
#             1: "Initialize2 (Pool Creation)",
#             2: "Initialize (Legacy Pool Creation)",
#             # ... other opcodes
#         }
        
#         for i, instruction in enumerate(instructions):
#             try:
#                 # Check program ID index bounds
#                 if instruction.program_id_index >= len(accounts):
#                     continue
                    
#                 instruction_program = accounts[instruction.program_id_index]
                
#                 if instruction_program != program_id:
#                     continue
                
#                 # Check if this is initialize2 (pool creation) - opcode 1
#                 if (hasattr(instruction, 'data') and instruction.data and 
#                     len(instruction.data) > 0):
                    
#                     opcode = instruction.data[0]
                    
#                     if opcode == 1:  # Pool creation
#                         pool_creation_count += 1
                        
#                         # Validate account indices
#                         if len(instruction.accounts) < 17:
#                             continue
                            
#                         pool_id = accounts[instruction.accounts[4]]
                        
#                         # Create pool info
#                         pool_info = {
#                             "updateTime": datetime.utcnow().timestamp(),
#                             "slot": slot,
#                             "txid": signature,
#                             "poolInfos": [{
#                                 "id": pool_id,
#                                 "baseMint": accounts[instruction.accounts[8]],
#                                 "quoteMint": accounts[instruction.accounts[9]],
#                                 "lpMint": accounts[instruction.accounts[7]],
#                                 "version": 4,
#                                 "programId": program_id,
#                                 "authority": accounts[instruction.accounts[5]],
#                                 "openOrders": accounts[instruction.accounts[6]],
#                                 "targetOrders": accounts[instruction.accounts[12]],
#                                 "baseVault": accounts[instruction.accounts[10]],
#                                 "quoteVault": accounts[instruction.accounts[11]],
#                                 "marketId": accounts[instruction.accounts[16]],
#                             }]
#                         }
#                         pool_infos.append(pool_info)
                    
#             except Exception as e:
#                 # Only log actual errors, not routine processing issues
#                 continue
        
#         # Only log if we actually found pools
#         if pool_creation_count > 0:
#             logger.info(f"Found {pool_creation_count} pool creation instruction(s) in transaction {signature}")
                
#     except Exception as e:
#         logger.error(f"Error finding Raydium pools: {e}")
#         traceback.print_exc()
        
#     return pool_infos

# # Updated process_pool_creations with Pump.fun fast-track
# async def process_pool_creations(pool_infos):
#     async with AsyncSessionLocal() as db_session:
#         try:
#             saved = 0
#             for pool in pool_infos:
#                 data = pool["poolInfos"][0]
#                 pool_id = data["id"]
#                 mint = data["baseMint"]

#                 # Dedupe
#                 if await db_session.get(NewTokens, pool_id):
#                     continue
#                 if (await db_session.execute(select(NewTokens).where(NewTokens.mint_address == mint))).scalar_one_or_none():
#                     continue

#                 delay_seconds = 28
#                 tx_type = "raydium_pool_create"
#                 source = "Raydium"

#                 # Detect if this came from Pump.fun migration (already in DB)
#                 existing = (await db_session.execute(select(NewTokens).where(NewTokens.mint_address == mint))).scalar_one_or_none()
#                 if existing and existing.tx_type == "pumpfun_migration":
#                     delay_seconds = 3
#                     tx_type = "pumpfun_migration_finalized"
#                     source = "Pump.fun → Raydium"

#                 new_token = NewTokens(
#                     pool_id=pool_id,
#                     mint_address=mint,
#                     timestamp=datetime.utcnow(),
#                     signature=pool["txid"],
#                     tx_type=tx_type,
#                     metadata_status="pending",
#                     next_reprocess_time=datetime.utcnow() + timedelta(seconds=delay_seconds),
#                     dexscreener_processed=False,
#                 )
#                 db_session.add(new_token)
#                 saved += 1

#             if saved > 0:
#                 await db_session.commit()
#                 logger.info(f"Saved {saved} new pool(s) | Fast-track Pump.fun tokens in 3s")

#                 for wallet in websocket_manager.active_connections.keys():
#                     for pool in pool_infos:
#                         await websocket_manager.send_personal_message(json.dumps({
#                             "type": "new_pool",
#                             "pool": pool["poolInfos"][0],
#                             "status": "indexing_soon",
#                             "source": source
#                         }), wallet)
#         except Exception as e:
#             logger.error(f"process_pool_creations error: {e}", exc_info=True)
#             await db_session.rollback()
            
# async def track_raydium_transaction_types(signature, accounts, instructions):
#     """Track and log the types of Raydium transactions we're seeing"""
#     program_id = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"
    
#     if program_id not in accounts:
#         return
    
#     raydium_instructions = []
#     for instruction in instructions:
#         try:
#             if (hasattr(instruction, 'program_id_index') and 
#                 instruction.program_id_index < len(accounts) and
#                 accounts[instruction.program_id_index] == program_id and
#                 hasattr(instruction, 'data') and instruction.data and len(instruction.data) > 0):
                
#                 opcode = instruction.data[0]
#                 raydium_instructions.append(opcode)
#         except:
#             continue
    
#     if raydium_instructions:
#         logger.info(f"Raydium transaction {signature} has opcodes: {raydium_instructions}")

# def analyze_transaction_type(accounts):
#     """Quick analysis of transaction type based on accounts"""
#     common_programs = {
#         "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA": "Token Program",
#         "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL": "Associated Token Program",
#         "11111111111111111111111111111111": "System Program",
#         "ComputeBudget111111111111111111111111111111": "Compute Budget Program",
#         "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8": "Raydium AMM V4",
#         "srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX": "OpenBook DEX",
#     }
    
#     found_programs = []
#     for account in accounts:
#         if account in common_programs:
#             found_programs.append(common_programs[account])
    
#     return found_programs  

                       
# # ===================================================================
# # 3. OTHER UTIL FUNCTIONS
# # ===================================================================
# async def broadcast_trade(trade: Trade):
#     message = {
#         "type": "trade_update",
#         "trade": {
#             "id": trade.id,
#             "trade_type": trade.trade_type,
#             "amount_sol": trade.amount_sol or 0,
#             "token_symbol": trade.token_symbol or "Unknown",
#             "timestamp": trade.created_at.isoformat() if trade.created_at else None,
#         }
#     }
#     await websocket_manager.send_personal_message(json.dumps(message), trade.user_wallet_address)
        
# async def run_user_specific_bot_loop(user_wallet_address: str):
#     logger.info(f"Starting bot loop for {user_wallet_address}")
#     try:
#         async with AsyncSessionLocal() as db:
#             user_result = await db.execute(select(User).filter(User.wallet_address == user_wallet_address))
#             user = user_result.scalar_one_or_none()
#             if not user:
#                 logger.error(f"User {user_wallet_address} not found.")
#                 await websocket_manager.send_personal_message(
#                     json.dumps({"type": "log", "message": "User not found. Stopping bot.", "status": "error"}),
#                     user_wallet_address
#                 )
#                 return
#             while True:
#                 recent_time_threshold = datetime.utcnow() - timedelta(minutes=30)
#                 stmt = select(TokenMetadata).filter(TokenMetadata.last_checked_at >= recent_time_threshold).order_by(TokenMetadata.last_checked_at.desc()).limit(10)
#                 result = await db.execute(stmt)
#                 tokens = result.scalars().all()
#                 tasks = [
#                     apply_user_filters_and_trade(user, token, db, websocket_manager)
#                     for token in tokens
#                     if (not await redis_client.exists(f"trade:{user_wallet_address}:{token.mint_address}") and
#                         token.trading_recommendation in ["MOONBAG_BUY", "STRONG_BUY", "BUY"] and
#                         token.profitability_confidence >= 70)
#                 ]
#                 await asyncio.gather(*tasks)
#                 await asyncio.sleep(user.bot_check_interval_seconds or 10)
#     except asyncio.CancelledError:
#         logger.info(f"Bot task for {user_wallet_address} cancelled.")
#     except Exception as e:
#         logger.error(f"Error in bot loop for {user_wallet_address}: {e}")
#         await websocket_manager.send_personal_message(
#             json.dumps({"type": "log", "message": f"Bot error: {str(e)}", "status": "error"}),
#             user_wallet_address
#         )
#     finally:
#         if user_wallet_address in active_bot_tasks:
#             del active_bot_tasks[user_wallet_address]
#         logger.info(f"Bot loop for {user_wallet_address} ended.")

# async def apply_user_filters_and_trade(user: User, token: TokenMetadata, db: AsyncSession, websocket_manager: ConnectionManager):
#     # Prevent double buys - FIXED: Use async Redis
#     if await redis_client.exists(f"trade:{user.wallet_address}:{token.mint_address}"):
#         logger.info(f"Skipping {token.mint_address[:8]} for {user.wallet_address} — Already trading.")
#         return

#     # === ONLY BUY MOONBAGS OR STRONG BUYS ===
#     if token.trading_recommendation not in ["MOONBAG_BUY", "STRONG_BUY", "BUY"]:
#         logger.info(f"Skipping {token.token_symbol or token.mint_address[:8]} — Not a moonbag (got {token.trading_recommendation})")
#         return

#     if token.profitability_confidence < 70:
#         logger.info(f"Skipping {token.token_symbol or token.mint_address[:8]} — Low confidence ({token.profitability_confidence}%)")
#         return

#     logger.info(f"🚀 MOONBAG DETECTED → {token.token_symbol or token.mint_address[:8]} | Score: {token.profitability_score:.1f} | Buying NOW for {user.wallet_address}!")

#     if token.trading_recommendation in ["MOONBAG_BUY", "STRONG_BUY", "BUY"] and token.profitability_confidence >= 70:
#         # Check if already bought (active position)
#         exists = await db.execute(
#             select(Trade).where(
#                 Trade.user_wallet_address == user.wallet_address,
#                 Trade.mint_address == token.mint_address,
#                 Trade.trade_type == "buy",
#                 Trade.sell_timestamp.is_(None)  # No sell yet
#             )
#         )
#         if exists.scalar_one_or_none():
#             logger.info(f"Skipping {token.mint_address[:8]} for {user.wallet_address} — Already holding position.")
#             return  # Already holding

#         # Set lock to prevent duplicates during async execution
#         await redis_client.setex(f"trade:{user.wallet_address}:{token.mint_address}", 300, "1")  # 5min lock

#         try:
#             # Trigger the buy (this calls execute_jupiter_swap internally with 1% referral fee)
#             await execute_user_buy(user, token, db, websocket_manager)
#         except Exception as e:
#             logger.error(f"Buy execution failed for {user.wallet_address} on {token.mint_address[:8]}: {e}")
#             # Notify user via WS
#             await websocket_manager.send_personal_message(
#                 json.dumps({
#                     "type": "log",
#                     "message": f"Buy failed: {str(e)}",
#                     "status": "error",
#                     "mint": token.mint_address
#                 }),
#                 user.wallet_address
#             )
#         finally:
#             # Always clear lock
#             await redis_client.delete(f"trade:{user.wallet_address}:{token.mint_address}")
            
# async def update_bot_settings(settings: dict, wallet_address: str, db: AsyncSession):
#     try:
#         stmt = select(User).filter(User.wallet_address == wallet_address)
#         result = await db.execute(stmt)
#         user = result.scalar_one_or_none()
#         if not user:
#             raise ValueError("User not found")
#         for key, value in settings.items():
#             if key == "is_premium" and not user.is_premium:
#                 continue
#             setattr(user, key, value)
#         await db.merge(user)
#         await db.commit()
#         await websocket_manager.send_personal_message(
#             json.dumps({"type": "log", "message": "Bot settings updated", "status": "info"}),
#             wallet_address
#         )
#     except Exception as e:
#         logger.error(f"Error updating settings for {wallet_address}: {e}")
#         await websocket_manager.send_personal_message(
#             json.dumps({"type": "log", "message": f"Settings update error: {str(e)}", "status": "error"}),
#             wallet_address
#         )

# async def handle_signed_transaction(data: dict, wallet_address: str, db: AsyncSession):
#     try:
#         signed_tx_base64 = data.get("signed_tx_base64")
#         if not signed_tx_base64:
#             raise ValueError("Missing signed transaction")
#         async with AsyncClient(settings.SOLANA_RPC_URL) as client:
#             signed_tx = VersionedTransaction.from_bytes(base64.b64decode(signed_tx_base64))
#             tx_hash = await client.send_raw_transaction(signed_tx)
#             logger.info(f"Transaction sent for {wallet_address}: {tx_hash}")
#             await websocket_manager.send_personal_message(
#                 json.dumps({"type": "log", "message": f"Transaction sent: {tx_hash}", "status": "info"}),
#                 wallet_address
#             )
#     except Exception as e:
#         logger.error(f"Error handling signed transaction for {wallet_address}: {e}")
#         await websocket_manager.send_personal_message(
#             json.dumps({"type": "log", "message": f"Transaction error: {str(e)}", "status": "error"}),
#             wallet_address
#         )
 
# async def apply_user_filters(user: User, token_meta: TokenMetadata, db: AsyncSession, websocket_manager: ConnectionManager) -> bool:
#     async def log_failure(filter_name: str, details: str = ""):
#         symbol = token_meta.token_symbol or token_meta.mint_address[:8]
#         msg = f"Token {symbol} failed {filter_name} filter.{f' {details}' if details else ''}"
#         logger.info(msg)
#         await websocket_manager.send_personal_message(
#             json.dumps({
#                 "type": "log",
#                 "log_type": "warning",
#                 "message": msg,
#                 "timestamp": datetime.utcnow().isoformat()
#             }),
#             user.wallet_address
#         )

#     # ===================================================================
#     # PREMIUM-ONLY FILTERS (Free users bypass ALL of these)
#     # ===================================================================
#     if user.is_premium:
#         # 1. Socials filter
#         if user.filter_socials_added and not token_meta.socials_present:
#             await log_failure("Socials Added", "No Twitter/Telegram/Website")
#             return False

#         # 2. Liquidity burnt
#         if user.filter_liquidity_burnt and not getattr(token_meta, "liquidity_burnt", False):
#             await log_failure("Liquidity Burnt")
#             return False

#         # 3. Minimum liquidity (SOL)
#         min_liq_sol = user.filter_check_pool_size_min_sol or 0.05
#         current_liq = getattr(token_meta, "liquidity_pool_size_sol", 0) or 0
#         if current_liq < min_liq_sol:
#             await log_failure(
#                 "Insufficient Liquidity",
#                 f"{current_liq:.4f} SOL < {min_liq_sol} SOL required"
#             )
#             return False

#         # 4. Token age filter
#         if token_meta.pair_created_at:
#             age_seconds = datetime.utcnow().timestamp() - token_meta.pair_created_at
#             if age_seconds < 15:
#                 await log_failure("Token Too New", f"Only {int(age_seconds)}s old")
#                 return False
#             if age_seconds > 72 * 3600:
#                 await log_failure("Token Too Old", ">72h old")
#                 return False

#         # 5. Market cap filter
#         if token_meta.market_cap is not None and token_meta.market_cap < 30_000:
#             await log_failure("Market Cap Too Low", f"${token_meta.market_cap:,.0f}")
#             return False

#         # 6. Webacy risk
#         if token_meta.webacy_risk_score is not None and token_meta.webacy_risk_score > 50:
#             await log_failure("Webacy Risk Too High", f"Score: {token_meta.webacy_risk_score:.1f}")
#             return False

#         # 7. Premium safety delay & moon potential
#         if user.filter_safety_check_period_seconds and token_meta.pair_created_at:
#             if age_seconds < user.filter_safety_check_period_seconds:
#                 await log_failure(
#                     "Safety Check Period",
#                     f"Waiting {user.filter_safety_check_period_seconds - int(age_seconds)}s"
#                 )
#                 return False

#         if token_meta.webacy_moon_potential is not None and token_meta.webacy_moon_potential < 80:
#             await log_failure("Webacy Moon Potential Too Low", f"{token_meta.webacy_moon_potential:.1f}%")
#             return False

#     else:
#         # ===================================================================
#         # FREE USERS → ONLY BASIC TRADING SETTINGS APPLY
#         # No liquidity, no socials, no age checks → just buy!
#         # ===================================================================
#         logger.info(f"FREE USER {user.wallet_address[:8]} → Skipping all advanced filters. Buying with basic settings only.")

#     # ===================================================================
#     # ALL USERS (free + premium) → Final sanity check
#     # ===================================================================
#     if not token_meta.price_usd or token_meta.price_usd <= 0:
#         await log_failure("No Price", "Token has no valid USD price yet")
#         return False

#     # ALL FILTERS PASSED → SAFE TO BUY
#     return True

# # ===================================================================
# # LOOP 2:- METADATA ENRICHMENT LOOP 
# # ===================================================================
# async def safe_metadata_enrichment_loop():
#     while True:
#         try:
#             await metadata_enrichment_loop()
#         except Exception as e:
#             logger.error(f"Metadata loop crashed: {e}")
#             await asyncio.sleep(30)
            
# async def metadata_enrichment_loop():
#     while True:
#         async with AsyncSessionLocal() as db:
#             stmt = select(NewTokens).where(
#                 NewTokens.metadata_status == "pending",
#                 or_(
#                     NewTokens.next_reprocess_time.is_(None),
#                     NewTokens.next_reprocess_time <= datetime.utcnow()
#                 )
#             ).order_by(NewTokens.timestamp).limit(15)

#             result = await db.execute(stmt)
#             pending = result.scalars().all()

#             tasks = [safe_enrich_token(t.mint_address, db) for t in pending]
#             await asyncio.gather(*tasks, return_exceptions=True)

#         await asyncio.sleep(6)
        
# async def safe_enrich_token(mint_address: str, db: AsyncSession):
#     try:
#         await process_token_logic(mint_address, db)

#         # FIXED: Query by mint_address, not by primary key
#         new_token_result = await db.execute(
#             select(NewTokens).where(NewTokens.mint_address == mint_address)
#         )
#         token = new_token_result.scalar_one_or_none()
        
#         if token:
#             token.metadata_status = "processed"
#             token.last_metadata_update = datetime.utcnow()
#             await db.commit()
            
#         logger.info(f"Successfully enriched and marked as processed: {mint_address[:8]}")
        
#     except Exception as e:
#         logger.error(f"Failed to enrich {mint_address}: {e}", exc_info=True)
#         # Leave as pending → will retry automatically



# def safe_float(value, default=0.0) -> float:
#     try:
#         return float(value) if value not in (None, "", "null") else default
#     except:
#         return default
    
# @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=4, max=10))
# async def process_token_logic(mint_address: str, db: AsyncSession):
#     try:
#         start_time = datetime.utcnow()
#         logger.info(f"Processing and Analysing → {mint_address[:8]} for Moonbag Potential...")

#         # 1. Get the token from the database or commit it to the database if it's new
#         result = await db.execute(select(TokenMetadata).where(TokenMetadata.mint_address == mint_address))
#         token = result.scalars().first()
#         if not token:
#             token = TokenMetadata(mint_address=mint_address)
#             db.add(token)
#             await db.flush()

#         # 2. Wait for DexScreener (CRITICAL — do not proceed without Dexscreener data)
#         dex_data = await fetch_dexscreener_with_retry(mint_address)
#         if not dex_data:
#             token.trading_recommendation = "NO_DEXSCREENER"
#             token.last_checked_at = datetime.utcnow()
#             await db.merge(token)
#             await db.commit()
#             return

#         # Populate DexScreener data
#         if dex_data:
#             token.dexscreener_url = dex_data.get("dexscreener_url")
#             token.pair_address = dex_data.get("pair_address")
#             token.price_native = safe_float(dex_data.get("price_native"))
#             token.price_usd = safe_float(dex_data.get("price_usd"))
#             token.market_cap = safe_float(dex_data.get("market_cap"))
#             token.pair_created_at = dex_data.get("pair_created_at")
#             token.websites = dex_data.get("websites")
#             token.twitter = dex_data.get("twitter")
#             token.telegram = dex_data.get("telegram")
#             token.token_name = dex_data.get("token_name")
#             token.token_symbol = dex_data.get("token_symbol")
#             token.dex_id = dex_data.get("dex_id")
#             token.liquidity_usd = safe_float(dex_data.get("liquidity_usd"))
#             token.fdv = safe_float(dex_data.get("fdv"))
#             token.volume_h24 = safe_float(dex_data.get("volume_h24"))
#             token.volume_h6 = safe_float(dex_data.get("volume_h6"))
#             token.volume_h1 = safe_float(dex_data.get("volume_h1"))
#             token.volume_m5 = safe_float(dex_data.get("volume_m5"))
#             token.price_change_h1 = safe_float(dex_data.get("price_change_h1"))
#             token.price_change_m5 = safe_float(dex_data.get("price_change_m5"))
#             token.price_change_h6 = safe_float(dex_data.get("price_change_h6"))
#             token.price_change_h24 = safe_float(dex_data.get("price_change_h24"))
#             token.socials_present = bool(dex_data.get("twitter") or dex_data.get("telegram") or dex_data.get("websites"))

#         if token.price_usd and token.price_usd > 0 and token.liquidity_usd:
#             token.liquidity_pool_size_sol = token.liquidity_usd / token.price_usd
#         else:
#             token.liquidity_pool_size_sol = 0.0
            
#         # ====================================================================
#         # FETCH JUPITER TOKEN DATA (INCLUDING LOGO) AFTER DEXSCREENER
#         # ====================================================================
#         jupiter_data = None
#         jupiter_logo = None
        
#         try:
#             # Try to fetch Jupiter data with a short timeout (we don't need to wait long)
#             logger.info(f"Fetching Jupiter data for {mint_address[:8]}...")
            
#             # Use asyncio.wait_for to set a timeout
#             try:
#                 jupiter_data = await asyncio.wait_for(
#                     get_jupiter_token_data(mint_address),
#                     timeout=10.0  # 10 second timeout
#                 )
#             except asyncio.TimeoutError:
#                 logger.warning(f"Jupiter fetch timeout for {mint_address[:8]}")
#                 jupiter_data = None
            
#             if jupiter_data:
#                 # Get token logo from Jupiter
#                 if jupiter_data.get("icon"):
#                     jupiter_logo = jupiter_data["icon"]
#                     token.token_logo = jupiter_logo  # Save to database
#                     logger.info(f"Jupiter logo found and saved: {jupiter_logo[:50]}...")
                
#                 # # Update token symbol if available from Jupiter (and better than DexScreener)
#                 # if jupiter_data.get("symbol") and jupiter_data["symbol"] != "UNKNOWN":
#                 #     # Only update if current symbol is generic or missing
#                 #     if not token.token_symbol or token.token_symbol == mint_address[:8]:
#                 #         token.token_symbol = jupiter_data["symbol"]
#                 #         logger.info(f"Updated symbol from Jupiter: {jupiter_data['symbol']}")
                
#                 # # Update token name if available from Jupiter
#                 # if jupiter_data.get("name") and jupiter_data["name"] != "Unknown":
#                 #     if not token.token_name or token.token_name == "Unknown":
#                 #         token.token_name = jupiter_data["name"]
#                 #         logger.info(f"Updated name from Jupiter: {jupiter_data['name']}")
                
#                 # # Update socials if not already set from DexScreener
#                 # if jupiter_data.get("twitter") and jupiter_data["twitter"] != "N/A" and not token.twitter:
#                 #     token.twitter = jupiter_data["twitter"]
                
#                 # if jupiter_data.get("website") and jupiter_data["website"] != "N/A" and not token.websites:
#                 #     token.websites = jupiter_data["website"]
                
#                 # if jupiter_data.get("telegram") and jupiter_data["telegram"] != "N/A" and not token.telegram:
#                 #     token.telegram = jupiter_data["telegram"]
                
#                 # # Update decimals if more accurate
#                 # if jupiter_data.get("decimals") and jupiter_data["decimals"] != 0:
#                 #     token.token_decimals = jupiter_data["decimals"]
            
#             # If Jupiter fetch failed, use DexScreener fallback logo
#             elif not token.token_logo:
#                 # Use DexScreener logo as fallback
#                 token.token_logo = f"https://dd.dexscreener.com/ds-logo/solana/{mint_address}.png"
#                 logger.info(f"Using DexScreener fallback logo for {mint_address[:8]}")
                
#         except Exception as e:
#             logger.warning(f"Failed to fetch Jupiter data for {mint_address[:8]}: {e}")
#             # Use DexScreener fallback logo
#             if not token.token_logo:
#                 token.token_logo = f"https://dd.dexscreener.com/ds-logo/solana/{mint_address}.png"
        
        
#         # 3. Wait for Raydium data with proper retry logic
#         raydium_data = {}
#         webacy_data = {}
        
#         try:
#             # Start Webacy immediately (it's fast)
#             webacy_task = asyncio.create_task(check_webacy_risk(mint_address))
            
#             # Get Webacy result
#             webacy_data = await webacy_task
#             webacy_data = webacy_data if not isinstance(webacy_data, Exception) else {}
            
#         except Exception as e:
#             logger.error(f"Error in data fetch for {mint_address[:8]}: {e}")
#             webacy_data = webacy_data if not isinstance(webacy_data, Exception) else {}

#         # 5. Webacy Risk
#         if webacy_data and isinstance(webacy_data, dict):
#             token.webacy_risk_score = safe_float(webacy_data.get("risk_score"))
#             token.webacy_risk_level = webacy_data.get("risk_level")
#             token.webacy_moon_potential = webacy_data.get("moon_potential")

#         # 6. PROFITABILITY ENGINE
#         try:
#             # Prepare safe data for analysis
#             token_dict = {}
#             for key, value in token.__dict__.items():
#                 if not key.startswith('_'):
#                     # Convert datetime to string for JSON serialization
#                     if isinstance(value, datetime):
#                         token_dict[key] = value.isoformat()
#                     else:
#                         token_dict[key] = value
            
#             analysis = await profitability_engine.analyze_token(
#                 mint=mint_address,
#                 token_data=token_dict,  # Use safe dict instead of __dict__
#                 webacy_data=webacy_data or {}
#             )
            
#             token.profitability_score = analysis.final_score
#             token.profitability_confidence = analysis.confidence
#             token.trading_recommendation = analysis.recommendation
#             token.risk_score = analysis.risk_score
#             token.moon_potential = analysis.moon_potential
#             token.holder_concentration = analysis.holder_concentration
#             token.liquidity_score = analysis.liquidity_score
#             token.reasons = " | ".join(analysis.reasons[:5]) if analysis.reasons else ""

#             logger.info(f"MOONBAG → {token.token_symbol or mint_address[:8]} | {analysis.recommendation} | "
#                         f"Score: {analysis.final_score:.1f} | Conf: {analysis.confidence:.0f}%")

#             if analysis.recommendation == "MOONBAG_BUY":
#                 # Logo is already fetched and saved above, so we just it from the token object
#                 token_logo = token.token_logo or f"https://dd.dexscreener.com/ds-logo/solana/{mint_address}.png"
                
#                 alert = {
#                     "type": "moonbag_detected",
#                     "mint": mint_address,
#                     "symbol": token.token_symbol or "UNKNOWN",
#                     "name": token.token_name or "Unknown",
#                     "price_usd": token.price_usd,
#                     "fdv": token.fdv,
#                     "score": round(analysis.final_score, 1),
#                     "confidence": round(analysis.confidence),
#                     "reasons": analysis.reasons[:3] if analysis.reasons else [],
#                     "logo": token_logo,
#                     "dexscreener": token.dexscreener_url
#                 }
#                 for wallet in list(websocket_manager.active_connections.keys()):
#                     await websocket_manager.send_personal_message(json.dumps(alert), wallet)

#                 # After analysis confirms MOONBAG_BUY
#                 if analysis.recommendation == "MOONBAG_BUY":
#                     logger.info(f"MOONBAG CONFIRMED → Queuing immediate buy for all users")
                    
#                     # This will trigger the persistent bot to pick it up instantly
#                     token.last_checked_at = datetime.utcnow()  # Make it fresh
#                     await db.merge(token)
#                     await db.commit()
                    
#                     # INSTANT TRIGGER for all users with active bots
#                     async with AsyncSessionLocal() as trigger_db:
#                         users_result = await trigger_db.execute(
#                             select(User).where(User.bot_enabled == True)
#                         )
#                         for user in users_result.scalars():
#                             if user.wallet_address in active_bot_tasks:
#                                 asyncio.create_task(process_user_specific_tokens(user, trigger_db))
                    
#         except Exception as e:
#             logger.error(f"Profitability engine error for {mint_address}: {e}")
#             token.trading_recommendation = "ERROR"

#         # Final save with safe datetime handling
#         token.last_checked_at = datetime.utcnow()
#         db.add(token)
#         await db.commit()

#         # Update NewTokens
#         new_token = await db.get(NewTokens, mint_address) or (await db.execute(
#             select(NewTokens).where(NewTokens.mint_address == mint_address)
#         )).scalar_one_or_none()
#         if new_token:
#             new_token.metadata_status = "completed"
#             new_token.last_metadata_update = datetime.utcnow()
#             await db.commit()

#         # Safe caching with proper JSON serialization
#         safe_dict = {}
#         for k, v in token.__dict__.items():
#             if not k.startswith('_'):
#                 if isinstance(v, datetime):
#                     safe_dict[k] = v.isoformat()
#                 else:
#                     safe_dict[k] = v
        
#         await redis_client.setex(f"token_metadata:{mint_address}", 600, json.dumps(safe_dict))

#         total_time = (datetime.utcnow() - start_time).total_seconds()
#         logger.info(f"Analysis complete: {mint_address[:8]} in {total_time:.1f}s")

#     except Exception as e:
#         logger.error(f"CRITICAL FAILURE in process_token_logic for {mint_address}: {e}", exc_info=True)
#         await db.rollback()
     
     
              
# async def smart_cleanup_and_archive_loop():
#     while True:
#         try:
#             async with AsyncSessionLocal() as db:
#                 cutoff = datetime.utcnow() - timedelta(hours=72)

#                 # 1. Find tokens older than 72h that we still have metadata for
#                 old_tokens = await db.execute(
#                     select(TokenMetadata).where(
#                         TokenMetadata.pair_created_at < cutoff.timestamp()
#                         if TokenMetadata.pair_created_at is not None
#                         else TokenMetadata.last_checked_at < cutoff
#                     ).limit(200)
#                 )
#                 old_tokens = old_tokens.scalars().all()

#                 for token in old_tokens:
#                     # Archive full snapshot
#                     archive = TokenMetadataArchive(
#                         mint_address=token.mint_address,
#                         data=json.dumps(token.__dict__, default=str)  # safe serialization safe
#                     )
#                     db.add(archive)

#                     # Now safe to delete from hot tables
#                     await db.execute(delete(NewTokens).where(NewTokens.mint_address == token.mint_address))
#                     await db.delete(token)

#                 await db.commit()

#                 if old_tokens:
#                     logger.info(f"Archived and cleaned {len(old_tokens)} tokens >72h old")

#         except Exception as e:
#             logger.error(f"Archive/cleanup error: {e}")

#         await asyncio.sleep(1800)  # every 30 min
       
# async def start_user_bot_task(wallet_address: str):
#     """Start a user-specific bot task"""
#     if wallet_address in active_bot_tasks:
#         logger.info(f"Bot already running for {wallet_address}")
#         return
    
#     task = asyncio.create_task(run_user_specific_bot_loop(wallet_address))
#     active_bot_tasks[wallet_address] = task
#     logger.info(f"Started bot task for {wallet_address}")          
 
 
 

# async def process_user_specific_tokens(user: User, db: AsyncSession):
#     """Process recent high-scoring tokens for a specific user"""
#     try:
#         recent_time = datetime.utcnow() - timedelta(minutes=1000000)

#         result = await db.execute(
#             select(TokenMetadata)
#             .where(
#                 TokenMetadata.last_checked_at >= recent_time,
#                 TokenMetadata.trading_recommendation.in_(["MOONBAG_BUY", "STRONG_BUY", "BUY"]),
#                 TokenMetadata.profitability_confidence >= 70
#             )
#             .order_by(TokenMetadata.profitability_score.desc())
#             .limit(10)
#         )

#         tokens = result.scalars().all()

#         for token in tokens:
#             # Skip if already holding
#             existing = await db.execute(
#                 select(Trade).where(
#                     Trade.user_wallet_address == user.wallet_address,
#                     Trade.mint_address == token.mint_address,
#                     Trade.sell_timestamp.is_(None)
#                 )
#             )
#             if existing.scalar_one_or_none():
#                 continue

#             # Apply filters + buy if passes
#             if await apply_user_filters(user, token, db, websocket_manager):
#                 # Create a NEW database session for the buy operation to avoid conflicts
#                 async with AsyncSessionLocal() as buy_db_session:
#                     async with buy_db_session.begin():
#                         # Refresh the token in the new session
#                         buy_token_result = await buy_db_session.execute(
#                             select(TokenMetadata).where(TokenMetadata.mint_address == token.mint_address)
#                         )
#                         buy_token = buy_token_result.scalar_one_or_none()
                        
#                         if buy_token:
#                             buy_user_result = await buy_db_session.execute(
#                                 select(User).where(User.wallet_address == user.wallet_address)
#                             )
#                             buy_user = buy_user_result.scalar_one_or_none()
                            
#                             if buy_user:
#                                 await execute_user_buy(buy_user, buy_token, buy_db_session, websocket_manager)
#                                 await asyncio.sleep(1)  # Prevent rate limits
                            
#     except Exception as e:
#         logger.error(f"Error in process_user_specific_tokens for {user.wallet_address}: {e}")
         
              
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
        

# # ===================================================================
# # 4. ALL MAIN ENDPOINTS STARTS HERE
# # ===================================================================
# @app.get("/ping")
# async def ping():
#     logger.info("Ping received.")
#     return {"message": "pong", "status": "ok"}

# @app.get("/health")
# async def health_check():
#     try:
#         async with AsyncClient(settings.SOLANA_RPC_URL) as client:
#             await client.is_connected()
#         try:
#             channel = create_grpc_channel(
#                 os.getenv("GRPC_URL", "grpc.mainnet.solana.yellowstone.dev:10000"),
#                 os.getenv("GRPC_TOKEN", "your-grpc-token")
#             )
#             stub = GeyserStub(channel)
#             await stub.GetVersion(GetVersionRequest())
#             grpc_status = "ok"
#             await channel.close()
#         except Exception as e:
#             grpc_status = f"error: {e}"
#         return {
#             "status": "healthy",
#             "database": "ok",
#             "solana_rpc": "ok",
#             "grpc_raydium": grpc_status,
#             "message": "All essential services are operational."
#         }
#     except Exception as e:
#         logger.error(f"Health check failed: {e}")
#         return {"status": "unhealthy", "message": str(e)}

# @app.get("/debug/routes")
# async def debug():
#     return [{"path": r.path, "name": r.name} for r in app.routes]

# # @app.websocket("/ws/logs/{wallet_address}")
# # async def websocket_endpoint(websocket: WebSocket, wallet_address: str):
# #     await websocket_manager.connect(websocket, wallet_address)  # FIXED: Remove extra websocket parameter
    
# #     try:
# #         # Send current bot status
# #         state = await load_bot_state(wallet_address)
# #         is_running = state.get("is_running", False) if state else False
        
# #         await websocket.send_json({
# #             "type": "bot_status",
# #             "is_running": is_running,
# #             "message": "Bot is running persistently" if is_running else "Bot is stopped"
# #         })
        
# #         # Send recent trades
# #         async with AsyncSessionLocal() as db:
# #             result = await db.execute(
# #                 select(Trade)
# #                 .filter_by(user_wallet_address=wallet_address)
# #                 .order_by(Trade.id.desc())
# #                 .limit(50)
# #             )
# #             trades = result.scalars().all()
# #             for trade in trades:
# #                 await websocket.send_json({
# #                     "type": "trade_update",
# #                     "trade": {
# #                         "id": trade.id,
# #                         "trade_type": trade.trade_type,
# #                         "amount_sol": trade.amount_sol or 0,
# #                         "token_symbol": trade.token_symbol or "Unknown",
# #                         "timestamp": trade.buy_timestamp.isoformat() if trade.buy_timestamp else None,
# #                     }
# #                 })
        
# #         # Handle messages
# #         while True:
# #             data = await websocket.receive_text()
# #             if data:
# #                 try:
# #                     message = json.loads(data)
# #                     await handle_websocket_message(message, wallet_address, websocket)
# #                 except json.JSONDecodeError:
# #                     logger.error(f"Invalid WebSocket message from {wallet_address}")
                    
# #     except WebSocketDisconnect:
# #         logger.info(f"WebSocket disconnected for {wallet_address}")
# #     except Exception as e:
# #         logger.error(f"WebSocket error for {wallet_address}: {str(e)}")
# #     finally:
# #         websocket_manager.disconnect(wallet_address)
        
        
        
# @app.websocket("/ws/logs/{wallet_address}")
# async def websocket_endpoint(websocket: WebSocket, wallet_address: str):
#     await websocket_manager.connect(websocket, wallet_address)  # FIXED: Remove extra websocket parameter
    
#     try:
#          # Send heartbeat every 25 seconds (keep-alive)
#         heartbeat_task = asyncio.create_task(send_heartbeat(websocket, wallet_address))
        
#         # Send current bot status
#         state = await load_bot_state(wallet_address)
#         is_running = state.get("is_running", False) if state else False
        
#         await websocket.send_json({
#             "type": "bot_status",
#             "is_running": is_running,
#             "message": "Bot is running persistently" if is_running else "Bot is stopped"
#         })
        
#         # Send recent trades
#         async with AsyncSessionLocal() as db:
#             result = await db.execute(
#                 select(Trade)
#                 .filter_by(user_wallet_address=wallet_address)
#                 .order_by(Trade.id.desc())
#                 .limit(50)
#             )
#             trades = result.scalars().all()
#             for trade in trades:
#                 await websocket.send_json({
#                     "type": "trade_update",
#                     "trade": {
#                         "id": trade.id,
#                         "trade_type": trade.trade_type,
#                         "amount_sol": trade.amount_sol or 0,
#                         "token_symbol": trade.token_symbol or "Unknown",
#                         "timestamp": trade.buy_timestamp.isoformat() if trade.buy_timestamp else None,
#                     }
#                 })
        
#         # Handle messages with timeout
#         while True:
#             try:
#                 data = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
#                 if data:
#                     try:
#                         message = json.loads(data)
#                         await handle_websocket_message(message, wallet_address, websocket)
#                     except json.JSONDecodeError:
#                         logger.error(f"Invalid WebSocket message from {wallet_address}")
                        
#             except asyncio.TimeoutError:
#                 # Send ping to keep connection alive
#                 try:
#                     await websocket.send_json({"type": "ping", "timestamp": datetime.utcnow().isoformat()})
#                 except:
#                     break  # Connection lost
                      
#     except WebSocketDisconnect:
#         logger.info(f"WebSocket disconnected for {wallet_address}")
#     except Exception as e:
#         logger.error(f"WebSocket error for {wallet_address}: {str(e)}")
#     finally:
#         # Cancel heartbeat task
#         if 'heartbeat_task' in locals():
#             heartbeat_task.cancel()
#         websocket_manager.disconnect(wallet_address)
              
# async def send_heartbeat(websocket: WebSocket, wallet_address: str):
#     """Send periodic heartbeat to keep connection alive"""
#     while True:
#         try:
#             await asyncio.sleep(25)  # Send heartbeat every 25 seconds
#             await websocket.send_json({
#                 "type": "heartbeat",
#                 "timestamp": datetime.utcnow().isoformat(),
#                 "wallet": wallet_address[:8]
#             })
#         except:
#             break  # Connection lost

# async def handle_websocket_message(message: dict, wallet_address: str, websocket: WebSocket):
#     """Handle different types of WebSocket messages"""
#     msg_type = message.get("type")
    
#     if msg_type == "start_bot":
#         await start_persistent_bot_for_user(wallet_address)
#         await websocket.send_json({
#             "type": "bot_status", 
#             "is_running": True,
#             "message": "Bot started successfully"
#         })
        
#     elif msg_type == "stop_bot":
#         await save_bot_state(wallet_address, False)
#         await websocket.send_json({
#             "type": "bot_status",
#             "is_running": False, 
#             "message": "Bot stopped successfully"
#         })
        
#     elif msg_type == "health_response":
#         logger.debug(f"Health response from {wallet_address}")
        
#     elif msg_type == "settings_update":
#         async with AsyncSessionLocal() as db:
#             await update_bot_settings(message.get("settings", {}), wallet_address, db)
            
# @app.post("/user/update-rpc")
# async def update_user_rpc(
#     rpc_data: dict,
#     current_user: User = Depends(get_current_user_by_wallet),
#     db: AsyncSession = Depends(get_db)
# ):
#     if not current_user.is_premium:
#         raise HTTPException(status_code=403, detail="Custom RPC is available only for premium users.")
#     https_url = rpc_data.get("https")
#     wss_url = rpc_data.get("wss")
#     if https_url and not https_url.startswith("https://"):
#         raise HTTPException(status_code=400, detail="Invalid HTTPS RPC URL")
#     if wss_url and not wss_url.startswith("wss://"):
#         raise HTTPException(status_code=400, detail="Invalid WSS RPC URL")
#     current_user.custom_rpc_https = https_url
#     current_user.custom_rpc_wss = wss_url
#     await db.merge(current_user)
#     await db.commit()
#     return {"status": "Custom RPC settings updated."}

# @app.get("/wallet/balance/{wallet_address}")
# async def get_wallet_balance(wallet_address: str):
#     try:
#         async with AsyncClient(settings.SOLANA_RPC_URL) as client:
#             pubkey = Pubkey.from_string(wallet_address)
#             balance_response = await client.get_balance(pubkey)
#             lamports = balance_response.value
#             sol_balance = lamports / 1_000_000_000
#             return {"wallet_address": wallet_address, "sol_balance": sol_balance}
#     except Exception as e:
#         logger.error(f"Error fetching balance for {wallet_address}: {e}")
#         raise HTTPException(status_code=500, detail=f"Error fetching balance: {str(e)}")

# @app.post("/trade/log-trade")
# async def log_trade(
#     trade_data: LogTradeRequest,
#     current_user: User = Depends(get_current_user_by_wallet),
#     db: AsyncSession = Depends(get_db)
# ):
#     fee_percentage = 0.01
#     fee_sol = trade_data.amount_sol * fee_percentage if trade_data.amount_sol else 0
#     amount_after_fee = trade_data.amount_sol - fee_sol if trade_data.amount_sol else 0
#     trade = Trade(
#         user_wallet_address=current_user.wallet_address,
#         mint_address=trade_data.mint_address,
#         token_symbol=trade_data.token_symbol,
#         trade_type=trade_data.trade_type,
#         amount_sol=amount_after_fee,
#         amount_tokens=trade_data.amount_tokens,
#         price_sol_per_token=trade_data.price_sol_per_token,
#         price_usd_at_trade=trade_data.price_usd_at_trade,
#         buy_tx_hash=trade_data.tx_hash if trade_data.trade_type == "buy" else None,
#         sell_tx_hash=trade_data.tx_hash if trade_data.trade_type == "sell" else None,
#         profit_usd=trade_data.profit_usd,
#         profit_sol=trade_data.profit_sol,
#         log_message=trade_data.log_message,
#         buy_price=trade_data.buy_price,
#         entry_price=trade_data.entry_price,
#         stop_loss=trade_data.stop_loss,
#         take_profit=trade_data.take_profit,
#         token_amounts_purchased=trade_data.token_amounts_purchased,
#         token_decimals=trade_data.token_decimals,
#         sell_reason=trade_data.sell_reason,
#         swap_provider=trade_data.swap_provider,
#         buy_timestamp=datetime.utcnow() if trade_data.trade_type == "buy" else None,
#         sell_timestamp=datetime.utcnow() if trade_data.trade_type == "sell" else None,
#     )
#     db.add(trade)
#     await db.commit()
#     await websocket_manager.send_personal_message(
#         json.dumps({"type": "log", "message": f"Applied 1% fee ({fee_sol:.6f} SOL) on {trade_data.trade_type} trade.", "status": "info"}),
#         current_user.wallet_address
#     )
#     return {"status": "Trade logged successfully."}

# @app.get("/trade/history")
# async def get_trade_history(current_user: User = Depends(get_current_user_by_wallet), db: AsyncSession = Depends(get_db)):
#     trades = await db.execute(
#         select(Trade)
#         .filter(Trade.user_wallet_address == current_user.wallet_address)
#         .order_by(Trade.buy_timestamp.desc())
#     )
#     trades = trades.scalars().all()

#     result = []
#     for trade in trades:
#         # Determine which URLs to show based on trade type
#         if trade.trade_type == "buy":
#             solscan_url = trade.solscan_buy_url or (f"https://solscan.io/tx/{trade.buy_tx_hash}" if trade.buy_tx_hash else None)
#         else:
#             solscan_url = trade.solscan_sell_url or (f"https://solscan.io/tx/{trade.sell_tx_hash}" if trade.sell_tx_hash else None)
        
#         # Prepare explorer URLs object
#         explorer_urls = None
#         if solscan_url or trade.dexscreener_url or trade.jupiter_url:
#             explorer_urls = {
#                 "solscan": solscan_url,
#                 "dexScreener": trade.dexscreener_url,
#                 "jupiter": trade.jupiter_url
#             }
        
#         # Get token info
#         token_symbol = trade.token_symbol
#         token_logo = None
        
#         if trade.mint_address:
#             meta = await db.get(TokenMetadata, trade.mint_address)
#             if meta:
#                 token_symbol = meta.token_symbol or token_symbol
#                 token_logo = meta.token_logo
        
#         # Default logo if none found
#         if not token_logo and trade.mint_address:
#             token_logo = f"https://dd.dexscreener.com/ds-logo/solana/{trade.mint_address}.png"
        
#         trade_data = {
#             "id": trade.id,
#             "type": trade.trade_type,
#             "trade_type": trade.trade_type,
#             "amount_sol": trade.amount_sol,
#             "amount_tokens": trade.amount_tokens,
#             "token_symbol": token_symbol,
#             "token": token_symbol,  # For compatibility
#             "token_logo": token_logo,
#             "timestamp": trade.buy_timestamp.isoformat() if trade.buy_timestamp else trade.sell_timestamp.isoformat(),
#             "buy_timestamp": trade.buy_timestamp.isoformat() if trade.buy_timestamp else None,
#             "sell_timestamp": trade.sell_timestamp.isoformat() if trade.sell_timestamp else None,
#             "profit_sol": trade.profit_sol,
#             "mint_address": trade.mint_address,
#             "tx_hash": trade.buy_tx_hash if trade.trade_type == "buy" else trade.sell_tx_hash,
#             "buy_tx_hash": trade.buy_tx_hash,
#             "sell_tx_hash": trade.sell_tx_hash,
#             "explorer_urls": explorer_urls
#         }
        
#         result.append(trade_data)

#     return result

# @app.post("/subscribe/premium")
# async def subscribe_premium(
#     subscription_data: SubscriptionRequest,
#     current_user: User = Depends(get_current_user_by_wallet),
#     db: AsyncSession = Depends(get_db)
# ):
#     try:
#         import stripe
#         stripe.api_key = settings.STRIPE_SECRET_KEY
#         subscription = stripe.Subscription.create(
#             customer={"email": subscription_data.email},
#             items=[{"price": settings.STRIPE_PREMIUM_PRICE_ID}],
#             payment_behavior="default_incomplete",
#             expand=["latest_invoice.payment_intent"]
#         )
#         sub = Subscription(
#             user_wallet_address=current_user.wallet_address,
#             plan_name="Premium",
#             payment_provider_id=subscription.id,
#             start_date=datetime.utcnow(),
#             end_date=datetime.utcnow() + timedelta(days=30)
#         )
#         current_user.is_premium = True
#         current_user.premium_start_date = datetime.utcnow()
#         current_user.premium_end_date = datetime.utcnow() + timedelta(days=30)
#         db.add(sub)
#         await db.merge(current_user)
#         await db.commit()
#         return {"status": "Subscription activated", "payment_intent": subscription.latest_invoice.payment_intent}
#     except Exception as e:
#         logger.error(f"Subscription failed: {e}")
#         raise HTTPException(status_code=400, detail=f"Subscription failed: {str(e)}")

  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
import logging
import os
from fastapi import FastAPI, HTTPException, Depends, WebSocket, WebSocketDisconnect, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
import json
import asyncio
import traceback
from typing import Dict, Optional
from datetime import datetime, timedelta
import grpc
import base58
import base64
from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from dotenv import load_dotenv
import aiohttp
from tenacity import retry, stop_after_attempt, wait_exponential
from solders.pubkey import Pubkey
from solders.keypair import Keypair
from solders.transaction import VersionedTransaction
from solana.rpc.async_api import AsyncClient
from app.dependencies import get_current_user_by_wallet
from app.models import Subscription, TokenMetadataArchive, Trade, User, TokenMetadata, NewTokens
from app.database import AsyncSessionLocal, get_db
from app.schemas import LogTradeRequest, SubscriptionRequest
from app.utils.jupiter_api import fetch_jupiter_with_retry, get_jupiter_token_data
from app.utils.profitability_engine import engine as profitability_engine
from app.utils.dexscreener_api import fetch_dexscreener_with_retry, get_dexscreener_data
from app.utils.webacy_api import check_webacy_risk
from app import models, database
from app.config import settings
from app.security import decrypt_private_key_backend
import redis.asyncio as redis
from app.utils.bot_components import ConnectionManager, check_and_restart_stale_monitors, execute_user_buy, websocket_manager
import logging
import os
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path
# Add generated stubs
import sys
sys.path.append('app/generated')
from app.generated.geyser_pb2 import SubscribeRequest, GetVersionRequest, CommitmentLevel
from app.generated.geyser_pb2_grpc import GeyserStub

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

# Redis client
redis_client = redis.Redis(host=os.getenv("REDIS_HOST", "localhost"), port=6379, db=0)

# FastAPI app
app = FastAPI(
    title="FlashSniper API",
    description="A powerful Solana sniping bot with AI analysis and rug pull protection.",
    version="0.2.0",
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

# Import routers AFTER app creation to avoid circular imports
from app.routers import auth, token, trade, user, util

# Include routers
app.include_router(auth.router)
app.include_router(token.router)
app.include_router(trade.router)
app.include_router(user.router)
app.include_router(util.router)



# Persistent bot storage (Redis)
async def save_bot_state(wallet_address: str, is_running: bool, settings: dict = None):
    """Save bot state to Redis for persistence"""
    state = {
        "is_running": is_running,
        "last_heartbeat": datetime.utcnow().isoformat(),
        "settings": settings or {}
    }
    await redis_client.setex(f"bot_state:{wallet_address}", 86400, json.dumps(state))  # 24h TTL

async def load_bot_state(wallet_address: str) -> Optional[dict]:
    """Load bot state from Redis"""
    state_data = await redis_client.get(f"bot_state:{wallet_address}")
    if state_data:
        return json.loads(state_data)
    return None

async def start_persistent_bot_for_user(wallet_address: str):
    """Start a persistent bot that survives browser closures"""
    if wallet_address in active_bot_tasks and not active_bot_tasks[wallet_address].done():
        logger.info(f"Bot already running for {wallet_address}")
        return
    
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
                check_interval = user.bot_check_interval_seconds if user and user.bot_check_interval_seconds else 10
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
async def restore_persistent_bots():
    """Restore all persistent bots on startup"""
    try:
        # Get all wallet addresses with active bots
        keys = await redis_client.keys("bot_state:*")
        for key in keys:
            state_data = await redis_client.get(key)
            if state_data:
                state = json.loads(state_data)
                if state.get("is_running", False):
                    wallet_address = key.decode().replace("bot_state:", "")
                    # Wait a bit before starting to avoid overload
                    await asyncio.sleep(1)
                    asyncio.create_task(start_persistent_bot_for_user(wallet_address))
                    logger.info(f"Restored persistent bot for {wallet_address}")
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
        asyncio.create_task(safe_hybrid_grpc_loop())           # ← PUMPFUN + RAYDIUM
        asyncio.create_task(safe_metadata_enrichment_loop())
        asyncio.create_task(restore_persistent_bots())
        asyncio.create_task(check_and_restart_stale_monitors())

        logger.info("🚀 FlashSniper STARTED | Detecting Pump.fun + Raydium tokens in <2s")
        yield
    except Exception as e:
        logger.error(f"Startup failed: {e}")
        raise
    finally:
        for task in active_bot_tasks.values():
            task.cancel()
        await asyncio.gather(*active_bot_tasks.values(), return_exceptions=True)
        await redis_client.close()
        await database.async_engine.dispose()

app.router.lifespan_context = lifespan
active_bot_tasks: Dict[str, asyncio.Task] = {}

# ===================================================================
# 2a. HYBRID gRPC LOOP — Pump.fun + Raydium (95%+ coverage)
# ===================================================================
def create_grpc_channel(endpoint: str, token: str) -> grpc.aio.Channel:
    endpoint = endpoint.replace('http://', '').replace('https://', '')
    logger.info(f"Creating gRPC channel to {endpoint} with token: {token[:8]}...")
    auth_creds = grpc.metadata_call_credentials(
        lambda context, callback: callback((("x-token", token),), None)
    )
    ssl_creds = grpc.ssl_channel_credentials()
    options = (
        ('grpc.ssl_target_name_override', endpoint.split(':')[0]),
        ('grpc.default_authority', endpoint.split(':')[0]),
        ('grpc.keepalive_time_ms', 10000),
        ('grpc.keepalive_timeout_ms', 5000),
        ('grpc.keepalive_permit_without_calls', 1),
    )
    combined_creds = grpc.composite_channel_credentials(ssl_creds, auth_creds)
    channel = grpc.aio.secure_channel(endpoint, combined_creds, options=options)
    logger.info(f"gRPC channel created: {endpoint}")
    return channel

async def safe_hybrid_grpc_loop():
    while True:
        try:
            await hybrid_grpc_subscription_loop()
        except Exception as e:
            logger.error(f"Hybrid gRPC loop crashed: {e}")
            await asyncio.sleep(10)

# Main hybrid listener
async def hybrid_grpc_subscription_loop():
    PUMPFUN_PROGRAM = settings.PUMPFUN_PROGRAM
    RAYDIUM_PROGRAM = settings.RAYDIUM_PROGRAM
    RAYDIUM_FEE_ACCOUNT = settings.RAYDIUM_FEE_ACCOUNT

    grpc_url = settings.GRPC_URL
    grpc_token = settings.GRPC_TOKEN

    while True:
        channel = None
        try:
            logger.info(f"Starting HYBRID gRPC (Pump.fun + Raydium) → {grpc_url}")
            channel = create_grpc_channel(grpc_url, grpc_token)
            stub = GeyserStub(channel)

            subscribe_request = SubscribeRequest(
                accounts={
                    "pumpfun_complete": {
                        "owner": [PUMPFUN_PROGRAM],
                        "filters": [
                            {
                                "memcmp": {
                                    "offset": 1,
                                    "bytes": bytes([1])  # ← FIXED: Raw bytes for 0x01 (complete=True)
                                }
                            }
                        ],
                    }
                },
                transactions={
                    "raydium_pools": {
                        "vote": False,
                        "failed": False,
                        "account_include": [RAYDIUM_PROGRAM, RAYDIUM_FEE_ACCOUNT],
                    }
                },
                commitment=CommitmentLevel.PROCESSED,
            )

            async for response in stub.Subscribe(iter([subscribe_request])):
                # FIXED: Check for account updates (field is 'account', not 'update_account')
                if hasattr(response, 'account') and response.account:
                    await handle_pumpfun_completion(response.account)

                # FIXED: Check for transaction updates (field is 'transaction')
                if hasattr(response, 'transaction') and response.transaction:
                    await handle_raydium_transaction(response.transaction)

        except grpc.aio.AioRpcError as e:
            logger.error(f"gRPC error: {e.code()} → {e.details()}")
            await asyncio.sleep(10)
        except Exception as e:
            logger.error(f"Hybrid loop error: {e}")
            await asyncio.sleep(10)
        finally:
            if channel:
                await channel.close()
            await asyncio.sleep(5)
          
async def handle_pumpfun_completion(update):
    try:
        account = update.account
        if not account or not account.data or len(account.data) < 33:
            return
            
        mint_bytes = account.data[:32]
        mint = base58.b58encode(mint_bytes).decode()
        
        if len(mint) != 44:
            return
            
        logger.info(f"⚡ PUMPFUN MIGRATION DETECTED | Immediate snipe for {mint[:8]}")
        
        async with AsyncSessionLocal() as db:
            # Dedupe
            exists = await db.execute(select(NewTokens).where(NewTokens.mint_address == mint))
            if exists.scalar_one_or_none():
                return
                
            new_token = NewTokens(
                mint_address=mint,
                pool_id=base58.b58encode(account.pubkey).decode(),
                timestamp=datetime.utcnow(),
                signature="pumpfun_complete",
                tx_type="pumpfun_migration",
                metadata_status="pending",
                next_reprocess_time=datetime.utcnow() + timedelta(seconds=1),  # FAST
                dexscreener_processed=False,
            )
            db.add(new_token)
            await db.commit()
            
            # 🔥 IMMEDIATE SNIPE
            await trigger_immediate_snipe(mint, db)
            
            # Send alert
            alert = {
                "type": "pumpfun_migration",
                "mint": mint,
                "message": "Pump.fun migration detected! Immediate snipe triggered!",
                "timestamp": datetime.utcnow().isoformat()
            }
            
            for wallet in websocket_manager.active_connections.keys():
                await websocket_manager.send_personal_message(json.dumps(alert), wallet)
                
    except Exception as e:
        logger.error(f"Pump.fun handler error: {e}")
        
async def handle_raydium_transaction(tx_info):
    try:
        # 1. Get signature
        if not tx_info.transaction or not tx_info.transaction.signature:
            return
        signature = base58.b58encode(tx_info.transaction.signature).decode()

        # 2. Get slot (top-level in new format)
        slot = getattr(tx_info, "slot", 0)

        # 3. Critical: Correct path to parsed message
        if not hasattr(tx_info.transaction, "transaction"):
            return
        parsed_tx = tx_info.transaction.transaction
        if not hasattr(parsed_tx, "message"):
            return
        message = parsed_tx.message
        if not hasattr(message, "account_keys"):
            return

        accounts = [base58.b58encode(key).decode() for key in message.account_keys]

        # 4. Raydium program check
        if settings.RAYDIUM_PROGRAM not in accounts:
            return

        # 5. Extract pool creations
        pool_infos = await find_raydium_pool_creations(tx_info, accounts, signature, slot)
        if pool_infos:
            logger.info(f"Raydium pool detected → {len(pool_infos)} pool(s) | Tx: {signature}")
            await process_pool_creations(pool_infos)

    except Exception as e:
        logger.error(f"Raydium tx handler error: {e}", exc_info=True)      

async def find_raydium_pool_creations(tx_info, accounts, signature, slot):
    """Extract Raydium pool creation information from transaction"""
    program_id = settings.RAYDIUM_PROGRAM
    pool_infos = []
    
    try:
        # Check if Raydium program is in the accounts
        if program_id not in accounts:
            return pool_infos

        # Get instructions from the transaction
        instructions = []
        main_instructions = []
        
        # Main instructions
        if (hasattr(tx_info, 'transaction') and tx_info.transaction and
            hasattr(tx_info.transaction, 'transaction') and tx_info.transaction.transaction and
            hasattr(tx_info.transaction.transaction, 'message') and tx_info.transaction.transaction.message and
            hasattr(tx_info.transaction.transaction.message, 'instructions')):
            
            main_instructions = tx_info.transaction.transaction.message.instructions
            instructions.extend(main_instructions)

        # Inner instructions from meta
        if (hasattr(tx_info, 'transaction') and tx_info.transaction and
            hasattr(tx_info.transaction, 'meta') and tx_info.transaction.meta and
            hasattr(tx_info.transaction.meta, 'inner_instructions')):
            
            for inner_instr in tx_info.transaction.meta.inner_instructions:
                if hasattr(inner_instr, 'instructions'):
                    inner_instructions = inner_instr.instructions
                    instructions.extend(inner_instructions)

        pool_creation_count = 0
        
        # Define Raydium instruction opcodes
        raydium_opcodes = {
            1: "Initialize2 (Pool Creation)",
            2: "Initialize (Legacy Pool Creation)",
            # ... other opcodes
        }
        
        for i, instruction in enumerate(instructions):
            try:
                # Check program ID index bounds
                if instruction.program_id_index >= len(accounts):
                    continue
                    
                instruction_program = accounts[instruction.program_id_index]
                
                if instruction_program != program_id:
                    continue
                
                # Check if this is initialize2 (pool creation) - opcode 1
                if (hasattr(instruction, 'data') and instruction.data and 
                    len(instruction.data) > 0):
                    
                    opcode = instruction.data[0]
                    
                    if opcode == 1:  # Pool creation
                        pool_creation_count += 1
                        
                        # Validate account indices
                        if len(instruction.accounts) < 17:
                            continue
                            
                        pool_id = accounts[instruction.accounts[4]]
                        
                        # Create pool info
                        pool_info = {
                            "updateTime": datetime.utcnow().timestamp(),
                            "slot": slot,
                            "txid": signature,
                            "poolInfos": [{
                                "id": pool_id,
                                "baseMint": accounts[instruction.accounts[8]],
                                "quoteMint": accounts[instruction.accounts[9]],
                                "lpMint": accounts[instruction.accounts[7]],
                                "version": 4,
                                "programId": program_id,
                                "authority": accounts[instruction.accounts[5]],
                                "openOrders": accounts[instruction.accounts[6]],
                                "targetOrders": accounts[instruction.accounts[12]],
                                "baseVault": accounts[instruction.accounts[10]],
                                "quoteVault": accounts[instruction.accounts[11]],
                                "marketId": accounts[instruction.accounts[16]],
                            }]
                        }
                        pool_infos.append(pool_info)
                    
            except Exception as e:
                # Only log actual errors, not routine processing issues
                continue
        
        # Only log if we actually found pools
        if pool_creation_count > 0:
            logger.info(f"Found {pool_creation_count} pool creation instruction(s) in transaction {signature}")
                
    except Exception as e:
        logger.error(f"Error finding Raydium pools: {e}")
        traceback.print_exc()
        
    return pool_infos

# Updated process_pool_creations with Pump.fun fast-track
async def process_pool_creations(pool_infos):
    """Process new pools and snipe INSTANTLY, then fetch metadata"""
    async with AsyncSessionLocal() as db_session:
        try:
            saved = 0
            for pool in pool_infos:
                data = pool["poolInfos"][0]
                pool_id = data["id"]
                mint = data["baseMint"]
                
                # Dedupe
                if await db_session.get(NewTokens, pool_id):
                    continue
                    
                if (await db_session.execute(select(NewTokens).where(NewTokens.mint_address == mint))).scalar_one_or_none():
                    continue
                
                # Create NewToken entry
                new_token = NewTokens(
                    pool_id=pool_id,
                    mint_address=mint,
                    timestamp=datetime.utcnow(),
                    signature=pool["txid"],
                    tx_type="raydium_pool_create",
                    metadata_status="pending",
                    next_reprocess_time=datetime.utcnow() + timedelta(seconds=1),  # FAST reprocess
                    dexscreener_processed=False,
                )
                db_session.add(new_token)
                saved += 1
                
                # 🔥 IMMEDIATE SNIPE TRIGGER
                logger.info(f"🚀 POOL DETECTED → Immediate snipe trigger for {mint[:8]}...")
                await trigger_immediate_snipe(mint, db_session)
                
                # Send alert to frontend
                alert = {
                    "type": "pool_detected",
                    "source": "Raydium",
                    "mint": mint,
                    "pool_id": pool_id,
                    "message": "New pool detected! Snipping in progress...",
                    "timestamp": datetime.utcnow().isoformat()
                }
                for wallet in websocket_manager.active_connections.keys():
                    await websocket_manager.send_personal_message(json.dumps(alert), wallet)
                
            if saved > 0:
                await db_session.commit()
                logger.info(f"Saved {saved} new pool(s) | Instant snipe triggered")
                
        except Exception as e:
            logger.error(f"process_pool_creations error: {e}", exc_info=True)
            await db_session.rollback()  
            
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
                            token_decimals=9,
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
             
async def track_raydium_transaction_types(signature, accounts, instructions):
    """Track and log the types of Raydium transactions we're seeing"""
    program_id = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"
    
    if program_id not in accounts:
        return
    
    raydium_instructions = []
    for instruction in instructions:
        try:
            if (hasattr(instruction, 'program_id_index') and 
                instruction.program_id_index < len(accounts) and
                accounts[instruction.program_id_index] == program_id and
                hasattr(instruction, 'data') and instruction.data and len(instruction.data) > 0):
                
                opcode = instruction.data[0]
                raydium_instructions.append(opcode)
        except:
            continue
    
    if raydium_instructions:
        logger.info(f"Raydium transaction {signature} has opcodes: {raydium_instructions}")

def analyze_transaction_type(accounts):
    """Quick analysis of transaction type based on accounts"""
    common_programs = {
        "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA": "Token Program",
        "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL": "Associated Token Program",
        "11111111111111111111111111111111": "System Program",
        "ComputeBudget111111111111111111111111111111": "Compute Budget Program",
        "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8": "Raydium AMM V4",
        "srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX": "OpenBook DEX",
    }
    
    found_programs = []
    for account in accounts:
        if account in common_programs:
            found_programs.append(common_programs[account])
    
    return found_programs  

                  
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
                await asyncio.sleep(user.bot_check_interval_seconds or 10)
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
        async with AsyncSessionLocal() as db:
            stmt = select(NewTokens).where(
                NewTokens.metadata_status == "pending",
                or_(
                    NewTokens.next_reprocess_time.is_(None),
                    NewTokens.next_reprocess_time <= datetime.utcnow()
                )
            ).order_by(NewTokens.timestamp).limit(15)

            result = await db.execute(stmt)
            pending = result.scalars().all()

            tasks = [safe_enrich_token(t.mint_address, db) for t in pending]
            await asyncio.gather(*tasks, return_exceptions=True)

        await asyncio.sleep(6)
        
async def safe_enrich_token(mint_address: str, db: AsyncSession):
    try:
        await process_token_logic(mint_address, db)

        # FIXED: Query by mint_address, not by primary key
        new_token_result = await db.execute(
            select(NewTokens).where(NewTokens.mint_address == mint_address)
        )
        token = new_token_result.scalar_one_or_none()
        
        if token:
            token.metadata_status = "processed"
            token.last_metadata_update = datetime.utcnow()
            await db.commit()
            
        logger.info(f"Successfully enriched and marked as processed: {mint_address[:8]}")
        
    except Exception as e:
        logger.error(f"Failed to enrich {mint_address}: {e}", exc_info=True)
        # Leave as pending → will retry automatically

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
            await db.flush()
        
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
                logger.info(f"✅ Jupiter logo found for {mint_address[:8]}")
                
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
                
# Add this to lifespan startup to restore persistent bots
async def restore_persistent_bots():
    """Restore all persistent bots on startup"""
    try:
        # Get all wallet addresses with active bots
        keys = await redis_client.keys("bot_state:*")
        for key in keys:
            state_data = await redis_client.get(key)
            if state_data:
                state = json.loads(state_data)
                if state.get("is_running", False):
                    wallet_address = key.decode().replace("bot_state:", "")
                    # Wait a bit before starting to avoid overload
                    await asyncio.sleep(1)
                    asyncio.create_task(start_persistent_bot_for_user(wallet_address))
                    logger.info(f"Restored persistent bot for {wallet_address}")
    except Exception as e:
        logger.error(f"Error restoring persistent bots: {e}")
        

# ===================================================================
# 4. ALL MAIN ENDPOINTS STARTS HERE
# ===================================================================
@app.get("/ping")
async def ping():
    logger.info("Ping received.")
    return {"message": "pong", "status": "ok"}

@app.get("/health")
async def health_check():
    try:
        async with AsyncClient(settings.SOLANA_RPC_URL) as client:
            await client.is_connected()
        try:
            channel = create_grpc_channel(
                os.getenv("GRPC_URL", "grpc.mainnet.solana.yellowstone.dev:10000"),
                os.getenv("GRPC_TOKEN", "your-grpc-token")
            )
            stub = GeyserStub(channel)
            await stub.GetVersion(GetVersionRequest())
            grpc_status = "ok"
            await channel.close()
        except Exception as e:
            grpc_status = f"error: {e}"
        return {
            "status": "healthy",
            "database": "ok",
            "solana_rpc": "ok",
            "grpc_raydium": grpc_status,
            "message": "All essential services are operational."
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return {"status": "unhealthy", "message": str(e)}

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

  
  
  
  
  
  
  
  
  