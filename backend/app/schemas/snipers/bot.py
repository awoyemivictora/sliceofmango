from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict, Any
from datetime import datetime


class StartBotRequest(BaseModel):
    """
    Request to start the auto-trading bot.
    Currently no payload needed — just authentication + user settings from DB.
    Future: allow one-time override of buy amount/slippage on start.
    """
    auto_start_on_launch: Optional[bool] = Field(
        default=True,
        description="If true, bot starts immediately after wallet connect (used on frontend login)"
    )

    model_config = {
        "extra": "forbid",
        "json_schema_extra": {
            "examples": [
                {
                    "auto_start_on_launch": True
                }
            ]
        }
    }


class UpdateBotSettingsRequest(BaseModel):
    """
    Full live-update payload for all user bot settings.
    Matches your frontend form exactly — free + premium fields.
    All fields optional so frontend can update just one.
    """
    # === Buy Settings ===
    buy_amount_sol: Optional[float] = Field(None, gt=0, le=100, description="Amount in SOL to buy per moonbag")
    buy_slippage_bps: Optional[int] = Field(None, ge=50, le=5000, description="Buy slippage in basis points (100 = 1%)")

    # === Sell Settings ===
    sell_take_profit_pct: Optional[float] = Field(None, ge=10, le=10000, description="Take profit %")
    sell_stop_loss_pct: Optional[float] = Field(None, ge=5, le=95, description="Stop loss %")
    sell_timeout_seconds: Optional[int] = Field(None, ge=60, le=86400, description="Auto-sell after X seconds")
    sell_slippage_bps: Optional[int] = Field(None, ge=100, le=10000, description="Sell slippage (higher = safer on dumps)")

    # === Advanced Sell ===
    enable_trailing_stop_loss: Optional[bool] = Field(None, description="Enable trailing stop loss")
    trailing_stop_loss_pct: Optional[float] = Field(None, ge=5, le=90, description="Trailing stop % from peak")

    # === Safety Filters (Free Tier) ===
    filter_socials_added: Optional[bool] = None
    filter_liquidity_burnt: Optional[bool] = None
    filter_immutable_metadata: Optional[bool] = None
    filter_mint_authority_renounced: Optional[bool] = None
    filter_freeze_authority_revoked: Optional[bool] = None
    filter_check_pool_size_min_sol: Optional[float] = Field(None, ge=1, le=1000)

    # === Premium-Only Filters ===
    filter_top_holders_max_pct: Optional[float] = Field(None, ge=10, le=99, description="Max % held by top 10 holders")
    filter_bundled_max: Optional[int] = Field(None, ge=1, le=100, description="Max bundled wallets")
    filter_max_same_block_buys: Optional[int] = Field(None, ge=1, le=50, description="Max buys in same block")
    filter_safety_check_period_seconds: Optional[int] = Field(None, ge=10, le=300, description="Min age before buying")
    filter_selected_dex: Optional[str] = Field(None, pattern="^(Raydium|Jupiter|Orca|Meteora|OKX)$")
    filter_webacy_risk_max: Optional[float] = Field(None, ge=0, le=100, description="Max Webacy risk score allowed")
    filter_mint_authority_renounced_strict: Optional[bool] = Field(None, description="Force mint renounced")
    filter_freeze_authority_renounced_strict: Optional[bool] = Field(None, description="Force freeze renounced")

    # === Bot Behavior ===
    bot_check_interval_seconds: Optional[int] = Field(None, ge=3, le=60, description="How often bot scans for new tokens")

    model_config = {
        "extra": "forbid",
        "json_schema_extra": {
            "examples": [
                {
                    "buy_amount_sol": 0.5,
                    "buy_slippage_bps": 1000,
                    "sell_take_profit_pct": 150,
                    "sell_stop_loss_pct": 30,
                    "sell_timeout_seconds": 1800,
                    "filter_top_holders_max_pct": 45,
                    "filter_webacy_risk_max": 40,
                    "enable_trailing_stop_loss": True,
                    "trailing_stop_loss_pct": 25
                }
            ]
        }
    }
    

class BotStatusResponse(BaseModel):
    is_running: bool
    active_positions: int
    lifetime_profit_sol: Optional[float] = None
    last_buy_time: Optional[datetime] = None
    current_settings: Dict[str, Any] = {}

    model_config = {"from_attributes": True}
    

class BotSettingsUpdate(BaseModel):
    buy_amount_sol: Optional[float] = None
    buy_priority_fee_lamports: Optional[int] = None
    buy_slippage_bps: Optional[int] = None
    sell_take_profit_pct: Optional[float] = None
    sell_stop_loss_pct: Optional[float] = None
    sell_timeout_seconds: Optional[int] = None
    sell_priority_fee_lamports: Optional[int] = None
    sell_slippage_bps: Optional[int] = None
    enable_trailing_stop_loss: Optional[bool] = None
    trailing_stop_loss_pct: Optional[float] = None


class LogTradeRequest(BaseModel):
    mint_address: str
    token_symbol: str
    trade_type: str
    amount_sol: float
    amount_tokens: float
    price_sol_per_token: float
    price_usd_at_trade: float
    tx_hash: str
    log_message: str
    profit_usd: Optional[float] = None
    profit_sol: Optional[float] = None
    buy_price: Optional[float] = None
    entry_price: Optional[float] = None
    stop_loss: Optional[float] = None
    take_profit: Optional[float] = None
    token_amounts_purchased: Optional[float] = None
    token_decimals: Optional[int] = None
    sell_reason: Optional[str] = None
    swap_provider: Optional[str] = None






