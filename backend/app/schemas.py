from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict, Any
from datetime import datetime


# =============================================
# FIXED & FINAL: Wallet Registration Schema
# =============================================
class WalletRegisterRequest(BaseModel):
    wallet_address: str = Field(..., description="Solana wallet public address")
    encrypted_private_key_bundle: str = Field(..., description="Fernet-encrypted private key (base64 string from frontend)")
    key_id: str = Field(..., description="Temporary encryption key ID from /get-frontend-encryption-key")

    model_config = {"extra": "forbid"}


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    wallet_address: str
    

class VerifyWalletRequest(BaseModel):
    wallet_address: str
    signature: str
    nonce_id: str


# =============================================
# Everything else below remains unchanged but cleaned up for Pydantic v2
# =============================================
class UserProfile(BaseModel):
    wallet_address: str
    is_premium: bool


class SnipeLog(BaseModel):
    id: str
    user_wallet_address: str
    mint_address: str
    started_at: datetime

    model_config = {"from_attributes": True}


class TradeLog(BaseModel):
    id: str
    user_wallet_address: str
    mint_address: str
    token_symbol: Optional[str] = None
    trade_type: str
    amount_sol: Optional[float] = None
    amount_tokens: Optional[float] = None
    price_sol_per_token: Optional[float] = None
    price_usd_at_trade: Optional[float] = None
    tx_hash: Optional[str] = None
    timestamp: datetime
    profit_usd: Optional[float] = None
    profit_sol: Optional[float] = None
    log_message: Optional[str] = None

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


class GetTradeQuoteRequest(BaseModel):
    token_in_address: str
    token_out_address: str
    in_amount: float
    user_wallet_address: str
    slippage: float = 0.005
    fee: Optional[float] = None


class GetTradeQuoteResponse(BaseModel):
    raw_tx_base64: str
    last_valid_block_height: int
    quote_data: dict


class SendSignedTransactionRequest(BaseModel):
    signed_tx_base64: str
    chain: str = "sol"


class SendSignedTransactionResponse(BaseModel):
    transaction_hash: str


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


class AIAnalysisRequest(BaseModel):
    token_address: str = Field(..., min_length=32, max_length=44)


class AIAnalysisResponse(BaseModel):
    token_address: str
    sentiment_score: Optional[float] = None
    openai_analysis_summary: Optional[str] = None
    rug_check_result: Optional[str] = None
    rug_check_details: Optional[Dict[str, Any]] = None
    top_10_holders_percentage: Optional[float] = None
    lp_locked: Optional[bool] = None
    mint_authority_revoked: Optional[bool] = None
    analyzed_at: datetime

    model_config = {"from_attributes": True}


class SnipeBase(BaseModel):
    token_address: str = Field(..., min_length=32, max_length=44)
    amount_sol: float = Field(..., gt=0)
    slippage: float = Field(0.01, ge=0, le=0.5)
    is_buy: bool


class SnipeCreate(SnipeBase):
    pass


class SnipeUpdate(BaseModel):
    status: Optional[str] = None
    transaction_signature: Optional[str] = None
    profit_loss: Optional[float] = None
    logs: Optional[List[Any]] = None


class SnipeResponse(SnipeBase):
    id: str
    user_wallet_address: str
    status: str
    transaction_signature: Optional[str] = None
    profit_loss: Optional[float] = None
    started_at: datetime
    completed_at: Optional[datetime] = None
    logs: List[Any] = []

    model_config = {"from_attributes": True}


class SubscriptionRequest(BaseModel):
    email: EmailStr


class SubscriptionResponse(BaseModel):
    id: str
    user_wallet_address: str
    plan_name: str
    is_active: bool
    start_date: datetime
    end_date: Optional[datetime] = None

    model_config = {"from_attributes": True}


class UserBase(BaseModel):
    wallet_address: str
    email: Optional[EmailStr] = None


class UserCreate(UserBase):
    pass


class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    is_premium: Optional[bool] = None


class UserResponse(UserBase):
    is_premium: bool
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class WalletResponse(BaseModel):
    wallet_address: str
    private_key: str
    sol_balance: float


class UserBotSettingsBase(BaseModel):
    buy_amount_sol: float
    buy_priority_fee_lamports: int
    buy_slippage_bps: int
    sell_take_profit_pct: float
    sell_stop_loss_pct: float
    sell_timeout_seconds: int
    sell_priority_fee_lamports: int
    sell_slippage_bps: int
    enable_trailing_stop_loss: bool
    trailing_stop_loss_pct: Optional[float] = None

    filter_socials_added: bool
    filter_liquidity_burnt: bool
    filter_immutable_metadata: bool
    filter_mint_authority_renounced: bool
    filter_freeze_authority_revoked: bool
    filter_pump_fun_migrated: bool
    filter_check_pool_size_min_sol: float
    bot_check_interval_seconds: int
    is_premium: bool


class UserBotSettingsResponse(UserBotSettingsBase):
    model_config = {"from_attributes": True}


class UserBotSettingsUpdate(UserBotSettingsBase):
    pass


# Add these to your app/schemas.py

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
    
    