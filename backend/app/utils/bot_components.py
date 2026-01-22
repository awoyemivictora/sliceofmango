# import logging
# import json
# import base64
# import asyncio
# from datetime import datetime, timedelta
# from typing import Dict, Optional, Any
# import redis.asyncio as redis
# import aiohttp
# import httpx
# from fastapi import WebSocket
# from sqlalchemy import select
# from sqlalchemy.ext.asyncio import AsyncSession
# from solders.pubkey import Pubkey
# from solders.keypair import Keypair
# from solders.transaction import VersionedTransaction
# from solders.signature import Signature
# from solders.message import to_bytes_versioned
# from solana.rpc.async_api import AsyncClient
# from spl.token.instructions import get_associated_token_address
# from app.database import AsyncSessionLocal
# from app.models import Trade, User, TokenMetadata
# from app.utils.dexscreener_api import fetch_dexscreener_with_retry, get_dexscreener_data
# from app.config import settings
# from app.security import decrypt_private_key_backend
# from app.utils.jupiter_api import get_jupiter_token_data, safe_float
# from app.utils.webacy_api import check_webacy_risk

# logger = logging.getLogger(__name__)

# # Redis
# redis_client = redis.Redis(host="localhost", port=6379, db=0, decode_responses=True)

# # Add near other global variables at the top
# monitor_tasks: Dict[int, asyncio.Task] = {}

# price_cache: Dict[str, Dict] = {}


# class ConnectionManager:
#     def __init__(self):
#         self.active_connections: Dict[str, WebSocket] = {}
#         self.connection_times: Dict[str, datetime] = {}
        
#     async def connect(self, websocket: WebSocket, wallet_address: str):
#         await websocket.accept()
#         self.active_connections[wallet_address] = websocket
#         self.connection_times[wallet_address] = datetime.utcnow()
        
#     def disconnect(self, wallet_address: str):
#         self.active_connections.pop(wallet_address, None)
#         self.connection_times.pop(wallet_address, None)
        
#     async def check_and_reconnect(self, wallet_address: str):
#         """Check if connection is stale and needs reconnection"""
#         if wallet_address in self.connection_times:
#             last_activity = datetime.utcnow() - self.connection_times[wallet_address]
#             if last_activity.total_seconds() > 60:  # 1 minute of inactivity
#                 logger.warning(f"Connection stale for {wallet_address}, reconnecting...")
#                 return True
#         return False

#     async def send_personal_message(self, message: str, wallet_address: str):
#         ws = self.active_connections.get(wallet_address)
#         if ws:
#             try:
#                 await ws.send_text(message)
#             except:
#                 self.disconnect(wallet_address)

# websocket_manager = ConnectionManager()




# # Move this function to the TOP after imports but before class definitions
# async def check_and_restart_stale_monitors():
#     """Check if monitor tasks are running and restart if needed"""
#     while True:
#         try:
#             async with AsyncSessionLocal() as db:
#                 # Find trades that should be monitored but don't have active tasks
#                 result = await db.execute(
#                     select(Trade).where(
#                         Trade.sell_timestamp.is_(None),
#                         Trade.buy_timestamp > datetime.utcnow() - timedelta(hours=24)
#                     )
#                 )
#                 trades = result.scalars().all()
                
#                 for trade in trades:
#                     if trade.id not in monitor_tasks:
#                         logger.info(f"🔄 Restarting monitor for trade {trade.id}")
                        
#                         # Get user
#                         user_result = await db.execute(
#                             select(User).where(User.wallet_address == trade.user_wallet_address)
#                         )
#                         user = user_result.scalar_one_or_none()
                        
#                         if user and trade.token_decimals and trade.amount_tokens:
#                             # Use a separate helper to avoid circular reference
#                             asyncio.create_task(
#                                 restart_monitor_for_trade(trade, user)
#                             )
        
#         except Exception as e:
#             logger.error(f"Error checking stale monitors: {e}")
        
#         await asyncio.sleep(30)  # Check every 30 seconds


# async def restart_monitor_for_trade(trade: Trade, user: User):
#     """Helper to restart monitor for a trade"""
#     try:
#         await monitor_position(
#             user=user,
#             trade=trade,
#             entry_price_usd=trade.price_usd_at_trade or 0,
#             token_decimals=trade.token_decimals,
#             token_amount=trade.amount_tokens,
#             websocket_manager=websocket_manager
#         )
#     except Exception as e:
#         logger.error(f"Failed to restart monitor for trade {trade.id}: {e}")
        
        

# # ===================================================================
# # Correct Jupiter Referral ATA (2025)
# # ===================================================================
# def get_jupiter_referral_ata(referral_pda: str, mint: str) -> str:
#     owner = Pubkey.from_string(referral_pda)
#     mint_pubkey = Pubkey.from_string(mint)
#     ata = get_associated_token_address(owner, mint_pubkey)
#     return str(ata)


# # ===================================================================
# # Non-blocking transaction confirmation
# # ===================================================================
# async def _confirm_tx_async(rpc_url: str, signature: str, label: str, wallet_address: str, input_sol: float):
#     try:
#         async with AsyncClient(rpc_url) as client:
#             sig = Signature.from_string(signature)
#             resp = await client.confirm_transaction(sig, commitment="confirmed")
#             statuses = resp.value
#             if statuses and len(statuses) > 0 and statuses[0].err:
#                 err = statuses[0].err
#                 err_str = str(err)
#                 error_type = "UNKNOWN"
#                 if "6025" in err_str:
#                     error_type = "INSUFFICIENT_INPUT_LIQUIDITY"
#                     user_msg = json.dumps({
#                         "type": "log",
#                         "message": f"{label} failed: Low liquidity (error 6025). Input {input_sol} SOL too small — try 0.1+ SOL.",
#                         "status": "warning",
#                         "tx": f"https://solscan.io/tx/{signature}"
#                     })
#                     await websocket_manager.send_personal_message(user_msg, wallet_address)
#                 logger.warning(f"{label} {signature} failed on-chain ({error_type}): {err}")
#             else:
#                 logger.info(f"{label} {signature} CONFIRMED")
#     except Exception as e:
#         logger.warning(f"Confirmation failed for {signature}: {e}")




# async def get_fee_statistics():
#     """Get statistics about collected fees"""
#     try:
#         # Get all fee records
#         fee_records = await redis_client.lrange("fee_tracking", 0, -1)
        
#         total_fees = 0
#         total_transactions = len(fee_records)
        
#         for record in fee_records:
#             try:
#                 data = json.loads(record)
#                 fee_amount = data.get("fee_amount", 0)
#                 total_fees += fee_amount
#             except:
#                 pass
        
#         return {
#             "total_transactions": total_transactions,
#             "total_fees_collected": total_fees,
#             "average_fee_per_tx": total_fees / total_transactions if total_transactions > 0 else 0
#         }
        
#     except Exception as e:
#         logger.error(f"Failed to get fee statistics: {e}")
#         return {"error": str(e)}

       
# async def get_fee_analytics(db: AsyncSession):
#     """Get analytics about fee collection"""
#     from sqlalchemy import select, func
#     from app.models import Trade  # Add this import
    
#     # Get total fees collected
#     stmt = select(
#         func.count(Trade.id).label("total_trades"),
#         func.count(Trade.id).filter(Trade.fee_applied == True).label("trades_with_fees"),
#         func.coalesce(func.sum(Trade.fee_amount), 0).label("total_fees_collected"),
#         func.avg(Trade.fee_percentage).label("avg_fee_percentage")
#     )
    
#     result = await db.execute(stmt)
#     stats = result.first()
    
#     # Get fee distribution by mint
#     stmt_mint = select(
#         Trade.fee_mint,
#         func.count(Trade.id).label("count"),
#         func.sum(Trade.fee_amount).label("total_amount")
#     ).where(
#         Trade.fee_applied == True
#     ).group_by(
#         Trade.fee_mint
#     )
    
#     result_mint = await db.execute(stmt_mint)
#     mint_distribution = result_mint.all()
    
#     return {
#         "total_trades": stats.total_trades or 0,
#         "trades_with_fees": stats.trades_with_fees or 0,
#         "total_fees_collected": float(stats.total_fees_collected or 0),
#         "avg_fee_percentage": float(stats.avg_fee_percentage or 0),
#         "fee_rate": (stats.trades_with_fees or 0) / (stats.total_trades or 1) * 100,
#         "mint_distribution": [
#             {
#                 "mint": mint,
#                 "count": count,
#                 "total_amount": float(total_amount or 0)
#             }
#             for mint, count, total_amount in mint_distribution
#         ]
#     } 
        
# # ===================================================================
# # JUPITER ULTRA API IMPLEMENTATION (CORRECT 2025)
# # ===================================================================

# async def execute_jupiter_swap(
#     user: User,
#     input_mint: str,
#     output_mint: str,
#     amount: int,
#     slippage_bps: int,
#     label: str = "swap",
#     max_retries: int = 3,
# ) -> dict:

#     input_sol = amount / 1_000_000_000.0
    
#     # FIX: Ensure MIN_BUY_SOL is a float
#     min_buy_sol_str = getattr(settings, 'MIN_BUY_SOL', '0.05')
#     try:
#         min_buy_sol = float(min_buy_sol_str)
#     except (ValueError, TypeError):
#         min_buy_sol = 0.05  # Default fallback
    
#     # Min buy checks - FIXED: Compare floats properly
#     if label == "BUY" and not user.is_premium:
#         min_for_free = max(min_buy_sol, 0.01)
#         if input_sol < min_for_free:
#             raise Exception(f"Free users need min {min_for_free:.2f} SOL for buys. Current: {input_sol:.4f} SOL")
    
#     if label == "BUY" and input_sol < min_buy_sol:
#         raise Exception(f"Min input too low: {input_sol:.4f} SOL < {min_buy_sol:.2f} SOL")

#     user_pubkey = str(user.wallet_address)
#     private_key_bytes = decrypt_private_key_backend(user.encrypted_private_key)
#     keypair = Keypair.from_bytes(private_key_bytes)

#     # 🔥 CRITICAL FIX: Ultra API fee implementation
#     use_referral = True
#     referral_fee = "100"  # 1% fee in basis points
    
#     # Get the Ultra referral account
#     referral_account = getattr(settings, 'JUPITER_REFERRAL_ACCOUNT', None)
    
#     if referral_account:
#         logger.info(f"💰 Using Ultra referral account: {referral_account[:8]}...")
#         logger.info(f"   Applying 1% fee on {label} transaction")
        
#         # For Ultra API, we just pass the referral account directly
#         # DON'T try to calculate token accounts - Jupiter handles it
#         fee_account = referral_account  # Use the referral account directly
#     else:
#         logger.warning("⚠️ No Ultra referral account configured - missing out on 1% fees!")
#         use_referral = False
#         fee_account = None

#     # REQUIRED: Jupiter API Key for Ultra API
#     if not getattr(settings, "JUPITER_API_KEY", None):
#         raise Exception("JUPITER_API_KEY is required for Ultra API. Get one from portal.jup.ag")
    
#     headers = {
#         "Content-Type": "application/json",
#         "x-api-key": settings.JUPITER_API_KEY
#     }

#     for attempt in range(max_retries):
#         try:
#             async with aiohttp.ClientSession(headers=headers, timeout=aiohttp.ClientTimeout(total=60)) as session:
#                 base = "https://api.jup.ag/ultra/v1"
                
#                 # =============================================================
#                 # 1. GET ORDER WITH 1% FEE
#                 # =============================================================
#                 order_params = {
#                     "inputMint": input_mint,
#                     "outputMint": output_mint,
#                     "amount": str(amount),
#                     "slippageBps": str(slippage_bps),
#                     "taker": user_pubkey,
#                 }
                
#                 # 🔥 Add referral parameters for Ultra API
#                 if use_referral and fee_account:
#                     order_params["referralAccount"] = fee_account
#                     order_params["referralFee"] = referral_fee
#                     logger.info(f"💰 Adding 1% fee via Ultra API")
#                 else:
#                     logger.warning("⚠️ Proceeding without 1% fee - you're losing revenue!")
                
#                 logger.info(f"Getting order for {label}: {input_mint[:8]}... → {output_mint[:8]}...")
                
#                 order_resp = await session.get(f"{base}/order", params=order_params)
#                 if order_resp.status != 200:
#                     txt = await order_resp.text()
                    
#                     # Check if it's a referral initialization error
#                     if "referralAccount is initialized" in txt:
#                         logger.warning(f"Referral token account not initialized for this swap")
                        
#                         # Try again without referral on the first attempt
#                         if attempt == 0 and use_referral:
#                             logger.info("Retrying without referral account...")
#                             use_referral = False
#                             continue  # Retry immediately without referral
#                         else:
#                             logger.error(f"Order failed: Status {order_resp.status}, Response: {txt[:500]}")
#                             raise Exception(f"Order failed: {txt[:200]}")
                    
#                     logger.error(f"Order failed: Status {order_resp.status}, Response: {txt[:500]}")
                    
#                     # Parse Jupiter error messages
#                     try:
#                         error_data = json.loads(txt)
#                         if "errorMessage" in error_data:
#                             raise Exception(f"Jupiter order failed: {error_data['errorMessage']}")
#                     except:
#                         pass
                    
#                     raise Exception(f"Order failed (attempt {attempt+1}): {txt[:300]}")
                
#                 order_data = await order_resp.json()
                
#                 # 🔥 CHECK IF 1% FEE IS APPLIED
#                 fee_applied = False
#                 fee_amount = 0
#                 fee_percentage = 0.0
                
#                 if "feeBps" in order_data:
#                     fee_bps = int(order_data.get("feeBps", 0))
#                     if fee_bps >= 100:  # At least 1% fee
#                         fee_applied = True
#                         fee_percentage = fee_bps / 100  # Convert to percentage
#                         in_amount = int(order_data["inAmount"])
#                         fee_amount = (in_amount * fee_bps) // 10000
                        
#                         logger.info(f"💰 1% FEE CONFIRMED: {fee_bps}bps fee applied")
                        
#                         # Log fee details
#                         fee_mint = order_data.get("feeMint", "Unknown")
#                         if "So111" in fee_mint:
#                             fee_sol = fee_amount / 1e9
#                             logger.info(f"   Estimated fee: {fee_sol:.6f} SOL")
#                         elif "EPjFW" in fee_mint:
#                             fee_usdc = fee_amount / 1e6
#                             logger.info(f"   Estimated fee: {fee_usdc:.6f} USDC")
#                         else:
#                             logger.info(f"   Estimated fee: {fee_amount} tokens")
#                     else:
#                         logger.warning(f"⚠️ Fee mismatch: {fee_bps}bps (expected 100bps)")
                
#                 # Validate order response
#                 if "transaction" not in order_data:
#                     logger.error(f"No transaction in order response: {order_data}")
#                     raise Exception("Jupiter didn't return a transaction")
                
#                 if "requestId" not in order_data:
#                     logger.error(f"No requestId in order response: {order_data}")
#                     raise Exception("Jupiter didn't return a requestId")
                
#                 if "outAmount" not in order_data or int(order_data["outAmount"]) <= 0:
#                     logger.error(f"Invalid output amount: {order_data.get('outAmount', 'missing')}")
#                     raise Exception("Order returned 0 output - insufficient liquidity")
                
#                 logger.info(f"{label} order: {int(order_data['inAmount'])/1e9:.4f} SOL → {int(order_data['outAmount'])} tokens | Slippage: {order_data.get('slippageBps', '?')}bps | 1% Fee: {'✅' if fee_applied else '❌'}")
                
#                 # =============================================================
#                 # 2. SIGN TRANSACTION
#                 # =============================================================
#                 tx_buf = base64.b64decode(order_data["transaction"])
#                 original_tx = VersionedTransaction.from_bytes(tx_buf)
#                 message_bytes = to_bytes_versioned(original_tx.message)
#                 user_signature = keypair.sign_message(message_bytes)
                
#                 # Create signed transaction
#                 signed_tx = VersionedTransaction.populate(original_tx.message, [user_signature])
#                 raw_tx = bytes(signed_tx)
#                 signed_transaction_base64 = base64.b64encode(raw_tx).decode("utf-8")
                
#                 # =============================================================
#                 # 3. EXECUTE ORDER (Jupiter sends the transaction)
#                 # =============================================================
#                 execute_payload = {
#                     "signedTransaction": signed_transaction_base64,
#                     "requestId": order_data["requestId"]
#                 }
                
#                 execute_resp = await session.post(f"{base}/execute", json=execute_payload)
#                 if execute_resp.status != 200:
#                     txt = await execute_resp.text()
#                     logger.error(f"Execute failed: Status {execute_resp.status}, Response: {txt[:500]}")
#                     raise Exception(f"Execute failed (attempt {attempt+1}): {txt[:300]}")
                
#                 execute_data = await execute_resp.json()
                
#                 # Check execution status
#                 if execute_data.get("status") == "Success":
#                     signature = execute_data.get("signature")
#                     if not signature:
#                         raise Exception("Execute succeeded but no signature returned")
                    
#                     logger.info(f"{label} SUCCESS → https://solscan.io/tx/{signature}")
                    
#                     # Log success details
#                     input_amount_result = execute_data.get("inputAmountResult", order_data["inAmount"])
#                     output_amount_result = execute_data.get("outputAmountResult", order_data["outAmount"])
                    
#                     # 🔥 TRACK FEE IF APPLIED
#                     if fee_applied:
#                         # Store fee info for analytics
#                         await store_fee_info(
#                             wallet_address=user.wallet_address,
#                             tx_signature=signature,
#                             fee_amount=fee_amount,
#                             fee_mint=order_data.get("feeMint", "Unknown"),  # This is correct
#                             trade_type=label,
#                             input_amount=int(input_amount_result),
#                             output_amount=int(output_amount_result)
#                         )
                    
#                     logger.info(f"{label} executed: {int(input_amount_result)/1e9:.4f} SOL → {int(output_amount_result)} tokens | 1% Fee: {'✅' if fee_applied else '❌'}")
                    
#                     # Fire-and-forget confirmation
#                     rpc_url = user.custom_rpc_https or settings.SOLANA_RPC_URL
#                     asyncio.create_task(_confirm_tx_async(rpc_url, signature, label, user_pubkey, input_sol))
                    
#                     return {
#                         "raw_tx_base64": signed_transaction_base64,
#                         "signature": signature,
#                         "out_amount": int(output_amount_result),
#                         "in_amount": int(input_amount_result),
#                         "estimated_referral_fee": fee_amount,
#                         "fee_applied": fee_applied,
#                         "fee_percentage": fee_percentage,
#                         "fee_bps": fee_bps if fee_applied else 0,
#                         "fee_mint": order_data.get("feeMint", "") if fee_applied else "",  # Add this line
#                         "method": "jup_ultra_referral",
#                         "status": "success",
#                         "request_id": order_data["requestId"],
#                         "referral_used": fee_applied
#                     }
                
#                 else:
#                     # Execution failed
#                     status = execute_data.get("status", "Unknown")
#                     error_code = execute_data.get("code", -1)
#                     signature = execute_data.get("signature")
                    
#                     # Map error codes to user-friendly messages
#                     error_messages = {
#                         -1: "Missing cached order (requestId expired)",
#                         -2: "Invalid signed transaction",
#                         -3: "Invalid message bytes",
#                         -4: "Missing request ID",
#                         -5: "Missing signed transaction",
#                         -1000: "Failed to land transaction",
#                         -1001: "Unknown error",
#                         -1002: "Invalid transaction",
#                         -1003: "Transaction not fully signed",
#                         -1004: "Invalid block height",
#                         -1005: "Transaction expired",
#                         -1006: "Transaction timed out",
#                         -1007: "Gasless unsupported wallet"
#                     }
                    
#                     error_msg = error_messages.get(error_code, f"Error code: {error_code}")
                    
#                     if signature:
#                         logger.warning(f"{label} EXECUTE FAILED ({status}): {error_msg} | Tx: https://solscan.io/tx/{signature}")
#                         raise Exception(f"{label} failed: {error_msg}")
#                     else:
#                         logger.warning(f"{label} EXECUTE FAILED ({status}): {error_msg}")
#                         raise Exception(f"{label} failed: {error_msg}")
        
#         except Exception as e:
#             error_str = str(e)
            
#             # Log specific error types
#             if "6025" in error_str or "InsufficientInputAmountWithSlippage" in error_str:
#                 logger.warning(f"{label} FAILED → Low liquidity (6025) | Input: {input_sol:.4f} SOL")
                
#                 # Send user-friendly message
#                 if not user.is_premium and label == "BUY":
#                     user_msg = json.dumps({
#                         "type": "log",
#                         "message": f"⚠️ Buy failed: Low liquidity (error 6025). Try increasing buy amount to 0.2+ SOL.",
#                         "status": "warning"
#                     })
#                     await websocket_manager.send_personal_message(user_msg, user.wallet_address)
            
#             elif "insufficient liquidity" in error_str.lower():
#                 logger.warning(f"{label} FAILED → Insufficient liquidity for {output_mint[:8]}...")
            
#             elif "Transaction simulation failed" in error_str:
#                 # Parse custom program error
#                 if "custom program error: 0x1789" in error_str:
#                     logger.warning(f"{label} FAILED → Jupiter program error 0x1789 (likely slippage/price moved)")
#                 else:
#                     logger.warning(f"{label} FAILED → Transaction simulation failed")
            
#             elif "referralAccount is initialized" in error_str:
#                 logger.warning(f"{label} FAILED → Referral token account not initialized. Will retry without referral.")
#                 # Don't raise exception, let it retry without referral
            
#             else:
#                 logger.warning(f"{label} FAILED (attempt {attempt+1}): {error_str}")
            
#             if attempt == max_retries - 1:
#                 # Final attempt failed
#                 if "6025" in error_str:
#                     raise Exception(f"Low liquidity (6025) after {max_retries} attempts. Try increasing buy amount to 0.2+ SOL.")
#                 raise e
            
#             # Exponential backoff
#             wait_time = 2 * (attempt + 1)
#             logger.info(f"Retrying {label} in {wait_time}s (attempt {attempt+2}/{max_retries})...")
#             await asyncio.sleep(wait_time)

#     raise Exception(f"All {max_retries} retries failed for {label}")


# async def store_fee_info(wallet_address: str, tx_signature: str, fee_amount: int, 
#                         fee_mint: str, trade_type: str, input_amount: int, output_amount: int):
#     """Store fee information in Redis for tracking"""
#     try:
#         fee_data = {
#             "user": wallet_address,
#             "tx": tx_signature,
#             "fee_amount": fee_amount,
#             "fee_mint": fee_mint,
#             "trade_type": trade_type,
#             "input_amount": input_amount,
#             "output_amount": output_amount,
#             "timestamp": datetime.utcnow().isoformat(),
#             "referral_account": getattr(settings, 'JUPITER_REFERRAL_ACCOUNT', '')
#         }
        
#         # Store in Redis with 30-day expiry
#         await redis_client.setex(
#             f"fee:{tx_signature}", 
#             2592000,  # 30 days
#             json.dumps(fee_data)
#         )
        
#         # Also add to fee tracking list
#         await redis_client.lpush("fee_tracking", json.dumps(fee_data))
#         await redis_client.ltrim("fee_tracking", 0, 1000)  # Keep last 1000 fees
        
#         # Convert fee to readable amount
#         if "So111" in fee_mint:
#             fee_readable = fee_amount / 1e9
#             fee_unit = "SOL"
#         elif "EPjFW" in fee_mint:
#             fee_readable = fee_amount / 1e6
#             fee_unit = "USDC"
#         else:
#             fee_readable = fee_amount
#             fee_unit = "tokens"
        
#         logger.info(f"💰 Fee recorded: {fee_readable:.6f} {fee_unit} from {wallet_address[:8]}...")
        
#     except Exception as e:
#         logger.error(f"Failed to store fee info: {e}")

        
# async def execute_user_buy(user: User, token: TokenMetadata, db: AsyncSession, websocket_manager: ConnectionManager):
#     """Execute immediate buy and fetch metadata right after"""
#     mint = token.mint_address
#     lock_key = f"buy_lock:{user.wallet_address}:{mint}"
    
#     # Check lock
#     if await redis_client.get(lock_key):
#         logger.info(f"Buy locked for {mint} – skipping")
#         return
    
#     await redis_client.setex(lock_key, 60, "1")
    
#     try:
#         # For immediate snipe, we use minimal data initially
#         token_symbol = token.token_symbol or mint[:8]
        
#         # Send immediate snipe notification
#         await websocket_manager.send_personal_message(json.dumps({
#             "type": "log",
#             "log_type": "info",
#             "message": f"⚡ IMMEDIATE SNIPE: Buying {mint} with {user.buy_amount_sol} SOL...",
#             "timestamp": datetime.utcnow().isoformat()
#         }), user.wallet_address)
        
#         amount_lamports = int(user.buy_amount_sol * 1_000_000_000)
#         slippage_bps = min(int(user.buy_slippage_bps or 1000), 1500)  # Cap at 15%
        
#         # Use default decimals for immediate buy (will be updated with metadata)
#         decimals = token.token_decimals or 9
        
#         logger.info(f"⚡ IMMEDIATE BUY: {user.buy_amount_sol} SOL → {mint[:8]}... (slippage: {slippage_bps}bps)")
        
#         # Try to execute the swap
#         try:
#             swap = await execute_jupiter_swap(
#                 user=user,
#                 input_mint=settings.SOL_MINT,
#                 output_mint=mint,
#                 amount=amount_lamports,
#                 slippage_bps=slippage_bps,
#                 label="IMMEDIATE_SNIPE",
#             )
            
#             if swap.get("fee_applied"):
#                 await websocket_manager.send_personal_message(json.dumps({
#                     "type": "log",
#                     "log_type": "info",
#                     "message": f"💰 1% fee applied to this transaction",
#                     "timestamp": datetime.utcnow().isoformat()
#                 }), user.wallet_address)
                
#         except Exception as swap_error:
#             error_msg = str(swap_error)
#             logger.error(f"Immediate buy failed for {mint}: {error_msg}")
            
#             # User-friendly error messages
#             if "6025" in error_msg:
#                 user_friendly_msg = f"Immediate buy failed: Low liquidity. Try 0.2+ SOL."
#             elif "JUPITER_API_KEY" in error_msg:
#                 user_friendly_msg = f"Immediate buy failed: Jupiter API key issue."
#             elif "insufficient" in error_msg.lower():
#                 user_friendly_msg = f"Immediate buy failed: Insufficient liquidity."
#             else:
#                 user_friendly_msg = f"Immediate buy failed: {error_msg[:80]}"
            
#             await websocket_manager.send_personal_message(json.dumps({
#                 "type": "log",
#                 "log_type": "error",
#                 "message": user_friendly_msg,
#                 "timestamp": datetime.utcnow().isoformat()
#             }), user.wallet_address)
#             raise

#         # Calculate token amount
#         token_amount = swap["out_amount"] / (10 ** decimals)
        
#         if token_amount <= 0:
#             raise Exception("Swap returned 0 tokens")

#         logger.info(f"✅ Immediate buy successful: {token_amount:.2f} tokens received")
        
#         # ===================================================================
#         # 🔥 CRITICAL: Fetch comprehensive metadata RIGHT AFTER successful buy
#         # ===================================================================
#         logger.info(f"🔄 Fetching comprehensive metadata for {mint[:8]}...")
        
#         # Get or create token metadata in the database
#         token_meta_result = await db.execute(
#             select(TokenMetadata).where(TokenMetadata.mint_address == mint)
#         )
#         token_meta = token_meta_result.scalar_one_or_none()
        
#         if not token_meta:
#             token_meta = TokenMetadata(mint_address=mint)
#             db.add(token_meta)
#             await db.flush()
        
#         # 1. Fetch DexScreener data
#         dex_data = await fetch_dexscreener_with_retry(mint)
        
#         if dex_data:
#             # Populate DexScreener data
#             token_meta.dexscreener_url = dex_data.get("dexscreener_url")
#             token_meta.pair_address = dex_data.get("pair_address")
#             token_meta.price_usd = safe_float(dex_data.get("price_usd"))
#             token_meta.market_cap = safe_float(dex_data.get("market_cap"))
#             token_meta.token_name = dex_data.get("token_name")
#             token_meta.token_symbol = dex_data.get("token_symbol")
#             token_meta.liquidity_usd = safe_float(dex_data.get("liquidity_usd"))
#             token_meta.fdv = safe_float(dex_data.get("fdv"))
#             token_meta.twitter = dex_data.get("twitter")
#             token_meta.telegram = dex_data.get("telegram")
#             token_meta.websites = dex_data.get("websites")
#             token_meta.socials_present = bool(dex_data.get("twitter") or dex_data.get("telegram") or dex_data.get("websites"))
            
#             # Update decimals if available
#             if dex_data.get("decimals"):
#                 try:
#                     decimals = int(dex_data["decimals"])
#                 except:
#                     pass
        
#         # 2. Fetch Jupiter data for logo
#         try:
#             jupiter_data = await asyncio.wait_for(
#                 get_jupiter_token_data(mint),
#                 timeout=5.0
#             )
            
#             if jupiter_data and jupiter_data.get("icon"):
#                 token_meta.token_logo = jupiter_data["icon"]
#                 logger.info(f"✅ Jupiter logo found for {mint[:8]}")
#             else:
#                 # Fallback to DexScreener logo
#                 token_meta.token_logo = f"https://dd.dexscreener.com/ds-logo/solana/{mint}.png"
                
#         except (asyncio.TimeoutError, Exception) as e:
#             logger.warning(f"Jupiter fetch failed for {mint[:8]}: {e}")
#             token_meta.token_logo = f"https://dd.dexscreener.com/ds-logo/solana/{mint}.png"
        
#         # 3. Fetch Webacy data
#         try:
#             webacy_data = await check_webacy_risk(mint)
#             if webacy_data and isinstance(webacy_data, dict):
#                 token_meta.webacy_risk_score = safe_float(webacy_data.get("risk_score"))
#                 token_meta.webacy_risk_level = webacy_data.get("risk_level")
#                 token_meta.webacy_moon_potential = webacy_data.get("moon_potential")
#         except Exception as e:
#             logger.warning(f"Webacy fetch failed for {mint[:8]}: {e}")
        
#         # 4. Update timestamp
#         token_meta.last_checked_at = datetime.utcnow()
        
#         # 5. Get final values from metadata
#         final_token_symbol = token_meta.token_symbol or mint[:8]
#         final_token_name = token_meta.token_name or "Unknown"
#         final_token_logo = token_meta.token_logo
#         current_price = token_meta.price_usd or 0.0001
        
#         # Update token amount with correct decimals if needed
#         if dex_data and dex_data.get("decimals"):
#             try:
#                 actual_decimals = int(dex_data["decimals"])
#                 if actual_decimals != decimals:
#                     decimals = actual_decimals
#                     token_amount = swap["out_amount"] / (10 ** decimals)
#             except:
#                 pass
        
#         # ===================================================================
#         # Create trade record with proper metadata
#         # ===================================================================
#         # Create explorer URLs
#         explorer_urls = {
#             "solscan": f"https://solscan.io/tx/{swap['signature']}",
#             "dexScreener": token_meta.dexscreener_url or f"https://dexscreener.com/solana/{mint}",
#             "jupiter": f"https://jup.ag/token/{mint}"
#         }
        
#         trade = Trade(
#             user_wallet_address=user.wallet_address,
#             mint_address=mint,
#             token_symbol=final_token_symbol,
#             trade_type="buy",
#             amount_sol=user.buy_amount_sol,
#             amount_tokens=token_amount,
#             price_usd_at_trade=current_price,
#             buy_timestamp=datetime.utcnow(),
#             take_profit=user.sell_take_profit_pct,
#             stop_loss=user.sell_stop_loss_pct,
#             token_amounts_purchased=token_amount,
#             token_decimals=decimals,
#             liquidity_at_buy=token_meta.liquidity_usd or 0,
#             # Store buy URLs
#             slippage_bps=slippage_bps,
#             solscan_buy_url=explorer_urls["solscan"],
#             dexscreener_url=explorer_urls["dexScreener"],
#             jupiter_url=explorer_urls["jupiter"],
#             # Set buy transaction hash
#             buy_tx_hash=swap.get('signature'),
#             # Fee tracking
#             fee_applied=swap.get("fee_applied", False),
#             fee_amount=float(swap.get("estimated_referral_fee", 0)) if swap.get("estimated_referral_fee") else None,
#             fee_percentage=float(swap.get("fee_percentage", 0.0)) if swap.get("fee_percentage") else None,
#             fee_bps=swap.get("fee_bps", None),
#             fee_mint=swap.get("fee_mint", None),
#             fee_collected_at=datetime.utcnow() if swap.get("fee_applied") else None
#         )
#         db.add(trade)
#         await db.commit()

#         logger.info(f"✅ Trade saved to database with ID: {trade.id}")
        
#         # ===================================================================
#         # Send metadata to frontend immediately
#         # ===================================================================
#         metadata_alert = {
#             "type": "token_metadata_update",
#             "mint": mint,
#             "symbol": final_token_symbol,
#             "name": final_token_name,
#             "logo": final_token_logo,
#             "price_usd": current_price,
#             "liquidity_usd": token_meta.liquidity_usd,
#             "market_cap": token_meta.market_cap,
#             "dexscreener_url": token_meta.dexscreener_url,
#             "twitter": token_meta.twitter,
#             "telegram": token_meta.telegram,
#             "website": token_meta.websites,
#             "webacy_risk_score": token_meta.webacy_risk_score,
#             "timestamp": datetime.utcnow().isoformat()
#         }
        
#         await websocket_manager.send_personal_message(json.dumps(metadata_alert), user.wallet_address)
        
#         # Send trade update with proper metadata
#         await websocket_manager.send_personal_message(json.dumps({
#             "type": "trade_update",
#             "trade": {
#                 "id": f"buy-{trade.id}-{datetime.utcnow().timestamp()}",
#                 "type": "buy",
#                 "mint_address": mint,
#                 "token_symbol": final_token_symbol,
#                 "token_logo": final_token_logo,
#                 "amount_sol": user.buy_amount_sol,
#                 "amount_tokens": token_amount,
#                 "tx_hash": swap["signature"],
#                 "timestamp": datetime.utcnow().isoformat() + "Z",
#                 "explorer_urls": explorer_urls,
#                 "is_immediate_snipe": True,
#                 "metadata_fetched": True
#             }
#         }), user.wallet_address)
        
#         # Also send a simple success message
#         await websocket_manager.send_personal_message(json.dumps({
#             "type": "log",
#             "log_type": "success",
#             "message": f"✅ Immediate snipe successful! {token_amount:.2f} {final_token_symbol} tokens purchased.",
#             "timestamp": datetime.utcnow().isoformat()
#         }), user.wallet_address)
        
#         # Send monitoring started message WITH PROPER TOKEN SYMBOL
#         await websocket_manager.send_personal_message(json.dumps({
#             "type": "log",
#             "log_type": "info",
#             "message": f"📈 Monitoring {final_token_symbol} for take profit ({user.sell_take_profit_pct}%) or stop loss ({user.sell_stop_loss_pct}%)",
#             "timestamp": datetime.utcnow().isoformat()
#         }), user.wallet_address)

#         logger.info(f"🎯 Creating monitor task for {final_token_symbol} ({mint[:8]}) | Trade ID: {trade.id}")

#         # Start monitoring with proper metadata
#         try:
#             # Start monitoring with new session approach
#             asyncio.create_task(
#                 start_monitor_for_trade(
#                     trade=trade,
#                     user=user,
#                     entry_price_usd=current_price,
#                     token_decimals=decimals,
#                     token_amount=token_amount
#                 )
#             )
            
#             # Send monitor started message with proper metadata
#             await websocket_manager.send_personal_message(json.dumps({
#                 "type": "monitor_started",
#                 "trade_id": trade.id,
#                 "mint": mint,
#                 "symbol": final_token_symbol,
#                 "entry_price": current_price,
#                 "timestamp": datetime.utcnow().isoformat(),
#                 "is_immediate_snipe": True,
#                 "metadata_fetched": True
#             }), user.wallet_address)
            
#         except Exception as e:
#             logger.error(f"Failed to start monitor for {mint}: {e}")
#             await websocket_manager.send_personal_message(json.dumps({
#                 "type": "log",
#                 "log_type": "warning",
#                 "message": f"⚠️ Buy successful but monitor failed to start: {str(e)[:100]}",
#                 "timestamp": datetime.utcnow().isoformat()
#             }), user.wallet_address)

#     except Exception as e:
#         logger.error(f"🚨 IMMEDIATE BUY FAILED for {mint}: {e}", exc_info=True)
#         error_msg = str(e)
        
#         # Provide helpful error messages
#         if "6025" in error_msg:
#             user_friendly_msg = f"Immediate buy failed: Low liquidity. Try 0.2+ SOL."
#         elif "JUPITER_API_KEY" in error_msg:
#             user_friendly_msg = f"Immediate buy failed: Jupiter API key issue."
#         elif "insufficient" in error_msg.lower():
#             user_friendly_msg = f"Immediate buy failed: Insufficient liquidity."
#         else:
#             user_friendly_msg = f"Immediate buy failed: {error_msg[:80]}"
        
#         await websocket_manager.send_personal_message(json.dumps({
#             "type": "log", 
#             "log_type": "error",
#             "message": user_friendly_msg,
#             "timestamp": datetime.utcnow().isoformat()
#         }), user.wallet_address)
        
#         logger.error(f"Detailed immediate buy error for {mint}: {error_msg}")
#         raise
        
#     finally:
#         await redis_client.delete(lock_key)

        
# async def start_monitor_for_trade(trade: Trade, user: User, entry_price_usd: float, token_decimals: int, token_amount: float):
#     """Start monitor task for a trade"""
#     try:
#         logger.info(f"🎯 STARTING MONITOR for trade {trade.id} ({trade.mint_address[:8]})")
        
#         # Create the monitor task
#         monitor_task = asyncio.create_task(
#             monitor_position(
#                 user=user,
#                 trade=trade,
#                 entry_price_usd=entry_price_usd,
#                 token_decimals=token_decimals,
#                 token_amount=token_amount,
#                 websocket_manager=websocket_manager
#             )
#         )
        
#         # Store the task reference
#         monitor_tasks[trade.id] = monitor_task
        
#         # Add callback to clean up when done
#         monitor_task.add_done_callback(lambda t: monitor_tasks.pop(trade.id, None))
        
#         return monitor_task
        
#     except Exception as e:
#         logger.error(f"Failed to start monitor for trade {trade.id}: {e}")
#         raise

# # ===================================================================
# # MONITOR & SELL (Updated for Ultra API)
# # ===================================================================

# async def get_cached_price(mint: str):
#     now = datetime.utcnow()
#     if mint in price_cache:
#         cached = price_cache[mint]
#         age = (now - cached["timestamp"]).total_seconds()
#         if age < 8:
#             return cached["data"]
#         elif age < 30:
#             # Allow stale up to 30s during high volatility
#             logger.debug(f"Using slightly stale price ({age:.0f}s old) for {mint[:8]}")
#             return cached["data"]
    
#     try:
#         data = await fetch_dexscreener_with_retry(mint)
#         if data and data.get("priceUsd"):
#             price_cache[mint] = {"timestamp": now, "data": data}
#             return data
#     except Exception as e:
#         logger.debug(f"Price fetch failed for {mint[:8]}: {e}")
    
#     # Fallback to stale if exists
#     if mint in price_cache:
#         age = (now - price_cache[mint]["timestamp"]).total_seconds()
#         logger.warning(f"Using stale price ({age:.0f}s old) for {mint[:8]} as fallback")
#         return price_cache[mint]["data"]
    
#     return None


# async def monitor_position(
#     user: User,
#     trade: Trade,
#     entry_price_usd: float,
#     token_decimals: int,
#     token_amount: float,
#     websocket_manager: ConnectionManager
# ):
#     """
#     Monitor position and execute sells based on criteria.
#     Creates its own database session to avoid session closure issues.
#     """
    
#     if token_amount <= 0:
#         logger.warning(f"Invalid token_amount {token_amount} for {trade.mint_address} – skipping monitor")
#         return
    
#     # Track the main session
#     main_session = None
    
#     try:
#         # Create a new database session for this monitor
#         main_session = AsyncSessionLocal()
        
#         # Get the trade ID from the passed trade object
#         trade_id = trade.id
        
#         if not trade_id:
#             logger.error(f"Trade ID is missing for {trade.mint_address}")
#             await websocket_manager.send_personal_message(json.dumps({
#                 "type": "log",
#                 "log_type": "error",
#                 "message": f"❌ Monitor failed: Trade ID missing for {trade.mint_address[:8]}",
#                 "timestamp": datetime.utcnow().isoformat()
#             }), user.wallet_address)
#             return
        
#         # Fetch trade FRESH from database using the ID
#         trade_result = await main_session.execute(
#             select(Trade).where(Trade.id == trade_id)
#         )
#         db_trade = trade_result.scalar_one_or_none()
        
#         if not db_trade:
#             logger.error(f"Trade {trade_id} not found in database for {trade.mint_address}")
#             await websocket_manager.send_personal_message(json.dumps({
#                 "type": "log",
#                 "log_type": "error",
#                 "message": f"❌ Monitor failed: Trade {trade_id} not found in database",
#                 "timestamp": datetime.utcnow().isoformat()
#             }), user.wallet_address)
#             return
        
#         # Now we have fresh objects in our new session
#         trade = db_trade
        
#         # 🔥 CRITICAL: Get the EXACT buy timestamp from the trade
#         timing_base = trade.buy_timestamp if trade.buy_timestamp else datetime.utcnow()
#         amount_lamports = int(token_amount * (10 ** token_decimals))  # Full amount
#         mint = trade.mint_address
        
#         # Get user's timeout setting - REFRESH EVERY LOOP
#         user_result = await main_session.execute(
#             select(User).where(User.wallet_address == user.wallet_address)
#         )
#         current_user = user_result.scalar_one_or_none()
        
#         if not current_user:
#             logger.error(f"User {user.wallet_address} not found during monitor setup")
#             return
        
#         timeout_seconds = current_user.sell_timeout_seconds or 3600  # Default 1 hour
#         take_profit_pct = current_user.sell_take_profit_pct or 50.0
#         stop_loss_pct = current_user.sell_stop_loss_pct or 20.0
        
#         # Log that monitoring has started with CLEAR timeout info
#         logger.info(f"🚀 MONITOR STARTED for {mint[:8]}... | Trade ID: {trade.id}")
#         logger.info(f"  User: {user.wallet_address[:8]}")
#         logger.info(f"  Buy time: {timing_base}")
#         logger.info(f"  Timeout: {timeout_seconds}s (Will auto-sell at: {timing_base + timedelta(seconds=timeout_seconds)})")
#         logger.info(f"  Take profit: {take_profit_pct}%")
#         logger.info(f"  Stop loss: {stop_loss_pct}%")
#         logger.info(f"  Token amount: {token_amount:.2f}")
        
#         # Send monitoring started message to frontend
#         await websocket_manager.send_personal_message(json.dumps({
#             "type": "log",
#             "log_type": "info",
#             "message": f"📈 Monitoring {trade.token_symbol or mint[:8]}... | Auto-sell in {timeout_seconds}s",
#             "timestamp": datetime.utcnow().isoformat()
#         }), user.wallet_address)
        
#         iteration = 0
        
#         while True:
#             iteration += 1
#             current_time = datetime.utcnow()
            
#             # Create a NEW session for each iteration
#             async with AsyncSessionLocal() as session:
#                 try:
#                     # REFRESH USER EVERY LOOP (CRITICAL FOR TIMEOUT)
#                     user_result = await session.execute(
#                         select(User).where(User.wallet_address == user.wallet_address)
#                     )
#                     user = user_result.scalar_one_or_none()
                    
#                     if not user:
#                         logger.error(f"User disappeared during monitoring: {user.wallet_address}")
#                         await websocket_manager.send_personal_message(json.dumps({
#                             "type": "log",
#                             "log_type": "error",
#                             "message": f"❌ User not found, stopping monitor",
#                             "timestamp": current_time.isoformat()
#                         }), user.wallet_address)
#                         break
                    
#                     # Get latest timeout from user
#                     timeout_seconds = user.sell_timeout_seconds or 3600
                    
#                     # Check if trade already sold
#                     trade_result = await session.execute(
#                         select(Trade).where(Trade.id == trade_id)
#                     )
#                     current_trade = trade_result.scalar_one_or_none()
                    
#                     if not current_trade:
#                         logger.warning(f"Trade {mint[:8]}... no longer in DB, stopping monitor")
#                         break
                    
#                     if current_trade.sell_timestamp:
#                         logger.info(f"Trade {mint[:8]}... already sold at {current_trade.sell_timestamp}, stopping monitor")
#                         await websocket_manager.send_personal_message(json.dumps({
#                             "type": "log",
#                             "log_type": "info",
#                             "message": f"✅ Position already sold, stopping monitor",
#                             "timestamp": current_time.isoformat()
#                         }), user.wallet_address)
#                         break
                    
#                     # ============================================================
#                     # 🎯 CHECK #1: TIMEOUT - THIS IS THE MAIN FIX
#                     # ============================================================
#                     elapsed_seconds = (current_time - timing_base).total_seconds()
                    
#                     # DEBUG: Log timeout status every 10 iterations
#                     if iteration % 10 == 0:
#                         time_left = max(0, timeout_seconds - elapsed_seconds)
#                         logger.info(f"⏰ Timeout check for {mint[:8]}: {elapsed_seconds:.0f}s / {timeout_seconds}s ({(elapsed_seconds/timeout_seconds*100):.1f}%)")
                    
#                     # TIMEOUT TRIGGER - This MUST happen regardless of price
#                     # if elapsed_seconds >= timeout_seconds:
#                     #     logger.info(f"⏰ TIMEOUT REACHED for {mint[:8]}: {elapsed_seconds:.0f}s >= {timeout_seconds}s")
                        
#                     #     # Fetch current price for reporting
#                     #     dex = await get_cached_price(mint)
#                     #     current_price = 0
#                     #     pnl = 0
                        
#                     #     if dex and dex.get("priceUsd"):
#                     #         current_price = float(dex["priceUsd"])
#                     #         if entry_price_usd > 0:
#                     #             pnl = (current_price / entry_price_usd - 1) * 100
                        
#                     #     # Send timeout notification
#                     #     await websocket_manager.send_personal_message(json.dumps({
#                     #         "type": "log",
#                     #         "log_type": "warning",
#                     #         "message": f"⏰ TIMEOUT: Selling {trade.token_symbol or mint[:8]} after {timeout_seconds}s (PnL: {pnl:.2f}%)",
#                     #         "timestamp": current_time.isoformat()
#                     #     }), user.wallet_address)
                        
#                     #     # Execute the sell
#                     #     await execute_timeout_sell(user, mint, amount_lamports, trade_id, session, 
#                     #                               entry_price_usd, current_price, pnl, websocket_manager)
                        
#                     #     # Monitor job is done
#                     #     break
                    
                    
#                     # TIMEOUT TRIGGER - This MUST happen regardless of price
#                     if elapsed_seconds >= timeout_seconds:
#                         logger.info(f"⏰ TIMEOUT REACHED for {mint[:8]}: {elapsed_seconds:.0f}s >= {timeout_seconds}s")
                        
#                         # 🔥 FIX: Get current price for PnL calculation
#                         dex = await get_cached_price(mint)
#                         current_price = 0
                        
#                         if dex and dex.get("priceUsd"):
#                             current_price = float(dex["priceUsd"])
                        
#                         # Calculate PnL based on ACTUAL entry price from trade
#                         if trade.price_usd_at_trade and current_price > 0:
#                             pnl = (current_price / trade.price_usd_at_trade - 1) * 100
#                         else:
#                             pnl = 0
                        
#                         # Send timeout notification with REAL PnL
#                         await websocket_manager.send_personal_message(json.dumps({
#                             "type": "log",
#                             "log_type": "warning",
#                             "message": f"⏰ TIMEOUT: Selling {trade.token_symbol or mint[:8]} after {timeout_seconds}s (PnL: {pnl:.2f}%)",
#                             "timestamp": current_time.isoformat()
#                         }), user.wallet_address)
                        
#                         # Execute the sell with CORRECT PnL
#                         await execute_timeout_sell(user, mint, amount_lamports, trade_id, session, 
#                                                 trade.price_usd_at_trade or entry_price_usd, 
#                                                 current_price, pnl, websocket_manager)
                        
#                         # Monitor job is done
#                         break
                    
#                     # ============================================================
#                     # CHECK #2: PRICE-BASED CONDITIONS (only if not timed out)
#                     # ============================================================
                    
#                     # Fetch current price
#                     dex = await get_cached_price(mint)
#                     if not dex or not dex.get("priceUsd"):
#                         logger.debug(f"No price data for {mint[:8]}... - waiting")
#                         await asyncio.sleep(5)
#                         continue
                    
#                     current_price = float(dex["priceUsd"])
                    
#                     if entry_price_usd <= 0 or current_price <= 0:
#                         logger.debug(f"Invalid price for {mint[:8]}: entry=${entry_price_usd}, current=${current_price}")
#                         await asyncio.sleep(5)
#                         continue
                    
#                     # Calculate PnL
#                     pnl = (current_price / entry_price_usd - 1) * 100
                    
#                     # Log current status periodically
#                     if iteration % 15 == 0:
#                         logger.info(f"📊 Monitor {mint[:8]}: ${current_price:.6f} | PnL: {pnl:.2f}% | Time left: {max(0, timeout_seconds - elapsed_seconds):.0f}s")
                        
#                         # Send heartbeat to frontend
#                         await websocket_manager.send_personal_message(json.dumps({
#                             "type": "position_update",
#                             "mint": mint,
#                             "current_price": current_price,
#                             "pnl_percent": round(pnl, 2),
#                             "entry_price": entry_price_usd,
#                             "time_left_seconds": max(0, timeout_seconds - elapsed_seconds),
#                             "timeout_seconds": timeout_seconds,
#                             "timestamp": current_time.isoformat()
#                         }), user.wallet_address)
                    
#                     sell_reason = None
#                     sell_partial = False
#                     sell_amount_lamports = amount_lamports
                    
#                     # 2A. Take Profit
#                     if user.sell_take_profit_pct and pnl >= user.sell_take_profit_pct:
#                         sell_reason = "Take Profit"
#                         if user.partial_sell_pct and user.partial_sell_pct < 100:
#                             sell_partial = True
#                             sell_amount_lamports = int(amount_lamports * (user.partial_sell_pct / 100))
#                         logger.info(f"🎯 TAKE PROFIT for {mint[:8]}: PnL {pnl:.2f}% >= {user.sell_take_profit_pct}%")
                    
#                     # 2B. Stop Loss
#                     elif user.sell_stop_loss_pct and pnl <= -user.sell_stop_loss_pct:
#                         sell_reason = "Stop Loss"
#                         logger.info(f"🛑 STOP LOSS for {mint[:8]}: PnL {pnl:.2f}% <= -{user.sell_stop_loss_pct}%")
                    
#                     # 2C. Execute sell if any price condition met
#                     if sell_reason:
#                         await execute_price_based_sell(
#                             user, mint, sell_amount_lamports, trade_id, session,
#                             entry_price_usd, current_price, pnl, sell_reason, sell_partial,
#                             token_decimals, websocket_manager
#                         )
                        
#                         if sell_partial:
#                             # Update remaining amount and continue monitoring
#                             amount_lamports -= sell_amount_lamports
#                             token_amount -= (sell_amount_lamports / (10 ** token_decimals))
#                             logger.info(f"✅ Partial sell executed. Remaining: {token_amount:.2f} tokens")
#                             continue
#                         else:
#                             # Full sell - exit monitor
#                             break
                    
#                     # ============================================================
#                     # WAIT BEFORE NEXT CHECK
#                     # ============================================================
#                     await asyncio.sleep(4)  # Check every 4 seconds
                    
#                 except Exception as e:
#                     logger.error(f"Monitor error for {mint} on iteration {iteration}: {e}", exc_info=True)
#                     await asyncio.sleep(10)
                    
#                     # After too many errors, check if we should stop
#                     if iteration > 100:  # ~10 minutes of errors
#                         logger.error(f"Too many monitor errors for {mint}, stopping")
#                         await websocket_manager.send_personal_message(json.dumps({
#                             "type": "log",
#                             "log_type": "error",
#                             "message": f"❌ Monitor stopped due to errors for {trade.token_symbol or mint[:8]}",
#                             "timestamp": current_time.isoformat()
#                         }), user.wallet_address)
#                         break
            
#             # Session auto-closes here due to context manager
        
#         logger.info(f"🛑 MONITOR STOPPED for {mint[:8]}... after {iteration} iterations")
        
#     except Exception as e:
#         logger.error(f"Fatal error in monitor setup for {trade.mint_address}: {e}", exc_info=True)
#         await websocket_manager.send_personal_message(json.dumps({
#             "type": "log",
#             "log_type": "error",
#             "message": f"❌ Monitor failed to start for {trade.token_symbol or trade.mint_address[:8]}",
#             "timestamp": datetime.utcnow().isoformat()
#         }), user.wallet_address)
        
#     finally:
#         # Always close the main session if it exists
#         if main_session:
#             await main_session.close()


# async def execute_timeout_sell(user: User, mint: str, amount_lamports: int, trade_id: int, 
#                               session: AsyncSession, entry_price: float, current_price: float,
#                               pnl: float, websocket_manager: ConnectionManager):
#     """Execute a sell due to timeout"""
#     try:
#         logger.info(f"🔄 Executing TIMEOUT sell for {mint[:8]}...")
        
#         # 🔥 CRITICAL FIX: Get ACTUAL current price from DexScreener
#         dex_data = await get_cached_price(mint)
#         actual_current_price = 0
        
#         if dex_data and dex_data.get("priceUsd"):
#             actual_current_price = float(dex_data["priceUsd"])
#         else:
#             # Try to fetch fresh data
#             dex_data = await fetch_dexscreener_with_retry(mint)
#             if dex_data and dex_data.get("price_usd"):
#                 actual_current_price = float(dex_data["price_usd"])
        
#         # 🔥 CRITICAL FIX: Get the trade with ALL details including token decimals
#         trade_result = await session.execute(
#             select(Trade).where(Trade.id == trade_id)
#         )
#         trade = trade_result.scalar_one_or_none()
        
#         if not trade:
#             logger.error(f"Trade {trade_id} not found for timeout sell")
#             return
        
#         # Get correct decimals
#         token_decimals = trade.token_decimals or 9
        
#         # 🔥 CRITICAL FIX: Get actual entry price from trade, not passed parameter
#         actual_entry_price = trade.price_usd_at_trade or entry_price
        
#         # Calculate REAL PnL
#         if actual_entry_price > 0 and actual_current_price > 0:
#             real_pnl = ((actual_current_price / actual_entry_price) - 1) * 100
#         else:
#             real_pnl = 0
        
#         logger.info(f"📊 REAL PnL Calculation: Entry=${actual_entry_price:.10f}, Current=${actual_current_price:.10f}, PnL={real_pnl:.2f}%")
        
#         # Get user's sell slippage
#         slippage_bps = int(user.sell_slippage_bps) if user.sell_slippage_bps else 500
        
#         # Execute the sell swap
#         swap = await execute_jupiter_swap(
#             user=user,
#             input_mint=mint,
#             output_mint=settings.SOL_MINT,
#             amount=amount_lamports,
#             slippage_bps=slippage_bps,
#             label="TIMEOUT_SELL",
#         )
        
#         # Calculate profit in USD
#         token_amount = amount_lamports / (10 ** token_decimals)
#         profit_usd = (actual_current_price - actual_entry_price) * token_amount
        
#         # Update trade record with CORRECT values
#         if trade:
#             trade.sell_timestamp = datetime.utcnow()
#             trade.sell_reason = "Timeout"
#             trade.sell_tx_hash = swap.get("signature")
#             trade.price_usd_at_trade = actual_current_price  # Update with actual sell price
#             trade.profit_usd = profit_usd
#             trade.profit_sol = profit_usd / actual_current_price if actual_current_price > 0 else 0
            
#             # Store fee info if applied
#             if swap.get("fee_applied"):
#                 trade.fee_applied = True
#                 trade.fee_amount = swap.get("estimated_referral_fee", 0)
#                 trade.fee_percentage = swap.get("fee_percentage", 0.0)
#                 trade.fee_bps = swap.get("fee_bps", None)
#                 trade.fee_mint = swap.get("fee_mint", None)
#                 trade.fee_collected_at = datetime.utcnow()
            
#             trade.solscan_sell_url = f"https://solscan.io/tx/{swap.get('signature')}"
            
#             await session.commit()
        
#         # Send success message with REAL PnL
#         await websocket_manager.send_personal_message(json.dumps({
#             "type": "log",
#             "log_type": "success",
#             "message": f"✅ TIMEOUT SELL: Sold {mint[:8]} after timeout. PnL: {real_pnl:.2f}% | Profit: ${profit_usd:.6f}",
#             "timestamp": datetime.utcnow().isoformat()
#         }), user.wallet_address)
        
#         # Send trade instruction to frontend with correct PnL
#         await websocket_manager.send_personal_message(json.dumps({
#             "type": "trade_instruction",
#             "action": "sell",
#             "mint": mint,
#             "reason": "Timeout",
#             "pnl_pct": round(real_pnl, 2),
#             "profit_usd": profit_usd,
#             "profit_sol": profit_usd / actual_current_price if actual_current_price > 0 else 0,
#             "entry_price": actual_entry_price,
#             "exit_price": actual_current_price,
#             "signature": swap["signature"],
#             "solscan_url": f"https://solscan.io/tx/{swap['signature']}"
#         }), user.wallet_address)
        
#         logger.info(f"✅ TIMEOUT SELL COMPLETED for {mint[:8]} | PnL: {real_pnl:.2f}% | Profit: ${profit_usd:.6f}")
        
#     except Exception as e:
#         logger.error(f"❌ TIMEOUT SELL FAILED for {mint[:8]}: {e}", exc_info=True)
#         await websocket_manager.send_personal_message(json.dumps({
#             "type": "log",
#             "log_type": "error",
#             "message": f"❌ Timeout sell failed: {str(e)[:100]}",
#             "timestamp": datetime.utcnow().isoformat()
#         }), user.wallet_address)
        

# async def execute_price_based_sell(user: User, mint: str, amount_lamports: int, trade_id: int,
#                                   session: AsyncSession, entry_price: float, current_price: float,
#                                   pnl: float, reason: str, is_partial: bool,
#                                   token_decimals: int, websocket_manager: ConnectionManager):
#     """Execute a sell based on price conditions (TP/SL)"""
#     try:
#         logger.info(f"🔄 Executing {reason} sell for {mint[:8]}...")
        
#         # Get user's sell slippage
#         slippage_bps = int(user.sell_slippage_bps) if user.sell_slippage_bps else 500
        
#         # Execute the sell swap
#         swap = await execute_jupiter_swap(
#             user=user,
#             input_mint=mint,
#             output_mint=settings.SOL_MINT,
#             amount=amount_lamports,
#             slippage_bps=slippage_bps,
#             label=f"{reason}_SELL",
#         )
        
#         # Update trade record
#         trade_result = await session.execute(
#             select(Trade).where(Trade.id == trade_id)
#         )
#         trade = trade_result.scalar_one_or_none()
        
#         if trade:
#             if is_partial:
#                 # Update remaining amount
#                 trade.amount_tokens = trade.amount_tokens - (amount_lamports / (10 ** token_decimals))
#                 trade.profit_usd = (trade.profit_usd or 0) + ((current_price - entry_price) * (amount_lamports / (10 ** token_decimals)))
#                 trade.sell_reason = f"{reason} (Partial)"
#             else:
#                 # Full sell
#                 trade.sell_timestamp = datetime.utcnow()
#                 trade.sell_reason = reason
#                 trade.sell_tx_hash = swap.get("signature")
#                 trade.price_usat_trade = current_price
#                 trade.profit_usd = (current_price - entry_price) * (amount_lamports / (10 ** token_decimals))
#                 trade.solscan_sell_url = f"https://solscan.io/tx/{swap.get('signature')}"
            
#             # Store fee info if applied
#             if swap.get("fee_applied"):
#                 trade.fee_applied = True
#                 trade.fee_amount = swap.get("estimated_referral_fee", 0)
#                 trade.fee_percentage = swap.get("fee_percentage", 0.0)
#                 trade.fee_bps = swap.get("fee_bps", None)
#                 trade.fee_mint = swap.get("fee_mint", None)
#                 trade.fee_collected_at = datetime.utcnow()
            
#             await session.commit()
        
#         # Send success message
#         message = f"✅ {reason}: Sold {mint[:8]}. PnL: {pnl:.2f}%"
#         if is_partial:
#             message += " (Partial)"
        
#         await websocket_manager.send_personal_message(json.dumps({
#             "type": "log",
#             "log_type": "success",
#             "message": message,
#             "timestamp": datetime.utcnow().isoformat()
#         }), user.wallet_address)
        
#         logger.info(f"✅ {reason} SELL COMPLETED for {mint[:8]}")
        
#     except Exception as e:
#         logger.error(f"❌ {reason} SELL FAILED for {mint[:8]}: {e}")
#         await websocket_manager.send_personal_message(json.dumps({
#             "type": "log",
#             "log_type": "error",
#             "message": f"❌ {reason} sell failed: {str(e)[:100]}",
#             "timestamp": datetime.utcnow().isoformat()
#         }), user.wallet_address)
        
                   
            
            
            
            
            
            
            
            
            
            
            
            
            
            
            
            
            
            
            
            
            
            
            
            
            
            
            
            
            
            
            
            
            
            
            
            
            
            
            
            
            
            
            
            
            
            
import logging
import json
import base64
import asyncio
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
import redis.asyncio as redis
import aiohttp
import httpx
from fastapi import WebSocket
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from solders.pubkey import Pubkey
from solders.keypair import Keypair
from solders.transaction import VersionedTransaction
from solders.signature import Signature
from solders.message import to_bytes_versioned
from solana.rpc.async_api import AsyncClient
from spl.token.instructions import get_associated_token_address
from app.database import AsyncSessionLocal
from app.models import Trade, User, TokenMetadata
from app.utils.dexscreener_api import fetch_dexscreener_with_retry, get_dexscreener_data
from app.config import settings
from app.security import decrypt_private_key_backend
from app.utils.jupiter_api import get_jupiter_token_data, safe_float
from app.utils.webacy_api import check_webacy_risk
from app.utils.jito_bundles import get_jito_manager, JitoBundleManager
from app.utils import fee_manager
from app.utils.redis_client import get_redis_client
import random
import time
from decimal import Decimal, ROUND_DOWN
from collections import deque

logger = logging.getLogger(__name__)

# Get the shared Redis client
redis_client = get_redis_client()

monitor_tasks: Dict[int, asyncio.Task] = {}
price_cache: Dict[str, Dict] = {}


# class ConnectionManager:
#     def __init__(self):
#         self.active_connections: Dict[str, WebSocket] = {}
#         self.connection_times: Dict[str, datetime] = {}
        
#     async def connect(self, websocket: WebSocket, wallet_address: str):
#         await websocket.accept()
#         self.active_connections[wallet_address] = websocket
#         self.connection_times[wallet_address] = datetime.utcnow()
        
#     def disconnect(self, wallet_address: str):
#         self.active_connections.pop(wallet_address, None)
#         self.connection_times.pop(wallet_address, None)
        
#     async def check_and_reconnect(self, wallet_address: str):
#         """Check if connection is stale and needs reconnection"""
#         if wallet_address in self.connection_times:
#             last_activity = datetime.utcnow() - self.connection_times[wallet_address]
#             if last_activity.total_seconds() > 60:  # 1 minute of inactivity
#                 logger.warning(f"Connection stale for {wallet_address}, reconnecting...")
#                 return True
#         return False

#     async def send_personal_message(self, message: str, wallet_address: str):
#         ws = self.active_connections.get(wallet_address)
#         if ws:
#             try:
#                 await ws.send_text(message)
#             except:
#                 self.disconnect(wallet_address)

# websocket_manager = ConnectionManager()


# app/utils/bot_components.py - Update ConnectionManager class

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.launch_connections: Dict[str, List[WebSocket]] = {}  # New: for launch-specific connections
        self.connection_times: Dict[str, datetime] = {}
        
    async def connect(self, websocket: WebSocket, connection_id: str, connection_type: str = "wallet"):
        """Connect WebSocket with specific type (wallet or launch)"""
        await websocket.accept()
        
        if connection_type == "wallet":
            self.active_connections[connection_id] = websocket
            self.connection_times[connection_id] = datetime.utcnow()
        elif connection_type == "launch":
            if connection_id not in self.launch_connections:
                self.launch_connections[connection_id] = []
            self.launch_connections[connection_id].append(websocket)
        
    def disconnect(self, connection_id: str, connection_type: str = "wallet"):
        """Disconnect WebSocket"""
        if connection_type == "wallet":
            self.active_connections.pop(connection_id, None)
            self.connection_times.pop(connection_id, None)
        elif connection_type == "launch":
            if connection_id in self.launch_connections:
                # Remove specific websocket (need to track which one)
                # For simplicity, we'll handle this in the endpoint
                pass
    
    async def send_to_launch(self, launch_id: str, message: dict):
        """Send message to all connections for a specific launch"""
        if launch_id in self.launch_connections:
            dead_connections = []
            
            for websocket in self.launch_connections[launch_id]:
                try:
                    await websocket.send_json(message)
                except Exception as e:
                    logger.error(f"Failed to send to launch {launch_id}: {e}")
                    dead_connections.append(websocket)
            
            # Remove dead connections
            for websocket in dead_connections:
                self.launch_connections[launch_id].remove(websocket)
                
            if not self.launch_connections[launch_id]:
                del self.launch_connections[launch_id]
    
    async def broadcast_launch_event(self, launch_id: str, event: str, data: dict):
        """Broadcast launch event to all connected clients"""
        message = {
            "event": event,  # Primary event identifier
            "type": event,   # For backward compatibility
            "launch_id": launch_id,
            "data": data,
            "timestamp": datetime.utcnow().isoformat()
        }
        await self.send_to_launch(launch_id, message)
        
    async def send_personal_message(self, message: str, wallet_address: str):
        ws = self.active_connections.get(wallet_address)
        if ws:
            try:
                await ws.send_text(message)
            except:
                self.disconnect(wallet_address)


# Update the global instance
websocket_manager = ConnectionManager()


class TokenAccountManager:
    """Manages token accounts to avoid rent costs and reuse existing accounts"""
    
    @staticmethod
    async def get_or_create_ata(
        user: User, 
        mint: str, 
        create_if_missing: bool = True,
        priority_fee: int = 10000  # Micro-lamports for priority fee
    ) -> Optional[str]:
        """
        Get existing Associated Token Account (ATA) or create one efficiently.
        Returns ATA address if found/created, None otherwise.
        """
        user_pubkey = Pubkey.from_string(str(user.wallet_address))
        mint_pubkey = Pubkey.from_string(mint)
        
        # Check if ATA already exists
        ata = get_associated_token_address(user_pubkey, mint_pubkey)
        ata_str = str(ata)
        
        # Validate inputs
        if not user_pubkey or not mint_pubkey:
            logger.error(f"Invalid pubkey for ATA creation: user={user.wallet_address[:8]}, mint={mint[:8]}")
            return None
        
        # Check on-chain if account exists
        try:
            async with AsyncClient(settings.SOLANA_RPC_URL) as client:
                account_info = await client.get_account_info(ata)
                if account_info.value:
                    logger.info(f"✅ Reusing existing ATA for {mint[:8]}: {ata_str[:8]}...")
                    
                    # Track ATA usage for analytics
                    await redis_client.hincrby(f"ata_usage:{user.wallet_address}", mint, 1)
                    await redis_client.expire(f"ata_usage:{user.wallet_address}", 86400)  # 24h
                    
                    return ata_str
        except Exception as e:
            logger.debug(f"Error checking ATA existence: {e}")
        
        # ATA doesn't exist, check if we should create it
        if not create_if_missing:
            return None
        
        # Create ATA only if trade size justifies the rent cost
        # Rent for token account is ~0.002 SOL
        RENT_COST_SOL = 0.002
        
        # Estimate if user will trade this token multiple times
        user_token_trades = await redis_client.hget(f"ata_usage:{user.wallet_address}", mint)
        expected_future_trades = int(user_token_trades or 0) + 1
        
        # Only create ATA if:
        # 1. Trade size > 2x rent cost, OR
        # 2. User has traded this token before, OR  
        # 3. User is premium (we invest in their infrastructure)
        
        # For now, let Jupiter handle ATA creation via Ultra API
        # They have optimized ATA creation with priority fees
        logger.info(f"⚠️ ATA for {mint[:8]} doesn't exist. Letting Jupiter handle creation.")
        
        return ata_str  # Return the ATA address anyway, Jupiter will create it
    
    @staticmethod
    async def track_ata_creation_cost(user_wallet: str, mint: str, cost_sol: float):
        """Track how much we've spent on ATA creation for a user"""
        key = f"ata_costs:{user_wallet}"
        current_cost = await redis_client.hget(key, mint) or "0"
        new_cost = float(current_cost) + cost_sol
        
        await redis_client.hset(key, mint, str(new_cost))
        await redis_client.expire(key, 2592000)  # 30 days
        
        logger.info(f"📊 ATA creation cost for {mint[:8]}: {new_cost:.6f} SOL total")

class ProfitOptimizer:
    """Advanced profit optimization for sniper trading"""
    
    def __init__(self):
        self.profit_history = deque(maxlen=100)
        self.rug_history = deque(maxlen=50)
        
    async def calculate_optimal_position_size(self, user_sol: float, risk_score: float) -> float:
        """
        Calculate optimal position size based on Kelly Criterion
        """
        # Historical win rate (adjust based on your actual data)
        WIN_RATE = 0.15  # 15% of tokens go up significantly
        AVG_WIN = 3.0    # 3x average win
        AVG_LOSS = 0.7   # 30% average loss
        
        # Kelly Criterion: f* = p - q/b
        # where p = win probability, q = loss probability, b = win/loss ratio
        p = WIN_RATE
        q = 1 - p
        b = AVG_WIN / AVG_LOSS
        
        kelly_fraction = max(0.01, p - (q / b))
        
        # Adjust for risk score (higher risk = smaller position)
        risk_adjustment = max(0.1, 1.0 - (risk_score / 100))
        
        optimal_fraction = min(0.25, kelly_fraction * risk_adjustment)  # Max 25% per trade
        
        return user_sol * optimal_fraction
    
    async def track_profit(self, trade_id: int, profit_sol: float, hold_time: float):
        """Track profit for optimization"""
        profit_per_hour = profit_sol / max(0.1, hold_time/3600)
        self.profit_history.append({
            "trade_id": trade_id,
            "profit_sol": profit_sol,
            "profit_per_hour": profit_per_hour,
            "timestamp": datetime.utcnow().isoformat()
        })
        
    async def get_optimal_sell_strategy(self, current_pnl: float, volatility: float) -> Dict:
        """
        Dynamic sell strategy based on market conditions
        """
        # Aggressive selling for high volatility
        if volatility > 50:  # >50% price swings
            return {
                "tp_levels": [
                    {"profit_pct": 15, "sell_pct": 40},
                    {"profit_pct": 30, "sell_pct": 30},
                    {"profit_pct": 50, "sell_pct": 20},
                    {"profit_pct": 100, "sell_pct": 10}
                ],
                "stop_loss": 15.0,
                "trailing_stop": 10.0
            }
        # Moderate for normal conditions
        else:
            return {
                "tp_levels": [
                    {"profit_pct": 25, "sell_pct": 30},
                    {"profit_pct": 50, "sell_pct": 30},
                    {"profit_pct": 100, "sell_pct": 25},
                    {"profit_pct": 200, "sell_pct": 15}
                ],
                "stop_loss": 20.0,
                "trailing_stop": 15.0
            }

profit_optimizer = ProfitOptimizer()


class MEVProtector:
    """Protect against MEV and front-running"""
    
    @staticmethod
    async def create_stealth_transaction(
        user: User,
        mint: str,
        amount_lamports: int,
        is_buy: bool,
        priority_fee: int = 100000  # 0.0001 SOL for priority
    ) -> Dict:
        """
        Create stealth transactions to avoid front-running
        """
        # Random delay to avoid predictable patterns
        delay_ms = random.randint(50, 300)
        await asyncio.sleep(delay_ms / 1000)
        
        # Vary slippage to avoid detection
        base_slippage = 1000  # 10%
        random_slippage = random.randint(-200, 200)
        final_slippage = max(500, base_slippage + random_slippage)
        
        # Add dummy instructions to confuse MEV bots
        # (In practice, you'd add some no-op instructions)
        
        return {
            "slippage_bps": final_slippage,
            "priority_fee": priority_fee,
            "stealth_delay_ms": delay_ms
        }
    
    @staticmethod
    async def detect_mev_activity(mint: str) -> bool:
        """
        Detect if MEV bots are active on this token
        """
        try:
            # Check for rapid consecutive transactions
            dex_data = await get_cached_price(mint)
            if not dex_data:
                return False
                
            txns_5m = dex_data.get("txns", {}).get("m5", {})
            buys = txns_5m.get("buys", 0)
            sells = txns_5m.get("sells", 0)
            
            # If very high volume in short time, likely MEV
            if (buys + sells) > 50:  # 50+ tx in 5 minutes
                logger.warning(f"⚠️ MEV activity detected on {mint[:8]}")
                return True
                
        except Exception as e:
            logger.debug(f"MEV detection failed: {e}")
            
        return False

mev_protector = MEVProtector()


class RugDetector:
    """Advanced rug pull detection"""
    
    @staticmethod
    async def analyze_token_risk(mint: str) -> Dict:
        """
        Analyze token for rug risk
        Returns: {"risk_score": 0-100, "red_flags": list, "suggestion": str}
        """
        red_flags = []
        risk_score = 0
        
        try:
            # Get comprehensive data
            jupiter_data, dexscreener_data = await get_on_chain_data_for_strategy(mint)
            
            if not jupiter_data or not dexscreener_data:
                return {"risk_score": 100, "red_flags": ["No data"], "suggestion": "AVOID"}
            
            # 1. Holder concentration
            top_holders = jupiter_data.get("top_holders_percentage", 100)
            if top_holders > 70:
                red_flags.append(f"High holder concentration ({top_holders}%)")
                risk_score += 30
            
            # 2. Recent sells
            num_sells_24h = jupiter_data.get("num_sells_24h", 0)
            if num_sells_24h > 100:
                red_flags.append(f"High sell volume ({num_sells_24h} sells)")
                risk_score += 20
            
            # 3. Liquidity
            liquidity = dexscreener_data.get("liquidity_usd", 0)
            if liquidity < 2000:
                red_flags.append(f"Low liquidity (${liquidity})")
                risk_score += 25
            
            # 4. Price action
            price_change_5m = dexscreener_data.get("price_change_m5", 0)
            if price_change_5m < -20:
                red_flags.append(f"Sharp dump ({price_change_5m}% in 5m)")
                risk_score += 15
            
            # 5. Suspicious flags
            if jupiter_data.get("is_suspicious"):
                red_flags.append("Jupiter suspicious flag")
                risk_score += 40
            
            if jupiter_data.get("blockaid_rugpull"):
                red_flags.append("Blockaid rugpull warning")
                risk_score += 50
            
            # Determine suggestion
            if risk_score >= 70:
                suggestion = "AVOID - High rug risk"
            elif risk_score >= 40:
                suggestion = "CAUTION - Medium risk"
            elif risk_score >= 20:
                suggestion = "WATCH - Some risk"
            else:
                suggestion = "SAFE - Low risk"
            
            return {
                "risk_score": min(100, risk_score),
                "red_flags": red_flags,
                "suggestion": suggestion,
                "data_timestamp": datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Rug detection failed: {e}")
            return {"risk_score": 100, "red_flags": ["Analysis failed"], "suggestion": "AVOID"}

rug_detector = RugDetector()



# Move this function to the TOP after imports but before class definitions
async def check_and_restart_stale_monitors():
    """Check if monitor tasks are running and restart if needed"""
    while True:
        try:
            # Use a single session for the check
            async with AsyncSessionLocal() as db:
                # Find trades that should be monitored but don't have active tasks
                result = await db.execute(
                    select(Trade).where(
                        Trade.sell_timestamp.is_(None),
                        Trade.buy_timestamp > datetime.utcnow() - timedelta(hours=24)
                    )
                )
                trades = result.scalars().all()
                
                for trade in trades:
                    if trade.id not in monitor_tasks:
                        logger.info(f"🔄 Restarting monitor for trade {trade.id}")
                        
                        # Get user - use the same session
                        user_result = await db.execute(
                            select(User).where(User.wallet_address == trade.user_wallet_address)
                        )
                        user = user_result.scalar_one_or_none()
                        
                        if user and trade.token_decimals and trade.amount_tokens:
                            # Pass the database session to avoid creating new ones
                            asyncio.create_task(
                                restart_monitor_for_trade(trade, user, db)
                            )
            
            # Session auto-closes here
        
        except Exception as e:
            logger.error(f"Error checking stale monitors: {e}")
        
        await asyncio.sleep(30)

async def restart_monitor_for_trade(trade: Trade, user: User, db: AsyncSession):
    """Helper to restart monitor for a trade with existing session"""
    try:
        # Note: We don't use the passed db session because monitor_position creates its own
        await monitor_position(
            user=user,
            trade=trade,
            entry_price_usd=trade.price_usd_at_trade or 0,
            token_decimals=trade.token_decimals,
            token_amount=trade.amount_tokens,
            websocket_manager=websocket_manager
        )
    except Exception as e:
        logger.error(f"Failed to restart monitor for trade {trade.id}: {e}")
    finally:
        # Don't close the session here - it's managed by check_and_restart_stale_monitors
        pass
        
# ===================================================================
# Correct Jupiter Referral ATA (2025)
# ===================================================================
def get_jupiter_referral_ata(referral_pda: str, mint: str) -> str:
    owner = Pubkey.from_string(referral_pda)
    mint_pubkey = Pubkey.from_string(mint)
    ata = get_associated_token_address(owner, mint_pubkey)
    return str(ata)

# ===================================================================
# Non-blocking transaction confirmation
# ===================================================================
async def _confirm_tx_async(rpc_url: str, signature: str, label: str, wallet_address: str, input_sol: float):
    try:
        async with AsyncClient(rpc_url) as client:
            sig = Signature.from_string(signature)
            resp = await client.confirm_transaction(sig, commitment="confirmed")
            statuses = resp.value
            if statuses and len(statuses) > 0 and statuses[0].err:
                err = statuses[0].err
                err_str = str(err)
                error_type = "UNKNOWN"
                if "6025" in err_str:
                    error_type = "INSUFFICIENT_INPUT_LIQUIDITY"
                    user_msg = json.dumps({
                        "type": "log",
                        "message": f"{label} failed: Low liquidity (error 6025). Input {input_sol} SOL too small — try 0.1+ SOL.",
                        "status": "warning",
                        "tx": f"https://solscan.io/tx/{signature}"
                    })
                    await websocket_manager.send_personal_message(user_msg, wallet_address)
                logger.warning(f"{label} {signature} failed on-chain ({error_type}): {err}")
            else:
                logger.info(f"{label} {signature} CONFIRMED")
    except Exception as e:
        logger.warning(f"Confirmation failed for {signature}: {e}")

async def get_fee_statistics():
    """Get statistics about collected fees"""
    try:
        # Get all fee records
        fee_records = await redis_client.lrange("fee_tracking", 0, -1)
        
        total_fees = 0
        total_transactions = len(fee_records)
        
        for record in fee_records:
            try:
                data = json.loads(record)
                fee_amount = data.get("fee_amount", 0)
                total_fees += fee_amount
            except:
                pass
        
        return {
            "total_transactions": total_transactions,
            "total_fees_collected": total_fees,
            "average_fee_per_tx": total_fees / total_transactions if total_transactions > 0 else 0
        }
        
    except Exception as e:
        logger.error(f"Failed to get fee statistics: {e}")
        return {"error": str(e)}

async def get_fee_analytics(db: AsyncSession):
    """Get analytics about fee collection"""
    from sqlalchemy import select, func
    from app.models import Trade  # Add this import
    
    # Get total fees collected
    stmt = select(
        func.count(Trade.id).label("total_trades"),
        func.count(Trade.id).filter(Trade.fee_applied == True).label("trades_with_fees"),
        func.coalesce(func.sum(Trade.fee_amount), 0).label("total_fees_collected"),
        func.avg(Trade.fee_percentage).label("avg_fee_percentage")
    )
    
    result = await db.execute(stmt)
    stats = result.first()
    
    # Get fee distribution by mint
    stmt_mint = select(
        Trade.fee_mint,
        func.count(Trade.id).label("count"),
        func.sum(Trade.fee_amount).label("total_amount")
    ).where(
        Trade.fee_applied == True
    ).group_by(
        Trade.fee_mint
    )
    
    result_mint = await db.execute(stmt_mint)
    mint_distribution = result_mint.all()
    
    return {
        "total_trades": stats.total_trades or 0,
        "trades_with_fees": stats.trades_with_fees or 0,
        "total_fees_collected": float(stats.total_fees_collected or 0),
        "avg_fee_percentage": float(stats.avg_fee_percentage or 0),
        "fee_rate": (stats.trades_with_fees or 0) / (stats.total_trades or 1) * 100,
        "mint_distribution": [
            {
                "mint": mint,
                "count": count,
                "total_amount": float(total_amount or 0)
            }
            for mint, count, total_amount in mint_distribution
        ]
    } 
        
# ===================================================================
# JUPITER ULTRA API IMPLEMENTATION (CORRECT 2025)
# ===================================================================

# async def execute_jupiter_swap(
#     user: User,
#     input_mint: str,
#     output_mint: str, 
#     amount: int,
#     slippage_bps: int,
#     label: str = "swap",
#     max_retries: int = 3,
#     use_jito_for_critical: bool = True 
# ) -> dict:
    
#     input_sol = amount / 1_000_000_000.0
    
#     # Determine if this is a critical trade that needs Jito
#     IS_CRITICAL_TRADE = (
#         "STOP_LOSS" in label or
#         "TIMEOUT" in label or 
#         "TP_" in label or 
#         input_sol > 1.0 # Large trades
#     )
    
#     # 🔥 CRITICAL: Use Jito for guaranteed execution on critical trades
#     if use_jito_for_critical and IS_CRITICAL_TRADE:
#         try:
#             logger.info(f"🚀 Using Jito bundle for CRITICAL trade: {label} {input_sol:.4f} SOL")
            
#             # First, get the Jupiter transaction as usual
#             regular_result = await execute_jupiter_swap_internal(
#                 user, input_mint, output_mint, amount, slippage_bps, label, max_retries
#             )
            
#             if regular_result.get("raw_tx_base64"):
#                 # Get Jito manager
#                 jito_manager = await get_jito_manager()
                
#                 # Get user keypair
#                 private_key_bytes = decrypt_private_key_backend(user.encrypted_private_key)
#                 keypair = Keypair.from_bytes(private_key_bytes)
                
#                 # Execute with Jito bundles
#                 jito_result = await jito_manager.execute_jupiter_swap_with_jito(
#                     signed_transaction_base64=regular_result["raw_tx_base64"],
#                     user_keypair=keypair,
#                     label=f"JITO_{label}"
#                 )
                
#                 # Merge results
#                 merged_result = {**regular_result, **jito_result}
#                 merged_result["method"] = "jupiter_ultra_with_jito"
#                 merged_result["jito_guaranteed"] = True 
                
#                 logger.info(f"✅ Jito bundle executed for {label} | Bundle: {jito_result.get('bundle_id', 'N/A')}")
                
#                 return merged_result
            
#         except Exception as jito_error:
#             logger.warning(f"Jito bundle failed, falling back to regular execution: {jito_error}")
#             # Fall back to regular execution
    
#     # Regular execution (original code)
#     return await execute_jupiter_swap_internal(user, input_mint, output_mint, amount, slippage_bps, label, max_retries)


async def execute_jupiter_swap(
    user: User,
    input_mint: str,
    output_mint: str, 
    amount: int,
    slippage_bps: int,
    label: str = "swap",
    max_retries: int = 3,
    use_jito_for_critical: bool = True,
    force_jito: bool = False,  # NEW: Force Jito for any trade
    stealth_mode: bool = False  # NEW: Use MEV protection
) -> dict:
    
    input_sol = amount / 1_000_000_000.0
    
    # 🔥 UPDATED CRITICAL TRADE DETECTION
    CRITICAL_TRADES = [
        "STOP_LOSS", "TIMEOUT", "TP_", "HEAVY_SELL_EXIT",
        "DCA_", "SCALE_IN_", "TRAILING_STOP", "EMERGENCY"
    ]
    
    IS_CRITICAL_TRADE = any(crit in label for crit in CRITICAL_TRADES)
    
    # NEW: Force Jito for ALL sells and large trades
    FORCE_JITO = (
        force_jito or 
        output_mint == settings.SOL_MINT or  # All sells
        input_sol > 0.5 or  # Large trades > 0.5 SOL
        "SELL" in label.upper()  # Any sell
    )
    
    # Apply MEV protection if enabled
    if stealth_mode:
        mev_config = await mev_protector.create_stealth_transaction(
            user, input_mint, amount, "BUY" in label
        )
        slippage_bps = mev_config["slippage_bps"]
        logger.info(f"🕵️ Stealth mode: Using {slippage_bps}bps slippage")
    
    # 🔥 USE JITO FOR ALL CRITICAL TRADES + FORCED JITO
    if use_jito_for_critical and (IS_CRITICAL_TRADE or FORCE_JITO):
        try:
            logger.info(f"🚀 ULTRA-PRIORITY Jito bundle: {label} {input_sol:.4f} SOL")
            
            # Get MEV detection
            has_mev = await mev_protector.detect_mev_activity(
                output_mint if "BUY" in label else input_mint
            )
            
            # Increase tip if MEV detected
            extra_tip = 50000 if has_mev else 0  # Extra 0.00005 SOL for MEV zones
            
            # Get Jupiter transaction
            regular_result = await execute_jupiter_swap_internal(
                user, input_mint, output_mint, amount, slippage_bps, 
                f"JITO_{label}", max_retries
            )
            
            if regular_result.get("raw_tx_base64"):
                # Get Jito manager
                jito_manager = await get_jito_manager()
                
                # Get user keypair
                private_key_bytes = decrypt_private_key_backend(user.encrypted_private_key)
                keypair = Keypair.from_bytes(private_key_bytes)
                
                # Execute with Jito bundles
                jito_result = await jito_manager.execute_jupiter_swap_with_jito(
                    signed_transaction_base64=regular_result["raw_tx_base64"],
                    user_keypair=keypair,
                    label=f"JITO_ULTRA_{label}"
                )
                
                # Merge results
                merged_result = {**regular_result, **jito_result}
                merged_result["method"] = "jupiter_ultra_with_jito"
                merged_result["jito_guaranteed"] = True 
                merged_result["extra_tip"] = extra_tip
                
                logger.info(f"✅ Jito ULTRA executed for {label} | Bundle: {jito_result.get('bundle_id', 'N/A')}")
                
                # Track Jito success
                await redis_client.hincrby("jito_stats", "successful_bundles", 1)
                
                return merged_result
            
        except Exception as jito_error:
            logger.warning(f"Jito bundle failed: {jito_error}")
            # Track Jito failure
            await redis_client.hincrby("jito_stats", "failed_bundles", 1)
            # Fall back to regular execution
    
    # Regular execution with MEV protection
    return await execute_jupiter_swap_internal(
        user, input_mint, output_mint, amount, slippage_bps, 
        label, max_retries, stealth_mode
    )



async def calculate_sol_value(mint: str, token_amount_lamports: int, decimals: int = 9) -> float:
    """Calculate estimated SOL value of tokens"""
    try:
        if mint == settings.SOL_MINT:
            return token_amount_lamports / 1_000_000_000
        
        # Get current price from Jupiter
        quote = await get_jupiter_quote_price(mint)
        if quote and quote.get("priceSOL"):
            price_sol = quote["priceSOL"]
            
            # Use provided decimals
            token_amount = token_amount_lamports / (10 ** decimals)
            return price_sol * token_amount
    except Exception as e:
        logger.debug(f"Failed to calculate SOL value: {e}")
    
    return 0.1  # Conservative fallback

async def execute_jito_optimized_sell(
    user: User,
    mint: str,
    amount_lamports: int,
    label: str, 
    slippage_bps: int = 2000
) -> Dict:
    """
    Execute sell with Jito optimization for guaranteed execution
    """
    try:
        logger.info(f"🎯 JITO-OPTIMIZED SELL: {label} for {mint[:8]}")
        
        # Calculate estimated SOL value
        estimated_sol_value = await calculate_sol_value(mint, amount_lamports)
        
        # Use fee_manager for fee decision
        fee_decision = await fee_manager.calculate_fee_decision(
            user=user,
            trade_type=label,
            amount_sol=estimated_sol_value,
            mint=mint,
            pnl_pct=0.0  # Will be updated if we have PnL data
        )
        
        # Store fee decision
        fee_key = fee_manager.get_fee_decision_key(
            user_wallet=user.wallet_address,
            mint=mint,
            trade_type=label
        )
        await redis_client.setex(fee_key, 300, json.dumps({
            **fee_decision,
            "estimated_sol": estimated_sol_value,
            "timestamp": datetime.utcnow().isoformat()
        }))
        
        # First create the regular Jupiter swap
        swap_result = await execute_jupiter_swap(
            user=user,
            input_mint=mint,
            output_mint=settings.SOL_MINT,
            amount=amount_lamports,
            slippage_bps=slippage_bps,
            label=f"JITO_{label}",
            use_jito_for_critical=True  # Force Jito for sells
        )
        
       # Track trade for analytics (still use FeeOptimizer for tracking)
        await fee_manager.track_trade_for_fee_optimization(
                user_wallet=user.wallet_address,
                amount_sol=estimated_sol_value,
                mint=mint,
                trade_type=f"SELL_{label}"
            )
        
        if swap_result.get("jito_guaranteed"):
            logger.info(f"✅ Jito-guaranteed sell executed for {label}")
            # Track Jito success
            await redis_client.hincrby("jito_stats", "successful_sells", 1)
        
        return swap_result
    
    except Exception as e:
        logger.error(f"Jito-optimized sell failed: {e}")
        
        # Fall back to regular execution
        logger.error(f"🔄 Falling back to regular sell execution")
        return await execute_jupiter_swap(
            user=user,
            input_mint=mint,
            output_mint=settings.SOL_MINT,
            amount=amount_lamports,
            slippage_bps=slippage_bps,
            label=label,
            use_jito_for_critical=False
        )
          
async def execute_jupiter_swap_internal(
    user: User,
    input_mint: str,
    output_mint: str,
    amount: int,
    slippage_bps: int,
    label: str = "swap",
    max_retries: int = 3,
    stealth_mode: bool = False 
) -> dict:

    input_sol = amount / 1_000_000_000.0
    
    # Use fee_manager for ALL fee decisions
    fee_decision = await fee_manager.calculate_fee_decision(
        user=user,
        trade_type=label,
        amount_sol=input_sol,
        mint=output_mint if "BUY" in label else input_mint,
        pnl_pct=0.0  # Will be updated for sells if needed
    )
    
    apply_referral_fee = fee_decision["should_apply"]
    referral_fee = fee_decision["referral_fee"]  # Already a string
    
    # Store fee decision in Redis
    fee_key = fee_manager.get_fee_decision_key(
        user_wallet=user.wallet_address,
        mint=output_mint if "BUY" in label else input_mint,
        trade_type=label
    )
    await redis_client.setex(fee_key, 600, json.dumps(fee_decision))
    
    logger.info(f"💰 Fee decision for {label}: {fee_decision['reason']} | Details: {fee_decision.get('details', '')}")
    
    
    
    # FIX: Ensure MIN_BUY_SOL is a float
    min_buy_sol_str = getattr(settings, 'MIN_BUY_SOL', '0.01')
    try:
        min_buy_sol = float(min_buy_sol_str)
    except (ValueError, TypeError):
        min_buy_sol = 0.05  # Default fallback
    
    # Min buy checks - FIXED: Compare floats properly
    if label == "BUY" and not user.is_premium:
        min_for_free = max(min_buy_sol, 0.01)
        if input_sol < min_for_free:
            raise Exception(f"Free users need min {min_for_free:.2f} SOL for buys. Current: {input_sol:.4f} SOL")
    
    if label == "BUY" and input_sol < min_buy_sol:
        raise Exception(f"Min input too low: {input_sol:.4f} SOL < {min_buy_sol:.2f} SOL")

    user_pubkey = str(user.wallet_address)
    private_key_bytes = decrypt_private_key_backend(user.encrypted_private_key)
    keypair = Keypair.from_bytes(private_key_bytes)
    
    # Get the Ultra referral account
    referral_account = getattr(settings, 'JUPITER_REFERRAL_ACCOUNT', None)
    
    if apply_referral_fee and referral_account:
        logger.info(f"💰 Using Ultra referral account: {referral_account[:8]}...")
        logger.info(f"   Applying {int(referral_fee)/100}% fee on {label} transaction")  # FIXED
        fee_account = referral_account
    else:
        logger.info(f"💰 No fee applied for this transaction")
        apply_referral_fee = False
        fee_account = None
        
    # Add MEV protection logic at the beginning if stealth_mode is True
    if stealth_mode:
        mev_config = await mev_protector.create_stealth_transaction(
            user, input_mint, amount, "BUY" in label
        )
        slippage_bps = mev_config["slippage_bps"]
        logger.info(f"🕵️ Stealth mode active: Using {slippage_bps}bps slippage")


    # REQUIRED: Jupiter API Key for Ultra API
    if not getattr(settings, "JUPITER_API_KEY", None):
        raise Exception("JUPITER_API_KEY is required for Ultra API. Get one from portal.jup.ag")
    
    headers = {
        "Content-Type": "application/json",
        "x-api-key": settings.JUPITER_API_KEY
    }

    for attempt in range(max_retries):
        try:
            async with aiohttp.ClientSession(headers=headers, timeout=aiohttp.ClientTimeout(total=60)) as session:
                base = "https://api.jup.ag/ultra/v1"
                
                # =============================================================
                # 1. GET ORDER WITH SMART FEE LOGIC
                # =============================================================
                order_params = {
                    "inputMint": input_mint,
                    "outputMint": output_mint,
                    "amount": str(amount),
                    "slippageBps": str(slippage_bps),
                    "taker": user_pubkey,
                }
                
                # 🔥 Add referral parameters ONLY if fees should apply
                if apply_referral_fee and fee_account:
                    order_params["referralAccount"] = fee_account
                    order_params["referralFee"] = referral_fee  # Dynamic fee from FeeOptimizer
                    logger.info(f"💰 Adding {int(referral_fee)/100:.1f}% fee via Ultra API")
                else:
                    logger.info("💰 Proceeding without fee - optimized pricing")
                            
                logger.info(f"Getting order for {label}: {input_sol:.4f} SOL | {input_mint[:8]}... → {output_mint[:8]}...")
                
                order_resp = await session.get(f"{base}/order", params=order_params)
                if order_resp.status != 200:
                    txt = await order_resp.text()
                    
                    # Check if it's a referral initialization error
                    if "referralAccount is initialized" in txt:
                        logger.warning(f"Referral token account not initialized for this swap")
                        
                        # Try again without referral on the first attempt
                        if attempt == 0 and apply_referral_fee:  # Use existing variable
                            logger.info("Retrying without referral account...")
                            apply_referral_fee = False
                            continue
                        else:
                            logger.error(f"Order failed: Status {order_resp.status}, Response: {txt[:500]}")
                            raise Exception(f"Order failed: {txt[:200]}")
                    
                    logger.error(f"Order failed: Status {order_resp.status}, Response: {txt[:500]}")
                    
                    # Parse Jupiter error messages
                    try:
                        error_data = json.loads(txt)
                        if "errorMessage" in error_data:
                            raise Exception(f"Jupiter order failed: {error_data['errorMessage']}")
                    except:
                        pass
                    
                    raise Exception(f"Order failed (attempt {attempt+1}): {txt[:300]}")
                
                order_data = await order_resp.json()
                
                # 🔥 CHECK IF 1% FEE IS APPLIED
                fee_applied = False
                fee_amount = 0
                fee_percentage = 0.0
                
                if "feeBps" in order_data:
                    fee_bps = int(order_data.get("feeBps", 0))
                    # if fee_bps >= 100:  # At least 1% fee
                    #     fee_applied = True
                    #     fee_percentage = fee_bps / 100  # Convert to percentage
                    #     in_amount = int(order_data["inAmount"])
                    #     fee_amount = (in_amount * fee_bps) // 10000
                        
                    #     logger.info(f"💰 1% FEE CONFIRMED: {fee_bps}bps fee applied")
                        
                    #     # Log fee details
                    #     fee_mint = order_data.get("feeMint", "Unknown")
                    #     if "So111" in fee_mint:
                    #         fee_sol = fee_amount / 1e9
                    #         logger.info(f"   Estimated fee: {fee_sol:.6f} SOL")
                    #     elif "EPjFW" in fee_mint:
                    #         fee_usdc = fee_amount / 1e6
                    #         logger.info(f"   Estimated fee: {fee_usdc:.6f} USDC")
                    #     else:
                    #         logger.info(f"   Estimated fee: {fee_amount} tokens")
                    # else:
                    #     logger.warning(f"⚠️ Fee mismatch: {fee_bps}bps (expected 100bps)")
                    
                    # Fix the fee calculation
                    if "feeBps" in order_data:
                        fee_bps = int(order_data.get("feeBps", 0))
                        if fee_bps >= 100:  # At least 1% fee
                            fee_applied = True
                            fee_percentage = fee_bps / 100  # BPS to percentage
                            
                            in_amount = int(order_data["inAmount"])
                            fee_amount_lamports = (in_amount * fee_bps) // 10000
                            
                            logger.info(f"💰 1% FEE CONFIRMED: {fee_bps}bps fee applied")
                            
                            # Log fee details
                            fee_mint = order_data.get("feeMint", "Unknown")
                            if "So111" in fee_mint:  # SOL
                                fee_sol = fee_amount_lamports / 1e9
                                logger.info(f"   Estimated fee: {fee_sol:.6f} SOL ({fee_amount_lamports} lamports)")
                            elif "EPjFW" in fee_mint:  # USDC
                                fee_usdc = fee_amount_lamports / 1e6
                                logger.info(f"   Estimated fee: {fee_usdc:.6f} USDC")
                            else:
                                logger.info(f"   Estimated fee: {fee_amount_lamports} raw units")
                
                # Validate order response
                if "transaction" not in order_data:
                    logger.error(f"No transaction in order response: {order_data}")
                    raise Exception("Jupiter didn't return a transaction")
                
                if "requestId" not in order_data:
                    logger.error(f"No requestId in order response: {order_data}")
                    raise Exception("Jupiter didn't return a requestId")
                
                if "outAmount" not in order_data or int(order_data["outAmount"]) <= 0:
                    logger.error(f"Invalid output amount: {order_data.get('outAmount', 'missing')}")
                    raise Exception("Order returned 0 output - insufficient liquidity")
                
                logger.info(f"{label} order: {int(order_data['inAmount'])/1e9:.4f} SOL → {int(order_data['outAmount'])} tokens | Slippage: {order_data.get('slippageBps', '?')}bps | 1% Fee: {'✅' if fee_applied else '❌'}")
                
                # =============================================================
                # 2. SIGN TRANSACTION
                # =============================================================
                try:
                    tx_buf = base64.b64decode(order_data["transaction"])
                    if len(tx_buf) < 32:  # Minimum transaction size check
                        logger.error(f"Transaction buffer too small: {len(tx_buf)} bytes")
                        raise Exception("Invalid transaction data received from Jupiter")
                    
                    original_tx = VersionedTransaction.from_bytes(tx_buf)
                    message_bytes = to_bytes_versioned(original_tx.message)
                    user_signature = keypair.sign_message(message_bytes)
                    
                    # Create signed transaction
                    signed_tx = VersionedTransaction.populate(original_tx.message, [user_signature])
                    raw_tx = bytes(signed_tx)
                    signed_transaction_base64 = base64.b64encode(raw_tx).decode("utf-8")
                    
                except Exception as tx_error:
                    logger.error(f"Transaction decoding failed: {tx_error}")
                    raise Exception(f"Failed to process transaction: {str(tx_error)[:100]}")
                # =============================================================
                # 3. EXECUTE ORDER (Jupiter sends the transaction)
                # =============================================================
                execute_payload = {
                    "signedTransaction": signed_transaction_base64,
                    "requestId": order_data["requestId"]
                }
                
                execute_resp = await session.post(f"{base}/execute", json=execute_payload)
                if execute_resp.status != 200:
                    txt = await execute_resp.text()
                    logger.error(f"Execute failed: Status {execute_resp.status}, Response: {txt[:500]}")
                    raise Exception(f"Execute failed (attempt {attempt+1}): {txt[:300]}")
                
                execute_data = await execute_resp.json()
                
                # Check execution status
                if execute_data.get("status") == "Success":
                    signature = execute_data.get("signature")
                    if not signature:
                        raise Exception("Execute succeeded but no signature returned")
                    
                    logger.info(f"{label} SUCCESS → https://solscan.io/tx/{signature}")
                    
                    # Log success details
                    input_amount_result = execute_data.get("inputAmountResult", order_data["inAmount"])
                    output_amount_result = execute_data.get("outputAmountResult", order_data["outAmount"])
                    
                    # 🔥 TRACK FEE IF APPLIED
                    if fee_applied:
                        # Store fee info for analytics
                        await store_fee_info(
                            wallet_address=user.wallet_address,
                            tx_signature=signature,
                            fee_amount=fee_amount,
                            fee_mint=order_data.get("feeMint", "Unknown"),  # This is correct
                            trade_type=label,
                            input_amount=int(input_amount_result),
                            output_amount=int(output_amount_result)
                        )
                    
                    logger.info(f"{label} executed: {int(input_amount_result)/1e9:.4f} SOL → {int(output_amount_result)} tokens | 1% Fee: {'✅' if fee_applied else '❌'}")
                    
                    # Fire-and-forget confirmation
                    rpc_url = user.custom_rpc_https or settings.SOLANA_RPC_URL
                    asyncio.create_task(_confirm_tx_async(rpc_url, signature, label, user_pubkey, input_sol))
                    
                    return {
                        "raw_tx_base64": signed_transaction_base64,
                        "signature": signature,
                        "out_amount": int(output_amount_result),
                        "in_amount": int(input_amount_result),
                        "estimated_referral_fee": fee_amount,
                        "fee_applied": fee_applied,
                        "fee_percentage": fee_percentage,
                        "fee_bps": fee_bps if fee_applied else 0,
                        "fee_mint": order_data.get("feeMint", "") if fee_applied else "",  # Add this line
                        "method": "jup_ultra_referral",
                        "status": "success",
                        "request_id": order_data["requestId"],
                        "referral_used": fee_applied
                    }
                
                else:
                    # Execution failed
                    status = execute_data.get("status", "Unknown")
                    error_code = execute_data.get("code", -1)
                    signature = execute_data.get("signature")
                    
                    # Map error codes to user-friendly messages
                    error_messages = {
                        -1: "Missing cached order (requestId expired)",
                        -2: "Invalid signed transaction",
                        -3: "Invalid message bytes",
                        -4: "Missing request ID",
                        -5: "Missing signed transaction",
                        -1000: "Failed to land transaction",
                        -1001: "Unknown error",
                        -1002: "Invalid transaction",
                        -1003: "Transaction not fully signed",
                        -1004: "Invalid block height",
                        -1005: "Transaction expired",
                        -1006: "Transaction timed out",
                        -1007: "Gasless unsupported wallet"
                    }
                    
                    error_msg = error_messages.get(error_code, f"Error code: {error_code}")
                    
                    if signature:
                        logger.warning(f"{label} EXECUTE FAILED ({status}): {error_msg} | Tx: https://solscan.io/tx/{signature}")
                        raise Exception(f"{label} failed: {error_msg}")
                    else:
                        logger.warning(f"{label} EXECUTE FAILED ({status}): {error_msg}")
                        raise Exception(f"{label} failed: {error_msg}")
        
        except Exception as e:
            error_str = str(e)
            
            # Log specific error types
            if "6025" in error_str or "InsufficientInputAmountWithSlippage" in error_str:
                logger.warning(f"{label} FAILED → Low liquidity (6025) | Input: {input_sol:.4f} SOL")
                
                # Send user-friendly message
                if not user.is_premium and label == "BUY":
                    user_msg = json.dumps({
                        "type": "log",
                        "message": f"⚠️ Buy failed: Low liquidity (error 6025). Try increasing buy amount to 0.2+ SOL.",
                        "status": "warning"
                    })
                    await websocket_manager.send_personal_message(user_msg, user.wallet_address)
            
            elif "insufficient liquidity" in error_str.lower():
                logger.warning(f"{label} FAILED → Insufficient liquidity for {output_mint[:8]}...")
            
            elif "Transaction simulation failed" in error_str:
                # Parse custom program error
                if "custom program error: 0x1789" in error_str:
                    logger.warning(f"{label} FAILED → Jupiter program error 0x1789 (likely slippage/price moved)")
                else:
                    logger.warning(f"{label} FAILED → Transaction simulation failed")
            
            elif "referralAccount is initialized" in error_str:
                logger.warning(f"{label} FAILED → Referral token account not initialized. Will retry without referral.")
                # Don't raise exception, let it retry without referral
            
            else:
                logger.warning(f"{label} FAILED (attempt {attempt+1}): {error_str}")
            
            if attempt == max_retries - 1:
                # Final attempt failed
                if "6025" in error_str:
                    raise Exception(f"Low liquidity (6025) after {max_retries} attempts. Try increasing buy amount to 0.2+ SOL.")
                raise e
            
            # Exponential backoff
            wait_time = 2 * (attempt + 1)
            logger.info(f"Retrying {label} in {wait_time}s (attempt {attempt+2}/{max_retries})...")
            await asyncio.sleep(wait_time)

    raise Exception(f"All {max_retries} retries failed for {label}")

async def store_fee_info(wallet_address: str, tx_signature: str, fee_amount: int, 
                        fee_mint: str, trade_type: str, input_amount: int, output_amount: int):
    """Store fee information in Redis for tracking"""
    try:
        fee_data = {
            "user": wallet_address,
            "tx": tx_signature,
            "fee_amount": fee_amount,
            "fee_mint": fee_mint,
            "trade_type": trade_type,
            "input_amount": input_amount,
            "output_amount": output_amount,
            "timestamp": datetime.utcnow().isoformat(),
            "referral_account": getattr(settings, 'JUPITER_REFERRAL_ACCOUNT', '')
        }
        
        # Store in Redis with 30-day expiry
        await redis_client.setex(
            f"fee:{tx_signature}", 
            2592000,  # 30 days
            json.dumps(fee_data)
        )
        
        # Also add to fee tracking list
        await redis_client.lpush("fee_tracking", json.dumps(fee_data))
        await redis_client.ltrim("fee_tracking", 0, 1000)  # Keep last 1000 fees
        
        # Convert fee to readable amount
        if "So111" in fee_mint:
            fee_readable = fee_amount / 1e9
            fee_unit = "SOL"
        elif "EPjFW" in fee_mint:
            fee_readable = fee_amount / 1e6
            fee_unit = "USDC"
        else:
            fee_readable = fee_amount
            fee_unit = "tokens"
        
        logger.info(f"💰 Fee recorded: {fee_readable:.12f} {fee_unit} from {wallet_address[:8]}...")
        
    except Exception as e:
        logger.error(f"Failed to store fee info: {e}")

async def get_on_chain_data_for_strategy(mint: str, timeout_seconds: int = 3) -> tuple:
    """
    Get comprehensive on-chain data using your existing APIs
    Returns: (jupiter_data, dexscreener_data)
    """
    jupiter_data = None
    dexscreener_data = None
    
    try:
        # Use asyncio.gather to fetch both in parallel with timeout
        async with asyncio.timeout(timeout_seconds):
            jupiter_task = get_jupiter_token_data(mint)  # Use your existing function
            dexscreener_task = fetch_dexscreener_with_retry(mint)  # Use your existing function
            
            # Execute both
            results = await asyncio.gather(
                jupiter_task, 
                dexscreener_task,
                return_exceptions=True
            )
            
            # Handle results
            for i, result in enumerate(results):
                if isinstance(result, Exception):
                    logger.warning(f"{'Jupiter' if i == 0 else 'DexScreener'} data failed: {result}")
                else:
                    if i == 0:
                        jupiter_data = result
                    else:
                        dexscreener_data = result
                
    except asyncio.TimeoutError:
        logger.warning(f"Data fetch timeout for {mint[:8]}")
    except Exception as e:
        logger.error(f"Error fetching on-chain data: {e}")
    
    return jupiter_data, dexscreener_data

def get_default_strategy():
    """Fallback strategy when data is missing"""
    return {
        "initial_buy_pct": 50,
        "dca_buy_levels": [
            {"price_pct": -10, "buy_pct": 25},
            {"price_pct": -20, "buy_pct": 25},
        ],
        "take_profit_levels": [
            {"profit_pct": 25, "sell_pct": 50},
            {"profit_pct": 50, "sell_pct": 50},
        ],
        "stop_loss": 25.0,
        "timeout_minutes": 15,
        "slippage_bps": 2000,
        "strategy_type": "moderate",
        "current_price": 0
    }
        
def calculate_sniper_strategy_from_data(jupiter_data: dict, dexscreener_data: dict) -> dict:
    """
    Calculate optimal sniper strategy based on real-time on-chain data
    Now using the data structure from YOUR existing APIs
    """
    
    # Extract key metrics from YOUR Jupiter API response structure
    if not jupiter_data or not dexscreener_data:
        return get_default_strategy()
    
    # Get current price (use whichever is available)
    current_price = 0
    if jupiter_data.get("usd_price"):
        current_price = jupiter_data.get("usd_price", 0)
    elif dexscreener_data.get("price_usd"):
        try:
            current_price = float(dexscreener_data["price_usd"])
        except:
            current_price = 0
    
    # Get holder concentration (from your Jupiter data)
    top_holders_pct = jupiter_data.get("top_holders_percentage", 100)
    
    # Get recent volume and price action from DexScreener
    volume_m5 = dexscreener_data.get("volume_m5", 0)
    volume_h1 = dexscreener_data.get("volume_h1", 0)
    
    price_change_m5 = dexscreener_data.get("price_change_m5", 0)
    price_change_h1 = dexscreener_data.get("price_change_h1", 0)
    
    # Get transaction counts (from your Jupiter data if available)
    num_sells_24h = jupiter_data.get("num_sells_24h", 0)
    num_traders_24h = jupiter_data.get("num_traders_24h", 0)
    
    # Liquidity
    liquidity_usd = dexscreener_data.get("liquidity_usd", 0)
    if not liquidity_usd:
        liquidity_usd = dexscreener_data.get("liquidity", 0)
    
    # Organic score
    organic_score = jupiter_data.get("organic_score", 0)
    
    # 🔥 NEW: Check if this is a brand new token (launched < 10 minutes ago)
    is_new_token = False
    try:
        created_at_str = jupiter_data.get("created_at")
        if created_at_str:
            created_at = datetime.fromisoformat(created_at_str.replace('Z', '+00:00'))
            age_minutes = (datetime.utcnow() - created_at).total_seconds() / 60
            if age_minutes < 10:  # Less than 10 minutes old
                is_new_token = True
                logger.info(f"📈 Token is NEW ({(age_minutes):.1f} minutes old)")
    except:
        pass
    
    # ======================================================
    # STRATEGY CALCULATION LOGIC - ADAPTED FOR YOUR DATA
    # ======================================================
    
    strategy = {
        "initial_buy_pct": 100,  # Default: full buy
        "dca_buy_levels": [],
        "take_profit_levels": [],
        "stop_loss": 20.0,
        "timeout_minutes": 10,
        "slippage_bps": 1500,
        "strategy_type": "moderate",
        "current_price": current_price,
        "current_price_sol": 0  # Will be calculated later from actual transaction
    }
    
    # 🚀 NEW LAUNCH STRATEGY - Brand new token (most aggressive)
    # if is_new_token and liquidity_usd < 5000:  # Very early launch, low liquidity
    if is_new_token:  # Very early launch, low liquidity
        strategy["strategy_type"] = "new_launch"
        strategy["initial_buy_pct"] = 50  # Start with small position
        strategy["stop_loss"] = 40.0  # Wider stop loss for volatility
        strategy["slippage_bps"] = 3000  # High slippage
        
        # DCA aggressively on big dips
        strategy["dca_buy_levels"] = [
            {"price_pct": -25, "buy_pct": 30},
            {"price_pct": -40, "buy_pct": 30},
        ]
        
        # Quick profits on new launches (they often pump fast)
        strategy["take_profit_levels"] = [
            {"profit_pct": 25, "sell_pct": 40},
            {"profit_pct": 50, "sell_pct": 40},  
            {"profit_pct": 100, "sell_pct": 20},  # Let some run
        ]
        # 🔴🔴 THIS IS SUPPOSED TO BE SET BY THE USER
        strategy["timeout_minutes"] = 15  # Shorter timeout for new tokens
        
        logger.info(f"🎯 NEW LAUNCH strategy selected (age < 10min, liquidity ${liquidity_usd:,.0f})")
    
    # 🔥 AGGRESSIVE STRATEGY - High potential pump
    elif (price_change_m5 > 50 or  # Pumping hard in 5 mins
          price_change_h1 > 100 or  # Pumping hard in 1 hour
          volume_m5 > 1000 or  # High 5-min volume
          organic_score > 60):  # High organic score
        
        strategy["strategy_type"] = "aggressive"
        strategy["initial_buy_pct"] = 50
        strategy["stop_loss"] = 30.0
        
        # DCA buy levels
        strategy["dca_buy_levels"] = [
            {"price_pct": -10, "buy_pct": 25},
            {"price_pct": -20, "buy_pct": 25},
        ]
        
        # Multi-level take profit
        strategy["take_profit_levels"] = [
            {"profit_pct": 25, "sell_pct": 30},
            {"profit_pct": 50, "sell_pct": 30},  
            {"profit_pct": 100, "sell_pct": 40},
        ]
        strategy["timeout_minutes"] = 30
        
    # ⚠️ CAUTIOUS STRATEGY - Suspected rug or dump
    elif (price_change_m5 < -20 or  # Dumping hard
          top_holders_pct > 70 or  # Concentrated holdings
          jupiter_data.get("is_suspicious", False) or  # Flagged as suspicious
          jupiter_data.get("blockaid_rugpull", False) or  # Blockaid rugpull warning
          liquidity_usd < 5000):  # Very low liquidity
        
        strategy["strategy_type"] = "conservative"
        strategy["initial_buy_pct"] = 30
        strategy["stop_loss"] = 15.0
        strategy["slippage_bps"] = 2500
        
        # Quick exit strategy
        strategy["take_profit_levels"] = [
            {"profit_pct": 15, "sell_pct": 50},
            {"profit_pct": 30, "sell_pct": 50},
        ]
        strategy["timeout_minutes"] = 5
        
    # 📈 MODERATE STRATEGY - Balanced approach (default)
    else:
        strategy["strategy_type"] = "moderate"
        strategy["initial_buy_pct"] = 70
        
        # DCA on dips
        strategy["dca_buy_levels"] = [
            {"price_pct": -15, "buy_pct": 15},
            {"price_pct": -25, "buy_pct": 15},
        ]
        
        # Staggered profit taking
        strategy["take_profit_levels"] = [
            {"profit_pct": 20, "sell_pct": 25},
            {"profit_pct": 40, "sell_pct": 25},
            {"profit_pct": 60, "sell_pct": 25},
            {"profit_pct": 80, "sell_pct": 25},
        ]
    
    # Adjust based on liquidity
    if liquidity_usd < 10000:
        strategy["initial_buy_pct"] = max(20, strategy["initial_buy_pct"] - 30)
        strategy["slippage_bps"] = max(strategy.get("slippage_bps", 1500), 3000)
    elif liquidity_usd > 100000:
        strategy["slippage_bps"] = max(500, strategy.get("slippage_bps", 1500) - 500)
    
    return strategy




async def execute_user_buy(user: User, token: TokenMetadata, db: AsyncSession, websocket_manager: ConnectionManager):
    """Execute immediate buy with data-driven strategy using your existing APIs"""
    mint = token.mint_address
    lock_key = f"buy_lock:{user.wallet_address}:{mint}"
    
    if await redis_client.get(lock_key):
        logger.info(f"Buy locked for {mint} – skipping")
        return
    
    await redis_client.setex(lock_key, 60, "1")
    
    try:
        # New: Check ATA before proceeding with buy
        logger.info(f"📋 Checking ATA for user {user.wallet_address[:8]}... and mint {mint[:8]}...")
        
        # Get or create ATA - let Jupiter handle creation if needed
        ata_address = await TokenAccountManager.get_or_create_ata(
            user=user,
            mint=mint,
            create_if_missing=True,
            priority_fee=5000   # Use moderate priority fee
        )
        
        if not ata_address:
            logger.warning(f"⚠️ ATA for {mint[:8]} doesn't exist. Letting Jupiter handle creation.")
        else:
            logger.info(f"✅ ATA ready for {mint[:8]}: {ata_address[:8]}...")
        
        # Use fee_manager for buy fee decision
        fee_decision = await fee_manager.calculate_fee_decision(
            user=user,
            trade_type="BUY",
            amount_sol=user.buy_amount_sol,
            mint=mint,
            pnl_pct=0.0  # No PnL for buy
        )
        
        # Store fee decision
        fee_key = fee_manager.get_fee_decision_key(
            user_wallet=user.wallet_address,
            mint=mint,
            trade_type="BUY"
        )
        await redis_client.setex(fee_key, 600, json.dumps({
            **fee_decision,
            "timestamp": datetime.utcnow().isoformat()
        }))
        
        # Track trade for analytics
        await fee_manager.track_trade_for_fee_optimization(
            user_wallet=user.wallet_address,
            amount_sol=user.buy_amount_sol,
            mint=mint,
            trade_type="BUY"
        )
        
        # STEP 1: Fetch on-chain data using YOUR existing APIs
        logger.info(f"📊 Fetching on-chain data for strategy calculation: {mint[:8]}")
        
        # Use your existing fetch functions with timeout
        jupiter_data, dexscreener_data = await get_on_chain_data_for_strategy(mint, timeout_seconds=3)
        
        # STEP 2: Calculate optimal strategy
        strategy = calculate_sniper_strategy_from_data(jupiter_data, dexscreener_data)
        
        logger.info(f"🎯 Calculated strategy for {mint[:8]}: {strategy['strategy_type']}")
        logger.info(f"   Initial buy: {strategy['initial_buy_pct']}%")
        logger.info(f"   TP levels: {len(strategy['take_profit_levels'])}")
        logger.info(f"   DCA levels: {len(strategy['dca_buy_levels'])}")
        logger.info(f"   Stop loss: {strategy['stop_loss']}%")
        
        # STEP 3: Execute initial buy
        token_symbol = token.token_symbol or mint[:8]
        total_sol = user.buy_amount_sol
        initial_buy_sol = total_sol * (strategy["initial_buy_pct"] / 100)
        
        # Send strategy info to user
        await websocket_manager.send_personal_message(json.dumps({
            "type": "log",
            "log_type": "info",
            "message": f"🎯 Strategy: {strategy['strategy_type'].upper()} | Initial Buy %: {strategy['initial_buy_pct']}% | TP Levels: {len(strategy['take_profit_levels'])} | SL: {strategy['stop_loss']}%",
            "timestamp": datetime.utcnow().isoformat()
        }), user.wallet_address)
        
        # Execute initial buy
        amount_lamports = int(initial_buy_sol * 1_000_000_000)
        slippage_bps = min(int(strategy["slippage_bps"]), 5000)
        
        # Properly get decimals
        try:
            jupiter_data_result = await get_jupiter_token_data(mint)
            if jupiter_data_result and "decimals" in jupiter_data_result:
                decimals = int(jupiter_data_result["decimals"])
                logger.info(f"📊 Using decimals from Jupiter: {decimals}")
            elif token.token_decimals:
                decimals = int(token.token_decimals)
                logger.info(f"📊 Using decimals from token metadata: {decimals}")
            else:
                decimals = 6  # Default fallback
                logger.warning(f"⚠️ No decimals found, using default: {decimals}")
        except Exception as e:
            logger.warning(f"Failed to get decimals from Jupiter: {e}")
            decimals = token.token_decimals or 6
        
        logger.info(f"⚡ INITIAL BUY ({strategy['initial_buy_pct']}%): {initial_buy_sol:.4f} SOL → {mint[:8]}... (slippage: {slippage_bps}bps, decimals: {decimals})")
        
        try:
            swap = await execute_jupiter_swap(
                user=user,
                input_mint=settings.SOL_MINT,
                output_mint=mint,
                amount=amount_lamports,
                slippage_bps=slippage_bps,
                label="INITIAL_SNIPE",
            )
            
            if swap.get("fee_applied"):
                await websocket_manager.send_personal_message(json.dumps({
                    "type": "log",
                    "log_type": "info",
                    "message": f"💰 1% fee applied to initial buy",
                    "timestamp": datetime.utcnow().isoformat()
                }), user.wallet_address)
                
        except Exception as swap_error:
            error_msg = str(swap_error)
            logger.error(f"Initial buy failed for {mint}: {error_msg}")
            
            if "6025" in error_msg:
                user_friendly_msg = f"Initial buy failed: Low liquidity. Try 0.2+ SOL."
            else:
                user_friendly_msg = f"Initial buy failed: {error_msg[:80]}"
            
            await websocket_manager.send_personal_message(json.dumps({
                "type": "log",
                "log_type": "error",
                "message": user_friendly_msg,
                "timestamp": datetime.utcnow().isoformat()
            }), user.wallet_address)
            raise
        
        # 🔥 CRITICAL: Calculate ACTUAL entry price from transaction
        input_lamports = int(swap["in_amount"])
        output_raw_tokens = int(swap["out_amount"])
        
        # Convert to readable amounts
        input_sol = input_lamports / 1_000_000_000  # lamports to SOL
        output_tokens = output_raw_tokens / (10 ** decimals)  # raw to tokens
        
        # ACTUAL entry price in SOL per token
        actual_entry_price_sol = input_sol / output_tokens
        
        logger.info(f"🔥 ACTUAL ENTRY: {input_sol:.6f} SOL → {output_tokens:.2f} tokens")
        logger.info(f"🔥 Entry price: {actual_entry_price_sol:.10f} SOL per token")
        
        # Try to get USD price from APIs
        estimated_entry_price_usd = 0
        if dexscreener_data and dexscreener_data.get("price_usd"):
            try:
                estimated_entry_price_usd = float(dexscreener_data["price_usd"])
            except:
                pass
        
        # If no USD price from API, calculate from SOL price
        if estimated_entry_price_usd <= 0:
            sol_price = await get_jupiter_token_data(settings.SOL_MINT)
            estimated_entry_price_usd = actual_entry_price_sol * sol_price
        
        logger.info(f"📊 Entry price: {actual_entry_price_sol:.10f} SOL/token ≈ ${estimated_entry_price_usd:.10f}")
        
        # FIX: Get liquidity from dexscreener_data if available
        liquidity_at_buy = 0
        if dexscreener_data and dexscreener_data.get("liquidity_usd"):
            liquidity_at_buy = dexscreener_data.get("liquidity_usd", 0)
            logger.info(f"📊 Liquidity at Buy Time: ${liquidity_at_buy}")
        elif dexscreener_data and dexscreener_data.get("liquidity"):
            liquidity_at_buy = dexscreener_data.get("liquidity", 0)
            logger.info(f"📊 Liquidity at Buy Time: ${liquidity_at_buy}")
        
        # STEP 5: Create trade record with CORRECT prices
        explorer_urls = {
            "solscan": f"https://solscan.io/tx/{swap['signature']}",
            "dexScreener": f"https://dexscreener.com/solana/{mint}",
            "jupiter": f"https://jup.ag/token/{mint}"
        }

        # Calculate first TP level to use for the single take_profit field
        first_tp_level = 0
        if strategy["take_profit_levels"]:
            first_tp_level = strategy["take_profit_levels"][0]["profit_pct"]
        else:
            # Fallback to user's setting or default
            first_tp_level = user.sell_take_profit_pct or 50.0
        
        trade = Trade(
            user_wallet_address=user.wallet_address,
            mint_address=mint,
            token_symbol=token_symbol,
            trade_type="buy",
            amount_sol=input_sol,  # ACTUAL SOL spent
            amount_tokens=output_tokens,  # ACTUAL tokens received
            price_usd_at_trade=estimated_entry_price_usd,
            price_sol_at_trade=actual_entry_price_sol,  # 🔥 CRITICAL: Store SOL price
            buy_timestamp=datetime.utcnow(),
            take_profit=first_tp_level,  # Will be handled by strategy
            stop_loss=strategy["stop_loss"],
            token_amounts_purchased=output_tokens,
            token_decimals=decimals,
            liquidity_at_buy=liquidity_at_buy,
            slippage_bps=slippage_bps,
            solscan_buy_url=explorer_urls["solscan"],
            dexscreener_url=explorer_urls["dexScreener"],
            jupiter_url=explorer_urls["jupiter"],
            buy_tx_hash=swap.get('signature'),
            fee_applied=swap.get("fee_applied", False),
            fee_amount=float(swap.get("estimated_referral_fee", 0)) if swap.get("estimated_referral_fee") else None,
            fee_percentage=float(swap.get("fee_percentage", 0.0)) if swap.get("fee_percentage") else None,
            fee_bps=swap.get("fee_bps", None),
            fee_mint=swap.get("fee_mint", None),
            fee_collected_at=datetime.utcnow() if swap.get("fee_applied") else None,
            
            # 🔥 Store the full strategy as JSON
            strategy_data=json.dumps({
                "strategy_type": strategy["strategy_type"],
                "initial_buy_pct": strategy["initial_buy_pct"],
                "remaining_sol": total_sol - input_sol,  # Use actual input_sol
                "dca_levels": strategy["dca_buy_levels"],
                "tp_levels": strategy["take_profit_levels"],
                "stop_loss_pct": strategy["stop_loss"],
                "original_timeout": strategy["timeout_minutes"] * 60,
                "entry_price_sol": actual_entry_price_sol,  # Store SOL price
                "entry_price_usd": estimated_entry_price_usd,  # Store USD price
                "slippage_bps": strategy["slippage_bps"],
                "calculated_at": datetime.utcnow().isoformat()
            })
        )

        db.add(trade)
        await db.commit()
        logger.info(f"✅ Trade saved with ID: {trade.id} | Strategy: {strategy['strategy_type']}")
        
        # STEP 6: Start advanced monitoring
        logger.info(f"🎯 Starting advanced monitor for {trade.id} with {strategy['strategy_type']} strategy")
        
        # With THIS (explicit launch):
        advanced_monitor_task = asyncio.create_task(
            start_advanced_monitor_for_trade(
                trade=trade,
                user=user,
                entry_price_usd=estimated_entry_price_usd,
                token_decimals=decimals,
                token_amount=output_tokens,
                total_sol_allocated=total_sol,
                initial_buy_sol=initial_buy_sol,
                strategy=strategy,
                websocket_manager=websocket_manager
            )
        )

        # Store for management
        monitor_tasks[trade.id] = advanced_monitor_task
        logger.info(f"🔥 ADVANCED MONITOR LAUNCHED for {trade.id}")

        await websocket_manager.send_personal_message(json.dumps({
            "type": "log",
            "log_type": "success",
            "message": f"✅ Initial snipe successful! {output_tokens:.2f} tokens purchased. Strategy: {strategy['strategy_type']}",
            "timestamp": datetime.utcnow().isoformat()
        }), user.wallet_address)
        
    except Exception as e:
        logger.error(f"🚨 IMMEDIATE BUY FAILED for {mint}: {e}", exc_info=True)
        error_msg = str(e)
        
        user_friendly_msg = f"Buy failed: {error_msg[:80]}"
        
        await websocket_manager.send_personal_message(json.dumps({
            "type": "log", 
            "log_type": "error",
            "message": user_friendly_msg,
            "timestamp": datetime.utcnow().isoformat()
        }), user.wallet_address)
        
        logger.error(f"Detailed buy error for {mint}: {error_msg}")
        raise
        
    finally:
        await redis_client.delete(lock_key)


async def get_tp_state(trade_id: int) -> Dict:
    """Get TP state from Redis (survives bot restarts)"""
    key = f"tp_state:{trade_id}"
    state_json = await redis_client.get(key)
    if state_json:
        return json.loads(state_json)
    
    # Default state
    return {
        "triggered": {},
        "highest_pnl": 0,
        "scale_in_triggered": False
    }

async def save_tp_state(trade_id: int, state: Dict):
    """Save TP state to Redis"""
    key = f"tp_state:{trade_id}"
    await redis_client.setex(key, 86400, json.dumps(state))  # 24h expiry



async def start_advanced_monitor_for_trade(
    trade: Trade, 
    user: User, 
    entry_price_usd: float, 
    token_decimals: int, 
    token_amount: float,
    total_sol_allocated: float, 
    initial_buy_sol: float,
    strategy: dict, 
    websocket_manager: ConnectionManager
):
    """
    🔥 FIXED ADVANCED MONITOR with proper PnL calculation and DCA triggering
    """
    
    # Create a database session for this entire monitor
    db = AsyncSessionLocal()
    
    try:
        mint = trade.mint_address
        trade_id = trade.id
        
        logger.info(f"📋 Verifying ATA for {mint[:8]}...")
        try:
            ata_address = await TokenAccountManager.get_or_create_ata(
                user=user,
                mint=mint,
                create_if_missing=False,
                priority_fee=1000
            )
            if ata_address:
                logger.info(f"✅ ATA verified for {mint[:8]}: {ata_address[:8]}...")
        except Exception as e:
            logger.warning(f"⚠️ ATA check warning: {e}")
        
        # Refresh trade object within our session
        trade_result = await db.execute(select(Trade).where(Trade.id == trade_id))
        db_trade = trade_result.scalar_one_or_none()
        
        if not db_trade:
            logger.error(f"Trade {trade_id} not found in database")
            return
        
        trade = db_trade  # Use the session-bound trade object
        
        # Parse strategy data
        dca_levels = strategy.get("dca_buy_levels", [])
        tp_levels = strategy.get("take_profit_levels", [])
        stop_loss_pct = strategy.get("stop_loss", 20.0)
        initial_timeout_minutes = strategy.get("timeout_minutes", 10)
        
        remaining_sol = total_sol_allocated - initial_buy_sol
        current_token_amount = token_amount
        
        # Strategy config
        SCALE_IN_ON_PUMP = True
        USE_TRAILING_STOP = True
        DYNAMIC_TIMEOUT = True
        
        # Track state - FIXED: Use string keys for DCA
        dca_triggered = {}
        if dca_levels:
            for level in dca_levels:
                key = f"{level['price_pct']}"  # String key like "-10"
                dca_triggered[key] = False
            logger.info(f"DCA levels configured: {dca_levels}")
            logger.info(f"DCA triggered state: {dca_triggered}")
        
        # Get TP state from Redis
        tp_state = await get_tp_state(trade_id)
        tp_triggered = tp_state.get("triggered", {})
        if not tp_triggered:
            tp_triggered = {level["profit_pct"]: False for level in tp_levels}
        
        scale_in_triggered = tp_state.get("scale_in_triggered", False)
        highest_pnl = tp_state.get("highest_pnl", 0)
        
        # Trailing stop variables
        trailing_stop_triggered = False
        trailing_stop_distance = 15.0
        
        # Momentum tracking
        price_history = []
        volume_spike_detected = False
        
        logger.info(f"🚀 ADVANCED MONITOR STARTED for {mint[:8]}")
        logger.info(f"  Strategy: {strategy['strategy_type']}")
        logger.info(f"  Scale IN on pump: {'✅' if SCALE_IN_ON_PUMP else '❌'}")
        logger.info(f"  Trailing stop: {'✅' if USE_TRAILING_STOP else '❌'}")
        logger.info(f"  Remaining SOL: {remaining_sol:.4f}")
        logger.info(f"  DCA levels: {len(dca_levels)}")
        logger.info(f"  TP levels: {len(tp_levels)}")
        
        iteration = 0
        start_time = datetime.utcnow()
        current_timeout_minutes = initial_timeout_minutes
        
        while True:
            iteration += 1
            current_time = datetime.utcnow()
            elapsed_seconds = (current_time - start_time).total_seconds()
            
            # ============================================================
            # 1. GET CURRENT MARKET DATA WITH DEBUGGING
            # ============================================================
            dex_data = await fetch_dexscreener_with_retry(mint)
            if not dex_data or not dex_data.get("priceUsd"):
                logger.warning(f"⚠️ No price data for {mint[:8]} - retrying in 3s")
                await asyncio.sleep(3)
                continue
            
            # DEBUG: Log price source
            if iteration % 10 == 0:
                source = dex_data.get("_source", "unknown")
                if dex_data.get("_stale"):
                    stale_age = dex_data.get("_stale_seconds", 0)
                    logger.debug(f"📊 Using stale price ({stale_age:.0f}s old) from {source}")
                else:
                    logger.debug(f"📊 Fresh price from {source}")
            
            # ============================================================
            # 2. CORRECT PnL CALCULATION WITH DEBUGGING
            # ============================================================
            current_price_usd = float(dex_data["priceUsd"])
            
            # DEBUG: Show prices
            if iteration <= 5 or iteration % 20 == 0:  # First 5 iterations and every 20th
                logger.debug(f"=== PRICE DEBUG ===")
                logger.debug(f"Entry price (USD): ${entry_price_usd:.10f}")
                logger.debug(f"Current price (USD): ${current_price_usd:.10f}")
                logger.debug(f"Price source: {dex_data.get('_source', 'unknown')}")
            
            # FIXED PnL calculation
            if entry_price_usd > 0 and current_price_usd > 0:
                current_pnl = ((current_price_usd / entry_price_usd) - 1) * 100
                
                # DEBUG: Show calculation
                if iteration <= 3:
                    logger.debug(f"PnL CALC: ({current_price_usd:.10f}/{entry_price_usd:.10f} - 1) * 100 = {current_pnl:.2f}%")
            else:
                current_pnl = 0
                logger.warning(f"Invalid prices: entry=${entry_price_usd}, current=${current_price_usd}")
            
            # Get SOL price for display only
            current_price_sol = 0
            if dex_data.get("priceSOL"):
                current_price_sol = float(dex_data["priceSOL"])
            else:
                sol_price = await get_jupiter_token_data(settings.SOL_MINT)
                if sol_price > 0:
                    current_price_sol = current_price_usd / sol_price
            
            # SOL PnL for display only
            current_pnl_sol = 0
            if trade.price_sol_at_trade and current_price_sol > 0:
                current_pnl_sol = ((current_price_sol / trade.price_sol_at_trade) - 1) * 100
            
            # Update highest PnL
            if current_pnl > highest_pnl:
                highest_pnl = current_pnl
                logger.debug(f"📈 New high: {highest_pnl:.1f}%")
                tp_state["highest_pnl"] = highest_pnl
                await save_tp_state(trade_id, tp_state)
            
            # Update price history
            price_history.append(current_price_usd)
            if len(price_history) > 5:
                price_history.pop(0)
            
            # ============================================================
            # 3. DYNAMIC TIMEOUT ADJUSTMENT
            # ============================================================
            if DYNAMIC_TIMEOUT:
                if current_pnl > 50 and elapsed_seconds > 300:
                    current_timeout_minutes = max(initial_timeout_minutes, 30)
                    logger.info(f"⏱️ Extended timeout to {current_timeout_minutes}min")
            
            # ============================================================
            # 4. CHECK TIMEOUT
            # ============================================================
            if elapsed_seconds >= current_timeout_minutes * 60:
                tp_levels_hit = sum(1 for v in tp_triggered.values() if v)
                
                if tp_levels_hit > 0 or current_pnl > 5:
                    current_timeout_minutes += 5
                    logger.info(f"⏱️ Extending timeout (TP hits: {tp_levels_hit}, PnL: {current_pnl:.1f}%)")
                    await save_tp_state(trade_id, tp_state)
                    continue
                
                logger.info(f"⏰ Strategy timeout reached for {mint[:8]} (no TP hits, PnL: {current_pnl:.1f}%)")
                
                try:
                    sell_lamports = int(current_token_amount * (10 ** token_decimals))
                    
                    swap = await execute_jito_optimized_sell(
                        user=user,
                        mint=mint,
                        amount_lamports=sell_lamports,
                        label="TIMEOUT_SELL",
                        slippage_bps=2000, 
                    )
                    
                    trade = await db.get(Trade, trade_id)
                    if trade:
                        trade.sell_timestamp = datetime.utcnow()
                        trade.sell_reason = "Timeout"
                        trade.sell_tx_hash = swap.get("signature")
                        trade.price_usd_at_trade = current_price_usd
                        trade.profit_usd = (current_price_usd - entry_price_usd) * current_token_amount
                        trade.solscan_sell_url = f"https://solscan.io/tx/{swap.get('signature')}"
                        
                        if swap.get("fee_applied"):
                            trade.fee_applied = True
                            trade.fee_amount = swap.get("estimated_referral_fee", 0)
                            trade.fee_percentage = swap.get("fee_percentage", 0.0)
                            trade.fee_bps = swap.get("fee_bps", None)
                            trade.fee_mint = swap.get("fee_mint", None)
                            trade.fee_collected_at = datetime.utcnow()
                        
                        await db.commit()
                    
                    await redis_client.delete(f"tp_state:{trade_id}")
                    
                    await websocket_manager.send_personal_message(json.dumps({
                        "type": "log",
                        "log_type": "info",
                        "message": f"⏰ Timeout: Sold {mint[:8]} after {current_timeout_minutes}min | PnL: {current_pnl:.1f}%",
                        "timestamp": current_time.isoformat()
                    }), user.wallet_address)
                    
                except Exception as e:
                    logger.error(f"Timeout sell failed: {e}")
                    await websocket_manager.send_personal_message(json.dumps({
                        "type": "log",
                        "log_type": "error",
                        "message": f"❌ Timeout sell failed: {str(e)[:100]}",
                        "timestamp": current_time.isoformat()
                    }), user.wallet_address)
                
                break
            
            # ============================================================
            # 5. MOMENTUM & VOLUME ANALYSIS
            # ============================================================
            try:
                buys_5m = dex_data.get("txns", {}).get("m5", {}).get("buys", 0)
                sells_5m = dex_data.get("txns", {}).get("m5", {}).get("sells", 0)
                
                if sells_5m > buys_5m * 3 and current_pnl > 10:
                    logger.warning(f"🚨 HEAVY SELLING: {sells_5m}s vs {buys_5m}b")
                    
                    if current_pnl > 25 and not scale_in_triggered:
                        sell_percentage = 30
                        sell_token_amount = current_token_amount * (sell_percentage / 100)
                        
                        try:
                            sell_lamports = int(sell_token_amount * (10 ** token_decimals))
                            await execute_jupiter_swap(
                                user=user,
                                input_mint=mint,
                                output_mint=settings.SOL_MINT,
                                amount=sell_lamports,
                                slippage_bps=2000,
                                label="HEAVY_SELL_EXIT",
                            )
                            
                            current_token_amount -= sell_token_amount
                            trade.amount_tokens = current_token_amount
                            await db.commit()
                            
                            await websocket_manager.send_personal_message(json.dumps({
                                "type": "log",
                                "log_type": "warning",
                                "message": f"🚨 Heavy selling! Sold {sell_percentage}% to protect profits.",
                                "timestamp": current_time.isoformat()
                            }), user.wallet_address)
                            
                        except Exception as e:
                            logger.error(f"Heavy sell exit failed: {e}")
                
                if buys_5m > 10 and not volume_spike_detected:
                    volume_spike_detected = True
                    logger.info(f"📊 Volume spike: {buys_5m} buys in 5m")
                    
            except Exception as e:
                logger.debug(f"Momentum analysis failed: {e}")
            
            # ============================================================
            # 6. 🔥 DCA BUY ON DIPS (FIXED IMPLEMENTATION)
            # ============================================================
            if dca_levels and remaining_sol > 0.001:
                for dca_level in dca_levels:
                    target_drop_pct = dca_level["price_pct"]  # e.g., -10
                    buy_pct = dca_level["buy_pct"]
                    level_key = f"{target_drop_pct}"
                    
                    # Check if DCA already triggered for this level
                    if not dca_triggered.get(level_key, False):
                        # DCA triggers when price drops TO or BELOW target percentage
                        # current_pnl is negative when price drops
                        # For -10% DCA, trigger when current_pnl <= -10
                        if current_pnl <= target_drop_pct:
                            dca_sol = remaining_sol * (buy_pct / 100)
                            
                            if dca_sol > 0.001:
                                logger.info(f"📉 DCA TRIGGERED! Price dropped {current_pnl:.1f}% (target: {target_drop_pct}%)")
                                
                                try:
                                    dca_lamports = int(dca_sol * 1_000_000_000)
                                    dca_swap = await execute_jupiter_swap(
                                        user=user,
                                        input_mint=settings.SOL_MINT,
                                        output_mint=mint,
                                        amount=dca_lamports,
                                        slippage_bps=2500,
                                        label=f"DCA_{abs(target_drop_pct)}%_DROP",
                                    )
                                    
                                    dca_tokens = dca_swap["out_amount"] / (10 ** token_decimals)
                                    current_token_amount += dca_tokens
                                    remaining_sol -= dca_sol
                                    dca_triggered[level_key] = True
                                    
                                    # Update database
                                    trade.amount_tokens = current_token_amount
                                    await db.commit()
                                    
                                    logger.info(f"✅ DCA bought {dca_tokens:.2f} tokens at {current_pnl:.1f}% drop")
                                    
                                    await websocket_manager.send_personal_message(json.dumps({
                                        "type": "log",
                                        "log_type": "info",
                                        "message": f"📉 DCA: Bought {dca_tokens:.2f} tokens at {current_pnl:.1f}% drop",
                                        "timestamp": current_time.isoformat()
                                    }), user.wallet_address)
                                    
                                except Exception as e:
                                    logger.error(f"DCA buy failed: {e}")
            
            # ============================================================
            # 7. 🔥 SCALE IN ON PUMP STRATEGY
            # ============================================================
            if SCALE_IN_ON_PUMP and remaining_sol > 0.001 and not scale_in_triggered:
                scale_in_levels = [
                    {"profit_pct": 25, "buy_pct": 30},
                    {"profit_pct": 50, "buy_pct": 30},
                    {"profit_pct": 100, "buy_pct": 20},
                ]
                
                for level in scale_in_levels:
                    profit_pct = level["profit_pct"]
                    buy_pct = level["buy_pct"]
                    
                    if (current_pnl >= profit_pct and 
                        current_pnl < profit_pct * 1.2):
                        
                        scale_in_sol = remaining_sol * (buy_pct / 100)
                        
                        if scale_in_sol > 0.001:
                            logger.info(f"🔥 SCALE IN at {profit_pct}% profit: {scale_in_sol:.4f} SOL")
                            
                            try:
                                scale_lamports = int(scale_in_sol * 1_000_000_000)
                                scale_swap = await execute_jupiter_swap(
                                    user=user,
                                    input_mint=settings.SOL_MINT,
                                    output_mint=mint,
                                    amount=scale_lamports,
                                    slippage_bps=1500,
                                    label=f"SCALE_IN_{profit_pct}",
                                )
                                
                                scale_tokens = scale_swap["out_amount"] / (10 ** token_decimals)
                                current_token_amount += scale_tokens
                                remaining_sol -= scale_in_sol
                                scale_in_triggered = True
                                
                                tp_state["scale_in_triggered"] = True
                                await save_tp_state(trade_id, tp_state)
                                
                                trade.amount_tokens = current_token_amount
                                await db.commit()
                                
                                logger.info(f"✅ Scale in successful: +{scale_tokens:.2f} tokens")
                                
                                await websocket_manager.send_personal_message(json.dumps({
                                    "type": "log",
                                    "log_type": "info",
                                    "message": f"🔥 Scaled IN at {profit_pct}% profit. New total: {current_token_amount:.2f} tokens",
                                    "timestamp": current_time.isoformat()
                                }), user.wallet_address)
                                
                                # Reset scale-in after 30 seconds
                                async def reset_scale_in():
                                    await asyncio.sleep(30)
                                    nonlocal scale_in_triggered
                                    scale_in_triggered = False
                                    tp_state["scale_in_triggered"] = False
                                    await save_tp_state(trade_id, tp_state)
                                    logger.info(f"🔁 Scale-in cooldown ended for {mint[:8]}")
                                
                                asyncio.create_task(reset_scale_in())
                                
                            except Exception as e:
                                logger.error(f"Scale in failed: {e}")
            
            # ============================================================
            # 8. TAKE PROFIT STRATEGY
            # ============================================================
            adjusted_tp_levels = []
            
            if strategy["strategy_type"] == "new_launch":
                adjusted_tp_levels = [
                    {"profit_pct": 25, "sell_pct": 40},
                    {"profit_pct": 50, "sell_pct": 30},
                    {"profit_pct": 100, "sell_pct": 20},
                    {"profit_pct": 200, "sell_pct": 10},
                ]
            else:
                adjusted_tp_levels = tp_levels
            
            for tp_level in adjusted_tp_levels:
                profit_pct = tp_level["profit_pct"]
                sell_pct = tp_level["sell_pct"]
                
                if not tp_triggered.get(profit_pct, False) and current_pnl >= profit_pct:
                    sell_token_amount = current_token_amount * (sell_pct / 100)
                    
                    estimated_sol_value = current_price_sol * sell_token_amount
                    
                    fee_decision = await fee_manager.calculate_fee_decision(
                        user=user,
                        trade_type=f"TP_{profit_pct}",
                        amount_sol=estimated_sol_value,
                        mint=mint,
                        pnl_pct=current_pnl
                    )
                    
                    fee_key = fee_manager.get_fee_decision_key(
                        user_wallet=user.wallet_address,
                        mint=mint,
                        trade_type=f"TP_{profit_pct}"
                    )
                    await redis_client.setex(fee_key, 300, json.dumps({
                        **fee_decision,
                        "pnl_at_sell": current_pnl,
                        "estimated_sol": estimated_sol_value,
                        "timestamp": datetime.utcnow().isoformat()
                    }))
                    
                    tp_triggered[profit_pct] = True
                    tp_state["triggered"] = tp_triggered
                    await save_tp_state(trade_id, tp_state)
                                        
                    if sell_token_amount > 0:
                        logger.info(f"🎯 TP {profit_pct}% HIT: Selling {sell_pct}%")
                            
                        sell_lamports = int(sell_token_amount * (10 ** token_decimals))
                        
                        try:
                            tp_swap = await execute_jito_optimized_sell(
                                user=user,
                                mint=mint,
                                amount_lamports=sell_lamports,
                                label=f"TP_{profit_pct}_SELL",
                                slippage_bps=1000,
                            )
                            
                            current_token_amount -= sell_token_amount
                            trade.amount_tokens = current_token_amount
                            await db.commit()
                            
                            profit_usd = (current_price_usd - entry_price_usd) * sell_token_amount
                            
                            logger.info(f"✅ TP {profit_pct}%: Sold {sell_pct}% for ${profit_usd:.4f}")
                            
                            await websocket_manager.send_personal_message(json.dumps({
                                "type": "log",
                                "log_type": "success",
                                "message": f"💰 TP {profit_pct}%: Sold {sell_pct}% for ${profit_usd:.2f} profit",
                                "timestamp": current_time.isoformat()
                            }), user.wallet_address)
                            
                            if current_token_amount <= 0:
                                trade.sell_timestamp = datetime.utcnow()
                                trade.sell_reason = f"TP_{profit_pct}"
                                trade.sell_tx_hash = tp_swap.get("signature")
                                trade.price_usd_at_trade = current_price_usd
                                trade.profit_usd = (current_price_usd - entry_price_usd) * token_amount
                                trade.solscan_sell_url = f"https://solscan.io/tx/{tp_swap.get('signature')}"
                                await db.commit()
                                
                                await redis_client.delete(f"tp_state:{trade_id}")
                                
                                logger.info(f"✅ All tokens sold via TP for {mint[:8]}")
                                return
                                
                        except Exception as e:
                            logger.error(f"TP sell failed: {e}")
            
            # ============================================================
            # 9. TRAILING STOP LOSS
            # ============================================================
            if USE_TRAILING_STOP and highest_pnl > 30:
                trailing_stop_level = highest_pnl - trailing_stop_distance
                
                if current_pnl <= trailing_stop_level and not trailing_stop_triggered:
                    logger.info(f"🛑 TRAILING STOP triggered: {current_pnl:.1f}% ≤ {trailing_stop_level:.1f}%")
                    trailing_stop_triggered = True
                    
                    sell_lamports = int(current_token_amount * (10 ** token_decimals))
                    
                    try:
                        sl_swap = await execute_jito_optimized_sell(
                            user=user,
                            mint=mint,
                            amount_lamports=sell_lamports,
                            label="TRAILING_STOP_SELL",
                            slippage_bps=2000,
                        )
                        
                        profit_usd = (current_price_usd - entry_price_usd) * current_token_amount
                        
                        trade.sell_timestamp = datetime.utcnow()
                        trade.sell_reason = "Trailing Stop"
                        trade.sell_tx_hash = sl_swap.get("signature")
                        trade.price_usd_at_trade = current_price_usd
                        trade.profit_usd = profit_usd
                        trade.solscan_sell_url = f"https://solscan.io/tx/{sl_swap.get('signature')}"
                        await db.commit()
                        
                        await redis_client.delete(f"tp_state:{trade_id}")
                        
                        await websocket_manager.send_personal_message(json.dumps({
                            "type": "log",
                            "log_type": "warning",
                            "message": f"🛑 Trailing stop: Sold all at {current_pnl:.1f}% (from high: {highest_pnl:.1f}%). Profit: ${profit_usd:.2f}",
                            "timestamp": current_time.isoformat()
                        }), user.wallet_address)
                        
                        logger.info(f"✅ Trailing stop executed: ${profit_usd:.2f} profit")
                        break
                        
                    except Exception as e:
                        logger.error(f"Trailing stop sell failed: {e}")
            
            # ============================================================
            # 10. REGULAR STOP LOSS
            # ============================================================
            if current_pnl <= -stop_loss_pct:
                logger.info(f"🛑 STOP LOSS triggered at {current_pnl:.1f}% for {mint[:8]}")
                
                sell_lamports = int(current_token_amount * (10 ** token_decimals))
                
                try:
                    sl_swap = await execute_jupiter_swap(
                        user=user,
                        input_mint=mint,
                        output_mint=settings.SOL_MINT,
                        amount=sell_lamports,
                        slippage_bps=2000,
                        label="STOP_LOSS_SELL",
                    )
                    
                    trade.sell_timestamp = datetime.utcnow()
                    trade.sell_reason = "Stop Loss"
                    trade.sell_tx_hash = sl_swap.get("signature")
                    trade.price_usd_at_trade = current_price_usd
                    trade.profit_usd = (current_price_usd - entry_price_usd) * current_token_amount
                    trade.solscan_sell_url = f"https://solscan.io/tx/{sl_swap.get('signature')}"
                    await db.commit()
                    
                    await redis_client.delete(f"tp_state:{trade_id}")
                    
                    await websocket_manager.send_personal_message(json.dumps({
                        "type": "log",
                        "log_type": "warning",
                        "message": f"🛑 STOP LOSS: Sold all at {current_pnl:.1f}% loss",
                        "timestamp": current_time.isoformat()
                    }), user.wallet_address)
                    
                    logger.info(f"✅ Stop loss executed for {mint[:8]}")
                    break
                    
                except Exception as e:
                    logger.error(f"Stop loss sell failed: {e}")
            
            # ============================================================
            # 11. STATUS UPDATES WITH DEBUG INFO
            # ============================================================
            if iteration % 5 == 0:
                # Calculate next DCA level
                next_dca_level = None
                dca_levels_triggered = sum(1 for v in dca_triggered.values() if v)
                
                if dca_levels:
                    for level in sorted(dca_levels, key=lambda x: x["price_pct"]):
                        level_key = f"{level['price_pct']}"
                        if not dca_triggered.get(level_key, False):
                            next_dca_level = level["price_pct"]
                            break
                
                status_update = {
                    "type": "strategy_update",
                    "mint": mint,
                    "current_price": current_price_usd,
                    "entry_price": entry_price_usd,
                    "pnl_percent": round(current_pnl, 2),
                    "pnl_usd": round(((current_price_usd - entry_price_usd) * current_token_amount), 6),
                    "pnl_sol": round(current_pnl_sol, 2),
                    "highest_pnl": round(highest_pnl, 2),
                    "current_tokens": current_token_amount,
                    "remaining_sol": remaining_sol,
                    "tp_levels_triggered": sum(1 for v in tp_triggered.values() if v),
                    "total_tp_levels": len(tp_triggered),
                    "dca_levels_triggered": dca_levels_triggered,
                    "total_dca_levels": len(dca_levels),
                    "next_dca_level": next_dca_level,
                    "scale_in_triggered": scale_in_triggered,
                    "time_left": max(0, current_timeout_minutes * 60 - elapsed_seconds),
                    "trailing_stop_active": USE_TRAILING_STOP and highest_pnl > 30,
                    "trailing_stop_level": round(highest_pnl - trailing_stop_distance, 2) if USE_TRAILING_STOP and highest_pnl > 30 else None,
                    "timestamp": current_time.isoformat()
                }
                
                await websocket_manager.send_personal_message(json.dumps(status_update), user.wallet_address)
                
                # Log with DCA info
                logger.info(
                    f"📊 {mint[:8]}: ${current_price_usd:.10f} | "
                    f"PnL: {current_pnl:.2f}% (High: {highest_pnl:.2f}%) | "
                    f"TP: {sum(1 for v in tp_triggered.values() if v)}/{len(tp_triggered)} | "
                    f"DCA: {dca_levels_triggered}/{len(dca_levels)} | "
                    f"Time: {max(0, current_timeout_minutes * 60 - elapsed_seconds):.0f}s"
                )
            
            # Wait before next check
            await asyncio.sleep(2)
        
        logger.info(f"🛑 Advanced monitor completed for {mint[:8]} after {iteration} iterations")
        
    except Exception as e:
        logger.error(f"Advanced monitor failed for {trade.mint_address}: {e}", exc_info=True)
        await websocket_manager.send_personal_message(json.dumps({
            "type": "log",
            "log_type": "error",
            "message": f"❌ Advanced monitor failed: {str(e)[:100]}",
            "timestamp": datetime.utcnow().isoformat()
        }), user.wallet_address)
    
    finally:
        # Clean up task reference
        if trade_id in monitor_tasks:
            del monitor_tasks[trade_id]
            
        # CRITICAL: Close session
        await db.close()




async def get_jito_statistics() -> Dict:
    """Get Jito bundle performance statistics"""
    try:
        stats = await redis_client.hgetall("jito_stats")
        
        successful_bundles = int(stats.get("successful_bundles", 0))
        failed_bundles = int(stats.get("failed_bundles", 0))
        successful_sells = int(stats.get("successful_sells", 0))
        
        total_bundles = successful_bundles + failed_bundles
        success_rate = (successful_bundles / total_bundles * 100) if total_bundles > 0 else 0
        
        return {
            "total_bundles_sent": total_bundles,
            "successful_bundles": successful_bundles,
            "failed_bundles": failed_bundles,
            "success_rate_percent": round(success_rate, 2),
            "successful_sells_via_jito": successful_sells,
            "estimated_tip_cost_sol": successful_bundles * 0.00001, # 0.00001 SOL per tip
            "last_updated": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Failed to get Jito statistics: {e}")
        return {"error": str(e)}

async def reset_scale_trigger(delay_seconds: int):
    """Reset scale in trigger after delay"""
    await asyncio.sleep(delay_seconds)
    # This would need to be implemented with proper state management
    # For now, we'll handle it in the main loop
    
async def adaptive_slippage_calculator(mint: str, base_slippage: int = 1500) -> int:
    """Calculate adaptive slippage based on token volatility"""
    try:
        dexscreener_data = await fetch_dexscreener_with_retry(mint)
        if not dexscreener_data:
            return base_slippage
        
        price_change_m5 = abs(dexscreener_data.get("price_change_m5", 0))
        
        if price_change_m5 > 50:
            return 3000  # Very volatile
        elif price_change_m5 > 20:
            return 2000  # Volatile
        elif price_change_m5 > 5:
            return 1500  # Moderate
        else:
            return 1000  # Stable
        
    except:
        return base_slippage
        
async def get_real_time_trading_signal(mint: str) -> dict:
    """
    Get real-time trading signals using your existing APIs
    Returns signals for making dynamic decisions
    """
    try:
        # Get fresh data
        jupiter_data = await get_jupiter_token_data(mint)
        dexscreener_data = await fetch_dexscreener_with_retry(mint)
        
        if not jupiter_data or not dexscreener_data:
            return {"signal": "NEUTRAL", "confidence": 0, "reason": "No data"}
        
        signals = []
        confidence = 0
        
        # Signal 1: Price momentum
        price_change_m5 = dexscreener_data.get("price_change_m5", 0)
        if price_change_m5 > 20:
            signals.append(f"Strong pump (+{price_change_m5:.1f}% in 5m)")
            confidence += 30
        elif price_change_m5 < -15:
            signals.append(f"Heavy dump ({price_change_m5:.1f}% in 5m)")
            confidence -= 25
        
        # Signal 2: Volume spike
        volume_m5 = dexscreener_data.get("volume_m5", 0)
        volume_h1 = dexscreener_data.get("volume_h1", 0)
        
        if volume_h1 > 0:
            volume_ratio = (volume_m5 * 12) / volume_h1  # Project 5min to 1h
            if volume_ratio > 3:
                signals.append(f"Volume spike ({volume_ratio:.1f}x normal)")
                confidence += 20
        
        # Signal 3: Organic activity
        organic_score = jupiter_data.get("organic_score", 0)
        if organic_score > 70:
            signals.append(f"High organic score ({organic_score})")
            confidence += 15
        elif organic_score < 30:
            signals.append(f"Low organic score ({organic_score})")
            confidence -= 10
        
        # Signal 4: Holder growth
        holder_change_1h = jupiter_data.get("holder_change_1h", 0)
        if holder_change_1h > 10:
            signals.append(f"Rapid holder growth (+{holder_change_1h:.1f}%)")
            confidence += 10
        
        # Determine overall signal
        if confidence >= 40:
            signal = "STRONG_BUY"
        elif confidence >= 20:
            signal = "BUY"
        elif confidence <= -20:
            signal = "SELL"
        elif confidence <= -40:
            signal = "STRONG_SELL"
        else:
            signal = "NEUTRAL"
        
        return {
            "signal": signal,
            "confidence": confidence,
            "reasons": signals,
            "price_change_5m": price_change_m5,
            "volume_ratio": volume_ratio if 'volume_ratio' in locals() else 0,
            "organic_score": organic_score,
            "timestamp": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Trading signal error: {e}")
        return {"signal": "NEUTRAL", "confidence": 0, "reason": "Error"}        
          
async def get_last_trade_price_from_db(mint: str) -> Optional[Dict]:
    """Get last trade price from your database as fallback"""
    try:
        async with AsyncSessionLocal() as db:
            # Get the most recent trade for this mint
            result = await db.execute(
                select(Trade)
                .where(Trade.mint_address == mint)
                .order_by(Trade.buy_timestamp.desc())
                .limit(1)
            )
            trade = result.scalar_one_or_none()
            
            if trade and trade.price_usd_at_trade:
                return {
                    "priceUsd": float(trade.price_usd_at_trade),
                    "_source": "db_last_trade",
                    "_timestamp": trade.buy_timestamp.isoformat() if trade.buy_timestamp else None
                }
    except Exception as e:
        logger.debug(f"Failed to get last trade price from DB for {mint}: {e}")
    
    return None
        
        
        
        
# async def get_price_with_fallback(mint: str, max_age_seconds: float = 8.0) -> Optional[Dict]:
#     """Get price with multiple fallback sources."""
    
#     # Add detailed logging
#     logger.debug(f"🔄 Fetching price for {mint[:8]}...")
    
#     # 1. Try cached price first
#     now = datetime.utcnow()
#     if mint in price_cache:
#         cached = price_cache[mint]
#         age = (now - cached["timestamp"]).total_seconds()
#         if age < max_age_seconds:
#             logger.debug(f"✅ Using cached price for {mint[:8]}: ${cached['data'].get('priceUsd', 0):.10f}")
#             return cached["data"]
    
#     # Try DexScreener first
#     try:
#         dex_data = await fetch_dexscreener_with_retry(mint)
#         if dex_data and dex_data.get("priceUsd"):
#             price_usd = float(dex_data["priceUsd"])
#             logger.debug(f"✅ DexScreener price for {mint[:8]}: ${price_usd:.10f}")
            
#             # Add timestamp and source
#             dex_data["_source"] = "dexscreener"
#             dex_data["_timestamp"] = now.isoformat()
            
#             price_cache[mint] = {"timestamp": now, "data": dex_data}
#             return dex_data
#     except Exception as e:
#         logger.debug(f"DexScreener failed for {mint[:8]}: {e}")
    
#     # Try Jupiter quote
#     try:
#         jup_data = await get_jupiter_quote_price(mint)
#         if jup_data and jup_data.get("priceUsd"):
#             price_usd = float(jup_data["priceUsd"])
#             logger.debug(f"✅ Jupiter price for {mint[:8]}: ${price_usd:.10f}")
            
#             price_cache[mint] = {"timestamp": now, "data": jup_data}
#             return jup_data
#     except Exception as e:
#         logger.debug(f"Jupiter quote failed for {mint[:8]}: {e}")
    
#     # Last resort: cached data even if stale
#     if mint in price_cache:
#         stale_data = price_cache[mint]["data"]
#         stale_age = (now - price_cache[mint]["timestamp"]).total_seconds()
#         logger.warning(f"⚠️ Using stale price for {mint[:8]} ({stale_age:.0f}s old): ${stale_data.get('priceUsd', 0):.10f}")
        
#         stale_data["_stale"] = True
#         stale_data["_stale_seconds"] = stale_age
#         return stale_data
    
#     logger.error(f"🚨 NO PRICE DATA for {mint[:8]}")
#     return None





async def get_jupiter_quote_price(mint: str) -> Optional[Dict]:
    """Get price directly from Jupiter quote API"""
    try:
        async with aiohttp.ClientSession() as session:
            # Quote for 1 token to SOL
            url = f"https://quote-api.jup.ag/v6/quote?inputMint={mint}&outputMint={settings.SOL_MINT}&amount=1000000"
            async with session.get(url, timeout=2.0) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    if data and "outAmount" in data:
                        sol_amount = int(data["outAmount"]) / 1_000_000_000
                        
                        # Convert SOL to USD
                        sol_price = await get_jupiter_token_data(settings.SOL_MINT)
                        usd_price = sol_amount * sol_price
                        
                        return {
                            "priceUsd": usd_price,
                            "priceSOL": sol_amount,
                            "_source": "jupiter_quote"
                        }
    except Exception as e:
        logger.debug(f"Jupiter quote failed for {mint}: {e}")
    return None
         
async def get_cached_price(mint: str):
    now = datetime.utcnow()
    if mint in price_cache:
        cached = price_cache[mint]
        age = (now - cached["timestamp"]).total_seconds()
        if age < 8:
            return cached["data"]
        elif age < 30:
            # Allow stale up to 30s during high volatility
            logger.debug(f"Using slightly stale price ({age:.0f}s old) for {mint[:8]}")
            return cached["data"]
    
    try:
        data = await fetch_dexscreener_with_retry(mint)
        if data and data.get("priceUsd"):
            price_cache[mint] = {"timestamp": now, "data": data}
            return data
    except Exception as e:
        logger.debug(f"Price fetch failed for {mint[:8]}: {e}")
    
    # Fallback to stale if exists
    if mint in price_cache:
        age = (now - price_cache[mint]["timestamp"]).total_seconds()
        logger.warning(f"Using stale price ({age:.0f}s old) for {mint[:8]} as fallback")
        return price_cache[mint]["data"]
    
    return None

async def start_monitor_for_trade(trade: Trade, user: User, entry_price_usd: float, token_decimals: int, token_amount: float):
    """Start monitor task for a trade"""
    try:
        logger.info(f"🎯 STARTING MONITOR for trade {trade.id} ({trade.mint_address[:8]})")
        
        # Create the monitor task
        monitor_task = asyncio.create_task(
            monitor_position(
                user=user,
                trade=trade,
                entry_price_usd=entry_price_usd,
                token_decimals=token_decimals,
                token_amount=token_amount,
                websocket_manager=websocket_manager
            )
        )
        
        # Store the task reference
        monitor_tasks[trade.id] = monitor_task
        
        # Add callback to clean up when done
        monitor_task.add_done_callback(lambda t: monitor_tasks.pop(trade.id, None))
        
        return monitor_task
        
    except Exception as e:
        logger.error(f"Failed to start monitor for trade {trade.id}: {e}")
        raise

# ===================================================================
# MONITOR & SELL (Updated for Ultra API)
# ===================================================================

async def monitor_position(
    user: User,
    trade: Trade,
    entry_price_usd: float,
    token_decimals: int,
    token_amount: float,
    websocket_manager: ConnectionManager
):
    """
    Monitor position and execute sells based on criteria.
    Uses a SINGLE database session for the entire monitor lifecycle.
    """
    
    if token_amount <= 0:
        logger.warning(f"Invalid token_amount {token_amount} for {trade.mint_address} – skipping monitor")
        return
    
    # Create ONE session for the entire monitor (CRITICAL FIX)
    db = AsyncSessionLocal()
    
    try:
        trade_id = trade.id
        mint = trade.mint_address
        
        if not trade_id:
            logger.error(f"Trade ID is missing for {mint}")
            await websocket_manager.send_personal_message(json.dumps({
                "type": "log",
                "log_type": "error",
                "message": f"❌ Monitor failed: Trade ID missing for {mint[:8]}",
                "timestamp": datetime.utcnow().isoformat()
            }), user.wallet_address)
            return
        
        # Fetch trade ONCE at the beginning
        trade_result = await db.execute(select(Trade).where(Trade.id == trade_id))
        current_trade = trade_result.scalar_one_or_none()
        
        if not current_trade:
            logger.error(f"Trade {trade_id} not found in database for {mint}")
            await websocket_manager.send_personal_message(json.dumps({
                "type": "log",
                "log_type": "error",
                "message": f"❌ Monitor failed: Trade {trade_id} not found in database",
                "timestamp": datetime.utcnow().isoformat()
            }), user.wallet_address)
            return
        
        # Get user ONCE at the beginning
        user_result = await db.execute(select(User).where(User.wallet_address == user.wallet_address))
        current_user = user_result.scalar_one_or_none()
        
        if not current_user:
            logger.error(f"User {user.wallet_address} not found during monitor setup")
            return
        
        # 🔥 Get the EXACT buy timestamp from the trade
        timing_base = current_trade.buy_timestamp if current_trade.buy_timestamp else datetime.utcnow()
        amount_lamports = int(token_amount * (10 ** token_decimals))  # Full amount
        
        # Get user settings ONCE (they rarely change during monitor)
        timeout_seconds = current_user.sell_timeout_seconds or 3600  # Default 1 hour
        take_profit_pct = current_user.sell_take_profit_pct or 50.0
        stop_loss_pct = current_user.sell_stop_loss_pct or 20.0
        partial_sell_pct = current_user.partial_sell_pct or 0
        
        # Log that monitoring has started
        logger.info(f"🚀 MONITOR STARTED for {mint[:8]}... | Trade ID: {current_trade.id}")
        logger.info(f"  User: {current_user.wallet_address[:8]}")
        logger.info(f"  Buy time: {timing_base}")
        logger.info(f"  Timeout: {timeout_seconds}s (Will auto-sell at: {timing_base + timedelta(seconds=timeout_seconds)})")
        logger.info(f"  Take profit: {take_profit_pct}%")
        logger.info(f"  Stop loss: {stop_loss_pct}%")
        logger.info(f"  Token amount: {token_amount:.2f}")
        
        # Send monitoring started message to frontend
        await websocket_manager.send_personal_message(json.dumps({
            "type": "log",
            "log_type": "info",
            "message": f"📈 Monitoring {current_trade.token_symbol or mint[:8]}... | Auto-sell in {timeout_seconds}s",
            "timestamp": datetime.utcnow().isoformat()
        }), user.wallet_address)
        
        iteration = 0
        start_time = datetime.utcnow()
        
        while True:
            iteration += 1
            current_time = datetime.utcnow()
            
            try:
                # ============================================================
                # 🎯 CHECK #1: REFRESH TRADE STATUS (using same session)
                # ============================================================
                await db.refresh(current_trade)  # Refresh trade object from database
                
                if current_trade.sell_timestamp:
                    logger.info(f"Trade {mint[:8]}... already sold at {current_trade.sell_timestamp}, stopping monitor")
                    await websocket_manager.send_personal_message(json.dumps({
                        "type": "log",
                        "log_type": "info",
                        "message": f"✅ Position already sold, stopping monitor",
                        "timestamp": current_time.isoformat()
                    }), user.wallet_address)
                    break
                
                # ============================================================
                # 🎯 CHECK #2: TIMEOUT - USING SAME SESSION
                # ============================================================
                elapsed_seconds = (current_time - timing_base).total_seconds()
                
                # DEBUG: Log timeout status every 10 iterations
                if iteration % 10 == 0:
                    time_left = max(0, timeout_seconds - elapsed_seconds)
                    logger.info(f"⏰ Timeout check for {mint[:8]}: {elapsed_seconds:.0f}s / {timeout_seconds}s ({(elapsed_seconds/timeout_seconds*100):.1f}%)")
                
                # TIMEOUT TRIGGER
                if elapsed_seconds >= timeout_seconds:
                    logger.info(f"⏰ TIMEOUT REACHED for {mint[:8]}: {elapsed_seconds:.0f}s >= {timeout_seconds}s")
                    
                    # Get current price for PnL calculation
                    dex = await get_cached_price(mint)
                    current_price = 0
                    
                    if dex and dex.get("priceUsd"):
                        current_price = float(dex["priceUsd"])
                    
                    # Calculate PnL based on ACTUAL entry price from trade
                    if current_trade.price_usd_at_trade and current_price > 0:
                        pnl = (current_price / current_trade.price_usd_at_trade - 1) * 100
                    else:
                        pnl = 0
                    
                    # Send timeout notification
                    await websocket_manager.send_personal_message(json.dumps({
                        "type": "log",
                        "log_type": "warning",
                        "message": f"⏰ TIMEOUT: Selling {current_trade.token_symbol or mint[:8]} after {timeout_seconds}s (PnL: {pnl:.2f}%)",
                        "timestamp": current_time.isoformat()
                    }), user.wallet_address)
                    
                    # Execute the sell WITH SAME SESSION
                    await execute_timeout_sell(
                        current_user, mint, amount_lamports, trade_id, db,
                        current_trade.price_usd_at_trade or entry_price_usd, 
                        current_price, pnl, websocket_manager
                    )
                    
                    # Monitor job is done
                    break
                
                # ============================================================
                # CHECK #3: PRICE-BASED CONDITIONS
                # ============================================================
                
                # Fetch current price
                dex = await get_cached_price(mint)
                if not dex or not dex.get("priceUsd"):
                    logger.debug(f"No price data for {mint[:8]}... - waiting")
                    await asyncio.sleep(5)
                    continue
                
                current_price = float(dex["priceUsd"])
                
                if entry_price_usd <= 0 or current_price <= 0:
                    logger.debug(f"Invalid price for {mint[:8]}: entry=${entry_price_usd}, current=${current_price}")
                    await asyncio.sleep(5)
                    continue
                
                # Calculate PnL
                # pnl = (current_price / entry_price_usd - 1) * 100
                
                # 🔥 FIX: Use SOL price for PnL calculation
                sol_price = await get_jupiter_token_data(settings.SOL_MINT)
                if sol_price > 0:
                    current_price_sol = current_price / sol_price
                    
                    # Get entry price in SOL from trade
                    if current_trade.price_sol_at_trade and current_price_sol > 0:
                        pnl = ((current_price_sol / current_trade.price_sol_at_trade) - 1) * 100
                        logger.debug(f"📊 SOL-based PnL: {pnl:.2f}%")
                    else:
                        # Fallback to USD calculation
                        pnl = (current_price / entry_price_usd - 1) * 100
                else:
                    # USD calculation as last resort
                    pnl = (current_price / entry_price_usd - 1) * 100
                
                # ============================================================
                # MOMENTUM-BASED ADJUSTMENTS
                # ============================================================
                try:
                    # Get recent transaction data
                    if dex and "txns" in dex:
                        buys_5m = dex["txns"].get("m5", {}).get("buys", 0)
                        sells_5m = dex["txns"].get("m5", {}).get("sells", 0)
                        
                        # If heavy selling, exit faster
                        if sells_5m > buys_5m * 3 and pnl > 5:  # 3x more sells, but we're in profit
                            logger.info(f"🚨 Heavy selling detected for {mint[:8]}, taking profit early")
                            await websocket_manager.send_personal_message(json.dumps({
                                "type": "log",
                                "log_type": "warning",
                                "message": f"🚨 Heavy selling detected ({sells_5m} sells vs {buys_5m} buys). Taking profit early.",
                                "timestamp": current_time.isoformat()
                            }), user.wallet_address)
                            
                            await execute_price_based_sell(
                                current_user, mint, amount_lamports, trade_id, db,
                                entry_price_usd, current_price, pnl,
                                "Early Exit (Heavy Selling)", False, token_decimals, websocket_manager
                            )
                            break
                            
                        # If strong buying, let it run longer
                        if buys_5m > sells_5m * 2 and pnl > 0:
                            # Extend timeout by 30 seconds
                            timeout_seconds += 30
                            logger.info(f"📈 Strong buying for {mint[:8]}, extending timeout by 30s")
                            
                            await websocket_manager.send_personal_message(json.dumps({
                                "type": "log",
                                "log_type": "info",
                                "message": f"📈 Strong buying detected ({buys_5m} buys vs {sells_5m} sells). Extending timeout.",
                                "timestamp": current_time.isoformat()
                            }), user.wallet_address)
                            
                except Exception as e:
                    logger.debug(f"Momentum check failed: {e}")
                
                # ============================================================
                # STATUS UPDATES
                # ============================================================
                if iteration % 15 == 0:
                    logger.info(f"📊 Monitor {mint[:8]}: ${current_price:.6f} | PnL: {pnl:.2f}% | Time left: {max(0, timeout_seconds - elapsed_seconds):.0f}s")
                    
                    # Send heartbeat to frontend
                    await websocket_manager.send_personal_message(json.dumps({
                        "type": "position_update",
                        "mint": mint,
                        "current_price": current_price,
                        "pnl_percent": round(pnl, 2),
                        "entry_price": entry_price_usd,
                        "time_left_seconds": max(0, timeout_seconds - elapsed_seconds),
                        "timeout_seconds": timeout_seconds,
                        "timestamp": current_time.isoformat()
                    }), user.wallet_address)
                
                # ============================================================
                # PRICE-BASED SELL CONDITIONS
                # ============================================================
                sell_reason = None
                sell_partial = False
                sell_amount_lamports = amount_lamports
                
                # 2A. Take Profit
                if take_profit_pct and pnl >= take_profit_pct:
                    sell_reason = "Take Profit"
                    if partial_sell_pct and partial_sell_pct < 100:
                        sell_partial = True
                        sell_amount_lamports = int(amount_lamports * (partial_sell_pct / 100))
                    logger.info(f"🎯 TAKE PROFIT for {mint[:8]}: PnL {pnl:.2f}% >= {take_profit_pct}%")
                
                # 2B. Stop Loss
                elif stop_loss_pct and pnl <= -stop_loss_pct:
                    sell_reason = "Stop Loss"
                    logger.info(f"🛑 STOP LOSS for {mint[:8]}: PnL {pnl:.2f}% <= -{stop_loss_pct}%")
                
                # 2C. Execute sell if any price condition met
                if sell_reason:
                    # Get token decimals from trade or database
                    token_decimals = trade.token_decimals or 9
                    
                    # Get SOL price using proper helper
                    price_data = await get_token_price_in_sol(mint, token_decimals)
                    current_price_sol = price_data["price_sol"]
                    
                    # Calculate estimated SOL value
                    token_amount_sold = sell_amount_lamports / (10 ** token_decimals)
                    estimated_sol_value = current_price_sol * token_amount_sold
                    
                    # Get fee decision
                    fee_decision = await fee_manager.calculate_fee_decision(
                        user=user,
                        trade_type=sell_reason,
                        amount_sol=estimated_sol_value,
                        mint=mint,
                        pnl_pct=pnl
                    )
                    
                    # Store for the swap execution
                    fee_key = fee_manager.get_fee_decision_key(
                        user_wallet=user.wallet_address,
                        mint=mint,
                        trade_type=sell_reason
                    )
                    await redis_client.setex(fee_key, 300, json.dumps(fee_decision))
                    
                    # Execute the sell
                    await execute_price_based_sell(
                        current_user, mint, sell_amount_lamports, trade_id, db,
                        entry_price_usd, current_price, pnl, sell_reason, sell_partial,
                        token_decimals, websocket_manager, fee_decision  # Pass fee decision
                    )
                                    
                    if sell_partial:
                        # Update remaining amount and continue monitoring
                        amount_lamports -= sell_amount_lamports
                        token_amount -= (sell_amount_lamports / (10 ** token_decimals))
                        logger.info(f"✅ Partial sell executed. Remaining: {token_amount:.2f} tokens")
                        continue
                    else:
                        # Full sell - exit monitor
                        break
                
                # ============================================================
                # WAIT BEFORE NEXT CHECK
                # ============================================================
                await asyncio.sleep(4)  # Check every 4 seconds
                
            except Exception as e:
                logger.error(f"Monitor error for {mint} on iteration {iteration}: {e}", exc_info=True)
                await db.rollback()  # Rollback any failed transaction
                await asyncio.sleep(10)
                
                # After too many errors, check if we should stop
                if iteration > 100:  # ~10 minutes of errors
                    logger.error(f"Too many monitor errors for {mint}, stopping")
                    await websocket_manager.send_personal_message(json.dumps({
                        "type": "log",
                        "log_type": "error",
                        "message": f"❌ Monitor stopped due to errors for {current_trade.token_symbol or mint[:8]}",
                        "timestamp": current_time.isoformat()
                    }), user.wallet_address)
                    break
        
        logger.info(f"🛑 MONITOR STOPPED for {mint[:8]}... after {iteration} iterations")
        
    except Exception as e:
        logger.error(f"Fatal error in monitor setup for {trade.mint_address}: {e}", exc_info=True)
        await websocket_manager.send_personal_message(json.dumps({
            "type": "log",
            "log_type": "error",
            "message": f"❌ Monitor failed to start for {trade.token_symbol or trade.mint_address[:8]}",
            "timestamp": datetime.utcnow().isoformat()
        }), user.wallet_address)
        
    finally:
        # CRITICAL: Close the session when done
        await db.close()
        
async def execute_timeout_sell(user: User, mint: str, amount_lamports: int, trade_id: int, 
                              session: AsyncSession, entry_price: float, current_price: float,
                              pnl: float, websocket_manager: ConnectionManager):
    """Execute a sell due to timeout"""
    try:
        # Get the trade with ALL details
        trade_result = await session.execute(
            select(Trade).where(Trade.id == trade_id)
        )
        trade = trade_result.scalar_one_or_none()
        
        if not trade:
            logger.error(f"Trade {trade_id} not found for timeout sell")
            return
        
        # Get correct decimals from trade (CRITICAL)
        token_decimals = trade.token_decimals
        if token_decimals is None:
            # Try to get from Jupiter
            jupiter_data = await get_jupiter_token_data(mint)
            token_decimals = jupiter_data.get("decimals", 9) if jupiter_data else 9
            logger.warning(f"⚠️ No decimals in trade, using {token_decimals} from Jupiter")
        
        # Calculate actual SOL amount
        actual_sol_amount = amount_lamports / 1_000_000_000
        token_amount = amount_lamports / (10 ** token_decimals)
        
        logger.info(f"🔄 Executing TIMEOUT sell for {mint[:8]}... ({actual_sol_amount:.4f} SOL = {token_amount:.2f} tokens)")
        
        # Get entry price in SOL from trade
        entry_price_sol = trade.price_sol_at_trade
        
        # 🔥 FIX: Get current token price in SOL with correct decimals
        current_price_sol = await get_token_price_in_sol(mint, token_decimals)
        
        # Calculate PnL properly
        if entry_price_sol and entry_price_sol > 0 and current_price_sol > 0:
            real_pnl = ((current_price_sol / entry_price_sol) - 1) * 100
            profit_sol = (current_price_sol - entry_price_sol) * token_amount
            logger.info(f"📊 SOL PnL: {real_pnl:.2f}% | Profit: {profit_sol:.6f} SOL")
        else:
            # Fallback to USD calculation
            if entry_price > 0 and current_price > 0:
                real_pnl = ((current_price / entry_price) - 1) * 100
                sol_price = await get_jupiter_token_data(settings.SOL_MINT)
                profit_sol = ((current_price - entry_price) * token_amount) / sol_price if sol_price > 0 else 0
                logger.warning(f"⚠️ Using USD PnL: {real_pnl:.2f}%")
            else:
                real_pnl = pnl
                profit_sol = 0
                logger.error(f"❌ No valid prices for PnL calculation")
                
        # Get user's sell slippage
        slippage_bps = int(user.sell_slippage_bps) if user.sell_slippage_bps else 500
        
        # Execute the sell swap
        swap = await execute_jupiter_swap(
            user=user,
            input_mint=mint,
            output_mint=settings.SOL_MINT,
            amount=amount_lamports,
            slippage_bps=slippage_bps,
            label="TIMEOUT_SELL",
        )
        
        # Convert profit to USD if we have SOL price
        sol_price = await get_jupiter_token_data(settings.SOL_MINT)
        profit_usd = profit_sol * sol_price if profit_sol > 0 else 0
        
        # Update trade record with CORRECT values
        if trade:
            trade.sell_timestamp = datetime.utcnow()
            trade.sell_reason = "Timeout"
            trade.sell_tx_hash = swap.get("signature")
            trade.price_usd_at_trade = current_price
            trade.profit_usd = profit_usd
            trade.profit_sol = profit_sol
            
            # Store fee info if applied
            if swap.get("fee_applied"):
                trade.fee_applied = True
                trade.fee_amount = swap.get("estimated_referral_fee", 0)
                trade.fee_percentage = swap.get("fee_percentage", 0.0)
                trade.fee_bps = swap.get("fee_bps", None)
                trade.fee_mint = swap.get("fee_mint", None)
                trade.fee_collected_at = datetime.utcnow()
            
            trade.solscan_sell_url = f"https://solscan.io/tx/{swap.get('signature')}"
            
            await session.commit()
        
        # Send success message with REAL PnL
        await websocket_manager.send_personal_message(json.dumps({
            "type": "log",
            "log_type": "success",
            "message": f"✅ TIMEOUT SELL: Sold {mint[:8]} after timeout. PnL: {real_pnl:.2f}% | Profit: {profit_sol:.6f} SOL (${profit_usd:.6f})",
            "timestamp": datetime.utcnow().isoformat()
        }), user.wallet_address)
        
        # Send trade instruction to frontend with correct PnL
        await websocket_manager.send_personal_message(json.dumps({
            "type": "trade_instruction",
            "action": "sell",
            "mint": mint,
            "reason": "Timeout",
            "pnl_pct": round(real_pnl, 2),
            "profit_usd": profit_usd,
            "profit_sol": profit_sol,
            "entry_price_sol": entry_price_sol,
            "exit_price_sol": current_price_sol,
            "signature": swap["signature"],
            "solscan_url": f"https://solscan.io/tx/{swap['signature']}"
        }), user.wallet_address)
        
        logger.info(f"✅ TIMEOUT SELL COMPLETED for {mint[:8]} | PnL: {real_pnl:.2f}% | Profit: {profit_sol:.6f} SOL (${profit_usd:.6f})")
        
    except Exception as e:
        logger.error(f"❌ TIMEOUT SELL FAILED for {mint[:8]}: {e}", exc_info=True)
        await websocket_manager.send_personal_message(json.dumps({
            "type": "log",
            "log_type": "error",
            "message": f"❌ Timeout sell failed: {str(e)[:100]}",
            "timestamp": datetime.utcnow().isoformat()
        }), user.wallet_address)
          
async def get_token_price_in_sol(mint: str, token_decimals: int = None) -> Dict[str, Any]:
    """
    Get current token price in SOL with all metadata
    Returns: {"price_sol": float, "price_usd": float, "decimals": int, "source": str}
    """
    try:
        # First try: Use existing Jupiter data function
        jupiter_data = await get_jupiter_token_data(mint)
        
        if jupiter_data:
            # Get decimals if not provided
            if token_decimals is None and "decimals" in jupiter_data:
                token_decimals = jupiter_data["decimals"]
            
            # Get SOL price
            sol_price = await get_jupiter_token_data(settings.SOL_MINT)
            
            if jupiter_data.get("usd_price") and sol_price > 0:
                price_sol = jupiter_data["usd_price"] / sol_price
                return {
                    "price_sol": price_sol,
                    "price_usd": jupiter_data["usd_price"],
                    "decimals": token_decimals,
                    "source": "jupiter_token_data",
                    "data": jupiter_data
                }
        
        # Second try: Jupiter quote API with proper decimals
        if token_decimals is not None:
            try:
                amount = 10 ** token_decimals  # 1 token
                async with aiohttp.ClientSession() as session:
                    url = f"https://quote-api.jup.ag/v6/quote?inputMint={mint}&outputMint={settings.SOL_MINT}&amount={amount}"
                    headers = {"x-api-key": settings.JUPITER_API_KEY} if hasattr(settings, "JUPITER_API_KEY") else {}
                    async with session.get(url, headers=headers, timeout=2.0) as resp:
                        if resp.status == 200:
                            data = await resp.json()
                            if data and "outAmount" in data:
                                out_amount = int(data["outAmount"])
                                price_sol = out_amount / (10 ** token_decimals) / 1_000_000_000
                                
                                # Convert to USD
                                sol_price = await get_jupiter_token_data(settings.SOL_MINT)
                                price_usd = price_sol * sol_price if sol_price > 0 else 0
                                
                                return {
                                    "price_sol": price_sol,
                                    "price_usd": price_usd,
                                    "decimals": token_decimals,
                                    "source": "jupiter_quote",
                                    "data": data
                                }
            except Exception as e:
                logger.debug(f"Jupiter quote failed: {e}")
        
        # Third try: DexScreener
        dex_data = await get_cached_price(mint)
        if dex_data and dex_data.get("priceUsd"):
            sol_price = await get_jupiter_token_data(settings.SOL_MINT)
            if sol_price > 0:
                price_sol = float(dex_data["priceUsd"]) / sol_price
                return {
                    "price_sol": price_sol,
                    "price_usd": float(dex_data["priceUsd"]),
                    "decimals": token_decimals or dex_data.get("decimals", 9),
                    "source": "dexscreener",
                    "data": dex_data
                }
        
    except Exception as e:
        logger.error(f"Failed to get token price in SOL for {mint}: {e}")
    
    return {"price_sol": 0, "price_usd": 0, "decimals": token_decimals or 9, "source": "failed", "data": {}}

 
async def execute_price_based_sell(user: User, mint: str, amount_lamports: int, trade_id: int,
                                  session: AsyncSession, entry_price: float, current_price: float,
                                  pnl: float, reason: str, is_partial: bool,
                                  token_decimals: int, websocket_manager: ConnectionManager,
                                  fee_decision: Dict[str, Any] = None):
    """Execute a sell based on price conditions (TP/SL)"""
    try:
        logger.info(f"🔄 Executing {reason} sell for {mint[:8]}...")
        
        # Get user's sell slippage
        slippage_bps = int(user.sell_slippage_bps) if user.sell_slippage_bps else 500
        
        # Execute the sell swap
        swap = await execute_jupiter_swap(
            user=user,
            input_mint=mint,
            output_mint=settings.SOL_MINT,
            amount=amount_lamports,
            slippage_bps=slippage_bps,
            label=f"{reason}_SELL",
        )
        
        # Update trade record
        trade_result = await session.execute(
            select(Trade).where(Trade.id == trade_id)
        )
        trade = trade_result.scalar_one_or_none()
        
        # 🔥 FIX: Calculate profit in SOL first, then convert to USD
        token_amount_sold = amount_lamports / (10 ** token_decimals)
        
        # Get SOL prices
        entry_price_sol = 0
        if trade and trade.price_sol_at_trade:
            entry_price_sol = trade.price_sol_at_trade
        
        current_price_sol = 0
        sol_price = await get_jupiter_token_data(settings.SOL_MINT)
        if sol_price > 0:
            current_price_sol = current_price / sol_price
        
        # Calculate profit
        if entry_price_sol > 0 and current_price_sol > 0:
            profit_sol = (current_price_sol - entry_price_sol) * token_amount_sold
            profit_usd = profit_sol * sol_price if sol_price > 0 else 0
            logger.info(f"📊 Profit: {profit_sol:.6f} SOL (${profit_usd:.6f})")
        else:
            # Fallback to USD calculation
            profit_usd = (current_price - entry_price) * token_amount_sold
            profit_sol = profit_usd / sol_price if sol_price > 0 else 0

        if trade:
            if is_partial:
                # Update remaining amount
                trade.amount_tokens = trade.amount_tokens - (amount_lamports / (10 ** token_decimals))
                trade.profit_usd = profit_usd
                trade.profit_sol = profit_sol
                trade.sell_reason = f"{reason} (Partial)"
            else:
                # Full sell
                trade.sell_timestamp = datetime.utcnow()
                trade.sell_reason = reason
                trade.sell_tx_hash = swap.get("signature")
                trade.price_usd_at_trade = current_price
                trade.profit_usd = profit_usd
                trade.profit_sol = profit_sol
                trade.solscan_sell_url = f"https://solscan.io/tx/{swap.get('signature')}"
            
            # Store fee info if applied
            if swap.get("fee_applied"):
                trade.fee_applied = True
                trade.fee_amount = swap.get("estimated_referral_fee", 0)
                trade.fee_percentage = swap.get("fee_percentage", 0.0)
                trade.fee_bps = swap.get("fee_bps", None)
                trade.fee_mint = swap.get("fee_mint", None)
                trade.fee_collected_at = datetime.utcnow()
            
            await session.commit()
        
        # Send success message
        message = f"✅ {reason}: Sold {mint[:8]}. PnL: {pnl:.2f}%"
        if is_partial:
            message += " (Partial)"
        
        await websocket_manager.send_personal_message(json.dumps({
            "type": "log",
            "log_type": "success",
            "message": message,
            "timestamp": datetime.utcnow().isoformat()
        }), user.wallet_address)
        
        logger.info(f"✅ {reason} SELL COMPLETED for {mint[:8]}")
        
    except Exception as e:
        logger.error(f"❌ {reason} SELL FAILED for {mint[:8]}: {e}")
        await websocket_manager.send_personal_message(json.dumps({
            "type": "log",
            "log_type": "error",
            "message": f"❌ {reason} sell failed: {str(e)[:100]}",
            "timestamp": datetime.utcnow().isoformat()
        }), user.wallet_address)
                 
async def cleanup_fee_decisions(user_wallet: str):
    """Clean up old fee decision keys"""
    try:
        # Use the new key pattern from fee_manager
        pattern = f"fee:{user_wallet}:*"  # Changed from "fee_decision:"
        keys = await redis_client.keys(pattern)
        
        for key in keys:
            # Check if key is older than 1 hour
            ttl = await redis_client.ttl(key)
            if ttl < 0:  # Already expired or no TTL
                await redis_client.delete(key)
                logger.debug(f"Cleaned up old fee decision key: {key}")
    except Exception as e:
        logger.debug(f"Fee decision cleanup failed: {e}")
        
async def periodic_fee_cleanup():
    """Periodically clean up old fee decision keys"""
    while True:
        try:
            # Get all users with recent activity
            recent_users = await redis_client.keys("fee_decision:*")
            user_set = set()
            
            for key in recent_users:
                parts = key.split(":")
                if len(parts) > 1:
                    user_set.add(parts[1])  # Extract user wallet
            
            # Clean up for each user
            for user_wallet in user_set:
                await cleanup_fee_decisions(user_wallet)
                
        except Exception as e:
            logger.error(f"Periodic fee cleanup failed: {e}")
        
        await asyncio.sleep(3600)  # Run every hour
        
        
        
        
        