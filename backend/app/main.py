# # app/main.py
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
# from sqlalchemy import select
# from sqlalchemy.ext.asyncio import AsyncSession
# from dotenv import load_dotenv
# import aiohttp
# from tenacity import retry, stop_after_attempt, wait_exponential
# from solders.pubkey import Pubkey
# from solders.keypair import Keypair
# from solders.transaction import VersionedTransaction
# from solana.rpc.async_api import AsyncClient
# from jupiter_python_sdk.jupiter import Jupiter
# from app.dependencies import get_current_user_by_wallet
# from app.models import Subscription, Trade, User, TokenMetadata, NewTokens
# from app.database import AsyncSessionLocal, get_db
# from app.schemas import LogTradeRequest, SubscriptionRequest
# from app.utils import profitability_engine
# from app.utils.dexscreener_api import get_dexscreener_data
# from app.utils.raydium_apis import get_raydium_pool_info
# from app.utils.solscan_apis import get_solscan_token_meta, get_top_holders_info
# from app.utils.webacy_api import check_webacy_risk
# from app import models, database
# from app.config import settings
# from app.security import decrypt_private_key_backend
# import redis.asyncio as redis
# from app.utils.tavily_api import tavily_client

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

# # Configure logger
# logger = logging.getLogger(__name__)
# logger.setLevel(logging.INFO)
# if not logger.handlers:
#     handler = logging.StreamHandler()
#     handler.setLevel(logging.INFO)
#     formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
#     handler.setFormatter(formatter)
#     logger.addHandler(handler)
#     logger.propagate = False

# # Redis client
# redis_client = redis.Redis(host=os.getenv("REDIS_HOST", "localhost"), port=6379, db=0)

# # FastAPI app
# app = FastAPI(
#     title="Solsniper API",
#     description="A powerful Solana sniping bot with AI analysis and rug pull protection.",
#     version="0.2.0",
# )

# # CORS middleware
# app.add_middleware(
#     CORSMiddleware,
#     allow_origins=["*"],  # DEV ONLY
#     allow_credentials=True,
#     allow_methods=["*"],
#     allow_headers=["*"],
# )

# # Import routers AFTER app creation to avoid circular imports
# from app.routers import auth, token, trade, user, util

# # Include routers
# app.include_router(auth.router)
# app.include_router(token.router)
# app.include_router(trade.router)
# app.include_router(user.router)
# app.include_router(util.router)


# # Lifespan event handler
# @asynccontextmanager
# async def lifespan(app: FastAPI):
#     try:
#         async with database.async_engine.begin() as conn:
#             await conn.run_sync(models.Base.metadata.create_all)
#         asyncio.create_task(safe_raydium_grpc_loop())
#         asyncio.create_task(safe_metadata_enrichment_loop())
#         logger.info("🚀 Production backend started successfully")
#         yield
#     except Exception as e:
#         logger.error(f"❌ Startup failed: {e}")
#         raise
#     finally:
#         await redis_client.close()
#         await database.async_engine.dispose()

# # Attach lifespan to app
# app.router.lifespan_context = lifespan

# # WebSocket Manager
# class ConnectionManager:
#     def __init__(self):
#         self.active_connections: Dict[str, WebSocket] = {}

#     async def connect(self, websocket: WebSocket, wallet_address: str):
#         await websocket.accept()
#         self.active_connections[wallet_address] = websocket
#         logger.info(f"WebSocket connected for wallet: {wallet_address}")

#     def disconnect(self, wallet_address: str):
#         if wallet_address in self.active_connections:
#             del self.active_connections[wallet_address]
#             logger.info(f"WebSocket disconnected for wallet: {wallet_address}")

#     async def send_personal_message(self, message: str, wallet_address: str):
#         if wallet_address in self.active_connections:
#             try:
#                 await self.active_connections[wallet_address].send_text(message)
#             except Exception as e:
#                 logger.error(f"Error sending message to {wallet_address}: {e}")
#                 self.disconnect(wallet_address)

# websocket_manager = ConnectionManager()

# # Active bot tasks
# active_bot_tasks: Dict[str, asyncio.Task] = {}

# @app.get("/debug/routes")
# async def debug():
#     return [{"path": r.path, "name": r.name} for r in app.routes]

# # WebSocket endpoint
# @app.websocket("/ws/logs/{wallet_address}")
# async def websocket_endpoint(websocket: WebSocket, wallet_address: str):
#     await websocket_manager.connect(websocket, wallet_address)
#     try:
#         async with AsyncSessionLocal() as db:
#             result = await db.execute(
#                 select(Trade)
#                 .filter_by(user_wallet_address=wallet_address)   # ← FIXED
#                 .order_by(Trade.id.desc())                      # ← better than created_at which doesn't exist
#                 .limit(50)
#             )
#             trades = result.scalars().all()
#             for trade in trades:
#                 await websocket.send_json({
#                     "type": "trade_update",
#                     "trade": {
#                         "id": trade.id,
#                         "trade_type": trade.trade_type,
#                         "amount_sol": trade.amount_sol_in or trade.amount_sol_out or 0,
#                         "token_symbol": trade.token_symbol or "Unknown",
#                         "timestamp": trade.created_at.isoformat() if trade.created_at else None,
#                     }
#                 })
        
#         while True:
#             data = await websocket.receive_text()
#             if data:
#                 try:
#                     message = json.loads(data)
#                     if message.get("type") == "health_response":
#                         logger.info(f"Received health response from {wallet_address}")
#                 except json.JSONDecodeError:
#                     logger.error(f"Invalid WebSocket message from {wallet_address}")
#     except WebSocketDisconnect:
#         websocket_manager.disconnect(wallet_address)
#     except Exception as e:
#         logger.error(f"WebSocket error for {wallet_address}: {str(e)}")
#         websocket_manager.disconnect(wallet_address)


    

# # WebSocket Manager
# class ConnectionManager:
#     def __init__(self):
#         self.active_connections: Dict[str, WebSocket] = {}

#     async def connect(self, websocket: WebSocket, wallet_address: str):
#         await websocket.accept()
#         self.active_connections[wallet_address] = websocket
#         logger.info(f"WebSocket connected for wallet: {wallet_address}")

#     def disconnect(self, wallet_address: str):
#         if wallet_address in self.active_connections:
#             del self.active_connections[wallet_address]
#             logger.info(f"WebSocket disconnected for wallet: {wallet_address}")

#     async def send_personal_message(self, message: str, wallet_address: str):
#         if wallet_address in self.active_connections:
#             try:
#                 await self.active_connections[wallet_address].send_text(message)
#             except Exception as e:
#                 logger.error(f"Error sending message to {wallet_address}: {e}")
#                 self.disconnect(wallet_address)

# websocket_manager = ConnectionManager()

# # Active bot tasks
# active_bot_tasks: Dict[str, asyncio.Task] = {}

# # Helper to broadcast new trade
# async def broadcast_trade(trade: Trade):
#     message = {
#         "type": "trade_update",
#         "trade": {
#             "id": trade.id,
#             "trade_type": trade.trade_type,
#             "amount_sol": trade.amount_sol_in or trade.amount_sol_out or 0,
#             "token_symbol": trade.token_symbol or "Unknown",
#             "timestamp": trade.created_at.isoformat() if trade.created_at else None,
#         }
#     }
#     await websocket_manager.send_personal_message(json.dumps(message), trade.user_wallet_address)
        

# # gRPC Channel
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

# # Raydium gRPC loop and other functions
# async def safe_raydium_grpc_loop():
#     while True:
#         try:
#             await raydium_grpc_subscription_loop()
#         except Exception as e:
#             logger.error(f"Raydium loop crashed: {e}")
#             await asyncio.sleep(30)

# async def safe_metadata_enrichment_loop():
#     while True:
#         try:
#             await metadata_enrichment_loop()
#         except Exception as e:
#             logger.error(f"Metadata loop crashed: {e}")
#             await asyncio.sleep(30)
        
# async def raydium_grpc_subscription_loop():
#     program_id = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"
#     create_pool_fee_account = "7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eqaYcHQqtj2G5"
#     grpc_url = os.getenv("GRPC_URL", "grpc.ams.shyft.to:443")
#     grpc_token = os.getenv("GRPC_TOKEN", "30c7ef87-5bf0-4d70-be9f-3ea432922437")

#     while True:
#         channel = None
#         try:
#             # Only log connection attempts, not every loop iteration
#             logger.info(f"Starting Raydium gRPC loop with URL: {grpc_url}")
#             channel = create_grpc_channel(grpc_url, grpc_token)
#             stub = GeyserStub(channel)

#             subscribe_request = SubscribeRequest(
#                 transactions={
#                     "raydium_pools": {
#                         "vote": False,
#                         "failed": False,
#                         "account_include": [program_id, create_pool_fee_account],
#                     }
#                 },
#                 commitment=CommitmentLevel.CONFIRMED,
#             )

#             # Remove the 30-second status logging
#             async for response in stub.Subscribe(iter([subscribe_request])):
#                 # Only process transaction updates
#                 if not response.HasField('transaction'):
#                     continue

#                 tx_info = response.transaction
                
#                 # Get signature from the nested transaction
#                 signature = None
#                 if (hasattr(tx_info, 'transaction') and tx_info.transaction and
#                     hasattr(tx_info.transaction, 'signature') and tx_info.transaction.signature):
#                     signature_bytes = tx_info.transaction.signature
#                     signature = base58.b58encode(signature_bytes).decode()
#                 else:
#                     continue

#                 # Get slot information
#                 slot = getattr(tx_info, 'slot', 0)

#                 # Extract account keys
#                 accounts = []
#                 try:
#                     if (hasattr(tx_info, 'transaction') and tx_info.transaction and
#                         hasattr(tx_info.transaction, 'transaction') and tx_info.transaction.transaction and
#                         hasattr(tx_info.transaction.transaction, 'message') and tx_info.transaction.transaction.message and
#                         hasattr(tx_info.transaction.transaction.message, 'account_keys')):
                        
#                         account_keys = tx_info.transaction.transaction.message.account_keys
#                         accounts = [base58.b58encode(key).decode() for key in account_keys]
                        
#                         # Check if Raydium program is in accounts
#                         if program_id in accounts:
#                             # Look for Raydium pool creation instructions
#                             pool_infos = await find_raydium_pool_creations(tx_info, accounts, signature, slot)
                            
#                             if pool_infos:
#                                 # Only log when pools are actually found and processed
#                                 logger.info(f"🎯 New pool creation detected! Processing {len(pool_infos)} pool(s)")
#                                 await process_pool_creations(pool_infos)
                            
#                     else:
#                         continue
                            
#                 except Exception as e:
#                     # Only log errors, not every extraction attempt
#                     logger.error(f"Error extracting account keys: {e}")
#                     continue

#         except grpc.aio.AioRpcError as e:
#             logger.error("gRPC error in Raydium loop: %s - %s", e.code(), e.details())
#             await asyncio.sleep(10)
#         except Exception as e:
#             logger.error("Unexpected error in Raydium gRPC loop: %s", e)
#             await asyncio.sleep(10)
#         finally:
#             if channel is not None:
#                 await channel.close()
#             # Don't log every retry, only log if there was an actual issue
#             await asyncio.sleep(10)

# async def find_raydium_pool_creations(tx_info, accounts, signature, slot):
#     """Extract Raydium pool creation information from transaction"""
#     program_id = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"
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

# async def process_pool_creations(pool_infos):
#     """Process and store new pool creations"""
#     async with AsyncSessionLocal() as db_session:
#         try:
#             pools_saved = 0
            
#             for pool in pool_infos:
#                 pool_data = pool["poolInfos"][0]
                
#                 # Check if this pool already exists in database to avoid duplicates
#                 existing_stmt = select(NewTokens).where(NewTokens.pool_id == pool_data["id"])
#                 existing_result = await db_session.execute(existing_stmt)
#                 existing_pool = existing_result.scalar_one_or_none()
                
#                 if existing_pool:
#                     continue  # Skip if pool already exists

#                 # Fetch token decimals
#                 try:
#                     async with AsyncClient(settings.SOLANA_RPC_URL) as solana_client:
#                         base_mint_acc, quote_mint_acc = await solana_client.get_multiple_accounts([
#                             Pubkey.from_string(pool_data["baseMint"]),
#                             Pubkey.from_string(pool_data["quoteMint"]),
#                         ])

#                         if base_mint_acc.value and quote_mint_acc.value:
#                             base_decimals = base_mint_acc.value.data[44] if len(base_mint_acc.value.data) > 44 else 9
#                             quote_decimals = quote_mint_acc.value.data[44] if len(quote_mint_acc.value.data) > 44 else 6
                            
#                             pool_data["baseDecimals"] = base_decimals
#                             pool_data["quoteDecimals"] = quote_decimals
#                             pool_data["lpDecimals"] = base_decimals
                
#                 except Exception as e:
#                     pool_data["baseDecimals"] = 9
#                     pool_data["quoteDecimals"] = 6
#                     pool_data["lpDecimals"] = 9

#                 # Save to database
#                 token_trade = NewTokens(
#                     mint_address=pool_data["baseMint"],
#                     pool_id=pool_data["id"],
#                     timestamp=datetime.utcnow(),
#                     signature=pool["txid"],
#                     tx_type="raydium_pool_create",
#                     metadata_status="pending"
#                 )
#                 db_session.add(token_trade)
#                 pools_saved += 1

#             if pools_saved > 0:
#                 await db_session.commit()
#                 logger.info(f"✅ Successfully saved {pools_saved} new pool(s) to database")
                
#                 # Notify WebSocket clients
#                 for wallet in websocket_manager.active_connections:
#                     for pool in pool_infos:
#                         await websocket_manager.send_personal_message(
#                             json.dumps({
#                                 "type": "new_pool",
#                                 "pool": pool["poolInfos"][0]
#                             }),
#                             wallet
#                         )

#                 # Process additional token logic for new pools only
#                 for pool in pool_infos:
#                     await process_token_logic(pool["poolInfos"][0]["baseMint"], db_session)
#             else:
#                 logger.info("No new pools to save (all already exist in database)")

#         except Exception as e:
#             logger.error("Error processing pool creations: %s", e)
#             await db_session.rollback()

# # Function to track Raydium transaction types
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

# # # Metadata Enrichment
# # @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=4, max=10))
# # async def process_token_logic(mint: str, db: AsyncSession):
# #     try:
# #         logger.info(f"Enriching metadata for: {mint}")
# #         stmt = select(TokenMetadata).where(TokenMetadata.mint_address == mint)
# #         result = await db.execute(stmt)
# #         token = result.scalars().first()
# #         if not token:
# #             token = TokenMetadata(mint_address=mint)
# #             db.add(token)

# #         cache_key = f"token_metadata:{mint}"
# #         cached_data = await redis_client.get(cache_key)
# #         if cached_data:
# #             token.__dict__.update(json.loads(cached_data))
# #             await db.merge(token)
# #             await db.commit()
# #             return

# #         dex_data = await get_dexscreener_data(mint)
# #         if dex_data:
# #             token.dexscreener_url = dex_data.get("dexscreener_url")
# #             token.pair_address = dex_data.get("pair_address")
# #             token.price_native = dex_data.get("price_native")
# #             token.price_usd = dex_data.get("price_usd")
# #             token.market_cap = dex_data.get("market_cap")
# #             token.pair_created_at = dex_data.get("pair_created_at")
# #             token.websites = dex_data.get("websites")
# #             token.twitter = dex_data.get("twitter")
# #             token.telegram = dex_data.get("telegram")
# #             token.token_name = dex_data.get("token_name")
# #             token.token_symbol = dex_data.get("token_symbol")
# #             token.dex_id = dex_data.get("dex_id")
# #             token.volume_h24 = dex_data.get("volume_h24")
# #             token.volume_h6 = dex_data.get("volume_h6")
# #             token.volume_h1 = dex_data.get("volume_h1")
# #             token.volume_m5 = dex_data.get("volume_m5")
# #             token.price_change_h1 = dex_data.get("price_change_h1")
# #             token.price_change_m5 = dex_data.get("price_change_m5")
# #             token.price_change_h6 = dex_data.get("price_change_h6")
# #             token.price_change_h24 = dex_data.get("price_change_h24")
# #             token.socials_present = bool(dex_data.get("twitter") or dex_data.get("telegram") or dex_data.get("websites"))

# #         if token.pair_address:
# #             raydium_data = await get_raydium_pool_info(token.pair_address)
# #             if raydium_data:
# #                 token.liquidity_burnt = raydium_data.get("burnPercent", 0) == 100
# #                 token.liquidity_pool_size_sol = raydium_data.get("tvl")

# #         # solscan_data = await get_solscan_token_meta(mint)
# #         # if solscan_data:
# #         #     token.immutable_metadata = solscan_data.get("is_mutable") is False
# #         #     token.mint_authority_renounced = solscan_data.get("mint_authority") is None
# #         #     token.freeze_authority_revoked = solscan_data.get("freeze_authority") is None
# #         #     token.token_decimals = solscan_data.get("decimals")
# #         #     token.holder = solscan_data.get("holder")
        
# #         # Get Raydium pool data using the pair address or mint
# #         raydium_data = await get_raydium_pool_info(token.pair_address or mint)
# #         if raydium_data and raydium_data.get("data"):
# #             pool_data = raydium_data["data"][0]  # Get first pool data
            
# #             # Extract pool information
# #             token.program_id = pool_data.get("programId")
# #             token.pool_id = pool_data.get("id")
            
# #             # Mint information
# #             if pool_data.get("mintA"):
# #                 token.mint_a = pool_data["mintA"].get("address")
# #                 token.token_decimals = pool_data["mintA"].get("decimals")
# #                 if not token.token_name:
# #                     token.token_name = pool_data["mintA"].get("name")
# #                 if not token.token_symbol:
# #                     token.token_symbol = pool_data["mintA"].get("symbol")
            
# #             if pool_data.get("mintB"):
# #                 token.mint_b = pool_data["mintB"].get("address")
            
# #             # Pool amounts and fees
# #             token.mint_amount_a = pool_data.get("mintAmountA")
# #             token.mint_amount_b = pool_data.get("mintAmountB")
# #             token.fee_rate = pool_data.get("feeRate")
# #             token.open_time = pool_data.get("openTime")
# #             token.tvl = pool_data.get("tvl")
            
# #             # Day statistics
# #             if pool_data.get("day"):
# #                 day_data = pool_data["day"]
# #                 token.day_volume = day_data.get("volume")
# #                 token.day_volume_quote = day_data.get("volumeQuote")
# #                 token.day_volume_fee = day_data.get("volumeFee")
# #                 token.day_apr = day_data.get("apr")
# #                 token.day_fee_apr = day_data.get("feeApr")
# #                 token.day_price_min = day_data.get("priceMin")
# #                 token.day_price_max = day_data.get("priceMax")
            
# #             # Week statistics
# #             if pool_data.get("week"):
# #                 week_data = pool_data["week"]
# #                 token.week_volume = week_data.get("volume")
# #                 token.week_volume_quote = week_data.get("volumeQuote")
# #                 token.week_volume_fee = week_data.get("volumeFee")
# #                 token.week_apr = week_data.get("apr")
# #                 token.week_fee_apr = week_data.get("feeApr")
# #                 token.week_price_min = week_data.get("priceMin")
# #                 token.week_price_max = week_data.get("priceMax")
            
# #             # Month statistics
# #             if pool_data.get("month"):
# #                 month_data = pool_data["month"]
# #                 token.month_volume = month_data.get("volume")
# #                 token.month_volume_quote = month_data.get("volumeQuote")
# #                 token.month_volume_fee = month_data.get("volumeFee")
# #                 token.month_apr = month_data.get("apr")
# #                 token.month_fee_apr = month_data.get("feeApr")
# #                 token.month_price_min = month_data.get("priceMin")
# #                 token.month_price_max = month_data.get("priceMax")
            
# #             # Pool metadata
# #             token.pool_type = ", ".join(pool_data.get("pooltype", []))
# #             token.market_id = pool_data.get("marketId")
            
# #             # LP information
# #             if pool_data.get("lpMint"):
# #                 token.lp_mint = pool_data["lpMint"].get("address")
# #             token.lp_price = pool_data.get("lpPrice")
# #             token.lp_amount = pool_data.get("lpAmount")
# #             token.burn_percent = pool_data.get("burnPercent")
# #             token.launch_migrate_pool = pool_data.get("launchMigratePool", False)
            
# #             # Set liquidity burnt flag
# #             token.liquidity_burnt = pool_data.get("burnPercent", 0) == 100
# #             token.liquidity_pool_size_sol = pool_data.get("tvl")

# #         webacy_data = await check_webacy_risk(mint)
# #         if webacy_data:
# #             token.webacy_risk_score = webacy_data["risk_score"]
# #             token.webacy_risk_level = webacy_data["risk_level"]
# #             token.webacy_moon_potential = webacy_data["moon_potential"]

# #         token.top10_holders_percentage = await get_top_holders_info(mint)
# #         token.last_checked_at = datetime.utcnow()

# #         await db.merge(token)
# #         await db.commit()

# #         await redis_client.setex(cache_key, 3600, json.dumps(token.__dict__))
# #         logger.info(f"Metadata enriched for: {mint}")
# #     except Exception as e:
# #         logger.error(f"Error enriching metadata for {mint}: {e}")
# #         await db.rollback()
# #         raise


# @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=4, max=10))
# async def process_token_logic(mint: str, db: AsyncSession):
#     try:
#         logger.info(f"2025 Moonbag Analysis → {mint}")

#         # 1. Get or create token
#         result = await db.execute(select(TokenMetadata).where(TokenMetadata.mint_address == mint))
#         token = result.scalars().first()
#         if not token:
#             token = TokenMetadata(mint_address=mint)
#             db.add(token)
#             await db.flush()  # Get ID if needed

#         # 2. FETCH ALL 4 DATA SOURCES IN PARALLEL (THE RIGHT WAY)
#         try:
#             # DO NOT CALL THE FUNCTIONS — PASS THEM!
#             dex_task = get_dexscreener_data(mint)
#             raydium_task = get_raydium_pool_info(mint)
#             webacy_task = check_webacy_risk(mint)

#             # Tavily needs symbol → get it from dexscreener first OR fallback
#             # So we fetch dexscreener FIRST (it's fastest), then use symbol for tavily
#             dex_data = await dex_task  # ← Await only this one first

#             token_symbol = "UNKNOWN"
#             token_name = "Unknown Token"
#             if dex_data:
#                 token_symbol = dex_data.get("token_symbol", "UNKNOWN")
#                 token_name = dex_data.get("token_name", "Unknown Token")

#             # Now run the rest in parallel, including Tavily with correct symbol
#             raydium_data, webacy_data, tavily_data = await asyncio.gather(
#                 raydium_task,
#                 webacy_task,
#                 tavily_client.analyze_sentiment(token_name, token_symbol),  # ← NOW WITH SYMBOL!
#                 return_exceptions=True
#             )

#         except Exception as e:
#             logger.error(f"Parallel fetch failed for {mint}: {e}")
#             dex_data = {}
#             raydium_data = {}
#             webacy_data = {}
#             tavily_data = {}
#             token_symbol = "UNKNOWN"

#         # Graceful fallbacks
#         dex_data = dex_data if not isinstance(dex_data, Exception) else {}
#         raydium_data = raydium_data if not isinstance(raydium_data, Exception) else {}
#         webacy_data = webacy_data if not isinstance(webacy_data, Exception) else {}
#         tavily_data = tavily_data if not isinstance(tavily_data, Exception) else {}
        
#         # 3. POPULATE DEXSCREENER DATA (for frontend + basic checks)
#         if dex_data:
#             token.dexscreener_url = dex_data.get("dexscreener_url")
#             token.pair_address = dex_data.get("pair_address")
#             token.price_native = dex_data.get("price_native")
#             token.price_usd = dex_data.get("price_usd")
#             token.market_cap = dex_data.get("market_cap")
#             token.pair_created_at = dex_data.get("pair_created_at")
#             token.websites = dex_data.get("websites")
#             token.twitter = dex_data.get("twitter")
#             token.telegram = dex_data.get("telegram")
#             token.token_name = dex_data.get("token_name")
#             token.token_symbol = dex_data.get("token_symbol")
#             token.dex_id = dex_data.get("dex_id")
#             token.volume_h24 = dex_data.get("volume_h24")
#             token.volume_h6 = dex_data.get("volume_h6")
#             token.volume_h1 = dex_data.get("volume_h1")
#             token.volume_m5 = dex_data.get("volume_m5")
#             token.price_change_h1 = dex_data.get("price_change_h1")
#             token.price_change_m5 = dex_data.get("price_change_m5")
#             token.price_change_h6 = dex_data.get("price_change_h6")
#             token.price_change_h24 = dex_data.get("price_change_h24")
#             token.socials_present = bool(dex_data.get("twitter") or dex_data.get("telegram") or dex_data.get("websites"))

#         # 4. POPULATE RAYDIUM DATA (critical for real metrics)
#         if raydium_data.get("data"):
#             pool = raydium_data["data"][0]

#             token.program_id = pool.get("programId")
#             token.pool_id = pool.get("id")
#             token.open_time = pool.get("openTime")
#             token.tvl = pool.get("tvl")
#             token.fee_rate = pool.get("feeRate")
#             token.pool_type = ", ".join(pool.get("pooltype", []))
#             token.market_id = pool.get("marketId")

#             # Mint A (the token)
#             if pool.get("mintA"):
#                 ma = pool["mintA"]
#                 token.mint_a = ma.get("address")
#                 token.token_decimals = ma.get("decimals")
#                 token.token_logo_uri = ma.get("logoURI")
#                 if not token.token_name or token.token_name == "Unknown":
#                     token.token_name = ma.get("name")
#                 if not token.token_symbol or token.token_symbol == "UNKNOWN":
#                     token.token_symbol = ma.get("symbol")

#             # Mint B (WSOL)
#             if pool.get("mintB"):
#                 token.mint_b = pool["mintB"].get("address")

#             # Amounts
#             token.mint_amount_a = pool.get("mintAmountA")
#             token.mint_amount_b = pool.get("mintAmountB")

#             # LP Token
#             if pool.get("lpMint"):
#                 token.lp_mint = pool["lpMint"].get("address")
#             token.lp_price = pool.get("lpPrice")
#             token.lp_amount = pool.get("lpAmount")

#             # Burn & migrate
#             token.burn_percent = pool.get("burnPercent", 0)
#             token.liquidity_burnt = token.burn_percent == 100
#             token.liquidity_pool_size_sol = pool.get("tvl")
#             token.launch_migrate_pool = pool.get("launchMigratePool", False)

#             # Stats (day/week/month)
#             for period in ["day", "week", "month"]:
#                 if pool.get(period):
#                     data = pool[period]
#                     setattr(token, f"{period}_volume", data.get("volume"))
#                     setattr(token, f"{period}_volume_quote", data.get("volumeQuote"))
#                     setattr(token, f"{period}_volume_fee", data.get("volumeFee"))
#                     setattr(token, f"{period}_apr", data.get("apr"))
#                     setattr(token, f"{period}_fee_apr", data.get("feeApr"))
#                     setattr(token, f"{period}_price_min", data.get("priceMin"))
#                     setattr(token, f"{period}_price_max", data.get("priceMax"))

#         # 5. Webacy Risk
#         if webacy_data:
#             token.webacy_risk_score = webacy_data.get("risk_score")
#             token.webacy_risk_level = webacy_data.get("risk_level")
#             token.webacy_moon_potential = webacy_data.get("moon_potential")

#         # 6. RUN THE 2025 PROFITABILITY ENGINE
#         try:
#             analysis = await profitability_engine.analyze_token(
#                 mint=mint,
#                 token_data=token.__dict__,
#                 webacy_data=webacy_data,
#                 tavily_data=tavily_data,
#                 raydium_data=raydium_data
#             )

#             token.profitability_score = analysis.final_score
#             token.profitability_confidence = analysis.confidence
#             token.trading_recommendation = analysis.recommendation
#             token.risk_score = analysis.risk_score
#             token.moon_potential = analysis.moon_potential
#             token.holder_concentration = analysis.holder_concentration
#             token.liquidity_score = analysis.liquidity_score
#             token.reasons = " | ".join(analysis.reasons[:5])

#             logger.info(f"MOONBAG SCAN → {token.token_symbol or mint[:8]} | "
#                         f"{analysis.recommendation} | Score: {analysis.final_score:.1f} | "
#                         f"Confidence: {analysis.confidence:.0f}%")

#             # ALERT ALL USERS ON MOONBAG
#             if analysis.recommendation == "MOONBAG_BUY":
#                 alert = {
#                     "type": "moonbag_detected",
#                     "mint": mint,
#                     "symbol": token.token_symbol or "UNKNOWN",
#                     "name": token.token_name or "Unknown",
#                     "price_usd": token.price_usd,
#                     "tvl": token.tvl,
#                     "score": round(analysis.final_score, 1),
#                     "confidence": round(analysis.confidence),
#                     "reasons": analysis.reasons,
#                     "logo": token.token_logo_uri,
#                     "dexscreener": token.dexscreener_url
#                 }
#                 for wallet in websocket_manager.active_connections.keys():
#                     await websocket_manager.send_personal_message(json.dumps(alert), wallet)

#         except Exception as e:
#             logger.error(f"Profitability engine crashed for {mint}: {e}")
#             token.trading_recommendation = "ERROR"
#             token.reasons = f"Engine error: {str(e)[:100]}"

#         # 7. Final save
#         token.last_checked_at = datetime.utcnow()
#         await db.merge(token)
#         await db.commit()

#         # Cache for 10 minutes
#         safe_dict = {k: v for k, v in token.__dict__.items() if not k.startswith('_')}
#         await redis_client.setex(f"token_metadata:{mint}", 600, json.dumps(safe_dict))

#     except Exception as e:
#         logger.error(f"CRITICAL FAILURE in process_token_logic for {mint}: {e}", exc_info=True)
#         await db.rollback()




# # Add this function for real-time trading decisions
# # async def make_trading_decision(mint: str, current_price: float, wallet_balance: float, db: AsyncSession) -> Dict:
# #     """Make real-time trading decision based on profitability analysis"""
# #     try:
# #         # Get latest analysis from database
# #         stmt = select(TokenMetadata).where(TokenMetadata.mint_address == mint)
# #         result = await db.execute(stmt)
# #         token = result.scalars().first()
        
# #         if not token or not token.profitability_score:
# #             return {"action": "SKIP", "reason": "Insufficient data"}
        
# #         # Trading decision logic
# #         min_confidence = 60  # Minimum confidence threshold
# #         min_score_for_buy = 65  # Minimum score to consider buying
        
# #         if token.profitability_confidence < min_confidence:
# #             return {"action": "SKIP", "reason": "Low confidence in analysis"}
        
# #         if token.profitability_score >= 80 and token.risk_adjusted_return > 20:
# #             # Strong buy signal
# #             investment_amount = min(wallet_balance * 0.1, wallet_balance * 0.02)  # 2-10% of balance
# #             return {
# #                 "action": "BUY",
# #                 "amount_sol": investment_amount,
# #                 "confidence": token.profitability_confidence,
# #                 "score": token.profitability_score,
# #                 "reason": token.trading_recommendation
# #             }
# #         elif token.profitability_score >= 70 and token.risk_adjusted_return > 10:
# #             # Moderate buy signal
# #             investment_amount = min(wallet_balance * 0.05, wallet_balance * 0.01)  # 1-5% of balance
# #             return {
# #                 "action": "BUY",
# #                 "amount_sol": investment_amount,
# #                 "confidence": token.profitability_confidence,
# #                 "score": token.profitability_score,
# #                 "reason": token.trading_recommendation
# #             }
# #         elif token.profitability_score <= 30:
# #             # Sell or avoid signal
# #             return {
# #                 "action": "AVOID",
# #                 "reason": f"Low profitability score: {token.profitability_score}",
# #                 "risk_level": token.webacy_risk_level
# #             }
# #         else:
# #             return {
# #                 "action": "HOLD",
# #                 "reason": "Neutral signal - wait for better opportunity",
# #                 "score": token.profitability_score
# #             }
            
# #     except Exception as e:
# #         logger.error(f"Trading decision error for {mint}: {e}")
# #         return {"action": "SKIP", "reason": "Decision engine error"}
    

# # Filters for 80% Profitability
# async def apply_user_filters(user: User, token_meta: TokenMetadata, db: AsyncSession, websocket_manager: ConnectionManager) -> bool:
#     async def log_failure(filter_name: str):
#         logger.debug(f"Token {token_meta.mint_address} failed {filter_name} for {user.wallet_address}.")
#         await websocket_manager.send_personal_message(
#             json.dumps({"type": "log", "message": f"Token {token_meta.token_symbol or token_meta.mint_address} failed {filter_name} filter.", "status": "info"}),
#             user.wallet_address
#         )

#     filters = [
#         ("Socials Added", user.filter_socials_added, lambda: not token_meta.socials_present),
#         ("Liquidity Burnt", user.filter_liquidity_burnt, lambda: not token_meta.liquidity_burnt),
#         ("Immutable Metadata", user.filter_immutable_metadata, lambda: not token_meta.immutable_metadata),
#         ("Mint Authority Renounced", user.filter_mint_authority_renounced, lambda: not token_meta.mint_authority_renounced),
#         ("Freeze Authority Revoked", user.filter_freeze_authority_revoked, lambda: not token_meta.freeze_authority_revoked),
#         (
#             f"Insufficient Liquidity Pool Size (min {user.filter_check_pool_size_min_sol} SOL)",
#             user.filter_check_pool_size_min_sol,
#             lambda: token_meta.liquidity_pool_size_sol is None or token_meta.liquidity_pool_size_sol < user.filter_check_pool_size_min_sol
#         ),
#         (
#             "Token Age (15m-72h)",
#             True,
#             lambda: not token_meta.pair_created_at or (
#                 (age := datetime.utcnow() - datetime.utcfromtimestamp(token_meta.pair_created_at)) < timedelta(minutes=15) or
#                 age > timedelta(hours=72)
#             )
#         ),
#         ("Market Cap (< $30k)", True, lambda: token_meta.market_cap is None or float(token_meta.market_cap) < 30000),
#         ("Holder Count (< 20)", True, lambda: token_meta.holder is None or token_meta.holder < 20),
#         ("Webacy Risk Score (>50)", True, lambda: token_meta.webacy_risk_score is None or token_meta.webacy_risk_score > 50),
#     ]

#     if user.is_premium:
#         filters.extend([
#             (
#                 f"Top 10 Holders % (>{user.filter_top_holders_max_pct}%)",
#                 user.filter_top_holders_max_pct,
#                 lambda: token_meta.top10_holders_percentage and token_meta.top10_holders_percentage > user.filter_top_holders_max_pct
#             ),
#             (
#                 f"Safety Check Period (<{user.filter_safety_check_period_seconds}s)",
#                 user.filter_safety_check_period_seconds and token_meta.pair_created_at,
#                 lambda: (datetime.utcnow() - datetime.utcfromtimestamp(token_meta.pair_created_at)) < timedelta(seconds=user.filter_safety_check_period_seconds)
#             ),
#             ("Webacy Moon Potential (<80)", True, lambda: token_meta.webacy_moon_potential is None or token_meta.webacy_moon_potential < 80),
#         ])

#     for filter_name, condition, check in filters:
#         if condition and check():
#             await log_failure(filter_name)
#             return False

#     return True

# # Metadata Enrichment Loop
# async def metadata_enrichment_loop():
#     while True:
#         try:
#             async with AsyncSessionLocal() as db:
#                 stmt = select(NewTokens).where(NewTokens.metadata_status == "pending").limit(10)
#                 result = await db.execute(stmt)
#                 tokens = result.scalars().all()
#                 for token in tokens:
#                     await process_token_logic(token.mint_address, db)
#                     token.metadata_status = "processed"
#                     await db.commit()
#         except Exception as e:
#             logger.error(f"Error in metadata enrichment loop: {e}")
#         await asyncio.sleep(30)

# # Endpoints
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
#     stmt = select(Trade).filter(Trade.user_wallet_address == current_user.wallet_address).order_by(Trade.buy_timestamp.desc())
#     result = await db.execute(stmt)
#     trades = result.scalars().all()
#     return [{
#         **trade.__dict__,
#         "profit_percentage": ((trade.price_usd_at_trade - trade.buy_price) / trade.buy_price * 100) if trade.trade_type == "sell" and trade.buy_price else 0
#     } for trade in trades]

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
#                     if not await redis_client.exists(f"trade:{user_wallet_address}:{token.mint_address}")
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
#     # Prevent double buys
#     if await redis_client.exists(f"trade:{user.wallet_address}:{token.mint_address}"):
#         return

#     # === ONLY BUY MOONBAGS OR STRONG BUYS ===
#     if token.trading_recommendation not in ["MOONBAG_BUY", "STRONG_BUY"]:
#         logger.info(f"Skipping {token.token_symbol} — Not a moonbag (got {token.trading_recommendation})")
#         return

#     if token.profitability_confidence < 75:
#         logger.info(f"Skipping {token.token_symbol} — Low confidence ({token.profitability_confidence}%)")
#         return

#     logger.info(f"MOONBAG DETECTED → {token.token_symbol} | Score: {token.profitability_score} | Buying NOW!")

#     await redis_client.setex(f"trade:{user.wallet_address}:{token.mint_address}", 3600, "bought")

#     await execute_user_trade(
#         user_wallet_address=user.wallet_address,
#         mint_address=token.mint_address,
#         amount_sol=user.buy_amount_sol or 0.5,
#         trade_type="buy",
#         slippage=user.buy_slippage_bps / 10000.0,
#         take_profit=user.sell_take_profit_pct,
#         stop_loss=user.sell_stop_loss_pct,
#         timeout_seconds=user.sell_timeout_seconds,
#         trailing_stop_loss_pct=user.trailing_stop_loss_pct,
#         db=db,
#         websocket_manager=websocket_manager
#     )
    
    
# async def execute_user_trade(
#     user_wallet_address: str,
#     mint_address: str,
#     amount_sol: float,
#     trade_type: str,
#     slippage: float,
#     take_profit: Optional[float],
#     stop_loss: Optional[float],
#     timeout_seconds: Optional[int],
#     trailing_stop_loss_pct: Optional[float],
#     db: AsyncSession,
#     websocket_manager: ConnectionManager
# ):
#     user_stmt = select(User).filter(User.wallet_address == user_wallet_address)
#     user_result = await db.execute(user_stmt)
#     user = user_result.scalar_one_or_none()
#     if not user:
#         raise ValueError("User not found")
#     rpc_url = user.custom_rpc_https if user.is_premium and user.custom_rpc_https else settings.SOLANA_RPC_URL
#     async with AsyncClient(rpc_url) as client:
#         try:
#             encrypted_private_key = user.encrypted_private_key.encode()
#             private_key_bytes = decrypt_private_key_backend(encrypted_private_key)
#             keypair = Keypair.from_bytes(private_key_bytes)
#             jupiter = Jupiter(client, keypair)
#             quote = await jupiter.get_quote(
#                 input_mint="So11111111111111111111111111111111111111112" if trade_type == "buy" else mint_address,
#                 output_mint=mint_address if trade_type == "buy" else "So11111111111111111111111111111111111111112",
#                 amount=int(amount_sol * 1_000_000_000),
#                 slippage_bps=int(slippage * 10000)
#             )
#             recent_fees = await client.get_recent_prioritization_fees()
#             priority_fee = max(fee.micro_lamports for fee in recent_fees.value) if recent_fees.value else 100_000
#             swap_transaction = await jupiter.swap(
#                 quote=quote,
#                 user_public_key=Pubkey.from_string(user_wallet_address),
#                 priority_fee_micro_lamports=priority_fee
#             )
#             raw_tx = base64.b64encode(swap_transaction.serialize()).decode()
#             trade_instruction_message = {
#                 "type": "trade_instruction",
#                 "trade_type": trade_type,
#                 "mint_address": mint_address,
#                 "amount_sol": amount_sol,
#                 "slippage": slippage,
#                 "take_profit": take_profit,
#                 "stop_loss": stop_loss,
#                 "timeout_seconds": timeout_seconds,
#                 "trailing_stop_loss_pct": trailing_stop_loss_pct,
#                 "raw_tx_base64": raw_tx,
#                 "last_valid_block_height": quote["last_valid_block_height"],
#                 "message": f"Execute {trade_type} trade for {mint_address}."
#             }
#             await websocket_manager.send_personal_message(
#                 json.dumps(trade_instruction_message),
#                 user_wallet_address
#             )
#             if trade_type == "buy":
#                 asyncio.create_task(monitor_trade_for_sell(
#                     user_wallet_address, mint_address, take_profit, stop_loss, timeout_seconds, trailing_stop_loss_pct, db, websocket_manager
#                 ))
#         except Exception as e:
#             logger.error(f"Error executing trade for {user_wallet_address}: {e}")
#             await websocket_manager.send_personal_message(
#                 json.dumps({"type": "log", "message": f"Trade error: {str(e)}", "status": "error"}),
#                 user_wallet_address
#             )


# async def monitor_trade_for_sell(
#     user_wallet_address: str,
#     mint_address: str,
#     take_profit: Optional[float],
#     stop_loss: Optional[float],
#     timeout_seconds: Optional[int],
#     trailing_stop_loss_pct: Optional[float],
#     db: AsyncSession,
#     websocket_manager: ConnectionManager
# ):
#     logger.info(f"Monitoring trade for {user_wallet_address} on {mint_address}")
#     start_time = datetime.utcnow()
#     highest_price = None
#     while True:
#         try:
#             dex_data = await get_dexscreener_data(mint_address)
#             if not dex_data:
#                 await websocket_manager.send_personal_message(
#                     json.dumps({"type": "log", "message": f"Failed to fetch price for {mint_address}. Retrying...", "status": "error"}),
#                     user_wallet_address
#                 )
#                 await asyncio.sleep(10)
#                 continue
#             current_price = float(dex_data.get("price_usd", 0))
#             trade_stmt = select(Trade).filter(
#                 Trade.user_wallet_address == user_wallet_address,
#                 Trade.mint_address == mint_address,
#                 Trade.trade_type == "buy"
#             ).order_by(Trade.buy_timestamp.desc())
#             trade_result = await db.execute(trade_stmt)
#             trade = trade_result.scalar_one_or_none()
#             if not trade:
#                 logger.error(f"No buy trade found for {user_wallet_address} and {mint_address}")
#                 break
#             buy_price = trade.price_usd_at_trade or 0
#             if timeout_seconds and (datetime.utcnow() - start_time).total_seconds() > timeout_seconds:
#                 await execute_user_trade(
#                     user_wallet_address, mint_address, trade.amount_tokens, "sell", 0.05, None, None, None, None, db, websocket_manager
#                 )
#                 await websocket_manager.send_personal_message(
#                     json.dumps({"type": "log", "message": f"Selling {mint_address} due to timeout.", "status": "info"}),
#                     user_wallet_address
#                 )
#                 break
#             if trailing_stop_loss_pct and current_price > (highest_price or buy_price):
#                 highest_price = current_price
#                 stop_loss = highest_price * (1 - trailing_stop_loss_pct / 100)
#             if take_profit and current_price >= buy_price * (1 + take_profit / 100):
#                 await execute_user_trade(
#                     user_wallet_address, mint_address, trade.amount_tokens, "sell", 0.05, None, None, None, None, db, websocket_manager
#                 )
#                 await websocket_manager.send_personal_message(
#                     json.dumps({"type": "log", "message": f"Selling {mint_address} at take-profit.", "status": "info"}),
#                     user_wallet_address
#                 )
#                 break
#             if stop_loss and current_price <= buy_price * (1 - stop_loss / 100):
#                 await execute_user_trade(
#                     user_wallet_address, mint_address, trade.amount_tokens, "sell", 0.05, None, None, None, None, db, websocket_manager
#                 )
#                 await websocket_manager.send_personal_message(
#                     json.dumps({"type": "log", "message": f"Selling {mint_address} at stop-loss.", "status": "info"}),
#                     user_wallet_address
#                 )
#                 break
#             await asyncio.sleep(5)
#         except Exception as e:
#             logger.error(f"Error monitoring trade for {mint_address}: {e}")
#             await websocket_manager.send_personal_message(
#                 json.dumps({"type": "log", "message": f"Error monitoring {mint_address}: {str(e)}", "status": "error"}),
#                 user_wallet_address
#             )
#             await asyncio.sleep(10)
            
            
            
















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
# from sqlalchemy import delete, select
# from sqlalchemy.ext.asyncio import AsyncSession
# from dotenv import load_dotenv
# import aiohttp
# from tenacity import retry, stop_after_attempt, wait_exponential
# from solders.pubkey import Pubkey
# from solders.keypair import Keypair
# from solders.transaction import VersionedTransaction
# from solana.rpc.async_api import AsyncClient
# from jupiter_python_sdk.jupiter import Jupiter
# from app.dependencies import get_current_user_by_wallet
# from app.models import Subscription, TokenMetadataArchive, Trade, User, TokenMetadata, NewTokens
# from app.database import AsyncSessionLocal, get_db
# from app.schemas import LogTradeRequest, SubscriptionRequest
# from app.utils import profitability_engine
# from app.utils.dexscreener_api import get_dexscreener_data
# from app.utils.raydium_apis import get_raydium_pool_info
# from app.utils.solscan_apis import get_solscan_token_meta, get_top_holders_info
# from app.utils.webacy_api import check_webacy_risk
# from app import models, database
# from app.config import settings
# from app.security import decrypt_private_key_backend
# import redis.asyncio as redis
# from app.utils.tavily_api import tavily_client
# # Generated gRPC stubs
# import sys
# sys.path.append('app/generated')
# from app.generated.geyser_pb2 import SubscribeRequest, GetVersionRequest, CommitmentLevel
# from app.generated.geyser_pb2_grpc import GeyserStub

# load_dotenv()
# logger = logging.getLogger(__name__)
# logger.setLevel(logging.INFO)
# handler = logging.StreamHandler()
# handler.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))
# logger.addHandler(handler)

# redis_client = redis.Redis(host=os.getenv("REDIS_HOST", "localhost"), port=6379, db=0)

# app = FastAPI(title="FlashSniper API", version="0.1.0")
# app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# # Active bot tasks
# active_bot_tasks: Dict[str, asyncio.Task] = {}

# from app.routers import auth, token, trade, user, util
# app.include_router(auth.router)
# app.include_router(token.router)
# app.include_router(trade.router)
# app.include_router(user.router)
# app.include_router(util.router)

# # WebSocket Manager
# class ConnectionManager:
#     def __init__(self):
#         self.active_connections: Dict[str, WebSocket] = {}

#     async def connect(self, websocket: WebSocket, wallet_address: str):
#         await websocket.accept()
#         self.active_connections[wallet_address] = websocket

#     def disconnect(self, wallet_address: str):
#         self.active_connections.pop(wallet_address, None)

#     async def send_personal_message(self, message: str, wallet_address: str):
#         ws = self.active_connections.get(wallet_address)
#         if ws:
#             try:
#                 await ws.send_text(message)
#             except:
#                 self.disconnect(wallet_address)

# websocket_manager = ConnectionManager()

# # ===================================================================
# # LIFESPAN + BACKGROUND TASKS
# # ===================================================================
# @asynccontextmanager
# async def lifespan(app: FastAPI):
#     async with database.async_engine.begin() as conn:
#         await conn.run_sync(models.Base.metadata.create_all)

#     # Start all background services
#     asyncio.create_task(safe_raydium_grpc_loop())
#     asyncio.create_task(initial_enrichment_worker())
#     asyncio.create_task(smart_refresh_worker())
#     asyncio.create_task(archive_and_cleanup_worker())

#     logger.info("Solsniper Bot v0.3 — Production Ready")
#     yield

#     await redis_client.close()
#     await database.async_engine.dispose()

# app.router.lifespan_context = lifespan

# # ===================================================================
# # 1. gRPC LOOP — Detect New Pools
# # ===================================================================
# async def safe_raydium_grpc_loop():
#     while True:
#         try:
#             await raydium_grpc_subscription_loop()
#         except Exception as e:
#             logger.error(f"gRPC loop crashed: {e}")
#             await asyncio.sleep(15)

# async def raydium_grpc_subscription_loop():
#     program_id = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"
#     grpc_url = os.getenv("GRPC_URL", "grpc.ams.shyft.to:443")
#     grpc_token = os.getenv("GRPC_TOKEN")

#     while True:
#         channel = None
#         try:
#             channel = create_grpc_channel(grpc_url, grpc_token)
#             stub = GeyserStub(channel)
#             request = SubscribeRequest(
#                 transactions={"raydium": {
#                     "vote": False, "failed": False,
#                     "account_include": [program_id]
#                 }},
#                 commitment=CommitmentLevel.CONFIRMED,
#             )

#             async for response in stub.Subscribe(iter([request])):
#                 if not response.HasField('transaction'):
#                     continue

#                 tx = response.transaction.transaction
#                 if not tx.transaction or not tx.transaction.message:
#                     continue

#                 accounts = [base58.b58encode(k).decode() for k in tx.transaction.message.account_keys]
#                 if program_id not in accounts:
#                     continue

#                 slot = response.transaction.slot
#                 sig = base58.b58encode(tx.transaction.signature).decode()
#                 pools = await find_raydium_pool_creations(response.transaction, accounts, sig, slot)
#                 if pools:
#                     await process_pool_creations(pools)

#         except Exception as e:
#             logger.error(f"gRPC error: {e}")
#         finally:
#             if channel:
#                 await channel.close()
#             await asyncio.sleep(10)

# async def find_raydium_pool_creations(tx_info, accounts, signature, slot):
#     """Extract Raydium pool creation information from transaction"""
#     program_id = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"
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

# async def process_pool_creations(pool_infos):
#     async with AsyncSessionLocal() as db:
#         saved = 0
#         for pool in pool_infos:
#             pool_data = pool["poolInfos"][0]
#             mint = pool_data["baseMint"]

#             # Deduplicate
#             exists = await db.execute(select(NewTokens).where(NewTokens.mint_address == mint))
#             if exists.scalar_one_or_none():
#                 continue

#             token = NewTokens(
#                 mint_address=mint,
#                 pool_id=pool_data["id"],
#                 timestamp=datetime.utcnow(),
#                 signature=pool["txid"],
#                 tx_type="raydium_pool_create",
#                 metadata_status="pending"
#             )
#             db.add(token)
#             saved += 1

#             # Push to Redis for instant processing
#             await redis_client.xadd("new_pools", {"mint": mint}, maxlen=5000)

#         if saved:
#             await db.commit()
#             logger.info(f"Saved {saved} new pools → queued for enrichment")

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

# # ===================================================================
# # 2. INSTANT ENRICHMENT WORKER (New Pools Only)
# # ===================================================================
# async def initial_enrichment_worker():
#     consumer_id = f"enrich-{os.getpid()}"
#     while True:
#         try:
#             streams = await redis_client.xread({"new_pools": "$"}, block=5000, count=50)
#             if not streams:
#                 continue

#             tasks = []
#             for stream, entries in streams:
#                 for entry_id, data in entries:
#                     mint = data.get(b"mint").decode()
#                     tasks.append(enrich_and_mark_processed(mint, entry_id))

#             if tasks:
#                 await asyncio.gather(*tasks, return_exceptions=True)

#         except Exception as e:
#             logger.error(f"Initial enrichment worker error: {e}")
#             await asyncio.sleep(5)

# async def enrich_and_mark_processed(mint: str, redis_entry_id: str):
#     async with AsyncSessionLocal() as db:
#         try:
#             await process_token_logic(mint, db)

#             # Only now mark as processed
#             token = await db.execute(select(NewTokens).where(NewTokens.mint_address == mint))
#             token = token.scalar_one_or_none()
#             if token:
#                 token.metadata_status = "processed"
#                 await db.commit()

#             # Ack from Redis
#             await redis_client.xdel("new_pools", redis_entry_id)

#             logger.info(f"Fully enriched & processed: {mint[:8]}")

#         except Exception as e:
#             logger.error(f"Failed to enrich {mint}: {e}")


# # ===================================================================
# # 3. SMART REFRESH LOOP — Only Active Tokens (<48h + volume)
# # ===================================================================
# async def smart_refresh_worker():
#     while True:
#         await asyncio.sleep(45)
#         try:
#             async with AsyncSessionLocal() as db:
#                 cutoff = datetime.utcnow() - timedelta(hours=48)

#                 stmt = select(TokenMetadata).where(
#                     TokenMetadata.pair_created_at > cutoff.timestamp(),
#                     TokenMetadata.last_checked_at < (datetime.utcnow() - timedelta(minutes=8))
#                 ).order_by(TokenMetadata.volume_h5.desc().nulls_last()).limit(60)

#                 tokens = (await db.execute(stmt)).scalars().all()
#                 for token in tokens:
#                     asyncio.create_task(process_token_logic(token.mint_address, db))

#         except Exception as e:
#             logger.error(f"Smart refresh error: {e}")

# # ===================================================================
# # 4. ARCHIVE + CLEANUP (Keeps Trade History Forever)
# # ===================================================================
# async def archive_and_cleanup_worker():
#     while True:
#         await asyncio.sleep(1800)  # 30 min
#         try:
#             async with AsyncSessionLocal() as db:
#                 cutoff = datetime.utcnow() - timedelta(hours=72)

#                 old_tokens = await db.execute(
#                     select(TokenMetadata).where(
#                         TokenMetadata.pair_created_at < cutoff.timestamp()
#                     ).limit(300)
#                 )
#                 old_tokens = old_tokens.scalars().all()

#                 for token in old_tokens:
#                     # Archive full snapshot
#                     archive = TokenMetadataArchive(
#                         mint_address=token.mint_address,
#                         data=json.dumps(token.__dict__, default=str)
#                     )
#                     db.add(archive)

#                     # Remove from hot tables
#                     await db.execute(delete(NewTokens).where(NewTokens.mint_address == token.mint_address))
#                     await db.delete(token)

#                 if old_tokens:
#                     await db.commit()
#                     logger.info(f"Archived & cleaned {len(old_tokens)} tokens >72h")

#         except Exception as e:
#             logger.error(f"Archive worker error: {e}")







# # ===================================================================
# # OTHER UTILITY FUNCTIONS
# # ===================================================================

# # async def apply_user_filters(user: User, token_meta: TokenMetadata, db: AsyncSession, websocket_manager: ConnectionManager) -> bool:
# #     async def log_failure(filter_name: str):
# #         logger.debug(f"Token {token_meta.mint_address} failed {filter_name} for {user.wallet_address}.")
# #         await websocket_manager.send_personal_message(
# #             json.dumps({"type": "log", "message": f"Token {token_meta.token_symbol or token_meta.mint_address} failed {filter_name} filter.", "status": "info"}),
# #             user.wallet_address
# #         )

# #     filters = [
# #         ("Socials Added", user.filter_socials_added, lambda: not token_meta.socials_present),
# #         ("Liquidity Burnt", user.filter_liquidity_burnt, lambda: not token_meta.liquidity_burnt),
# #         ("Immutable Metadata", user.filter_immutable_metadata, lambda: not token_meta.immutable_metadata),
# #         ("Mint Authority Renounced", user.filter_mint_authority_renounced, lambda: not token_meta.mint_authority_renounced),
# #         ("Freeze Authority Revoked", user.filter_freeze_authority_revoked, lambda: not token_meta.freeze_authority_revoked),
# #         (
# #             f"Insufficient Liquidity Pool Size (min {user.filter_check_pool_size_min_sol} SOL)",
# #             user.filter_check_pool_size_min_sol,
# #             lambda: token_meta.liquidity_pool_size_sol is None or token_meta.liquidity_pool_size_sol < user.filter_check_pool_size_min_sol
# #         ),
# #         (
# #             "Token Age (15m-72h)",
# #             True,
# #             lambda: not token_meta.pair_created_at or (
# #                 (age := datetime.utcnow() - datetime.utcfromtimestamp(token_meta.pair_created_at)) < timedelta(minutes=15) or
# #                 age > timedelta(hours=72)
# #             )
# #         ),
# #         ("Market Cap (< $30k)", True, lambda: token_meta.market_cap is None or float(token_meta.market_cap) < 30000),
# #         ("Holder Count (< 20)", True, lambda: token_meta.holder is None or token_meta.holder < 20),
# #         ("Webacy Risk Score (>50)", True, lambda: token_meta.webacy_risk_score is None or token_meta.webacy_risk_score > 50),
# #     ]

# #     if user.is_premium:
# #         filters.extend([
# #             (
# #                 f"Top 10 Holders % (>{user.filter_top_holders_max_pct}%)",
# #                 user.filter_top_holders_max_pct,
# #                 lambda: token_meta.top10_holders_percentage and token_meta.top10_holders_percentage > user.filter_top_holders_max_pct
# #             ),
# #             (
# #                 f"Safety Check Period (<{user.filter_safety_check_period_seconds}s)",
# #                 user.filter_safety_check_period_seconds and token_meta.pair_created_at,
# #                 lambda: (datetime.utcnow() - datetime.utcfromtimestamp(token_meta.pair_created_at)) < timedelta(seconds=user.filter_safety_check_period_seconds)
# #             ),
# #             ("Webacy Moon Potential (<80)", True, lambda: token_meta.webacy_moon_potential is None or token_meta.webacy_moon_potential < 80),
# #         ])

# #     for filter_name, condition, check in filters:
# #         if condition and check():
# #             await log_failure(filter_name)
# #             return False

# #     return True

# # async def apply_user_filters_and_trade(user: User, token: TokenMetadata, db: AsyncSession, websocket_manager: ConnectionManager):
# #     # Prevent double buys
# #     if await redis_client.exists(f"trade:{user.wallet_address}:{token.mint_address}"):
# #         return

# #     # === ONLY BUY MOONBAGS OR STRONG BUYS ===
# #     if token.trading_recommendation not in ["MOONBAG_BUY", "STRONG_BUY"]:
# #         logger.info(f"Skipping {token.token_symbol} — Not a moonbag (got {token.trading_recommendation})")
# #         return

# #     if token.profitability_confidence < 75:
# #         logger.info(f"Skipping {token.token_symbol} — Low confidence ({token.profitability_confidence}%)")
# #         return

# #     logger.info(f"MOONBAG DETECTED → {token.token_symbol} | Score: {token.profitability_score} | Buying NOW!")

# #     await redis_client.setex(f"trade:{user.wallet_address}:{token.mint_address}", 3600, "bought")

# #     await execute_user_trade(
# #         user_wallet_address=user.wallet_address,
# #         mint_address=token.mint_address,
# #         amount_sol=user.buy_amount_sol or 0.5,
# #         trade_type="buy",
# #         slippage=user.buy_slippage_bps / 10000.0,
# #         take_profit=user.sell_take_profit_pct,
# #         stop_loss=user.sell_stop_loss_pct,
# #         timeout_seconds=user.sell_timeout_seconds,
# #         trailing_stop_loss_pct=user.trailing_stop_loss_pct,
# #         db=db,
# #         websocket_manager=websocket_manager
# #     )
  
# # async def metadata_enrichment_loop():
# #     while True:
# #         try:
# #             async with AsyncSessionLocal() as db:
# #                 stmt = select(NewTokens).where(NewTokens.metadata_status == "pending").limit(10)
# #                 result = await db.execute(stmt)
# #                 tokens = result.scalars().all()
# #                 for token in tokens:
# #                     await process_token_logic(token.mint_address, db)
# #                     token.metadata_status = "processed"
# #                     await db.commit()
# #         except Exception as e:
# #             logger.error(f"Error in metadata enrichment loop: {e}")
# #         await asyncio.sleep(30)

# # async def safe_metadata_enrichment_loop():
# #     while True:
# #         try:
# #             await metadata_enrichment_loop()
# #         except Exception as e:
# #             logger.error(f"Metadata loop crashed: {e}")
# #             await asyncio.sleep(30)

# # async def update_bot_settings(settings: dict, wallet_address: str, db: AsyncSession):
# #     try:
# #         stmt = select(User).filter(User.wallet_address == wallet_address)
# #         result = await db.execute(stmt)
# #         user = result.scalar_one_or_none()
# #         if not user:
# #             raise ValueError("User not found")
# #         for key, value in settings.items():
# #             if key == "is_premium" and not user.is_premium:
# #                 continue
# #             setattr(user, key, value)
# #         await db.merge(user)
# #         await db.commit()
# #         await websocket_manager.send_personal_message(
# #             json.dumps({"type": "log", "message": "Bot settings updated", "status": "info"}),
# #             wallet_address
# #         )
# #     except Exception as e:
# #         logger.error(f"Error updating settings for {wallet_address}: {e}")
# #         await websocket_manager.send_personal_message(
# #             json.dumps({"type": "log", "message": f"Settings update error: {str(e)}", "status": "error"}),
# #             wallet_address
# #         )

# # async def handle_signed_transaction(data: dict, wallet_address: str, db: AsyncSession):
# #     try:
# #         signed_tx_base64 = data.get("signed_tx_base64")
# #         if not signed_tx_base64:
# #             raise ValueError("Missing signed transaction")
# #         async with AsyncClient(settings.SOLANA_RPC_URL) as client:
# #             signed_tx = VersionedTransaction.from_bytes(base64.b64decode(signed_tx_base64))
# #             tx_hash = await client.send_raw_transaction(signed_tx)
# #             logger.info(f"Transaction sent for {wallet_address}: {tx_hash}")
# #             await websocket_manager.send_personal_message(
# #                 json.dumps({"type": "log", "message": f"Transaction sent: {tx_hash}", "status": "info"}),
# #                 wallet_address
# #             )
# #     except Exception as e:
# #         logger.error(f"Error handling signed transaction for {wallet_address}: {e}")
# #         await websocket_manager.send_personal_message(
# #             json.dumps({"type": "log", "message": f"Transaction error: {str(e)}", "status": "error"}),
# #             wallet_address
# #         )

# # async def run_user_specific_bot_loop(user_wallet_address: str):
# #     logger.info(f"Starting bot loop for {user_wallet_address}")
# #     try:
# #         async with AsyncSessionLocal() as db:
# #             user_result = await db.execute(select(User).filter(User.wallet_address == user_wallet_address))
# #             user = user_result.scalar_one_or_none()
# #             if not user:
# #                 logger.error(f"User {user_wallet_address} not found.")
# #                 await websocket_manager.send_personal_message(
# #                     json.dumps({"type": "log", "message": "User not found. Stopping bot.", "status": "error"}),
# #                     user_wallet_address
# #                 )
# #                 return
# #             while True:
# #                 recent_time_threshold = datetime.utcnow() - timedelta(minutes=30)
# #                 stmt = select(TokenMetadata).filter(TokenMetadata.last_checked_at >= recent_time_threshold).order_by(TokenMetadata.last_checked_at.desc()).limit(10)
# #                 result = await db.execute(stmt)
# #                 tokens = result.scalars().all()
# #                 tasks = [
# #                     apply_user_filters_and_trade(user, token, db, websocket_manager)
# #                     for token in tokens
# #                     if not await redis_client.exists(f"trade:{user_wallet_address}:{token.mint_address}")
# #                 ]
# #                 await asyncio.gather(*tasks)
# #                 await asyncio.sleep(user.bot_check_interval_seconds or 10)
# #     except asyncio.CancelledError:
# #         logger.info(f"Bot task for {user_wallet_address} cancelled.")
# #     except Exception as e:
# #         logger.error(f"Error in bot loop for {user_wallet_address}: {e}")
# #         await websocket_manager.send_personal_message(
# #             json.dumps({"type": "log", "message": f"Bot error: {str(e)}", "status": "error"}),
# #             user_wallet_address
# #         )
# #     finally:
# #         if user_wallet_address in active_bot_tasks:
# #             del active_bot_tasks[user_wallet_address]
# #         logger.info(f"Bot loop for {user_wallet_address} ended.")
  
# async def execute_user_trade(
#     user_wallet_address: str,
#     mint_address: str,
#     amount_sol: float,
#     trade_type: str,
#     slippage: float,
#     take_profit: Optional[float],
#     stop_loss: Optional[float],
#     timeout_seconds: Optional[int],
#     trailing_stop_loss_pct: Optional[float],
#     db: AsyncSession,
#     websocket_manager: ConnectionManager
# ):
#     user_stmt = select(User).filter(User.wallet_address == user_wallet_address)
#     user_result = await db.execute(user_stmt)
#     user = user_result.scalar_one_or_none()
#     if not user:
#         raise ValueError("User not found")
#     rpc_url = user.custom_rpc_https if user.is_premium and user.custom_rpc_https else settings.SOLANA_RPC_URL
#     async with AsyncClient(rpc_url) as client:
#         try:
#             encrypted_private_key = user.encrypted_private_key.encode()
#             private_key_bytes = decrypt_private_key_backend(encrypted_private_key)
#             keypair = Keypair.from_bytes(private_key_bytes)
#             jupiter = Jupiter(client, keypair)
#             quote = await jupiter.get_quote(
#                 input_mint="So11111111111111111111111111111111111111112" if trade_type == "buy" else mint_address,
#                 output_mint=mint_address if trade_type == "buy" else "So11111111111111111111111111111111111111112",
#                 amount=int(amount_sol * 1_000_000_000),
#                 slippage_bps=int(slippage * 10000)
#             )
#             recent_fees = await client.get_recent_prioritization_fees()
#             priority_fee = max(fee.micro_lamports for fee in recent_fees.value) if recent_fees.value else 100_000
#             swap_transaction = await jupiter.swap(
#                 quote=quote,
#                 user_public_key=Pubkey.from_string(user_wallet_address),
#                 priority_fee_micro_lamports=priority_fee
#             )
#             raw_tx = base64.b64encode(swap_transaction.serialize()).decode()
#             trade_instruction_message = {
#                 "type": "trade_instruction",
#                 "trade_type": trade_type,
#                 "mint_address": mint_address,
#                 "amount_sol": amount_sol,
#                 "slippage": slippage,
#                 "take_profit": take_profit,
#                 "stop_loss": stop_loss,
#                 "timeout_seconds": timeout_seconds,
#                 "trailing_stop_loss_pct": trailing_stop_loss_pct,
#                 "raw_tx_base64": raw_tx,
#                 "last_valid_block_height": quote["last_valid_block_height"],
#                 "message": f"Execute {trade_type} trade for {mint_address}."
#             }
#             await websocket_manager.send_personal_message(
#                 json.dumps(trade_instruction_message),
#                 user_wallet_address
#             )
#             if trade_type == "buy":
#                 asyncio.create_task(monitor_trade_for_sell(
#                     user_wallet_address, mint_address, take_profit, stop_loss, timeout_seconds, trailing_stop_loss_pct, db, websocket_manager
#                 ))
#         except Exception as e:
#             logger.error(f"Error executing trade for {user_wallet_address}: {e}")
#             await websocket_manager.send_personal_message(
#                 json.dumps({"type": "log", "message": f"Trade error: {str(e)}", "status": "error"}),
#                 user_wallet_address
#             )

# async def monitor_trade_for_sell(
#     user_wallet_address: str,
#     mint_address: str,
#     take_profit: Optional[float],
#     stop_loss: Optional[float],
#     timeout_seconds: Optional[int],
#     trailing_stop_loss_pct: Optional[float],
#     db: AsyncSession,
#     websocket_manager: ConnectionManager
# ):
#     logger.info(f"Monitoring trade for {user_wallet_address} on {mint_address}")
#     start_time = datetime.utcnow()
#     highest_price = None
#     while True:
#         try:
#             dex_data = await get_dexscreener_data(mint_address)
#             if not dex_data:
#                 await websocket_manager.send_personal_message(
#                     json.dumps({"type": "log", "message": f"Failed to fetch price for {mint_address}. Retrying...", "status": "error"}),
#                     user_wallet_address
#                 )
#                 await asyncio.sleep(10)
#                 continue
#             current_price = float(dex_data.get("price_usd", 0))
#             trade_stmt = select(Trade).filter(
#                 Trade.user_wallet_address == user_wallet_address,
#                 Trade.mint_address == mint_address,
#                 Trade.trade_type == "buy"
#             ).order_by(Trade.buy_timestamp.desc())
#             trade_result = await db.execute(trade_stmt)
#             trade = trade_result.scalar_one_or_none()
#             if not trade:
#                 logger.error(f"No buy trade found for {user_wallet_address} and {mint_address}")
#                 break
#             buy_price = trade.price_usd_at_trade or 0
#             if timeout_seconds and (datetime.utcnow() - start_time).total_seconds() > timeout_seconds:
#                 await execute_user_trade(
#                     user_wallet_address, mint_address, trade.amount_tokens, "sell", 0.05, None, None, None, None, db, websocket_manager
#                 )
#                 await websocket_manager.send_personal_message(
#                     json.dumps({"type": "log", "message": f"Selling {mint_address} due to timeout.", "status": "info"}),
#                     user_wallet_address
#                 )
#                 break
#             if trailing_stop_loss_pct and current_price > (highest_price or buy_price):
#                 highest_price = current_price
#                 stop_loss = highest_price * (1 - trailing_stop_loss_pct / 100)
#             if take_profit and current_price >= buy_price * (1 + take_profit / 100):
#                 await execute_user_trade(
#                     user_wallet_address, mint_address, trade.amount_tokens, "sell", 0.05, None, None, None, None, db, websocket_manager
#                 )
#                 await websocket_manager.send_personal_message(
#                     json.dumps({"type": "log", "message": f"Selling {mint_address} at take-profit.", "status": "info"}),
#                     user_wallet_address
#                 )
#                 break
#             if stop_loss and current_price <= buy_price * (1 - stop_loss / 100):
#                 await execute_user_trade(
#                     user_wallet_address, mint_address, trade.amount_tokens, "sell", 0.05, None, None, None, None, db, websocket_manager
#                 )
#                 await websocket_manager.send_personal_message(
#                     json.dumps({"type": "log", "message": f"Selling {mint_address} at stop-loss.", "status": "info"}),
#                     user_wallet_address
#                 )
#                 break
#             await asyncio.sleep(5)
#         except Exception as e:
#             logger.error(f"Error monitoring trade for {mint_address}: {e}")
#             await websocket_manager.send_personal_message(
#                 json.dumps({"type": "log", "message": f"Error monitoring {mint_address}: {str(e)}", "status": "error"}),
#                 user_wallet_address
#             )
#             await asyncio.sleep(10)
            
# # async def broadcast_trade(trade: Trade):
# #     message = {
# #         "type": "trade_update",
# #         "trade": {
# #             "id": trade.id,
# #             "trade_type": trade.trade_type,
# #             "amount_sol": trade.amount_sol_in or trade.amount_sol_out or 0,
# #             "token_symbol": trade.token_symbol or "Unknown",
# #             "timestamp": trade.created_at.isoformat() if trade.created_at else None,
# #         }
# #     }
# #     await websocket_manager.send_personal_message(json.dumps(message), trade.user_wallet_address)
        
# # async def safe_raydium_grpc_loop():
# #     while True:
# #         try:
# #             await raydium_grpc_subscription_loop()
# #         except Exception as e:
# #             logger.error(f"Raydium loop crashed: {e}")
# #             await asyncio.sleep(30)

# # async def raydium_grpc_subscription_loop():
# #     program_id = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"
# #     create_pool_fee_account = "7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eqaYcHQqtj2G5"
# #     grpc_url = os.getenv("GRPC_URL", "grpc.ams.shyft.to:443")
# #     grpc_token = os.getenv("GRPC_TOKEN", "30c7ef87-5bf0-4d70-be9f-3ea432922437")

# #     while True:
# #         channel = None
# #         try:
# #             # Only log connection attempts, not every loop iteration
# #             logger.info(f"Starting Raydium gRPC loop with URL: {grpc_url}")
# #             channel = create_grpc_channel(grpc_url, grpc_token)
# #             stub = GeyserStub(channel)

# #             subscribe_request = SubscribeRequest(
# #                 transactions={
# #                     "raydium_pools": {
# #                         "vote": False,
# #                         "failed": False,
# #                         "account_include": [program_id, create_pool_fee_account],
# #                     }
# #                 },
# #                 commitment=CommitmentLevel.CONFIRMED,
# #             )

# #             # Remove the 30-second status logging
# #             async for response in stub.Subscribe(iter([subscribe_request])):
# #                 # Only process transaction updates
# #                 if not response.HasField('transaction'):
# #                     continue

# #                 tx_info = response.transaction
                
# #                 # Get signature from the nested transaction
# #                 signature = None
# #                 if (hasattr(tx_info, 'transaction') and tx_info.transaction and
# #                     hasattr(tx_info.transaction, 'signature') and tx_info.transaction.signature):
# #                     signature_bytes = tx_info.transaction.signature
# #                     signature = base58.b58encode(signature_bytes).decode()
# #                 else:
# #                     continue

# #                 # Get slot information
# #                 slot = getattr(tx_info, 'slot', 0)

# #                 # Extract account keys
# #                 accounts = []
# #                 try:
# #                     if (hasattr(tx_info, 'transaction') and tx_info.transaction and
# #                         hasattr(tx_info.transaction, 'transaction') and tx_info.transaction.transaction and
# #                         hasattr(tx_info.transaction.transaction, 'message') and tx_info.transaction.transaction.message and
# #                         hasattr(tx_info.transaction.transaction.message, 'account_keys')):
                        
# #                         account_keys = tx_info.transaction.transaction.message.account_keys
# #                         accounts = [base58.b58encode(key).decode() for key in account_keys]
                        
# #                         # Check if Raydium program is in accounts
# #                         if program_id in accounts:
# #                             # Look for Raydium pool creation instructions
# #                             pool_infos = await find_raydium_pool_creations(tx_info, accounts, signature, slot)
                            
# #                             if pool_infos:
# #                                 # Only log when pools are actually found and processed
# #                                 logger.info(f"🎯 New pool creation detected! Processing {len(pool_infos)} pool(s)")
# #                                 await process_pool_creations(pool_infos)
                            
# #                     else:
# #                         continue
                            
# #                 except Exception as e:
# #                     # Only log errors, not every extraction attempt
# #                     logger.error(f"Error extracting account keys: {e}")
# #                     continue

# #         except grpc.aio.AioRpcError as e:
# #             logger.error("gRPC error in Raydium loop: %s - %s", e.code(), e.details())
# #             await asyncio.sleep(10)
# #         except Exception as e:
# #             logger.error("Unexpected error in Raydium gRPC loop: %s", e)
# #             await asyncio.sleep(10)
# #         finally:
# #             if channel is not None:
# #                 await channel.close()
# #             # Don't log every retry, only log if there was an actual issue
# #             await asyncio.sleep(10)

# # async def track_raydium_transaction_types(signature, accounts, instructions):
# #     """Track and log the types of Raydium transactions we're seeing"""
# #     program_id = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"
    
# #     if program_id not in accounts:
# #         return
    
# #     raydium_instructions = []
# #     for instruction in instructions:
# #         try:
# #             if (hasattr(instruction, 'program_id_index') and 
# #                 instruction.program_id_index < len(accounts) and
# #                 accounts[instruction.program_id_index] == program_id and
# #                 hasattr(instruction, 'data') and instruction.data and len(instruction.data) > 0):
                
# #                 opcode = instruction.data[0]
# #                 raydium_instructions.append(opcode)
# #         except:
# #             continue
    
# #     if raydium_instructions:
# #         logger.info(f"Raydium transaction {signature} has opcodes: {raydium_instructions}")

# # def analyze_transaction_type(accounts):
# #     """Quick analysis of transaction type based on accounts"""
# #     common_programs = {
# #         "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA": "Token Program",
# #         "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL": "Associated Token Program",
# #         "11111111111111111111111111111111": "System Program",
# #         "ComputeBudget111111111111111111111111111111": "Compute Budget Program",
# #         "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8": "Raydium AMM V4",
# #         "srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX": "OpenBook DEX",
# #     }
    
# #     found_programs = []
# #     for account in accounts:
# #         if account in common_programs:
# #             found_programs.append(common_programs[account])
    
# #     return found_programs
 
            

# # ===================================================================
# # ALL MAIN ENDPOINTS STARTS HERE 
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

# @app.websocket("/ws/logs/{wallet_address}")
# async def websocket_endpoint(websocket: WebSocket, wallet_address: str):
#     await websocket_manager.connect(websocket, wallet_address)
#     try:
#         async with AsyncSessionLocal() as db:
#             result = await db.execute(
#                 select(Trade)
#                 .filter_by(user_wallet_address=wallet_address)   # ← FIXED
#                 .order_by(Trade.id.desc())                      # ← better than created_at which doesn't exist
#                 .limit(50)
#             )
#             trades = result.scalars().all()
#             for trade in trades:
#                 await websocket.send_json({
#                     "type": "trade_update",
#                     "trade": {
#                         "id": trade.id,
#                         "trade_type": trade.trade_type,
#                         "amount_sol": trade.amount_sol_in or trade.amount_sol_out or 0,
#                         "token_symbol": trade.token_symbol or "Unknown",
#                         "timestamp": trade.created_at.isoformat() if trade.created_at else None,
#                     }
#                 })
        
#         while True:
#             data = await websocket.receive_text()
#             if data:
#                 try:
#                     message = json.loads(data)
#                     if message.get("type") == "health_response":
#                         logger.info(f"Received health response from {wallet_address}")
#                 except json.JSONDecodeError:
#                     logger.error(f"Invalid WebSocket message from {wallet_address}")
#     except WebSocketDisconnect:
#         websocket_manager.disconnect(wallet_address)
#     except Exception as e:
#         logger.error(f"WebSocket error for {wallet_address}: {str(e)}")
#         websocket_manager.disconnect(wallet_address)

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

# @app.get("/trade/history")
# async def get_trade_history(
#     current_user: User = Depends(get_current_user_by_wallet),
#     db: AsyncSession = Depends(get_db)
# ):
#     trades = await db.execute(
#         select(Trade)
#         .where(Trade.user_wallet_address == current_user.wallet_address)
#         .order_by(Trade.buy_timestamp.desc())
#     )
#     trades = trades.scalars().all()

#     result = []
#     for trade in trades:
#         item = trade.__dict__.copy()

#         # Try live metadata
#         meta = await db.get(TokenMetadata, trade.mint_address)
#         if meta and meta.token_symbol:
#             item["token_symbol"] = meta.token_symbol
#             item["token_name"] = meta.token_name or "Unknown"
#             item["token_logo_uri"] = meta.token_logo_uri
#         else:
#             # Fallback to archive
#             arch = await db.execute(
#                 select(TokenMetadataArchive.data)
#                 .where(TokenMetadataArchive.mint_address == trade.mint_address)
#                 .order_by(TokenMetadataArchive.archived_at.desc())
#             )
#             data = arch.scalar()
#             if data:
#                 archived = json.loads(data)
#                 item["token_symbol"] = archived.get("token_symbol", trade.mint_address[:8])
#                 item["token_name"] = archived.get("token_name", "Unknown Token")
#                 item["token_logo_uri"] = archived.get("token_logo_uri")

#         result.append(item)

#     return result

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

# @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=4, max=10))
# async def process_token_logic(mint: str, db: AsyncSession):
#     try:
#         logger.info(f"2025 Moonbag Analysis → {mint}")

#         # 1. Get or create token
#         result = await db.execute(select(TokenMetadata).where(TokenMetadata.mint_address == mint))
#         token = result.scalars().first()
#         if not token:
#             token = TokenMetadata(mint_address=mint)
#             db.add(token)
#             await db.flush()  # Get ID if needed

#         # 2. FETCH ALL 4 DATA SOURCES IN PARALLEL (THE RIGHT WAY)
#         try:
#             # DO NOT CALL THE FUNCTIONS — PASS THEM!
#             dex_task = get_dexscreener_data(mint)
#             raydium_task = get_raydium_pool_info(mint)
#             webacy_task = check_webacy_risk(mint)

#             # Tavily needs symbol → get it from dexscreener first OR fallback
#             # So we fetch dexscreener FIRST (it's fastest), then use symbol for tavily
#             dex_data = await dex_task  # ← Await only this one first

#             token_symbol = "UNKNOWN"
#             token_name = "Unknown Token"
#             if dex_data:
#                 token_symbol = dex_data.get("token_symbol", "UNKNOWN")
#                 token_name = dex_data.get("token_name", "Unknown Token")

#             # Now run the rest in parallel, including Tavily with correct symbol
#             raydium_data, webacy_data, tavily_data = await asyncio.gather(
#                 raydium_task,
#                 webacy_task,
#                 tavily_client.analyze_sentiment(token_name, token_symbol),  # ← NOW WITH SYMBOL!
#                 return_exceptions=True
#             )

#         except Exception as e:
#             logger.error(f"Parallel fetch failed for {mint}: {e}")
#             dex_data = {}
#             raydium_data = {}
#             webacy_data = {}
#             tavily_data = {}
#             token_symbol = "UNKNOWN"

#         # Graceful fallbacks
#         dex_data = dex_data if not isinstance(dex_data, Exception) else {}
#         raydium_data = raydium_data if not isinstance(raydium_data, Exception) else {}
#         webacy_data = webacy_data if not isinstance(webacy_data, Exception) else {}
#         tavily_data = tavily_data if not isinstance(tavily_data, Exception) else {}
        
#         # 3. POPULATE DEXSCREENER DATA (for frontend + basic checks)
#         if dex_data:
#             token.dexscreener_url = dex_data.get("dexscreener_url")
#             token.pair_address = dex_data.get("pair_address")
#             token.price_native = dex_data.get("price_native")
#             token.price_usd = dex_data.get("price_usd")
#             token.market_cap = dex_data.get("market_cap")
#             token.pair_created_at = dex_data.get("pair_created_at")
#             token.websites = dex_data.get("websites")
#             token.twitter = dex_data.get("twitter")
#             token.telegram = dex_data.get("telegram")
#             token.token_name = dex_data.get("token_name")
#             token.token_symbol = dex_data.get("token_symbol")
#             token.dex_id = dex_data.get("dex_id")
#             token.volume_h24 = dex_data.get("volume_h24")
#             token.volume_h6 = dex_data.get("volume_h6")
#             token.volume_h1 = dex_data.get("volume_h1")
#             token.volume_m5 = dex_data.get("volume_m5")
#             token.price_change_h1 = dex_data.get("price_change_h1")
#             token.price_change_m5 = dex_data.get("price_change_m5")
#             token.price_change_h6 = dex_data.get("price_change_h6")
#             token.price_change_h24 = dex_data.get("price_change_h24")
#             token.socials_present = bool(dex_data.get("twitter") or dex_data.get("telegram") or dex_data.get("websites"))

#         # 4. POPULATE RAYDIUM DATA (critical for real metrics)
#         if raydium_data.get("data"):
#             pool = raydium_data["data"][0]

#             token.program_id = pool.get("programId")
#             token.pool_id = pool.get("id")
#             token.open_time = pool.get("openTime")
#             token.tvl = pool.get("tvl")
#             token.fee_rate = pool.get("feeRate")
#             token.pool_type = ", ".join(pool.get("pooltype", []))
#             token.market_id = pool.get("marketId")

#             # Mint A (the token)
#             if pool.get("mintA"):
#                 ma = pool["mintA"]
#                 token.mint_a = ma.get("address")
#                 token.token_decimals = ma.get("decimals")
#                 token.token_logo_uri = ma.get("logoURI")
#                 if not token.token_name or token.token_name == "Unknown":
#                     token.token_name = ma.get("name")
#                 if not token.token_symbol or token.token_symbol == "UNKNOWN":
#                     token.token_symbol = ma.get("symbol")

#             # Mint B (WSOL)
#             if pool.get("mintB"):
#                 token.mint_b = pool["mintB"].get("address")

#             # Amounts
#             token.mint_amount_a = pool.get("mintAmountA")
#             token.mint_amount_b = pool.get("mintAmountB")

#             # LP Token
#             if pool.get("lpMint"):
#                 token.lp_mint = pool["lpMint"].get("address")
#             token.lp_price = pool.get("lpPrice")
#             token.lp_amount = pool.get("lpAmount")

#             # Burn & migrate
#             token.burn_percent = pool.get("burnPercent", 0)
#             token.liquidity_burnt = token.burn_percent == 100
#             token.liquidity_pool_size_sol = pool.get("tvl")
#             token.launch_migrate_pool = pool.get("launchMigratePool", False)

#             # Stats (day/week/month)
#             for period in ["day", "week", "month"]:
#                 if pool.get(period):
#                     data = pool[period]
#                     setattr(token, f"{period}_volume", data.get("volume"))
#                     setattr(token, f"{period}_volume_quote", data.get("volumeQuote"))
#                     setattr(token, f"{period}_volume_fee", data.get("volumeFee"))
#                     setattr(token, f"{period}_apr", data.get("apr"))
#                     setattr(token, f"{period}_fee_apr", data.get("feeApr"))
#                     setattr(token, f"{period}_price_min", data.get("priceMin"))
#                     setattr(token, f"{period}_price_max", data.get("priceMax"))

#         # 5. Webacy Risk
#         if webacy_data:
#             token.webacy_risk_score = webacy_data.get("risk_score")
#             token.webacy_risk_level = webacy_data.get("risk_level")
#             token.webacy_moon_potential = webacy_data.get("moon_potential")

#         # 6. RUN THE 2025 PROFITABILITY ENGINE
#         try:
#             analysis = await profitability_engine.analyze_token(
#                 mint=mint,
#                 token_data=token.__dict__,
#                 webacy_data=webacy_data,
#                 tavily_data=tavily_data,
#                 raydium_data=raydium_data
#             )

#             token.profitability_score = analysis.final_score
#             token.profitability_confidence = analysis.confidence
#             token.trading_recommendation = analysis.recommendation
#             token.risk_score = analysis.risk_score
#             token.moon_potential = analysis.moon_potential
#             token.holder_concentration = analysis.holder_concentration
#             token.liquidity_score = analysis.liquidity_score
#             token.reasons = " | ".join(analysis.reasons[:5])

#             logger.info(f"MOONBAG SCAN → {token.token_symbol or mint[:8]} | "
#                         f"{analysis.recommendation} | Score: {analysis.final_score:.1f} | "
#                         f"Confidence: {analysis.confidence:.0f}%")

#             # ALERT ALL USERS ON MOONBAG
#             if analysis.recommendation == "MOONBAG_BUY":
#                 alert = {
#                     "type": "moonbag_detected",
#                     "mint": mint,
#                     "symbol": token.token_symbol or "UNKNOWN",
#                     "name": token.token_name or "Unknown",
#                     "price_usd": token.price_usd,
#                     "tvl": token.tvl,
#                     "score": round(analysis.final_score, 1),
#                     "confidence": round(analysis.confidence),
#                     "reasons": analysis.reasons,
#                     "logo": token.token_logo_uri,
#                     "dexscreener": token.dexscreener_url
#                 }
#                 for wallet in websocket_manager.active_connections.keys():
#                     await websocket_manager.send_personal_message(json.dumps(alert), wallet)

#         except Exception as e:
#             logger.error(f"Profitability engine crashed for {mint}: {e}")
#             token.trading_recommendation = "ERROR"
#             token.reasons = f"Engine error: {str(e)[:100]}"

#         # 7. Final save
#         token.last_checked_at = datetime.utcnow()
#         await db.merge(token)
#         await db.commit()

#         # Cache for 10 minutes
#         safe_dict = {k: v for k, v in token.__dict__.items() if not k.startswith('_')}
#         await redis_client.setex(f"token_metadata:{mint}", 600, json.dumps(safe_dict))

#     except Exception as e:
#         logger.error(f"CRITICAL FAILURE in process_token_logic for {mint}: {e}", exc_info=True)
#         await db.rollback()































































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
from jupiter_python_sdk.jupiter import Jupiter
from app.dependencies import get_current_user_by_wallet
from app.models import Subscription, TokenMetadataArchive, Trade, User, TokenMetadata, NewTokens
from app.database import AsyncSessionLocal, get_db
from app.schemas import LogTradeRequest, SubscriptionRequest
from app.utils.profitability_engine import engine as profitability_engine
from app.utils.dexscreener_api import get_dexscreener_data
from app.utils.webacy_api import check_webacy_risk
from app import models, database
from app.config import settings
from app.security import decrypt_private_key_backend
import redis.asyncio as redis
from app.utils.bot_components import ConnectionManager, execute_user_buy, websocket_manager

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

# Configure logger
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setLevel(logging.INFO)
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.propagate = False

# Redis client
redis_client = redis.Redis(host=os.getenv("REDIS_HOST", "localhost"), port=6379, db=0)

# FastAPI app
app = FastAPI(
    title="Solsniper API",
    description="A powerful Solana sniping bot with AI analysis and rug pull protection.",
    version="0.2.0",
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # DEV ONLY
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
                    
                    # Check balance
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
                    await process_user_specific_tokens(user, db)
                    
                # Heartbeat - update every cycle
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
    
async def process_user_specific_tokens(user: User, db: AsyncSession):
    """Process tokens specifically for a user based on their filters"""
    # Get recently processed tokens (last 5 minutes)
    recent_time = datetime.utcnow() - timedelta(minutes=5)
    
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
        # Check if user already has position
        existing_trade = await db.execute(
            select(Trade).where(
                Trade.user_wallet_address == user.wallet_address,
                Trade.mint_address == token.mint_address,
                Trade.sell_timestamp.is_(None)
            )
        )
        if existing_trade.scalar_one_or_none():
            continue
        
        # Apply user-specific filters
        if await apply_user_filters(user, token, db, websocket_manager):
            # Execute buy
            await execute_user_buy(user, token, db, websocket_manager)
            # Small delay between buys
            await asyncio.sleep(1)

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

# Update lifespan to restore bots
@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        async with database.async_engine.begin() as conn:
            await conn.run_sync(models.Base.metadata.create_all)
        
        # Start core services
        asyncio.create_task(safe_raydium_grpc_loop())
        asyncio.create_task(safe_metadata_enrichment_loop())
        asyncio.create_task(restore_persistent_bots())  # ADD THIS LINE
        
        logger.info("🚀 Production backend started successfully with persistent bots")
        yield
    except Exception as e:
        logger.error(f"❌ Startup failed: {e}")
        raise
    finally:
        # Cancel all bot tasks
        for task in active_bot_tasks.values():
            task.cancel()
        await asyncio.gather(*active_bot_tasks.values(), return_exceptions=True)
        await redis_client.close()
        await database.async_engine.dispose()

# Attach lifespan to app
app.router.lifespan_context = lifespan


# Active bot tasks
active_bot_tasks: Dict[str, asyncio.Task] = {}


# ===================================================================
# 2a. gRPC LOOP — Detect New Pools
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

async def safe_raydium_grpc_loop():
    while True:
        try:
            await raydium_grpc_subscription_loop()
        except Exception as e:
            logger.error(f"Raydium loop crashed: {e}")
            await asyncio.sleep(30)

async def safe_metadata_enrichment_loop():
    while True:
        try:
            await metadata_enrichment_loop()
        except Exception as e:
            logger.error(f"Metadata loop crashed: {e}")
            await asyncio.sleep(30)
        
async def raydium_grpc_subscription_loop():
    program_id = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"
    create_pool_fee_account = "7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eqaYcHQqtj2G5"
    grpc_url = os.getenv("GRPC_URL", "grpc.ams.shyft.to:443")
    grpc_token = os.getenv("GRPC_TOKEN", "30c7ef87-5bf0-4d70-be9f-3ea432922437")

    while True:
        channel = None
        try:
            # Only log connection attempts, not every loop iteration
            logger.info(f"Starting Raydium gRPC loop with URL: {grpc_url}")
            channel = create_grpc_channel(grpc_url, grpc_token)
            stub = GeyserStub(channel)

            subscribe_request = SubscribeRequest(
                transactions={
                    "raydium_pools": {
                        "vote": False,
                        "failed": False,
                        "account_include": [program_id, create_pool_fee_account],
                    }
                },
                commitment=CommitmentLevel.CONFIRMED,
            )

            # Remove the 30-second status logging
            async for response in stub.Subscribe(iter([subscribe_request])):
                # Only process transaction updates
                if not response.HasField('transaction'):
                    continue

                tx_info = response.transaction
                
                # Get signature from the nested transaction
                signature = None
                if (hasattr(tx_info, 'transaction') and tx_info.transaction and
                    hasattr(tx_info.transaction, 'signature') and tx_info.transaction.signature):
                    signature_bytes = tx_info.transaction.signature
                    signature = base58.b58encode(signature_bytes).decode()
                else:
                    continue

                # Get slot information
                slot = getattr(tx_info, 'slot', 0)

                # Extract account keys
                accounts = []
                try:
                    if (hasattr(tx_info, 'transaction') and tx_info.transaction and
                        hasattr(tx_info.transaction, 'transaction') and tx_info.transaction.transaction and
                        hasattr(tx_info.transaction.transaction, 'message') and tx_info.transaction.transaction.message and
                        hasattr(tx_info.transaction.transaction.message, 'account_keys')):
                        
                        account_keys = tx_info.transaction.transaction.message.account_keys
                        accounts = [base58.b58encode(key).decode() for key in account_keys]
                        
                        # Check if Raydium program is in accounts
                        if program_id in accounts:
                            # Look for Raydium pool creation instructions
                            pool_infos = await find_raydium_pool_creations(tx_info, accounts, signature, slot)
                            
                            if pool_infos:
                                # Only log when pools are actually found and processed
                                logger.info(f"🎯 New pool creation detected! Processing {len(pool_infos)} pool(s)")
                                await process_pool_creations(pool_infos)
                            
                    else:
                        continue
                            
                except Exception as e:
                    # Only log errors, not every extraction attempt
                    logger.error(f"Error extracting account keys: {e}")
                    continue

        except grpc.aio.AioRpcError as e:
            logger.error("gRPC error in Raydium loop: %s - %s", e.code(), e.details())
            await asyncio.sleep(10)
        except Exception as e:
            logger.error("Unexpected error in Raydium gRPC loop: %s", e)
            await asyncio.sleep(10)
        finally:
            if channel is not None:
                await channel.close()
            # Don't log every retry, only log if there was an actual issue
            await asyncio.sleep(10)

async def find_raydium_pool_creations(tx_info, accounts, signature, slot):
    """Extract Raydium pool creation information from transaction"""
    program_id = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"
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

async def process_pool_creations(pool_infos):
    """Only save to NewTokens with delay — DO NOT process immediately"""
    async with AsyncSessionLocal() as db_session:
        try:
            pools_saved = 0
            for pool in pool_infos:
                pool_data = pool["poolInfos"][0]
                pool_id = pool_data["id"]
                mint = pool_data["baseMint"]

                # === PREVENT DUPLICATES (by pool_id OR mint) ===
                exists_pool = await db_session.get(NewTokens, pool_id)
                if exists_pool:
                    continue

                exists_mint = await db_session.execute(
                    select(NewTokens).where(NewTokens.mint_address == mint)
                )
                if exists_mint.scalar_one_or_none():
                    continue  # Same token already in queue (e.g. pump.fun → Raydium)

                # === Fetch decimals (fast) ===
                try:
                    async with AsyncClient(settings.SOLANA_RPC_URL) as client:
                        base_acc, quote_acc = await asyncio.gather(
                            client.get_account_info(Pubkey.from_string(mint)),
                            client.get_account_info(Pubkey.from_string(pool_data["quoteMint"]))
                        )
                        base_decimals = base_acc.value.data[44] if base_acc.value and len(base_acc.value.data) > 44 else 9
                        quote_decimals = quote_acc.value.data[44] if quote_acc.value and len(quote_acc.value.data) > 44 else 6
                except:
                    base_decimals = quote_decimals = 9

                # === INSERT WITH DELAY ===
                new_token = NewTokens(
                    pool_id=pool_id,
                    mint_address=mint,
                    timestamp=datetime.utcnow(),
                    signature=pool["txid"],
                    tx_type="raydium_pool_create",
                    metadata_status="pending",
                    next_reprocess_time=datetime.utcnow() + timedelta(seconds=28),  # Critical delay
                    dexscreener_processed=False,
                )
                db_session.add(new_token)
                pools_saved += 1

            if pools_saved > 0:
                await db_session.commit()
                logger.info(f"Saved {pools_saved} new pool(s) → delayed processing in 28s")

                # Notify frontend
                for wallet in websocket_manager.active_connections.keys():
                    for pool in pool_infos:
                        await websocket_manager.send_personal_message(json.dumps({
                            "type": "new_pool",
                            "pool": pool["poolInfos"][0],
                            "status": "indexing_soon"
                        }), wallet)
            else:
                logger.info("No new unique pools to save")

        except Exception as e:
            logger.error(f"Error in process_pool_creations: {e}", exc_info=True)
            await db_session.rollback()

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
# 2b. NEW: Smart DexScreener Fetch with Retry + Delay
# ===================================================================
async def fetch_dexscreener_with_retry(mint: str, max_attempts: int = 9) -> dict:
    for attempt in range(max_attempts):
        data = await get_dexscreener_data(mint)
        price_usd = 0.0
        if data and data.get("price_usd"):
            try:
                price_usd = float(data["price_usd"])
            except (ValueError, TypeError):
                price_usd = 0.0

        if price_usd > 0:
            logger.info(f"DexScreener ready → {mint[:8]} | ${price_usd:.10f} | MC: ${data.get('market_cap', 0):,.0f} | Attempt {attempt + 1}")
            return data

        delay = min(8 + (attempt ** 2) * 7, 160)
        logger.info(f"DexScreener not ready {mint[:8]} → waiting {delay}s (attempt {attempt+1})")
        await asyncio.sleep(delay)

    logger.warning(f"DexScreener failed permanently for {mint[:8]}")
    return {}

def safe_float(value, default=0.0) -> float:
    try:
        return float(value) if value not in (None, "", "null") else default
    except:
        return default
    
@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=4, max=10))
async def process_token_logic(mint_address: str, db: AsyncSession):
    try:
        start_time = datetime.utcnow()
        logger.info(f"2025 Moonbag Analysis → {mint_address[:8]}...")

        # 1. Get or create token
        result = await db.execute(select(TokenMetadata).where(TokenMetadata.mint_address == mint_address))
        token = result.scalars().first()
        if not token:
            token = TokenMetadata(mint_address=mint_address)
            db.add(token)
            await db.flush()

        # 2. Wait for DexScreener (CRITICAL — do not proceed without price)
        dex_data = await fetch_dexscreener_with_retry(mint_address)
        if not dex_data:
            token.trading_recommendation = "NO_DEXSCREENER"
            token.last_checked_at = datetime.utcnow()
            await db.merge(token)
            await db.commit()
            return

        # Populate DexScreener data
        if dex_data:
            token.dexscreener_url = dex_data.get("dexscreener_url")
            token.pair_address = dex_data.get("pair_address")
            token.price_native = safe_float(dex_data.get("price_native"))
            token.price_usd = safe_float(dex_data.get("price_usd"))
            token.market_cap = safe_float(dex_data.get("market_cap"))
            token.pair_created_at = dex_data.get("pair_created_at")
            token.websites = dex_data.get("websites")
            token.twitter = dex_data.get("twitter")
            token.telegram = dex_data.get("telegram")
            token.token_name = dex_data.get("token_name")
            token.token_symbol = dex_data.get("token_symbol")
            token.dex_id = dex_data.get("dex_id")
            token.volume_h24 = safe_float(dex_data.get("volume_h24"))
            token.volume_h6 = safe_float(dex_data.get("volume_h6"))
            token.volume_h1 = safe_float(dex_data.get("volume_h1"))
            token.volume_m5 = safe_float(dex_data.get("volume_m5"))
            token.price_change_h1 = safe_float(dex_data.get("price_change_h1"))
            token.price_change_m5 = safe_float(dex_data.get("price_change_m5"))
            token.price_change_h6 = safe_float(dex_data.get("price_change_h6"))
            token.price_change_h24 = safe_float(dex_data.get("price_change_h24"))
            token.socials_present = bool(dex_data.get("twitter") or dex_data.get("telegram") or dex_data.get("websites"))

        # 3. Wait for Raydium data with proper retry logic
        raydium_data = {}
        webacy_data = {}
        
        try:
            # Start Webacy immediately (it's fast)
            webacy_task = asyncio.create_task(check_webacy_risk(mint_address))
            
            # Get Webacy result
            webacy_data = await webacy_task
            webacy_data = webacy_data if not isinstance(webacy_data, Exception) else {}
            
        except Exception as e:
            logger.error(f"Error in data fetch for {mint_address[:8]}: {e}")
            webacy_data = webacy_data if not isinstance(webacy_data, Exception) else {}

        # 5. Webacy Risk
        if webacy_data and isinstance(webacy_data, dict):
            token.webacy_risk_score = safe_float(webacy_data.get("risk_score"))
            token.webacy_risk_level = webacy_data.get("risk_level")
            token.webacy_moon_potential = webacy_data.get("moon_potential")

        # 6. PROFITABILITY ENGINE
        try:
            # Prepare safe data for analysis
            token_dict = {}
            for key, value in token.__dict__.items():
                if not key.startswith('_'):
                    # Convert datetime to string for JSON serialization
                    if isinstance(value, datetime):
                        token_dict[key] = value.isoformat()
                    else:
                        token_dict[key] = value
            
            analysis = await profitability_engine.analyze_token(
                mint=mint_address,
                token_data=token_dict,  # Use safe dict instead of __dict__
                webacy_data=webacy_data or {}
            )
            
            token.profitability_score = analysis.final_score
            token.profitability_confidence = analysis.confidence
            token.trading_recommendation = analysis.recommendation
            token.risk_score = analysis.risk_score
            token.moon_potential = analysis.moon_potential
            token.holder_concentration = analysis.holder_concentration
            token.liquidity_score = analysis.liquidity_score
            token.reasons = " | ".join(analysis.reasons[:5]) if analysis.reasons else ""

            logger.info(f"MOONBAG → {token.token_symbol or mint_address[:8]} | {analysis.recommendation} | "
                        f"Score: {analysis.final_score:.1f} | Conf: {analysis.confidence:.0f}%")

            if analysis.recommendation == "MOONBAG_BUY":
                alert = {
                    "type": "moonbag_detected",
                    "mint": mint_address,
                    "symbol": token.token_symbol or "UNKNOWN",
                    "name": token.token_name or "Unknown",
                    "price_usd": token.price_usd,
                    "tvl": token.tvl,
                    "score": round(analysis.final_score, 1),
                    "confidence": round(analysis.confidence),
                    "reasons": analysis.reasons[:3] if analysis.reasons else [],
                    "logo": token.token_symbol,
                    "dexscreener": token.dexscreener_url
                }
                for wallet in list(websocket_manager.active_connections.keys()):
                    await websocket_manager.send_personal_message(json.dumps(alert), wallet)

                # IMMEDIATELY trigger buys for all connected users
                logger.info(f"🚨 IMMEDIATE MOONBAG BUY TRIGGERED FOR {mint_address[:8]}")
                for wallet_address in list(websocket_manager.active_connections.keys()):
                    try:
                        async with AsyncSessionLocal() as db:
                            user_result = await db.execute(select(User).filter(User.wallet_address == wallet_address))
                            user = user_result.scalar_one_or_none()
                            if user and user.wallet_address in active_bot_tasks:
                                # Check if already bought
                                exists = await db.execute(
                                    select(Trade).where(
                                        Trade.user_wallet_address == user.wallet_address,
                                        Trade.mint_address == mint_address,
                                        Trade.trade_type == "buy",
                                        Trade.sell_timestamp.is_(None)
                                    )
                                )
                                if not exists.scalar_one_or_none():
                                    asyncio.create_task(
                                        apply_user_filters_and_trade(user, token, db, websocket_manager)
                                    )
                    except Exception as e:
                        logger.error(f"Error triggering immediate buy for {wallet_address}: {e}")
                        
        except Exception as e:
            logger.error(f"Profitability engine error for {mint_address}: {e}")
            token.trading_recommendation = "ERROR"

        # Final save with safe datetime handling
        token.last_checked_at = datetime.utcnow()
        db.add(token)
        await db.commit()

        # Update NewTokens
        new_token = await db.get(NewTokens, mint_address) or (await db.execute(
            select(NewTokens).where(NewTokens.mint_address == mint_address)
        )).scalar_one_or_none()
        if new_token:
            new_token.metadata_status = "completed"
            new_token.last_metadata_update = datetime.utcnow()
            await db.commit()

        # Safe caching with proper JSON serialization
        safe_dict = {}
        for k, v in token.__dict__.items():
            if not k.startswith('_'):
                if isinstance(v, datetime):
                    safe_dict[k] = v.isoformat()
                else:
                    safe_dict[k] = v
        
        await redis_client.setex(f"token_metadata:{mint_address}", 600, json.dumps(safe_dict))

        total_time = (datetime.utcnow() - start_time).total_seconds()
        logger.info(f"Analysis complete: {mint_address[:8]} in {total_time:.1f}s")

    except Exception as e:
        logger.error(f"CRITICAL FAILURE in process_token_logic for {mint_address}: {e}", exc_info=True)
        await db.rollback()
       
        

                  
        
# ===================================================================
# 3. OTHER UTIL FUNCTIONS
# ===================================================================
async def broadcast_trade(trade: Trade):
    message = {
        "type": "trade_update",
        "trade": {
            "id": trade.id,
            "trade_type": trade.trade_type,
            "amount_sol": trade.amount_sol_in or trade.amount_sol_out or 0,
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
    # Prevent double buys
    if await redis_client.exists(f"trade:{user.wallet_address}:{token.mint_address}"):
        return

    # === ONLY BUY MOONBAGS OR STRONG BUYS ===
    if token.trading_recommendation not in ["MOONBAG_BUY", "STRONG_BUY", "BUY"]:
        logger.info(f"Skipping {token.token_symbol} — Not a moonbag (got {token.trading_recommendation})")
        return

    if token.profitability_confidence < 70:
        logger.info(f"Skipping {token.token_symbol} — Low confidence ({token.profitability_confidence}%)")
        return

    logger.info(f"MOONBAG DETECTED → {token.token_symbol} | Score: {token.profitability_score} | Buying NOW!")

    if token.trading_recommendation in ["MOONBAG_BUY", "STRONG_BUY", "BUY"] and token.profitability_confidence >= 70:
        # Check if already bought
        exists = await db.execute(
            select(Trade).where(
                Trade.user_wallet_address == user.wallet_address,
                Trade.mint_address == token.mint_address,
                Trade.trade_type == "buy",
                Trade.sell_timestamp.is_(None)
            )
        )
        if exists.scalar_one_or_none():
            return  # Already holding

        await execute_user_buy(user, token, db, websocket_manager)
        return asyncio.sleep(0)
         
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
    async def log_failure(filter_name: str):
        logger.debug(f"Token {token_meta.mint_address} failed {filter_name} for {user.wallet_address}.")
        await websocket_manager.send_personal_message(
            json.dumps({"type": "log", "message": f"Token {token_meta.token_symbol or token_meta.mint_address} failed {filter_name} filter.", "status": "info"}),
            user.wallet_address
        )

    filters = [
        ("Socials Added", user.filter_socials_added, lambda: not token_meta.socials_present),
        ("Liquidity Burnt", user.filter_liquidity_burnt, lambda: not token_meta.liquidity_burnt),
        ("Immutable Metadata", user.filter_immutable_metadata, lambda: not token_meta.immutable_metadata),
        ("Mint Authority Renounced", user.filter_mint_authority_renounced, lambda: not token_meta.mint_authority_renounced),
        ("Freeze Authority Revoked", user.filter_freeze_authority_revoked, lambda: not token_meta.freeze_authority_revoked),
        (
            f"Insufficient Liquidity Pool Size (min {user.filter_check_pool_size_min_sol} SOL)",
            user.filter_check_pool_size_min_sol,
            lambda: token_meta.liquidity_pool_size_sol is None or token_meta.liquidity_pool_size_sol < user.filter_check_pool_size_min_sol
        ),
        (
            "Token Age (15m-72h)",
            True,
            lambda: not token_meta.pair_created_at or (
                (age := datetime.utcnow() - datetime.utcfromtimestamp(token_meta.pair_created_at)) < timedelta(minutes=15) or
                age > timedelta(hours=72)
            )
        ),
        ("Market Cap (< $30k)", True, lambda: token_meta.market_cap is None or float(token_meta.market_cap) < 30000),
        ("Holder Count (< 20)", True, lambda: token_meta.holder is None or token_meta.holder < 20),
        ("Webacy Risk Score (>50)", True, lambda: token_meta.webacy_risk_score is None or token_meta.webacy_risk_score > 50),
    ]

    if user.is_premium:
        filters.extend([
            (
                f"Top 10 Holders % (>{user.filter_top_holders_max_pct}%)",
                user.filter_top_holders_max_pct,
                lambda: token_meta.top10_holders_percentage and token_meta.top10_holders_percentage > user.filter_top_holders_max_pct
            ),
            (
                f"Safety Check Period (<{user.filter_safety_check_period_seconds}s)",
                user.filter_safety_check_period_seconds and token_meta.pair_created_at,
                lambda: (datetime.utcnow() - datetime.utcfromtimestamp(token_meta.pair_created_at)) < timedelta(seconds=user.filter_safety_check_period_seconds)
            ),
            ("Webacy Moon Potential (<80)", True, lambda: token_meta.webacy_moon_potential is None or token_meta.webacy_moon_potential < 80),
        ])

    for filter_name, condition, check in filters:
        if condition and check():
            await log_failure(filter_name)
            return False

    return True

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
 
 
 
 # Add to main.py after active_bot_tasks definition

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
        return  # Already running
    
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
                        break
                    
                    # Check balance
                    try:
                        async with AsyncClient(settings.SOLANA_RPC_URL) as client:
                            balance_response = await client.get_balance(Pubkey.from_string(wallet_address))
                            sol_balance = balance_response.value / 1_000_000_000
                            
                            if sol_balance < 0.3:
                                logger.info(f"Insufficient balance for {wallet_address}: {sol_balance} SOL")
                                await asyncio.sleep(30)
                                continue
                    except Exception as e:
                        logger.error(f"Balance check failed for {wallet_address}: {e}")
                        await asyncio.sleep(30)
                        continue
                    
                    # Process new tokens for this user
                    await process_user_specific_tokens(user, db)
                    
                # Heartbeat
                await save_bot_state(wallet_address, True)
                await asyncio.sleep(user.bot_check_interval_seconds or 10)
                
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

async def process_user_specific_tokens(user: User, db: AsyncSession):
    """Process tokens specifically for a user based on their filters"""
    # Get recently processed tokens (last 5 minutes)
    recent_time = datetime.utcnow() - timedelta(minutes=5)
    
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
        # Check if user already has position
        existing_trade = await db.execute(
            select(Trade).where(
                Trade.user_wallet_address == user.wallet_address,
                Trade.mint_address == token.mint_address,
                Trade.sell_timestamp.is_(None)
            )
        )
        if existing_trade.scalar_one_or_none():
            continue
        
        # Apply user-specific filters
        if await apply_user_filters(user, token, db, websocket_manager):
            # Execute buy
            await execute_user_buy(user, token, db, websocket_manager)
            # Small delay between buys
            await asyncio.sleep(1)

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

# @app.websocket("/ws/logs/{wallet_address}")
# async def websocket_endpoint(websocket: WebSocket, wallet_address: str):
#     await websocket_manager.connect(websocket, wallet_address)
#     try:
#         # Start bot when WebSocket connects
#         await start_user_bot_task(wallet_address)
        
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
#                         "amount_sol": trade.amount_sol_in or trade.amount_sol_out or 0,
#                         "token_symbol": trade.token_symbol or "Unknown",
#                         "timestamp": trade.created_at.isoformat() if trade.created_at else None,
#                     }
#                 })
        
#         while True:
#             data = await websocket.receive_text()
#             if data:
#                 try:
#                     message = json.loads(data)
#                     if message.get("type") == "health_response":
#                         logger.info(f"Received health response from {wallet_address}")
#                 except json.JSONDecodeError:
#                     logger.error(f"Invalid WebSocket message from {wallet_address}")
#     except WebSocketDisconnect:
#         websocket_manager.disconnect(wallet_address)
#         # Stop bot when WebSocket disconnects
#         if wallet_address in active_bot_tasks:
#             active_bot_tasks[wallet_address].cancel()
#             del active_bot_tasks[wallet_address]
#     except Exception as e:
#         logger.error(f"WebSocket error for {wallet_address}: {str(e)}")
#         websocket_manager.disconnect(wallet_address)
#         if wallet_address in active_bot_tasks:
#             active_bot_tasks[wallet_address].cancel()
#             del active_bot_tasks[wallet_address]

@app.websocket("/ws/logs/{wallet_address}")
async def websocket_endpoint(websocket: WebSocket, wallet_address: str):
    await websocket_manager.connect(websocket, wallet_address)  # FIXED: Remove extra websocket parameter
    
    try:
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
                        "amount_sol": trade.amount_sol_in or trade.amount_sol_out or 0,
                        "token_symbol": trade.token_symbol or "Unknown",
                        "timestamp": trade.created_at.isoformat() if trade.created_at else None,
                    }
                })
        
        # Handle messages
        while True:
            data = await websocket.receive_text()
            if data:
                try:
                    message = json.loads(data)
                    await handle_websocket_message(message, wallet_address, websocket)
                except json.JSONDecodeError:
                    logger.error(f"Invalid WebSocket message from {wallet_address}")
                    
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for {wallet_address}")
    except Exception as e:
        logger.error(f"WebSocket error for {wallet_address}: {str(e)}")
    finally:
        websocket_manager.disconnect(wallet_address)
        
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
        data = trade.__dict__.copy()
        
        # If token still in hot table → use live data
        meta = await db.get(TokenMetadata, trade.mint_address)
        if not meta:
            # Fallback to archive
            arch = await db.execute(
                select(TokenMetadataArchive.data)
                .where(TokenMetadataArchive.mint_address == trade.mint_address)
                .order_by(TokenMetadataArchive.archived_at.desc())
            )
            arch_data = arch.scalar()
            if arch_data:
                archived = json.loads(arch_data)
                data["token_symbol"] = archived.get("token_symbol", "Unknown")
                data["token_name"] = archived.get("token_name", "Unknown Token")
                data["token_logo_uri"] = archived.get("token_logo_uri")
            else:
                data["token_symbol"] = trade.token_symbol or trade.mint_address[:8]
        else:
            data["token_symbol"] = meta.token_symbol or trade.token_symbol
            data["token_name"] = meta.token_name
        
        result.append(data)

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

  