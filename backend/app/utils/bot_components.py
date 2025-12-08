import logging
import json
import base64
import asyncio
from datetime import datetime, timedelta
from typing import Dict, Optional, Any
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

logger = logging.getLogger(__name__)

# Redis
redis_client = redis.Redis(host="localhost", port=6379, db=0, decode_responses=True)

# Add near other global variables at the top
monitor_tasks: Dict[int, asyncio.Task] = {}

price_cache: Dict[str, Dict] = {}


class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.connection_times: Dict[str, datetime] = {}
        
    async def connect(self, websocket: WebSocket, wallet_address: str):
        await websocket.accept()
        self.active_connections[wallet_address] = websocket
        self.connection_times[wallet_address] = datetime.utcnow()
        
    def disconnect(self, wallet_address: str):
        self.active_connections.pop(wallet_address, None)
        self.connection_times.pop(wallet_address, None)
        
    async def check_and_reconnect(self, wallet_address: str):
        """Check if connection is stale and needs reconnection"""
        if wallet_address in self.connection_times:
            last_activity = datetime.utcnow() - self.connection_times[wallet_address]
            if last_activity.total_seconds() > 60:  # 1 minute of inactivity
                logger.warning(f"Connection stale for {wallet_address}, reconnecting...")
                return True
        return False

    async def send_personal_message(self, message: str, wallet_address: str):
        ws = self.active_connections.get(wallet_address)
        if ws:
            try:
                await ws.send_text(message)
            except:
                self.disconnect(wallet_address)

websocket_manager = ConnectionManager()




# Move this function to the TOP after imports but before class definitions
async def check_and_restart_stale_monitors():
    """Check if monitor tasks are running and restart if needed"""
    while True:
        try:
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
                        
                        # Get user
                        user_result = await db.execute(
                            select(User).where(User.wallet_address == trade.user_wallet_address)
                        )
                        user = user_result.scalar_one_or_none()
                        
                        if user and trade.token_decimals and trade.amount_tokens:
                            # Use a separate helper to avoid circular reference
                            asyncio.create_task(
                                restart_monitor_for_trade(trade, user)
                            )
        
        except Exception as e:
            logger.error(f"Error checking stale monitors: {e}")
        
        await asyncio.sleep(30)  # Check every 30 seconds


async def restart_monitor_for_trade(trade: Trade, user: User):
    """Helper to restart monitor for a trade"""
    try:
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

async def execute_jupiter_swap(
    user: User,
    input_mint: str,
    output_mint: str,
    amount: int,
    slippage_bps: int,
    label: str = "swap",
    max_retries: int = 3,
) -> dict:

    input_sol = amount / 1_000_000_000.0
    
    # FIX: Ensure MIN_BUY_SOL is a float
    min_buy_sol_str = getattr(settings, 'MIN_BUY_SOL', '0.05')
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

    # 🔥 CRITICAL FIX: Ultra API fee implementation
    use_referral = True
    referral_fee = "100"  # 1% fee in basis points
    
    # Get the Ultra referral account
    referral_account = getattr(settings, 'JUPITER_REFERRAL_ACCOUNT', None)
    
    if referral_account:
        logger.info(f"💰 Using Ultra referral account: {referral_account[:8]}...")
        logger.info(f"   Applying 1% fee on {label} transaction")
        
        # For Ultra API, we just pass the referral account directly
        # DON'T try to calculate token accounts - Jupiter handles it
        fee_account = referral_account  # Use the referral account directly
    else:
        logger.warning("⚠️ No Ultra referral account configured - missing out on 1% fees!")
        use_referral = False
        fee_account = None

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
                # 1. GET ORDER WITH 1% FEE
                # =============================================================
                order_params = {
                    "inputMint": input_mint,
                    "outputMint": output_mint,
                    "amount": str(amount),
                    "slippageBps": str(slippage_bps),
                    "taker": user_pubkey,
                }
                
                # 🔥 Add referral parameters for Ultra API
                if use_referral and fee_account:
                    order_params["referralAccount"] = fee_account
                    order_params["referralFee"] = referral_fee
                    logger.info(f"💰 Adding 1% fee via Ultra API")
                else:
                    logger.warning("⚠️ Proceeding without 1% fee - you're losing revenue!")
                
                logger.info(f"Getting order for {label}: {input_mint[:8]}... → {output_mint[:8]}...")
                
                order_resp = await session.get(f"{base}/order", params=order_params)
                if order_resp.status != 200:
                    txt = await order_resp.text()
                    
                    # Check if it's a referral initialization error
                    if "referralAccount is initialized" in txt:
                        logger.warning(f"Referral token account not initialized for this swap")
                        
                        # Try again without referral on the first attempt
                        if attempt == 0 and use_referral:
                            logger.info("Retrying without referral account...")
                            use_referral = False
                            continue  # Retry immediately without referral
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
                    if fee_bps >= 100:  # At least 1% fee
                        fee_applied = True
                        fee_percentage = fee_bps / 100  # Convert to percentage
                        in_amount = int(order_data["inAmount"])
                        fee_amount = (in_amount * fee_bps) // 10000
                        
                        logger.info(f"💰 1% FEE CONFIRMED: {fee_bps}bps fee applied")
                        
                        # Log fee details
                        fee_mint = order_data.get("feeMint", "Unknown")
                        if "So111" in fee_mint:
                            fee_sol = fee_amount / 1e9
                            logger.info(f"   Estimated fee: {fee_sol:.6f} SOL")
                        elif "EPjFW" in fee_mint:
                            fee_usdc = fee_amount / 1e6
                            logger.info(f"   Estimated fee: {fee_usdc:.6f} USDC")
                        else:
                            logger.info(f"   Estimated fee: {fee_amount} tokens")
                    else:
                        logger.warning(f"⚠️ Fee mismatch: {fee_bps}bps (expected 100bps)")
                
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
                tx_buf = base64.b64decode(order_data["transaction"])
                original_tx = VersionedTransaction.from_bytes(tx_buf)
                message_bytes = to_bytes_versioned(original_tx.message)
                user_signature = keypair.sign_message(message_bytes)
                
                # Create signed transaction
                signed_tx = VersionedTransaction.populate(original_tx.message, [user_signature])
                raw_tx = bytes(signed_tx)
                signed_transaction_base64 = base64.b64encode(raw_tx).decode("utf-8")
                
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
        
        logger.info(f"💰 Fee recorded: {fee_readable:.6f} {fee_unit} from {wallet_address[:8]}...")
        
    except Exception as e:
        logger.error(f"Failed to store fee info: {e}")

        
async def execute_user_buy(user: User, token: TokenMetadata, db: AsyncSession, websocket_manager: ConnectionManager):
    """Execute immediate buy and fetch metadata right after"""
    mint = token.mint_address
    lock_key = f"buy_lock:{user.wallet_address}:{mint}"
    
    # Check lock
    if await redis_client.get(lock_key):
        logger.info(f"Buy locked for {mint} – skipping")
        return
    
    await redis_client.setex(lock_key, 60, "1")
    
    try:
        # For immediate snipe, we use minimal data initially
        token_symbol = token.token_symbol or mint[:8]
        
        # Send immediate snipe notification
        await websocket_manager.send_personal_message(json.dumps({
            "type": "log",
            "log_type": "info",
            "message": f"⚡ IMMEDIATE SNIPE: Buying {mint} with {user.buy_amount_sol} SOL...",
            "timestamp": datetime.utcnow().isoformat()
        }), user.wallet_address)
        
        amount_lamports = int(user.buy_amount_sol * 1_000_000_000)
        slippage_bps = min(int(user.buy_slippage_bps or 1000), 1500)  # Cap at 15%
        
        # Use default decimals for immediate buy (will be updated with metadata)
        decimals = token.token_decimals or 9
        
        logger.info(f"⚡ IMMEDIATE BUY: {user.buy_amount_sol} SOL → {mint[:8]}... (slippage: {slippage_bps}bps)")
        
        # Try to execute the swap
        try:
            swap = await execute_jupiter_swap(
                user=user,
                input_mint=settings.SOL_MINT,
                output_mint=mint,
                amount=amount_lamports,
                slippage_bps=slippage_bps,
                label="IMMEDIATE_SNIPE",
            )
            
            if swap.get("fee_applied"):
                await websocket_manager.send_personal_message(json.dumps({
                    "type": "log",
                    "log_type": "info",
                    "message": f"💰 1% fee applied to this transaction",
                    "timestamp": datetime.utcnow().isoformat()
                }), user.wallet_address)
                
        except Exception as swap_error:
            error_msg = str(swap_error)
            logger.error(f"Immediate buy failed for {mint}: {error_msg}")
            
            # User-friendly error messages
            if "6025" in error_msg:
                user_friendly_msg = f"Immediate buy failed: Low liquidity. Try 0.2+ SOL."
            elif "JUPITER_API_KEY" in error_msg:
                user_friendly_msg = f"Immediate buy failed: Jupiter API key issue."
            elif "insufficient" in error_msg.lower():
                user_friendly_msg = f"Immediate buy failed: Insufficient liquidity."
            else:
                user_friendly_msg = f"Immediate buy failed: {error_msg[:80]}"
            
            await websocket_manager.send_personal_message(json.dumps({
                "type": "log",
                "log_type": "error",
                "message": user_friendly_msg,
                "timestamp": datetime.utcnow().isoformat()
            }), user.wallet_address)
            raise

        # Calculate token amount
        token_amount = swap["out_amount"] / (10 ** decimals)
        
        if token_amount <= 0:
            raise Exception("Swap returned 0 tokens")

        logger.info(f"✅ Immediate buy successful: {token_amount:.2f} tokens received")
        
        # ===================================================================
        # 🔥 CRITICAL: Fetch comprehensive metadata RIGHT AFTER successful buy
        # ===================================================================
        logger.info(f"🔄 Fetching comprehensive metadata for {mint[:8]}...")
        
        # Get or create token metadata in the database
        token_meta_result = await db.execute(
            select(TokenMetadata).where(TokenMetadata.mint_address == mint)
        )
        token_meta = token_meta_result.scalar_one_or_none()
        
        if not token_meta:
            token_meta = TokenMetadata(mint_address=mint)
            db.add(token_meta)
            await db.flush()
        
        # 1. Fetch DexScreener data
        dex_data = await fetch_dexscreener_with_retry(mint)
        
        if dex_data:
            # Populate DexScreener data
            token_meta.dexscreener_url = dex_data.get("dexscreener_url")
            token_meta.pair_address = dex_data.get("pair_address")
            token_meta.price_usd = safe_float(dex_data.get("price_usd"))
            token_meta.market_cap = safe_float(dex_data.get("market_cap"))
            token_meta.token_name = dex_data.get("token_name")
            token_meta.token_symbol = dex_data.get("token_symbol")
            token_meta.liquidity_usd = safe_float(dex_data.get("liquidity_usd"))
            token_meta.fdv = safe_float(dex_data.get("fdv"))
            token_meta.twitter = dex_data.get("twitter")
            token_meta.telegram = dex_data.get("telegram")
            token_meta.websites = dex_data.get("websites")
            token_meta.socials_present = bool(dex_data.get("twitter") or dex_data.get("telegram") or dex_data.get("websites"))
            
            # Update decimals if available
            if dex_data.get("decimals"):
                try:
                    decimals = int(dex_data["decimals"])
                except:
                    pass
        
        # 2. Fetch Jupiter data for logo
        try:
            jupiter_data = await asyncio.wait_for(
                get_jupiter_token_data(mint),
                timeout=5.0
            )
            
            if jupiter_data and jupiter_data.get("icon"):
                token_meta.token_logo = jupiter_data["icon"]
                logger.info(f"✅ Jupiter logo found for {mint[:8]}")
            else:
                # Fallback to DexScreener logo
                token_meta.token_logo = f"https://dd.dexscreener.com/ds-logo/solana/{mint}.png"
                
        except (asyncio.TimeoutError, Exception) as e:
            logger.warning(f"Jupiter fetch failed for {mint[:8]}: {e}")
            token_meta.token_logo = f"https://dd.dexscreener.com/ds-logo/solana/{mint}.png"
        
        # 3. Fetch Webacy data
        try:
            webacy_data = await check_webacy_risk(mint)
            if webacy_data and isinstance(webacy_data, dict):
                token_meta.webacy_risk_score = safe_float(webacy_data.get("risk_score"))
                token_meta.webacy_risk_level = webacy_data.get("risk_level")
                token_meta.webacy_moon_potential = webacy_data.get("moon_potential")
        except Exception as e:
            logger.warning(f"Webacy fetch failed for {mint[:8]}: {e}")
        
        # 4. Update timestamp
        token_meta.last_checked_at = datetime.utcnow()
        
        # 5. Get final values from metadata
        final_token_symbol = token_meta.token_symbol or mint[:8]
        final_token_name = token_meta.token_name or "Unknown"
        final_token_logo = token_meta.token_logo
        current_price = token_meta.price_usd or 0.0001
        
        # Update token amount with correct decimals if needed
        if dex_data and dex_data.get("decimals"):
            try:
                actual_decimals = int(dex_data["decimals"])
                if actual_decimals != decimals:
                    decimals = actual_decimals
                    token_amount = swap["out_amount"] / (10 ** decimals)
            except:
                pass
        
        # ===================================================================
        # Create trade record with proper metadata
        # ===================================================================
        # Create explorer URLs
        explorer_urls = {
            "solscan": f"https://solscan.io/tx/{swap['signature']}",
            "dexScreener": token_meta.dexscreener_url or f"https://dexscreener.com/solana/{mint}",
            "jupiter": f"https://jup.ag/token/{mint}"
        }
        
        trade = Trade(
            user_wallet_address=user.wallet_address,
            mint_address=mint,
            token_symbol=final_token_symbol,
            trade_type="buy",
            amount_sol=user.buy_amount_sol,
            amount_tokens=token_amount,
            price_usd_at_trade=current_price,
            buy_timestamp=datetime.utcnow(),
            take_profit=user.sell_take_profit_pct,
            stop_loss=user.sell_stop_loss_pct,
            token_amounts_purchased=token_amount,
            token_decimals=decimals,
            liquidity_at_buy=token_meta.liquidity_usd or 0,
            # Store buy URLs
            slippage_bps=slippage_bps,
            solscan_buy_url=explorer_urls["solscan"],
            dexscreener_url=explorer_urls["dexScreener"],
            jupiter_url=explorer_urls["jupiter"],
            # Set buy transaction hash
            buy_tx_hash=swap.get('signature'),
            # Fee tracking
            fee_applied=swap.get("fee_applied", False),
            fee_amount=float(swap.get("estimated_referral_fee", 0)) if swap.get("estimated_referral_fee") else None,
            fee_percentage=float(swap.get("fee_percentage", 0.0)) if swap.get("fee_percentage") else None,
            fee_bps=swap.get("fee_bps", None),
            fee_mint=swap.get("fee_mint", None),
            fee_collected_at=datetime.utcnow() if swap.get("fee_applied") else None
        )
        db.add(trade)
        await db.commit()

        logger.info(f"✅ Trade saved to database with ID: {trade.id}")
        
        # ===================================================================
        # Send metadata to frontend immediately
        # ===================================================================
        metadata_alert = {
            "type": "token_metadata_update",
            "mint": mint,
            "symbol": final_token_symbol,
            "name": final_token_name,
            "logo": final_token_logo,
            "price_usd": current_price,
            "liquidity_usd": token_meta.liquidity_usd,
            "market_cap": token_meta.market_cap,
            "dexscreener_url": token_meta.dexscreener_url,
            "twitter": token_meta.twitter,
            "telegram": token_meta.telegram,
            "website": token_meta.websites,
            "webacy_risk_score": token_meta.webacy_risk_score,
            "timestamp": datetime.utcnow().isoformat()
        }
        
        await websocket_manager.send_personal_message(json.dumps(metadata_alert), user.wallet_address)
        
        # Send trade update with proper metadata
        await websocket_manager.send_personal_message(json.dumps({
            "type": "trade_update",
            "trade": {
                "id": f"buy-{trade.id}-{datetime.utcnow().timestamp()}",
                "type": "buy",
                "mint_address": mint,
                "token_symbol": final_token_symbol,
                "token_logo": final_token_logo,
                "amount_sol": user.buy_amount_sol,
                "amount_tokens": token_amount,
                "tx_hash": swap["signature"],
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "explorer_urls": explorer_urls,
                "is_immediate_snipe": True,
                "metadata_fetched": True
            }
        }), user.wallet_address)
        
        # Also send a simple success message
        await websocket_manager.send_personal_message(json.dumps({
            "type": "log",
            "log_type": "success",
            "message": f"✅ Immediate snipe successful! {token_amount:.2f} {final_token_symbol} tokens purchased.",
            "timestamp": datetime.utcnow().isoformat()
        }), user.wallet_address)
        
        # Send monitoring started message WITH PROPER TOKEN SYMBOL
        await websocket_manager.send_personal_message(json.dumps({
            "type": "log",
            "log_type": "info",
            "message": f"📈 Monitoring {final_token_symbol} for take profit ({user.sell_take_profit_pct}%) or stop loss ({user.sell_stop_loss_pct}%)",
            "timestamp": datetime.utcnow().isoformat()
        }), user.wallet_address)

        logger.info(f"🎯 Creating monitor task for {final_token_symbol} ({mint[:8]}) | Trade ID: {trade.id}")

        # Start monitoring with proper metadata
        try:
            # Start monitoring with new session approach
            asyncio.create_task(
                start_monitor_for_trade(
                    trade=trade,
                    user=user,
                    entry_price_usd=current_price,
                    token_decimals=decimals,
                    token_amount=token_amount
                )
            )
            
            # Send monitor started message with proper metadata
            await websocket_manager.send_personal_message(json.dumps({
                "type": "monitor_started",
                "trade_id": trade.id,
                "mint": mint,
                "symbol": final_token_symbol,
                "entry_price": current_price,
                "timestamp": datetime.utcnow().isoformat(),
                "is_immediate_snipe": True,
                "metadata_fetched": True
            }), user.wallet_address)
            
        except Exception as e:
            logger.error(f"Failed to start monitor for {mint}: {e}")
            await websocket_manager.send_personal_message(json.dumps({
                "type": "log",
                "log_type": "warning",
                "message": f"⚠️ Buy successful but monitor failed to start: {str(e)[:100]}",
                "timestamp": datetime.utcnow().isoformat()
            }), user.wallet_address)

    except Exception as e:
        logger.error(f"🚨 IMMEDIATE BUY FAILED for {mint}: {e}", exc_info=True)
        error_msg = str(e)
        
        # Provide helpful error messages
        if "6025" in error_msg:
            user_friendly_msg = f"Immediate buy failed: Low liquidity. Try 0.2+ SOL."
        elif "JUPITER_API_KEY" in error_msg:
            user_friendly_msg = f"Immediate buy failed: Jupiter API key issue."
        elif "insufficient" in error_msg.lower():
            user_friendly_msg = f"Immediate buy failed: Insufficient liquidity."
        else:
            user_friendly_msg = f"Immediate buy failed: {error_msg[:80]}"
        
        await websocket_manager.send_personal_message(json.dumps({
            "type": "log", 
            "log_type": "error",
            "message": user_friendly_msg,
            "timestamp": datetime.utcnow().isoformat()
        }), user.wallet_address)
        
        logger.error(f"Detailed immediate buy error for {mint}: {error_msg}")
        raise
        
    finally:
        await redis_client.delete(lock_key)

        
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
       
#         # 🔥 FIX: Use buy_timestamp for timeout calculation (fallback to now if missing)
#         timing_base = trade.buy_timestamp if trade.buy_timestamp else datetime.utcnow()
#         amount_lamports = int(token_amount * (10 ** token_decimals)) # Full amount
#         mint = trade.mint_address
#         peak_price = entry_price_usd # Track highest price for trailing SL
       
#         # Get initial liquidity from the trade
#         initial_liquidity = trade.liquidity_at_buy or 0 # From buy time
#         # Log that monitoring has started
#         logger.info(f"🚀 MONITOR STARTED for {mint[:8]}... | Trade ID: {trade.id}")
#         logger.info(f" User: {user.wallet_address[:8]}")
#         logger.info(f" Entry price: ${entry_price_usd:.6f}")
#         logger.info(f" Token amount: {token_amount:.2f} ({amount_lamports} lamports)")
#         logger.info(f" User timeout (initial): {user.sell_timeout_seconds}s")
#         logger.info(f" User take profit: {user.sell_take_profit_pct}%")
#         logger.info(f" User stop loss: {user.sell_stop_loss_pct}%")
#         logger.info(f" Timing base (buy time): {timing_base}")
       
#         # Send monitoring started message to frontend
#         await websocket_manager.send_personal_message(json.dumps({
#             "type": "log",
#             "log_type": "info",
#             "message": f"📈 Monitoring started for {trade.token_symbol or mint[:8]}...",
#             "timestamp": datetime.utcnow().isoformat()
#         }), user.wallet_address)
#         iteration = 0
       
#         while True:
#             iteration += 1
           
#             # Create a NEW session for each iteration to avoid stale data
#             async with AsyncSessionLocal() as session:
#                 try:
#                     # REFRESH USER EVERY LOOP ← THIS FIXES TIMEOUT
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
#                             "timestamp": datetime.utcnow().isoformat()
#                         }), user.wallet_address)
#                         break
                   
#                     # Check if trade already sold (edge case) - use fresh query
#                     trade_result = await session.execute(
#                         select(Trade).where(Trade.id == trade_id)
#                     )
#                     current_trade = trade_result.scalar_one_or_none()
                   
#                     if not current_trade:
#                         logger.warning(f"Trade {mint[:8]}... no longer in DB, stopping monitor")
#                         await websocket_manager.send_personal_message(json.dumps({
#                             "type": "log",
#                             "log_type": "warning",
#                             "message": f"⚠️ Trade {trade.token_symbol or mint[:8]} no longer exists, stopping monitor",
#                             "timestamp": datetime.utcnow().isoformat()
#                         }), user.wallet_address)
#                         break
                       
#                     if current_trade.sell_timestamp:
#                         logger.info(f"Trade {mint[:8]}... already sold at {current_trade.sell_timestamp}, stopping monitor")
#                         await websocket_manager.send_personal_message(json.dumps({
#                             "type": "log",
#                             "log_type": "info",
#                             "message": f"✅ Position already sold, stopping monitor",
#                             "timestamp": datetime.utcnow().isoformat()
#                         }), user.wallet_address)
#                         break
#                     # Fetch current price
#                     dex = await get_cached_price(mint)
#                     if not dex or not dex.get("priceUsd"):
#                         logger.debug(f"No price data for {mint[:8]}... - waiting")
#                         await asyncio.sleep(5)
#                         continue
#                     price = float(dex["priceUsd"])
#                     if entry_price_usd <= 0 or price <= 0:
#                         logger.debug(f"Invalid price for {mint[:8]}... - entry: ${entry_price_usd}, current: ${price}")
#                         await asyncio.sleep(5)
#                         continue
                   
#                     # Calculate PnL
#                     pnl = (price / entry_price_usd - 1) * 100
#                     peak_price = max(peak_price, price) # Update peak
#                     # Log current status every 10 iterations or 30 seconds
#                     # Log current status every 10 iterations or 30 seconds
#                     if iteration % 10 == 0 or (datetime.utcnow() - timing_base).total_seconds() > 30:
#                         logger.info(f"📊 Monitor {mint[:8]}...: ${price:.6f} | PnL: {pnl:.2f}% | TP: {user.sell_take_profit_pct}% | SL: {user.sell_stop_loss_pct}% | Peak: ${peak_price:.6f}")
                       
#                         # Send heartbeat to frontend
#                         await websocket_manager.send_personal_message(json.dumps({
#                             "type": "position_update",
#                             "mint": mint,
#                             "current_price": price,
#                             "pnl_percent": round(pnl, 2),
#                             "entry_price": entry_price_usd,
#                             "peak_price": peak_price,
#                             "timestamp": datetime.utcnow().isoformat()
#                         }), user.wallet_address)
                        
#                     sell_reason = None
#                     sell_partial = False
#                     sell_amount_lamports = amount_lamports # Default full sell
#                     # 🔥 FIX: Calculate elapsed from buy time
#                     elapsed = (datetime.utcnow() - timing_base).total_seconds()
                    
#                     # 🔥 DEBUG: Add this to see actual values
#                     logger.info(f"TIMEOUT CHECK: User={user.wallet_address}, elapsed={elapsed:.1f}s, timeout={user.sell_timeout_seconds}s, should_sell={elapsed > user.sell_timeout_seconds}")
#                     logger.info(f"Monitor iteration {iteration} for {mint[:8]}: Elapsed {elapsed:.2f}s / Timeout {user.sell_timeout_seconds}s | PNL {pnl:.2f}%")
                    
#                     # DEBUG: Log elapsed and timeout every iteration
#                     logger.info(f"DEBUG: Elapsed from buy: {elapsed:.0f}s | Current timeout setting: {user.sell_timeout_seconds}s")
#                     # Test: Move timeout to FIRST check
#                     if user.sell_timeout_seconds and elapsed > user.sell_timeout_seconds:
#                         sell_reason = "Timeout"
#                         logger.info(f"⏰ TIMEOUT for {mint[:8]}...: {elapsed:.0f}s > {user.sell_timeout_seconds}s")

#                     # 1. Take Profit / Early Profit: Partial sell if hits user TP
#                     elif user.sell_take_profit_pct and pnl >= user.sell_take_profit_pct:
#                         sell_reason = "Take Profit"
#                         sell_partial = True if user.partial_sell_pct and user.partial_sell_pct < 100 else False
#                         if sell_partial:
#                             sell_amount_lamports = int(amount_lamports * (user.partial_sell_pct / 100))
#                         logger.info(f"🎯 TAKE PROFIT TRIGGERED for {mint[:8]}...: PnL {pnl:.2f}% >= {user.sell_take_profit_pct}% {'| Partial sell' if sell_partial else ''}")
                        
#                     # 2. Stop Loss (Fixed + Trailing)
#                     elif user.sell_stop_loss_pct and pnl <= -user.sell_stop_loss_pct:
#                         sell_reason = "Stop Loss"
#                         logger.info(f"🛑 STOP LOSS TRIGGERED for {mint[:8]}...: PnL {pnl:.2f}% <= -{user.sell_stop_loss_pct}%")
                   
#                     # 3. Trailing Stop Loss
#                     elif user.trailing_sl_pct:
#                         trail_pnl = (price / peak_price - 1) * 100
#                         if trail_pnl <= -user.trailing_sl_pct:
#                             sell_reason = "Trailing SL"
#                             logger.info(f"📉 TRAILING SL HIT: Drop {trail_pnl:.2f}% from peak ${peak_price:.6f}")
                            
#                     # 4. Basic Rug Detection: Liquidity drop
#                     elif user.rug_liquidity_drop_pct:
#                         current_liquidity = safe_float(dex.get("liquidity_usd", 0))
#                         if current_liquidity > 0 and current_liquidity < initial_liquidity * (1 - user.rug_liquidity_drop_pct / 100):
#                             sell_reason = "Rug Detected (Liquidity Drop)"
#                             logger.warning(f"🚨 RUG DETECTED: Liquidity dropped to ${current_liquidity:.2f} from ${initial_liquidity:.2f}")
   
#                         # Send sell notification
#                         await websocket_manager.send_personal_message(json.dumps({
#                             "type": "log",
#                             "log_type": "warning",
#                             "message": f"🚨 Selling {trade.token_symbol or mint[:8]} - {sell_reason} triggered (PnL: {pnl:.2f}%)",
#                             "timestamp": datetime.utcnow().isoformat()
#                         }), user.wallet_address)
                       
#                         # Update slippage based on current liquidity
#                         slippage_bps = int(user.sell_slippage_bps) if user.sell_slippage_bps else 500 # Default 5%
#                         liquidity_usd = 0.0
                       
#                         try:
#                             dex = await get_cached_price(mint)
#                             if dex and "liquidity" in dex and isinstance(dex["liquidity"], dict):
#                                 liquidity_value = dex["liquidity"].get("usd", 0)
#                                 try:
#                                     liquidity_usd = float(liquidity_value)
#                                 except (ValueError, TypeError):
#                                     liquidity_usd = 0.0
#                         except Exception as e:
#                             logger.debug(f"Failed to fetch liquidity for {mint[:8]}: {e}")
                       
#                         if liquidity_usd < 50000.0: # Low liquidity
#                             slippage_bps = min(1500, slippage_bps * 3) # Triple slippage but max 15%
#                             logger.info(f"Low liquidity (${liquidity_usd:.0f}) → Using {slippage_bps}bps slippage")
                           
#                         # Execute sell (use sell_amount_lamports for partial)
#                         try:
#                             swap = await execute_jupiter_swap(
#                                 user=user,
#                                 input_mint=mint,
#                                 output_mint=settings.SOL_MINT,
#                                 amount=sell_amount_lamports,
#                                 slippage_bps=slippage_bps,
#                                 label="SELL",
#                             )
#                         except Exception as swap_error:
#                             logger.error(f"SELL failed for {mint}: {swap_error}")
                           
#                             # Send error message to user
#                             await websocket_manager.send_personal_message(json.dumps({
#                                 "type": "log",
#                                 "log_type": "error",
#                                 "message": f"❌ Sell failed: {str(swap_error)[:100]}",
#                                 "timestamp": datetime.utcnow().isoformat()
#                             }), user.wallet_address)
                           
#                             # Check if it's a liquidity error
#                             error_msg = str(swap_error)
#                             if "6025" in error_msg or "insufficient liquidity" in error_msg.lower():
#                                 logger.warning(f"Low liquidity for {mint[:8]} - waiting 30s before retry")
#                                 await asyncio.sleep(30)
#                             else:
#                                 # Wait and retry on next iteration
#                                 await asyncio.sleep(10)
#                             continue
                       
#                         # Prepare sell explorer URL
#                         sell_explorer_url = f"https://solscan.io/tx/{swap.get('signature')}"
                       
#                         # Calculate profit
#                         profit_usd = (price - entry_price_usd) * (sell_amount_lamports / (10 ** token_decimals))
                       
#                         # Update trade record
#                         if sell_partial:
#                             # Update remaining amount for continued monitoring
#                             amount_lamports -= sell_amount_lamports
#                             token_amount -= (sell_amount_lamports / (10 ** token_decimals))
                           
#                             # Update the trade in database
#                             current_trade.amount_tokens = token_amount
#                             current_trade.profit_usd = (current_trade.profit_usd or 0) + round(profit_usd, 4)
#                             current_trade.sell_reason = f"{sell_reason} (Partial)"
                           
#                             # 🔥 Store fee information if applied
#                             if swap.get("fee_applied"):
#                                 current_trade.fee_applied = True
#                                 current_trade.fee_amount = swap.get("estimated_referral_fee", 0)
#                                 current_trade.fee_percentage = swap.get("fee_percentage", 0.0)
#                                 current_trade.fee_bps = swap.get("fee_bps", None)
#                                 current_trade.fee_mint = swap.get("fee_mint", None)
#                                 current_trade.fee_collected_at = datetime.utcnow()
                               
#                                 # Log fee collection
#                                 logger.info(f"💰 1% fee collected on PARTIAL SELL: {swap.get('estimated_referral_fee', 0)}")
                               
#                                 # Send fee notification
#                                 await websocket_manager.send_personal_message(json.dumps({
#                                     "type": "log",
#                                     "log_type": "info",
#                                     "message": f"💰 1% fee applied to this partial sell transaction",
#                                     "timestamp": datetime.utcnow().isoformat()
#                                 }), user.wallet_address)
                           
#                             await session.commit()
#                             logger.info(f"✅ PARTIAL SELL: Remaining {token_amount:.2f} tokens")
                           
#                             # Send success message
#                             await websocket_manager.send_personal_message(json.dumps({
#                                 "type": "log",
#                                 "log_type": "success",
#                                 "message": f"✅ Partial sell ({user.partial_sell_pct if sell_partial else 100}%)! Profit: ${profit_usd:.4f} ({pnl:.2f}%) | Remaining holds until timeout.",
#                                 "timestamp": datetime.utcnow().isoformat()
#                             }), user.wallet_address)
                           
#                             # Continue monitoring remainder
#                             continue
                       
#                         else:
#                             # Full sell: Close position
#                             current_trade.sell_timestamp = datetime.utcnow()
#                             current_trade.sell_reason = sell_reason
#                             current_trade.sell_tx_hash = swap.get("signature")
#                             current_trade.price_usd_at_trade = price
#                             current_trade.profit_usd = round(profit_usd, 4)
#                             current_trade.solscan_sell_url = sell_explorer_url
                           
#                             # 🔥 Store fee information if applied
#                             if swap.get("fee_applied"):
#                                 current_trade.fee_applied = True
#                                 current_trade.fee_amount = swap.get("estimated_referral_fee", 0)
#                                 current_trade.fee_percentage = swap.get("fee_percentage", 0.0)
#                                 current_trade.fee_bps = swap.get("fee_bps", None)
#                                 current_trade.fee_mint = swap.get("fee_mint", None)
#                                 current_trade.fee_collected_at = datetime.utcnow()
                               
#                                 # Log fee collection
#                                 logger.info(f"💰 1% fee collected on SELL: {swap.get('estimated_referral_fee', 0)}")
                           
#                             await session.commit()
                           
#                             # Send trade instruction to frontend
#                             trade_instruction = {
#                                 "type": "trade_instruction",
#                                 "action": "sell",
#                                 "mint": mint,
#                                 "reason": sell_reason,
#                                 "pnl_pct": round(pnl, 2),
#                                 "profit_usd": round(profit_usd, 4),
#                                 "raw_tx_base64": swap["raw_tx_base64"],
#                                 "signature": swap["signature"],
#                                 "solscan_url": f"https://solscan.io/tx/{swap['signature']}"
#                             }
#                             if swap.get("fee_applied"):
#                                 trade_instruction["fee_applied"] = True
#                             else:
#                                 trade_instruction["fee_applied"] = False
                           
#                             await websocket_manager.send_personal_message(json.dumps(trade_instruction), user.wallet_address)
                           
#                             # Send final sell confirmation
#                             sell_message = f"✅ Sold {trade.token_symbol or mint[:8]}! Profit: ${profit_usd:.4f} ({pnl:.2f}%)"
                           
#                             if swap.get("fee_applied"):
#                                 sell_message += f" (1% fee applied)"
                           
#                             await websocket_manager.send_personal_message(json.dumps({
#                                 "type": "log",
#                                 "log_type": "success",
#                                 "message": sell_message,
#                                 "timestamp": datetime.utcnow().isoformat()
#                             }), user.wallet_address)
                           
#                             logger.info(f"✅ SELL COMPLETED for {mint[:8]}... - Signature: {swap.get('signature', 'Unknown')}")
#                             break
#                     # Wait before next check
#                     await asyncio.sleep(4) # Check every 4 seconds
                   
#                 except Exception as e:
#                     logger.error(f"Monitor error for {mint} on iteration {iteration}: {e}", exc_info=True)
#                     await asyncio.sleep(10)
                   
#                     # After too many errors, check if we should stop
#                     if iteration > 100: # ~10 minutes of errors
#                         logger.error(f"Too many monitor errors for {mint}, stopping")
#                         await websocket_manager.send_personal_message(json.dumps({
#                             "type": "log",
#                             "log_type": "error",
#                             "message": f"❌ Monitor stopped due to errors for {trade.token_symbol or mint[:8]}",
#                             "timestamp": datetime.utcnow().isoformat()
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
    Creates its own database session to avoid session closure issues.
    """
    
    if token_amount <= 0:
        logger.warning(f"Invalid token_amount {token_amount} for {trade.mint_address} – skipping monitor")
        return
    
    # Track the main session
    main_session = None
    
    try:
        # Create a new database session for this monitor
        main_session = AsyncSessionLocal()
        
        # Get the trade ID from the passed trade object
        trade_id = trade.id
        
        if not trade_id:
            logger.error(f"Trade ID is missing for {trade.mint_address}")
            await websocket_manager.send_personal_message(json.dumps({
                "type": "log",
                "log_type": "error",
                "message": f"❌ Monitor failed: Trade ID missing for {trade.mint_address[:8]}",
                "timestamp": datetime.utcnow().isoformat()
            }), user.wallet_address)
            return
        
        # Fetch trade FRESH from database using the ID
        trade_result = await main_session.execute(
            select(Trade).where(Trade.id == trade_id)
        )
        db_trade = trade_result.scalar_one_or_none()
        
        if not db_trade:
            logger.error(f"Trade {trade_id} not found in database for {trade.mint_address}")
            await websocket_manager.send_personal_message(json.dumps({
                "type": "log",
                "log_type": "error",
                "message": f"❌ Monitor failed: Trade {trade_id} not found in database",
                "timestamp": datetime.utcnow().isoformat()
            }), user.wallet_address)
            return
        
        # Now we have fresh objects in our new session
        trade = db_trade
        
        # 🔥 CRITICAL: Get the EXACT buy timestamp from the trade
        timing_base = trade.buy_timestamp if trade.buy_timestamp else datetime.utcnow()
        amount_lamports = int(token_amount * (10 ** token_decimals))  # Full amount
        mint = trade.mint_address
        
        # Get user's timeout setting - REFRESH EVERY LOOP
        user_result = await main_session.execute(
            select(User).where(User.wallet_address == user.wallet_address)
        )
        current_user = user_result.scalar_one_or_none()
        
        if not current_user:
            logger.error(f"User {user.wallet_address} not found during monitor setup")
            return
        
        timeout_seconds = current_user.sell_timeout_seconds or 3600  # Default 1 hour
        take_profit_pct = current_user.sell_take_profit_pct or 50.0
        stop_loss_pct = current_user.sell_stop_loss_pct or 20.0
        
        # Log that monitoring has started with CLEAR timeout info
        logger.info(f"🚀 MONITOR STARTED for {mint[:8]}... | Trade ID: {trade.id}")
        logger.info(f"  User: {user.wallet_address[:8]}")
        logger.info(f"  Buy time: {timing_base}")
        logger.info(f"  Timeout: {timeout_seconds}s (Will auto-sell at: {timing_base + timedelta(seconds=timeout_seconds)})")
        logger.info(f"  Take profit: {take_profit_pct}%")
        logger.info(f"  Stop loss: {stop_loss_pct}%")
        logger.info(f"  Token amount: {token_amount:.2f}")
        
        # Send monitoring started message to frontend
        await websocket_manager.send_personal_message(json.dumps({
            "type": "log",
            "log_type": "info",
            "message": f"📈 Monitoring {trade.token_symbol or mint[:8]}... | Auto-sell in {timeout_seconds}s",
            "timestamp": datetime.utcnow().isoformat()
        }), user.wallet_address)
        
        iteration = 0
        
        while True:
            iteration += 1
            current_time = datetime.utcnow()
            
            # Create a NEW session for each iteration
            async with AsyncSessionLocal() as session:
                try:
                    # REFRESH USER EVERY LOOP (CRITICAL FOR TIMEOUT)
                    user_result = await session.execute(
                        select(User).where(User.wallet_address == user.wallet_address)
                    )
                    user = user_result.scalar_one_or_none()
                    
                    if not user:
                        logger.error(f"User disappeared during monitoring: {user.wallet_address}")
                        await websocket_manager.send_personal_message(json.dumps({
                            "type": "log",
                            "log_type": "error",
                            "message": f"❌ User not found, stopping monitor",
                            "timestamp": current_time.isoformat()
                        }), user.wallet_address)
                        break
                    
                    # Get latest timeout from user
                    timeout_seconds = user.sell_timeout_seconds or 3600
                    
                    # Check if trade already sold
                    trade_result = await session.execute(
                        select(Trade).where(Trade.id == trade_id)
                    )
                    current_trade = trade_result.scalar_one_or_none()
                    
                    if not current_trade:
                        logger.warning(f"Trade {mint[:8]}... no longer in DB, stopping monitor")
                        break
                    
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
                    # 🎯 CHECK #1: TIMEOUT - THIS IS THE MAIN FIX
                    # ============================================================
                    elapsed_seconds = (current_time - timing_base).total_seconds()
                    
                    # DEBUG: Log timeout status every 10 iterations
                    if iteration % 10 == 0:
                        time_left = max(0, timeout_seconds - elapsed_seconds)
                        logger.info(f"⏰ Timeout check for {mint[:8]}: {elapsed_seconds:.0f}s / {timeout_seconds}s ({(elapsed_seconds/timeout_seconds*100):.1f}%)")
                    
                    # TIMEOUT TRIGGER - This MUST happen regardless of price
                    # if elapsed_seconds >= timeout_seconds:
                    #     logger.info(f"⏰ TIMEOUT REACHED for {mint[:8]}: {elapsed_seconds:.0f}s >= {timeout_seconds}s")
                        
                    #     # Fetch current price for reporting
                    #     dex = await get_cached_price(mint)
                    #     current_price = 0
                    #     pnl = 0
                        
                    #     if dex and dex.get("priceUsd"):
                    #         current_price = float(dex["priceUsd"])
                    #         if entry_price_usd > 0:
                    #             pnl = (current_price / entry_price_usd - 1) * 100
                        
                    #     # Send timeout notification
                    #     await websocket_manager.send_personal_message(json.dumps({
                    #         "type": "log",
                    #         "log_type": "warning",
                    #         "message": f"⏰ TIMEOUT: Selling {trade.token_symbol or mint[:8]} after {timeout_seconds}s (PnL: {pnl:.2f}%)",
                    #         "timestamp": current_time.isoformat()
                    #     }), user.wallet_address)
                        
                    #     # Execute the sell
                    #     await execute_timeout_sell(user, mint, amount_lamports, trade_id, session, 
                    #                               entry_price_usd, current_price, pnl, websocket_manager)
                        
                    #     # Monitor job is done
                    #     break
                    
                    
                    # TIMEOUT TRIGGER - This MUST happen regardless of price
                    if elapsed_seconds >= timeout_seconds:
                        logger.info(f"⏰ TIMEOUT REACHED for {mint[:8]}: {elapsed_seconds:.0f}s >= {timeout_seconds}s")
                        
                        # 🔥 FIX: Get current price for PnL calculation
                        dex = await get_cached_price(mint)
                        current_price = 0
                        
                        if dex and dex.get("priceUsd"):
                            current_price = float(dex["priceUsd"])
                        
                        # Calculate PnL based on ACTUAL entry price from trade
                        if trade.price_usd_at_trade and current_price > 0:
                            pnl = (current_price / trade.price_usd_at_trade - 1) * 100
                        else:
                            pnl = 0
                        
                        # Send timeout notification with REAL PnL
                        await websocket_manager.send_personal_message(json.dumps({
                            "type": "log",
                            "log_type": "warning",
                            "message": f"⏰ TIMEOUT: Selling {trade.token_symbol or mint[:8]} after {timeout_seconds}s (PnL: {pnl:.2f}%)",
                            "timestamp": current_time.isoformat()
                        }), user.wallet_address)
                        
                        # Execute the sell with CORRECT PnL
                        await execute_timeout_sell(user, mint, amount_lamports, trade_id, session, 
                                                trade.price_usd_at_trade or entry_price_usd, 
                                                current_price, pnl, websocket_manager)
                        
                        # Monitor job is done
                        break
                    
                    # ============================================================
                    # CHECK #2: PRICE-BASED CONDITIONS (only if not timed out)
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
                    pnl = (current_price / entry_price_usd - 1) * 100
                    
                    # Log current status periodically
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
                    
                    sell_reason = None
                    sell_partial = False
                    sell_amount_lamports = amount_lamports
                    
                    # 2A. Take Profit
                    if user.sell_take_profit_pct and pnl >= user.sell_take_profit_pct:
                        sell_reason = "Take Profit"
                        if user.partial_sell_pct and user.partial_sell_pct < 100:
                            sell_partial = True
                            sell_amount_lamports = int(amount_lamports * (user.partial_sell_pct / 100))
                        logger.info(f"🎯 TAKE PROFIT for {mint[:8]}: PnL {pnl:.2f}% >= {user.sell_take_profit_pct}%")
                    
                    # 2B. Stop Loss
                    elif user.sell_stop_loss_pct and pnl <= -user.sell_stop_loss_pct:
                        sell_reason = "Stop Loss"
                        logger.info(f"🛑 STOP LOSS for {mint[:8]}: PnL {pnl:.2f}% <= -{user.sell_stop_loss_pct}%")
                    
                    # 2C. Execute sell if any price condition met
                    if sell_reason:
                        await execute_price_based_sell(
                            user, mint, sell_amount_lamports, trade_id, session,
                            entry_price_usd, current_price, pnl, sell_reason, sell_partial,
                            token_decimals, websocket_manager
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
                    await asyncio.sleep(10)
                    
                    # After too many errors, check if we should stop
                    if iteration > 100:  # ~10 minutes of errors
                        logger.error(f"Too many monitor errors for {mint}, stopping")
                        await websocket_manager.send_personal_message(json.dumps({
                            "type": "log",
                            "log_type": "error",
                            "message": f"❌ Monitor stopped due to errors for {trade.token_symbol or mint[:8]}",
                            "timestamp": current_time.isoformat()
                        }), user.wallet_address)
                        break
            
            # Session auto-closes here due to context manager
        
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
        # Always close the main session if it exists
        if main_session:
            await main_session.close()


# async def execute_timeout_sell(user: User, mint: str, amount_lamports: int, trade_id: int, 
#                               session: AsyncSession, entry_price: float, current_price: float,
#                               pnl: float, websocket_manager: ConnectionManager):
#     """Execute a sell due to timeout"""
#     try:
#         logger.info(f"🔄 Executing TIMEOUT sell for {mint[:8]}...")
        
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
        
#         # Update trade record
#         trade_result = await session.execute(
#             select(Trade).where(Trade.id == trade_id)
#         )
#         trade = trade_result.scalar_one_or_none()
        
#         if trade:
#             trade.sell_timestamp = datetime.utcnow()
#             trade.sell_reason = "Timeout"
#             trade.sell_tx_hash = swap.get("signature")
#             trade.price_usat_trade = current_price
#             trade.profit_usd = (current_price - entry_price) * (amount_lamports / (10 ** 9))  # Approximate
            
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
        
#         # Send success message
#         await websocket_manager.send_personal_message(json.dumps({
#             "type": "log",
#             "log_type": "success",
#             "message": f"✅ TIMEOUT SELL: Sold {mint[:8]} after timeout. PnL: {pnl:.2f}%",
#             "timestamp": datetime.utcnow().isoformat()
#         }), user.wallet_address)
        
#         # Send trade instruction to frontend
#         await websocket_manager.send_personal_message(json.dumps({
#             "type": "trade_instruction",
#             "action": "sell",
#             "mint": mint,
#             "reason": "Timeout",
#             "pnl_pct": round(pnl, 2),
#             "profit_usd": trade.profit_usd if trade else 0,
#             "signature": swap["signature"],
#             "solscan_url": f"https://solscan.io/tx/{swap['signature']}"
#         }), user.wallet_address)
        
#         logger.info(f"✅ TIMEOUT SELL COMPLETED for {mint[:8]}")
        
#     except Exception as e:
#         logger.error(f"❌ TIMEOUT SELL FAILED for {mint[:8]}: {e}")
#         await websocket_manager.send_personal_message(json.dumps({
#             "type": "log",
#             "log_type": "error",
#             "message": f"❌ Timeout sell failed: {str(e)[:100]}",
#             "timestamp": datetime.utcnow().isoformat()
#         }), user.wallet_address)


async def execute_timeout_sell(user: User, mint: str, amount_lamports: int, trade_id: int, 
                              session: AsyncSession, entry_price: float, current_price: float,
                              pnl: float, websocket_manager: ConnectionManager):
    """Execute a sell due to timeout"""
    try:
        logger.info(f"🔄 Executing TIMEOUT sell for {mint[:8]}...")
        
        # 🔥 CRITICAL FIX: Get ACTUAL current price from DexScreener
        dex_data = await get_cached_price(mint)
        actual_current_price = 0
        
        if dex_data and dex_data.get("priceUsd"):
            actual_current_price = float(dex_data["priceUsd"])
        else:
            # Try to fetch fresh data
            dex_data = await fetch_dexscreener_with_retry(mint)
            if dex_data and dex_data.get("price_usd"):
                actual_current_price = float(dex_data["price_usd"])
        
        # 🔥 CRITICAL FIX: Get the trade with ALL details including token decimals
        trade_result = await session.execute(
            select(Trade).where(Trade.id == trade_id)
        )
        trade = trade_result.scalar_one_or_none()
        
        if not trade:
            logger.error(f"Trade {trade_id} not found for timeout sell")
            return
        
        # Get correct decimals
        token_decimals = trade.token_decimals or 9
        
        # 🔥 CRITICAL FIX: Get actual entry price from trade, not passed parameter
        actual_entry_price = trade.price_usd_at_trade or entry_price
        
        # Calculate REAL PnL
        if actual_entry_price > 0 and actual_current_price > 0:
            real_pnl = ((actual_current_price / actual_entry_price) - 1) * 100
        else:
            real_pnl = 0
        
        logger.info(f"📊 REAL PnL Calculation: Entry=${actual_entry_price:.10f}, Current=${actual_current_price:.10f}, PnL={real_pnl:.2f}%")
        
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
        
        # Calculate profit in USD
        token_amount = amount_lamports / (10 ** token_decimals)
        profit_usd = (actual_current_price - actual_entry_price) * token_amount
        
        # Update trade record with CORRECT values
        if trade:
            trade.sell_timestamp = datetime.utcnow()
            trade.sell_reason = "Timeout"
            trade.sell_tx_hash = swap.get("signature")
            trade.price_usd_at_trade = actual_current_price  # Update with actual sell price
            trade.profit_usd = profit_usd
            trade.profit_sol = profit_usd / actual_current_price if actual_current_price > 0 else 0
            
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
            "message": f"✅ TIMEOUT SELL: Sold {mint[:8]} after timeout. PnL: {real_pnl:.2f}% | Profit: ${profit_usd:.6f}",
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
            "profit_sol": profit_usd / actual_current_price if actual_current_price > 0 else 0,
            "entry_price": actual_entry_price,
            "exit_price": actual_current_price,
            "signature": swap["signature"],
            "solscan_url": f"https://solscan.io/tx/{swap['signature']}"
        }), user.wallet_address)
        
        logger.info(f"✅ TIMEOUT SELL COMPLETED for {mint[:8]} | PnL: {real_pnl:.2f}% | Profit: ${profit_usd:.6f}")
        
    except Exception as e:
        logger.error(f"❌ TIMEOUT SELL FAILED for {mint[:8]}: {e}", exc_info=True)
        await websocket_manager.send_personal_message(json.dumps({
            "type": "log",
            "log_type": "error",
            "message": f"❌ Timeout sell failed: {str(e)[:100]}",
            "timestamp": datetime.utcnow().isoformat()
        }), user.wallet_address)
        

async def execute_price_based_sell(user: User, mint: str, amount_lamports: int, trade_id: int,
                                  session: AsyncSession, entry_price: float, current_price: float,
                                  pnl: float, reason: str, is_partial: bool,
                                  token_decimals: int, websocket_manager: ConnectionManager):
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
        
        if trade:
            if is_partial:
                # Update remaining amount
                trade.amount_tokens = trade.amount_tokens - (amount_lamports / (10 ** token_decimals))
                trade.profit_usd = (trade.profit_usd or 0) + ((current_price - entry_price) * (amount_lamports / (10 ** token_decimals)))
                trade.sell_reason = f"{reason} (Partial)"
            else:
                # Full sell
                trade.sell_timestamp = datetime.utcnow()
                trade.sell_reason = reason
                trade.sell_tx_hash = swap.get("signature")
                trade.price_usat_trade = current_price
                trade.profit_usd = (current_price - entry_price) * (amount_lamports / (10 ** token_decimals))
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
        
                   
            
            