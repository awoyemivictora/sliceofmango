import logging
import os
from typing import Dict, Optional
from fastapi import WebSocket
import redis
from fastapi import WebSocket
import json
import asyncio
from typing import Dict, Optional
from datetime import datetime
import base64
from sqlalchemy.ext.asyncio import AsyncSession
from solders.pubkey import Pubkey
from solders.keypair import Keypair
from solana.rpc.async_api import AsyncClient
from jupiter_python_sdk.jupiter import Jupiter
from app.models import Trade, User, TokenMetadata
from app.utils.dexscreener_api import get_dexscreener_data
from app.config import settings
from app.security import decrypt_private_key_backend

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


class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}

    async def connect(self, websocket: WebSocket, wallet_address: str):
        await websocket.accept()
        self.active_connections[wallet_address] = websocket

    def disconnect(self, wallet_address: str):
        self.active_connections.pop(wallet_address, None)

    async def send_personal_message(self, message: str, wallet_address: str):
        ws = self.active_connections.get(wallet_address)
        if ws:
            try:
                await ws.send_text(message)
            except:
                self.disconnect(wallet_address)

# Single global instance
websocket_manager = ConnectionManager()

# ===================================================================
# JUPITER LOGICS
# ===================================================================
async def execute_jupiter_swap(
    user: User,
    input_mint: str,
    output_mint: str,
    amount_lamports: int,
    slippage_bps: int,
    label: str = "swap",
    db: Optional[AsyncSession] = None,
    priority_fee: int = 100_000
) -> dict:
    """
    Universal Jupiter swap with 1% referral fee
    Used for BOTH buy and sell
    """
    rpc_url = user.custom_rpc_https or settings.SOLANA_RPC_URL
    async with AsyncClient(rpc_url) as client:
        private_key_bytes = decrypt_private_key_backend(user.encrypted_private_key.encode())
        keypair = Keypair.from_bytes(private_key_bytes)
        jupiter = Jupiter(client, keypair)

        quote = await jupiter.get_quote(
            input_mint=input_mint,
            output_mint=output_mint,
            amount=amount_lamports,
            slippage_bps=slippage_bps,
            platform_fee_bps=settings.JUPITER_PLATFORM_FEE_BPS  # ← 1% FEE
        )

        swap_tx = await jupiter.swap(
            quote=quote,
            user_public_key=Pubkey.from_string(user.wallet_address),
            fee_account=settings.JUPITER_FEE_ACCOUNT,  # ← YOUR REFERRAL WALLET
            priority_fee_micro_lamports=priority_fee,
            wrap_and_unwrap_sol=True
        )

        raw_tx = base64.b64encode(swap_tx.serialize()).decode()

        return {
            "raw_tx_base64": raw_tx,
            "quote": quote,
            "last_valid_block_height": quote.get("lastValidBlockHeight"),
            "out_amount": int(quote["outAmount"]),
            "price_impact": quote.get("priceImpactPct", "0"),
        }
   
async def execute_user_buy(
    user: User,
    token: TokenMetadata,
    db: AsyncSession,
    websocket_manager: ConnectionManager
):
    mint = token.mint_address
    lock_key = f"buy_lock:{user.wallet_address}:{mint}"
    if await redis_client.get(lock_key):
        return  # Already buying

    await redis_client.setex(lock_key, 60, "1")  # 60s lock

    try:
        amount_lamports = int(user.buy_amount_sol * 1_000_000_000)
        swap_data = await execute_jupiter_swap(
            user=user,
            input_mint="So11111111111111111111111111111111111111112",
            output_mint=mint,
            amount_lamports=amount_lamports,
            slippage_bps=user.buy_slippage_bps,
            label="BUY"
        )

        trade = Trade(
            user_wallet_address=user.wallet_address,
            mint_address=mint,
            token_symbol=token.token_symbol or mint[:8],
            trade_type="buy",
            amount_sol_in=user.buy_amount_sol,
            amount_tokens=swap_data["out_amount"] / (10 ** (token.token_decimals or 9)),
            price_usd_at_trade=token.price_usd,
            buy_timestamp=datetime.utcnow(),
            take_profit_target=user.sell_take_profit_pct,
            stop_loss_target=user.sell_stop_loss_pct,
            timeout_seconds=user.sell_timeout_seconds,
        )
        db.add(trade)
        await db.commit()

        await websocket_manager.send_personal_message(json.dumps({
            "type": "trade_instruction",
            "action": "buy",
            "mint": mint,
            "amount_sol": user.buy_amount_sol,
            "raw_tx_base64": swap_data["raw_tx_base64"],
            "token_amount": swap_data["out_amount"] / (10 ** (token.token_decimals or 9)),
            "price_usd": token.price_usd,
        }), user.wallet_address)

        # Auto start sell monitor
        asyncio.create_task(monitor_position(
            user=user,
            trade=trade,
            entry_price_usd=token.price_usd,
            token_decimals=token.token_decimals or 9,
            db=db,
            websocket_manager=websocket_manager
        ))

    except Exception as e:
        logger.error(f"Buy failed for {user.wallet_address}: {e}")
        await websocket_manager.send_personal_message(json.dumps({
            "type": "log", "message": f"Buy failed: {str(e)}", "status": "error"
        }), user.wallet_address)
    finally:
        await redis_client.delete(lock_key)
        
async def monitor_position(
    user: User,
    trade: Trade,
    entry_price_usd: float,
    token_decimals: int,
    db: AsyncSession,
    websocket_manager: ConnectionManager
):
    start_time = datetime.utcnow()
    highest_price = entry_price_usd
    token_amount = trade.amount_tokens or 0
    amount_lamports = int(token_amount * (10 ** token_decimals))

    while True:
        try:
            dex = await get_dexscreener_data(trade.mint_address)
            if not dex or not dex.get("price_usd"):
                await asyncio.sleep(5)
                continue

            current_price = float(dex["price_usd"])
            pnl_pct = (current_price / entry_price_usd - 1) * 100
            highest_price = max(highest_price, current_price)

            # Trailing stop
            trailing_trigger = highest_price * (1 - user.trailing_stop_loss_pct / 100)

            # Conditions
            tp_hit = user.sell_take_profit_pct and pnl_pct >= user.sell_take_profit_pct
            sl_hit = user.sell_stop_loss_pct and pnl_pct <= -user.sell_stop_loss_pct
            trail_hit = user.trailing_stop_loss_pct and current_price <= trailing_trigger
            timeout_hit = user.sell_timeout_seconds and (datetime.utcnow() - start_time).total_seconds() > user.sell_timeout_seconds

            if tp_hit or sl_hit or trail_hit or timeout_hit:
                reason = "Take Profit" if tp_hit else "Stop Loss" if sl_hit else "Trailing Stop" if trail_hit else "Timeout"

                swap_data = await execute_jupiter_swap(
                    user=user,
                    input_mint=trade.mint_address,
                    output_mint="So11111111111111111111111111111111111111112",
                    amount_lamports=amount_lamports,
                    slippage_bps=4000,  # 40% slippage on sell
                    label="SELL"
                )

                profit_usd = (current_price - entry_price_usd) * token_amount

                trade.trade_type = "sell"
                trade.sell_timestamp = datetime.utcnow()
                trade.profit_usd = profit_usd
                trade.sell_reason = reason
                await db.commit()

                await websocket_manager.send_personal_message(json.dumps({
                    "type": "trade_instruction",
                    "action": "sell",
                    "mint": trade.mint_address,
                    "reason": reason,
                    "pnl_pct": round(pnl_pct, 2),
                    "profit_usd": round(profit_usd, 4),
                    "raw_tx_base64": swap_data["raw_tx_base64"],
                }), user.wallet_address)

                break

            await asyncio.sleep(4)
        except Exception as e:
            logger.error(f"Monitor error: {e}")
            await asyncio.sleep(10)
            
            