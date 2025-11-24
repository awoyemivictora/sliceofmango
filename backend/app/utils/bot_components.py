import logging
import os
import json
import base64
import asyncio
from datetime import datetime
from typing import Dict, Optional

import redis
from fastapi import WebSocket
from sqlalchemy.ext.asyncio import AsyncSession

from solders.pubkey import Pubkey
from solders.keypair import Keypair
from solana.rpc.async_api import AsyncClient

# Latest Jupiter SDK (pip install jupiter-python-sdk)
from jupiter_python_sdk.jupiter import Jupiter  # ← This is the correct import

from app.models import Trade, User, TokenMetadata
from app.utils.dexscreener_api import get_dexscreener_data
from app.config import settings
from app.security import decrypt_private_key_backend

# Logger
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))
    logger.addHandler(handler)

# Redis
redis_client = redis.Redis(host=os.getenv("REDIS_HOST", "localhost"), port=6379, db=0, decode_responses=True)


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
            except Exception:
                self.disconnect(wallet_address)


websocket_manager = ConnectionManager()


# ===================================================================
# JUPITER SWAP USING LATEST SDK (v6+ API, community wrapper)
# ===================================================================
async def execute_jupiter_swap(
    user: User,
    input_mint: str,
    output_mint: str,
    amount: int,                    # Raw lamports / smallest unit
    slippage_bps: int,
    label: str = "swap",
    db: Optional[AsyncSession] = None,
    priority_fee_micro_lamports: int = 100_000
) -> dict:
    """
    Execute swap with 1% referral fee baked in.
    """
    rpc_url = user.custom_rpc_https or settings.SOLANA_RPC_URL

    async with AsyncClient(rpc_url) as client:
        private_key_bytes = decrypt_private_key_backend(user.encrypted_private_key.encode())
        keypair = Keypair.from_bytes(private_key_bytes)

        # Initialize Jupiter SDK client
        jupiter_client = Jupiter(
            async_client=client,
            keypair=keypair,
        )

        try:
            # Step 1: Get quote WITH referral fee (1%)
            quote: dict = await jupiter_client.quote(
                input_mint=input_mint,
                output_mint=output_mint,
                amount=amount,
                slippage_bps=slippage_bps,
                # Referral params (new in v6+)
                platform_fee_bps=settings.JUPITER_PLATFORM_FEE_BPS,  # 100 = 1%
                referrer=settings.JUPITER_REFERRAL_ACCOUNT,  # Your referral pubkey
            )

            if 'error' in quote:
                raise ValueError(f"Quote error: {quote['error']}")

            # Step 2: Execute swap (inherits fee from quote)
            swap_tx_base64: str = await jupiter_client.swap(
                input_mint=input_mint,
                output_mint=output_mint,
                amount=amount,
                wrap_unwrap_sol=True,
                slippage_bps=slippage_bps,
                # Fee is already in the quote; referrer is propagated
            )

            if isinstance(swap_tx_base64, bytes):
                swap_tx_base64 = base64.b64encode(swap_tx_base64).decode("utf-8")

            # Log the fee for tracking (optional)
            estimated_fee = (int(quote.get("inAmount", amount)) * settings.JUPITER_PLATFORM_FEE_BPS) / 10000  # Rough calc
            logger.info(f"{label} fee estimated: {estimated_fee} units to {settings.JUPITER_REFERRAL_ACCOUNT}")

            return {
                "raw_tx_base64": swap_tx_base64,
                "quote": quote,
                "last_valid_block_height": quote.get("contextSlot"),
                "out_amount": int(quote.get("outAmount", 0)),
                "price_impact": quote.get("priceImpactPct", "0"),
                "in_amount": int(quote.get("inAmount", amount)),
                "estimated_referral_fee": estimated_fee,  # For your records
            }

        except Exception as e:
            logger.error(f"Jupiter {label} failed for {user.wallet_address}: {e}")
            raise

# ===================================================================
# BUY LOGIC
# ===================================================================
async def execute_user_buy(
    user: User,
    token: TokenMetadata,
    db: AsyncSession,
    websocket_manager: ConnectionManager
):
    mint = token.mint_address
    lock_key = f"buy_lock:{user.wallet_address}:{mint}"

    if await redis_client.get(lock_key):
        return  # Prevent duplicate buys

    await redis_client.setex(lock_key, 60, "1")

    try:
        amount_lamports = int(user.buy_amount_sol * 1_000_000_000)

        swap_data = await execute_jupiter_swap(
            user=user,
            input_mint=settings.SOL_MINT,
            output_mint=mint,
            amount=amount_lamports,
            slippage_bps=user.buy_slippage_bps,
            label="BUY",
            priority_fee_micro_lamports=100_000
        )

        token_amount = swap_data["out_amount"] / (10 ** (token.token_decimals or 9))

        trade = Trade(
            user_wallet_address=user.wallet_address,
            mint_address=mint,
            token_symbol=token.token_symbol or mint[:8],
            trade_type="buy",
            amount_sol_in=user.buy_amount_sol,
            amount_tokens=token_amount,
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
            "token_amount": round(token_amount, 6),
            "price_usd": token.price_usd,
        }), user.wallet_address)

        # Start monitoring for sell conditions
        asyncio.create_task(monitor_position(
            user=user,
            trade=trade,
            entry_price_usd=token.price_usd,
            token_decimals=token.token_decimals or 9,
            token_amount=token_amount,
            db=db,
            websocket_manager=websocket_manager
        ))

    except Exception as e:
        logger.error(f"Buy failed for {user.wallet_address} | {mint}: {e}")
        await websocket_manager.send_personal_message(json.dumps({
            "type": "log",
            "message": f"Buy failed: {str(e)}",
            "status": "error"
        }), user.wallet_address)
    finally:
        await redis_client.delete(lock_key)


# ===================================================================
# MONITOR + SELL LOGIC
# ===================================================================
async def monitor_position(
    user: User,
    trade: Trade,
    entry_price_usd: float,
    token_decimals: int,
    token_amount: float,
    db: AsyncSession,
    websocket_manager: ConnectionManager
):
    start_time = datetime.utcnow()
    highest_price = entry_price_usd
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

            tp_hit = user.sell_take_profit_pct and pnl_pct >= user.sell_take_profit_pct
            sl_hit = user.sell_stop_loss_pct and pnl_pct <= -user.sell_stop_loss_pct
            timeout_hit = user.sell_timeout_seconds and (datetime.utcnow() - start_time).total_seconds() > user.sell_timeout_seconds

            if tp_hit or sl_hit or timeout_hit:
                reason = "Take Profit" if tp_hit else "Stop Loss" if sl_hit else "Timeout"

                swap_data = await execute_jupiter_swap(
                    user=user,
                    input_mint=trade.mint_address,
                    output_mint=settings.SOL_MINT,
                    amount=amount_lamports,
                    slippage_bps=user.sell_slippage_bps,
                    label="SELL",
                    priority_fee_micro_lamports=200_000  # Higher fee on sell
                )

                profit_usd = (current_price - entry_price_usd) * token_amount

                trade.trade_type = "sell"
                trade.sell_timestamp = datetime.utcnow()
                trade.profit_usd = round(profit_usd, 4)
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
            logger.error(f"Monitor error for {user.wallet_address}: {e}")
            await asyncio.sleep(10)
            
            