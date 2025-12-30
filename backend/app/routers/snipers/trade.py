import asyncio
import base64
from datetime import datetime
from decimal import Decimal
import json
import logging
import os
from typing import Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import desc, select
import redis.asyncio as redis
from solana.rpc.async_api import AsyncClient
from solders.pubkey import Pubkey
from app.database import AsyncSessionLocal, get_db
from app.middleware.rate_limiter import rate_limited
from app.models import TokenMetadata, User, Trade
from app.dependencies import get_current_user_by_wallet
from app.config import settings
from app.schemas.snipers.bot import UpdateBotSettingsRequest
from app.schemas.snipers.trade import BulkTradeLog, GetTradeQuoteRequest, GetTradeQuoteResponse, ImmediateSnipeRequest, SendSignedTransactionRequest, SendSignedTransactionResponse
from app.utils.bot_components import execute_jupiter_swap, monitor_position, websocket_manager
from app.security import get_current_user
from app.utils import bot_components
from app.utils.bot_logger import BotLogger
from app.utils.profitability_engine import engine as profitability_engine
from app.utils.dexscreener_api import get_dexscreener_data

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/trade", tags=["Trade"])

# In-memory active bots (wallet_address → task)
active_bots: Dict[str, asyncio.Task] = {}
redis_client = redis.Redis(host=os.getenv("REDIS_HOST", "localhost"), port=6379, db=0)

# ===================================================================
# WEBSOCKET FOR REAL-TIME LOGS
# ===================================================================
@router.websocket("/ws/{wallet_address}")
async def trade_websocket(websocket: WebSocket, wallet_address: str):
    await websocket.connect(websocket, wallet_address)
    try:
        while True:
            await asyncio.sleep(1)  # Keep alive
    except WebSocketDisconnect:
        websocket.disconnect(wallet_address)


# ===================================================================
# START AUTO TRADING BOT
# ===================================================================
@router.post("/bot/start")
async def start_trading_bot(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Start persistent bot that survives browser closures"""
    # Check balance first
    try:
        async with AsyncClient(settings.SOLANA_RPC_URL) as client:
            balance_response = await client.get_balance(Pubkey.from_string(current_user.wallet_address))
            sol_balance = balance_response.value / 1_000_000_000
            
            if sol_balance < 0.3:
                raise HTTPException(
                    status_code=400, 
                    detail=f"Insufficient SOL balance: {sol_balance:.4f}. Minimum 0.3 SOL required."
                )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to check balance: {str(e)}")
    
    # Start bot directly using Redis state
    state = {
        "is_running": True,
        "last_heartbeat": datetime.utcnow().isoformat(),
        "settings": {}
    }
    await redis_client.setex(f"bot_state:{current_user.wallet_address}", 86400, json.dumps(state))
    
    return {"status": "success", "message": "Persistent trading bot started."}
    
# ===================================================================
# STOP BOT
# ===================================================================
@router.post("/bot/stop")
async def stop_trading_bot(current_user: User = Depends(get_current_user)):
    await redis_client.set(f"bot_state:{current_user.wallet_address}", json.dumps({
        "is_running": False,
        "last_heartbeat": datetime.utcnow().isoformat()
    }))
    return {"status": "success", "message": "Trading bot stopped."}


@router.get("/bot/status")
async def get_bot_status(current_user: User = Depends(get_current_user)):
    state_data = await redis_client.get(f"bot_state:{current_user.wallet_address}")
    if state_data:
        state = json.loads(state_data)
        return {
            "is_running": state.get("is_running", False),
            "last_heartbeat": state.get("last_heartbeat")
        }
    return {"is_running": False, "last_heartbeat": None}

# ===================================================================
# UPDATE BOT SETTINGS (REAL-TIME)
# ===================================================================
@router.post("/bot/settings")
async def update_bot_settings(
    settings_data: UpdateBotSettingsRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    update_fields = settings_data.dict(exclude_unset=True)
    for key, value in update_fields.items():
        if hasattr(current_user, key):
            setattr(current_user, key, value)

    await db.commit()
    BotLogger(current_user.wallet_address).send_log("Settings updated live", "info")
    return {"status": "success", "message": "Settings updated"}


# ===================================================================
# JUPITER QUOTE (BUY/SELL) — WITH REFERRAL FEE
# ===================================================================
@router.post("/quote", response_model=GetTradeQuoteResponse)
async def get_jupiter_quote(
    request: GetTradeQuoteRequest,
    current_user: User = Depends(get_current_user)
):
    try:
        amount_lamports = int(request.in_amount * 1e9) if request.token_in_address == settings.SOL_MINT else int(request.in_amount)

        swap_result = await execute_jupiter_swap(
            user=current_user,
            input_mint=request.token_in_address,
            output_mint=request.token_out_address,
            amount_lamports=amount_lamports,
            slippage_bps=request.slippage,
            priority_fee=100_000 if current_user.is_premium else 50_000
        )

        return GetTradeQuoteResponse(
            raw_tx_base64=swap_result["raw_tx_base64"],
            last_valid_block_height=swap_result["last_valid_block_height"],
            out_amount=int(swap_result["out_amount"]),
            price_impact=swap_result.get("price_impact", "0")
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Quote failed: {str(e)}")


# ===================================================================
# EXECUTE BUY (CALLED FROM BOT)
# ===================================================================
# async def execute_user_buy(
#     user: User,
#     token: TokenMetadata,
#     db: AsyncSession,
#     logger: BotLogger
# ):
#     mint = token.mint_address
#     lock_key = f"buy_lock:{user.wallet_address}:{mint}"
#     await redis_client.setex(lock_key, 120, "1")

#     try:
#         amount_sol = user.buy_amount_sol or 0.1
#         slippage_bps = user.buy_slippage_bps or 1000  # 10%

#         swap_data = await execute_jupiter_swap(
#             user=user,
#             input_mint=settings.SOL_MINT,
#             output_mint=mint,
#             amount_lamports=int(amount_sol * 1e9),
#             slippage_bps=slippage_bps,
#             label="BUY"
#         )

#         token_amount = int(swap_data["out_amount"]) / (10 ** (token.token_decimals or 9))

#         trade = Trade(
#             user_wallet_address=user.wallet_address,
#             mint_address=mint,
#             token_symbol=token.token_symbol or mint[:8],
#             trade_type="buy",
#             amount_sol=amount_sol,
#             amount_tokens=token_amount,
#             price_usd_at_trade=token.price_usd,
#             buy_timestamp=datetime.utcnow(),
#             take_profit=user.sell_take_profit_pct,
#             stop_loss=user.sell_stop_loss_pct,
#             timeout_seconds=user.sell_timeout_seconds,
#         )
#         db.add(trade)
#         await db.commit()

#         await logger.send_log(
#             f"BOUGHT {amount_sol} SOL → {token_amount:,.2f} {token.token_symbol}\n"
#             f"Price: ${token.price_usd:.10f} | MC: ${token.market_cap:,.0f}",
#             "success",
#             tx_hash="pending..."
#         )

#         # Start auto-sell monitor
#         asyncio.create_task(monitor_position(
#             user=user,
#             trade=trade,
#             entry_price_usd=token.price_usd,
#             token_decimals=token.token_decimals or 9,
#             db=db,
#             websocket_manager=bot_components
#         ))

#     except Exception as e:
#         await logger.send_log(f"Buy failed: {str(e)}", "error")
#     finally:
#         await redis_client.delete(lock_key)


# ===================================================================
# PREMIUM FILTERS CHECK
# ===================================================================
# async def apply_premium_filters(user: User, token: TokenMetadata) -> bool:
#     if not user.is_premium:
#         return True  # Free users get basic moonbag

#     # Premium filters
#     if user.filter_top_holders_max_pct is not None:
#         if (token.top10_holders_percentage or 100) > user.filter_top_holders_max_pct:
#             return False

#     if user.filter_webacy_risk_max is not None:
#         if (token.webacy_risk_score or 100) > user.filter_webacy_risk_max:
#             return False

#     if user.filter_mint_authority_renounced and not token.mint_authority_renounced:
#         return False

#     if user.filter_freeze_authority_renounced and not token.freeze_authority_renounced:
#         return False

#     if user.filter_immutable_metadata and not token.immutable_metadata:
#         return False

#     return True


# ===================================================================
# BROADCAST SIGNED TX (Frontend → Backend → Solana)
# ===================================================================
@router.post("/send-signed-transaction", response_model=SendSignedTransactionResponse)
async def broadcast_signed_tx(
    request: SendSignedTransactionRequest,
    current_user: User = Depends(get_current_user)
):
    try:
        from solders.transaction import VersionedTransaction
        from solana.rpc.async_api import AsyncClient

        tx = VersionedTransaction.from_bytes(base64.b64decode(request.signed_tx_base64))
        async with AsyncClient(settings.SOLANA_RPC_URL) as client:
            result = await client.send_raw_transaction(tx.serialize())
            tx_hash = str(result.value)

            BotLogger(current_user.wallet_address).send_log(
                f"Transaction confirmed: {tx_hash[:8]}...{tx_hash[-6:]}",
                "success",
                tx_hash=tx_hash
            )
            return SendSignedTransactionResponse(transaction_hash=tx_hash)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Broadcast failed: {str(e)}")


# ===================================================================
# PROFIT ENDPOINTS
# ===================================================================
@router.get("/positions")
async def get_open_positions(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    trades = await db.execute(
        select(Trade).where(
            Trade.user_wallet_address == current_user.wallet_address,
            Trade.trade_type == "buy",
            Trade.sell_timestamp.is_(None)
        )
    )
    return [t.__dict__ for t in trades.scalars().all()]

@router.get("/profit-per-trade")
async def get_total_profit(
    current_user: User = Depends(get_current_user_by_wallet),
    db: AsyncSession = Depends(get_db),
    _: bool = rate_limited(calls=5, per_seconds=60)  # FIXED
):
    try:
        # Fetch all trades for the user
        result = await db.execute(
            select(Trade).filter_by(user_wallet_address=current_user.wallet_address)
        )
        trades = result.scalars().all()
        
        total_profit = 0.0
        for trade in trades:
            # Assume Trade model has amount_sol (buy) and amount_sol_out (sell)
            # Profit = amount_sol_out - amount_sol for completed trades
            if trade.trade_type == "completed" and trade.amount_sol and trade.amount_sol_out:
                profit = trade.amount_sol_out - trade.amount_sol
                total_profit += profit
        
        logger.info(f"Retrieved total profit for {current_user.wallet_address}: {total_profit} SOL")
        return {"total_profit": total_profit}
    except Exception as e:
        logger.error(f"Failed to retrieve total profit for {current_user.wallet_address}: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to retrieve total profit")
    
@router.get("/lifetime-profit")
async def get_total_profit(
    current_user: User = Depends(get_current_user_by_wallet),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Trade).where(Trade.user_wallet_address == current_user.wallet_address)
    )
    trades = result.scalars().all()

    total_profit = sum(t.profit_sol or 0 for t in trades if t.profit_sol)

    return {
        "total_profit": round(total_profit, 4),
        "is_positive": total_profit >= 0
    }

@router.get("/active-positions")
async def get_active_positions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get all active (open) positions for the user"""
    try:
        # Get all buy trades that don't have corresponding sell trades
        result = await db.execute(
            select(Trade).where(
                Trade.user_wallet_address == current_user.wallet_address,
                Trade.trade_type == "buy",
                Trade.sell_timestamp.is_(None)
            ).order_by(desc(Trade.buy_timestamp))
        )
        active_trades = result.scalars().all()
        
        positions = []
        for trade in active_trades:
            # Get current price from DexScreener
            current_price_data = await get_dexscreener_data(trade.mint_address)
            current_price = None
            # if current_price_data and 'pairs' in current_price_data and current_price_data['pairs']:
            #     current_price = float(current_price_data['pairs'][0].get('priceUsd', 0))
            
            position_data = {
                "mint_address": trade.mint_address,
                "token_symbol": trade.token_symbol,
                "entry_price": float(trade.price_usd_at_trade) if trade.price_usd_at_trade else 0,
                "current_price": current_price,
                "amount_tokens": float(trade.amount_tokens) if trade.amount_tokens else 0,
                "amount_sol": float(trade.amount_sol) if trade.amount_sol else 0,
                "buy_timestamp": trade.buy_timestamp.isoformat() if trade.buy_timestamp else None,
                "take_profit": float(trade.take_profit) if trade.take_profit else None,
                "stop_loss": float(trade.stop_loss) if trade.stop_loss else None,
                # "pair_address": current_price_data['pairs'][0]['url'] if current_price_data and current_price_data['pairs'] else None
            }
            
            # Calculate P&L
            if current_price and trade.price_usd_at_trade:
                pnl_percent = ((current_price - float(trade.price_usd_at_trade)) / float(trade.price_usd_at_trade)) * 100
                position_data["pnl_percent"] = round(pnl_percent, 2)
                position_data["pnl_usd"] = (current_price - float(trade.price_usd_at_trade)) * float(trade.amount_tokens or 0)
            else:
                position_data["pnl_percent"] = 0
                position_data["pnl_usd"] = 0
                
            positions.append(position_data)
        
        return positions
        
    except Exception as e:
        logger.error(f"Error fetching active positions: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to fetch active positions")

@router.get("/sniped-count")
async def get_sniped_count(
    current_user: User = Depends(get_current_user_by_wallet),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Trade)
        .where(Trade.user_wallet_address == current_user.wallet_address)
        .where(Trade.trade_type == "buy")
    )
    count = len(result.scalars().all())
    return {"sniped_count": count}

@router.post("/bulk-log")
async def bulk_log_trades(
    bulk_data: BulkTradeLog,
    api_key: str = None,
    db: AsyncSession = Depends(get_db)
):
    """Bulk log trades from TypeScript sniper"""
    # Verify API key
    if not api_key or api_key != os.getenv("ONCHAIN_API_KEY"):
        raise HTTPException(status_code=401, detail="Invalid API key")
    
    try:
        created_trades = []
        
        for trade_data in bulk_data.trades:
            # Verify user exists
            result = await db.execute(
                select(User).where(User.wallet_address == trade_data["user_wallet_address"])
            )
            user = result.scalar_one_or_none()
            
            if not user:
                continue  # Skip if user doesn't exist
            
            # Create trade entry
            trade = Trade(
                user_wallet_address=trade_data["user_wallet_address"],
                mint_address=trade_data["mint_address"],
                token_symbol=trade_data.get("token_symbol", "UNKNOWN"),
                trade_type=trade_data["trade_type"],
                amount_sol=trade_data.get("amount_sol"),
                buy_tx_hash=trade_data.get("buy_tx_hash"),
                buy_timestamp=datetime.fromisoformat(trade_data.get("timestamp").replace("Z", "+00:00")) 
                           if trade_data.get("timestamp") else datetime.utcnow(),
            )
            
            db.add(trade)
            created_trades.append(trade)
        
        await db.commit()
        
        return {
            "status": "success",
            "message": f"Logged {len(created_trades)} trades",
            "count": len(created_trades)
        }
        
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/immediate-snipe")
async def log_immediate_snipe(
    request: ImmediateSnipeRequest,
    api_key: str = None,
    db: AsyncSession = Depends(get_db)
):
    """Log immediate snipe trades from TypeScript engine"""
    # Verify API key
    if not api_key or api_key != settings.ONCHAIN_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    
    try:
        created_trades = []
        
        for trade_data in request.trades:
            # Verify user exists
            result = await db.execute(
                select(User).where(User.wallet_address == trade_data.user_wallet_address)
            )
            user = result.scalar_one_or_none()
            
            if not user:
                continue    # Skip if user doesn't exist
            
            # Parse timestamp
            timestamp_str = trade_data.timestamp.replace("Z", "+00:00")
            buy_timestamp = datetime.fromisoformat(timestamp_str)
            
            # Create trade entry
            trade = Trade(
                user_wallet_address = trade_data.user_wallet_address,
                mint_address=trade_data.mint_address,
                token_symbol=trade_data.token_symbol,
                token_name=trade_data.token_name,
                trade_type=trade_data.trade_type,
                amount_sol=trade_data.amount_sol,
                bundle_id=trade_data.bundle_id,
                buy_timestamp=buy_timestamp,
                price_usd_at_trade=0.0, # Default, can be updated later
                amount_tokens=0.0   # Will be updated when tokens are received
            )
            
            db.add(trade)
            created_trades.append(trade)
            
        await db.commit()
        
        # Also log token metadata if needed
        token_data = request.token_data
        if token_data:
            # Check if token metadata already exists
            result = await db.execute(
                select(TokenMetadata).where(TokenMetadata.mint_address == token_data.get("Mint"))
            )
            existing_token = result.scalar_one_or_none()
            
            if not existing_token:
                token_metadata = TokenMetadata(
                    mint_address=token_data.get("Mint"),
                    token_symbol=token_data.get("Symbol"),
                    token_name=token_data.get("Name"),
                    created_at=datetime.utcnow()
                )
                db.add(token_metadata)
                await db.commit()
        
        return {
            "status": "success",
            "message": f"Logged {len(created_trades)} immediate snipe traades",
            "count": len(created_trades),
            "bundle_id": request.bundle_id
        }
        
    except Exception as e:
        await db.rollback()
        logger.error(f"Failed to log immediate snipe: {e}")
        raise HTTPException(status_code=500, detail=str(e))



