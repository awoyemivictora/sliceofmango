# app/models.py
from sqlalchemy import (
    JSON, BigInteger, Column, Enum, Index, Integer, Numeric, String, Float, Boolean, DateTime, ForeignKey, Text, func
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from datetime import datetime
from typing import Any, Dict, Optional, List
import enum


class Base(DeclarativeBase):
    pass

# =======================================
# ENUMS
# =======================================
class UserRole(str, enum.Enum):
    SNIPER = "sniper"
    CREATOR = "creator"
    BOTH = "both"
    

class LaunchStatus(str, enum.Enum):
    SETUP = "setup"
    METADATA_GENERATED = "metadata_generated"
    ONCHAIN_CREATION = "onchain_creation"
    FUNDING = "funding"
    BUYING = "buying"
    MONITORING = "monitoring"
    SELLING = "selling"
    COMPLETE = "complete"
    FAILED = "failed"
    CANCELLED = "cancelled"
    

class BotStatus(str, enum.Enum):
    PENDING = "PENDING"  # Changed from "pending" to "PENDING"
    READY = "READY"      # Changed from "ready" to "READY"
    FUNDED = "FUNDED"    # Changed from "funded" to "FUNDED"
    ACTIVE = "ACTIVE"    # Changed from "active" to "ACTIVE"
    INSUFFICIENT_FUNDS = "INSUFFICIENT_FUNDS"
    FUNDING_FAILED = "FUNDING_FAILED"
    FAILED = "FAILED"
    COMPLETED = "COMPLETED"
    BUY_EXECUTED = "BUY_EXECUTED"
    SELL_EXECUTED = "SELL_EXECUTED"
    
    
    


# ──────────────────────────────────────────────────────────────
# 1. New Tokens & Metadata (shared across all users)
# ──────────────────────────────────────────────────────────────

class NewTokens(Base):
    __tablename__ = "new_tokens"

    mint_address: Mapped[str] = mapped_column(String, primary_key=True, unique=True, index=True)
    pool_id: Mapped[Optional[str]] = mapped_column(String, nullable=True, default=None)
    bonding_curve: Mapped[Optional[str]] = mapped_column(String, nullable=True, default=None)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=False), default=datetime.utcnow)  
    signature: Mapped[str] = mapped_column(String)
    tx_type: Mapped[str] = mapped_column(String)
    
    # Enhanced status tracking
    metadata_status: Mapped[str] = mapped_column(String, default="pending")  # pending → processing → completed → needs_update → failed
    metadata_retry_count: Mapped[int] = mapped_column(Integer, default=0)
    last_metadata_update: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    next_reprocess_time: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    
    # Processing stages tracking (for debugging and partial completion)
    dexscreener_processed: Mapped[bool] = mapped_column(Boolean, default=False)
    webacy_processed: Mapped[bool] = mapped_column(Boolean, default=False)
    profitability_processed: Mapped[bool] = mapped_column(Boolean, default=False)
    
    # Error tracking
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # Performance metrics
    total_processing_time_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    
    # Indexes for better query performance
    __table_args__ = (
        Index('ix_new_tokens_status_timestamp', "metadata_status", "timestamp"),
        Index('ix_new_tokens_reprocess_time', "next_reprocess_time"),
        Index('ix_new_tokens_mint_status', "mint_address", "metadata_status"),
    )


class TokenMetadata(Base):
    __tablename__ = "token_metadata"

    mint_address: Mapped[str] = mapped_column(String, primary_key=True, unique=True, index=True)

    # DexScreener Core
    dexscreener_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    pair_address: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    price_native: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    price_usd: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    market_cap: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    pair_created_at: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    websites: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    twitter: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    telegram: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    token_name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    token_symbol: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    token_logo: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    token_decimals: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, server_default="6", default=6)
    dex_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    liquidity_usd: Mapped[Optional[float]] = mapped_column(Float, nullable=True, comment="Total liquidity in USD across all pairs")
    fdv: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Volume & Price Changes
    volume_h24: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    volume_h6: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    volume_h1: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    volume_m5: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    price_change_h1: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    price_change_m5: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    price_change_h6: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    price_change_h24: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    socials_present: Mapped[bool] = mapped_column(Boolean, default=False)

    # Liquidity & Safety
    liquidity_burnt: Mapped[bool] = mapped_column(Boolean, default=False)
    liquidity_pool_size_sol: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    burn_percent: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    launch_migrate_pool: Mapped[Optional[bool]] = mapped_column(Boolean, default=False)

    # Webacy
    webacy_risk_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    webacy_risk_level: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    webacy_moon_potential: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Profitability Engine Output
    profitability_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    profitability_confidence: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    trading_recommendation: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    
    # AI-generated risk & potential scores
    risk_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    moon_potential: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    holder_concentration: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    liquidity_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    reasons: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    risk_adjusted_return: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    last_profitability_analysis: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    last_checked_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    
    # Indexes for better performance
    __table_args__ = (
        Index('ix_token_metadata_last_checked', "last_checked_at"),
        Index('ix_token_metadata_profitability', "profitability_score", "last_checked_at"),
        Index('ix_token_metadata_recommendation', "trading_recommendation", "last_checked_at"),
        Index('ix_token_recommendation_score', "trading_recommendation", "profitability_score", "last_checked_at"),
        Index('ix_token_metadata_liquidity', "liquidity_usd"),
    )


class TokenMetadataArchive(Base):
    __tablename__ = "token_metadata_archive"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    mint_address: Mapped[str] = mapped_column(String, index=True)
    archived_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    data: Mapped[str] = mapped_column(Text)

    __table_args__ = (
        Index('ix_archive_mint', "mint_address"),
        Index('ix_archive_archived_at', "archived_at"),
    )
    

# ──────────────────────────────────────────────────────────────
# 2. User + One-to-Many → Trades
# ──────────────────────────────────────────────────────────────
class User(Base):
    __tablename__ = "users"

    # Core user info
    wallet_address: Mapped[str] = mapped_column(String, primary_key=True, index=True)
    encrypted_private_key: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    
    # User role and permissions
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), default=UserRole.SNIPER)
    is_premium: Mapped[bool] = mapped_column(Boolean, default=False)
    premium_start_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    premium_end_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # Custom RPCs
    # custom_rpc_https: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    # custom_rpc_wss: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    # =======================
    # SNIPER CONFIGURATION
    # =======================
    # Bot Filters (Premium Only - nullable for basic users)
    filter_socials_added: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True, default=None)
    filter_liquidity_burnt: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True, default=None)
    filter_immutable_metadata: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True, default=None)
    filter_mint_authority_renounced: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True, default=None)
    filter_freeze_authority_revoked: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True, default=None)
    filter_check_pool_size_min_sol: Mapped[Optional[float]] = mapped_column(Float, nullable=True, default=None)
    filter_top_holders_max_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True, default=None)
    filter_safety_check_period_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, default=None)
    
    # Buy Trading Settings
    sniper_buy_amount_sol: Mapped[float] = mapped_column(Float, default=0.1)
    sniper_buy_slippage_bps: Mapped[int] = mapped_column(Integer, default=1000)
    
    # Sell Trading Settings
    sniper_sell_take_profit_pct: Mapped[float] = mapped_column(Float, default=50.0)
    sniper_sell_stop_loss_pct: Mapped[float] = mapped_column(Float, default=20.0)
    sniper_sell_timeout_seconds: Mapped[int] = mapped_column(Integer, default=3600)
    sniper_sell_slippage_bps: Mapped[int] = mapped_column(Integer, default=1000)
    
    sniper_bot_check_interval_seconds: Mapped[int] = mapped_column(Integer, default=10)
    
    # Advanced sniper settings
    sniper_partial_sell_pct: Mapped[float] = mapped_column(Float, default=70.0)  # Sell 70% on early profit
    sniper_trailing_sl_pct: Mapped[float] = mapped_column(Float, default=15.0)   # Trailing SL drop from peak
    sniper_rug_liquidity_drop_pct: Mapped[float] = mapped_column(Float, default=20.0)  # Rug if liquidity drops >20%
    
    # =======================
    # CREATOR CONFIGURATION
    # =======================
    # Creator Settings
    creator_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    creator_last_launch_time: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    creator_total_launches: Mapped[int] = mapped_column(Integer, default=0)
    creator_successful_launches: Mapped[int] = mapped_column(Integer, default=0)
    creator_total_profit: Mapped[float] = mapped_column(Float, default=0.0)
    creator_average_roi: Mapped[float] = mapped_column(Float, default=0.0)
    
    # Default launch configuration
    default_bot_count: Mapped[int] = mapped_column(Integer, default=5)
    default_bot_buy_amount: Mapped[float] = mapped_column(Float, default=0.0001)
    default_creator_buy_amount: Mapped[float] = mapped_column(Float, default=0.001)
    default_sell_strategy_type: Mapped[str] = mapped_column(String, default="volume_based")
    default_sell_volume_target: Mapped[Optional[float]] = mapped_column(Float, nullable=True, default=5.0)
    default_sell_time_minutes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, default=5)
    default_sell_price_target: Mapped[Optional[float]] = mapped_column(Float, nullable=True, default=2.0)
    
    # Creator wallet management
    creator_wallet_balance: Mapped[float] = mapped_column(Float, default=0.0)
    creator_bot_reserve_balance: Mapped[float] = mapped_column(Float, default=0.0)
    creator_min_balance_required: Mapped[float] = mapped_column(Float, default=0.0001)  # Minimum SOL to launch
    
    # Bot wallet pool (encrypted bot private keys)
    bot_wallet_pool: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True, default=None)
    
    # ====================
    # SHARED SETTINGS
    # ====================
    # Custom RPCs
    custom_rpc_https: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    custom_rpc_wss: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    
    # Profitability tracking
    total_volume_sol: Mapped[float] = mapped_column(Float, default=0.0)
    total_fees_paid_sol: Mapped[float] = mapped_column(Float, default=0.0)
    total_trades: Mapped[int] = mapped_column(Integer, default=0)
    fee_tier: Mapped[str] = mapped_column(String, default="standard")  # standard, volume, vip
    last_fee_adjustment: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    
    # Token account optimization
    prefer_ata_reuse: Mapped[bool] = mapped_column(Boolean, default=True)
    ata_rent_paid_sol: Mapped[float] = mapped_column(Float, default=0.0)
    
     # 🔥 JITO TIP MANAGEMENT FIELDS
    jito_tip_account: Mapped[Optional[str]] = mapped_column(String, nullable=True, default=None)
    jito_reserved_tip_amount: Mapped[float] = mapped_column(Float, default=0.0)  # Total amount to reserve for tips
    jito_current_tip_balance: Mapped[float] = mapped_column(Float, default=0.0)  # Current balance in tip account
    jito_tip_per_tx: Mapped[int] = mapped_column(Integer, default=100_000)  # Lamports per transaction (default 0.0001 SOL)
    jito_tip_last_updated: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    jito_tip_account_initialized: Mapped[bool] = mapped_column(Boolean, default=False)

    # Relationships
    trades: Mapped[List["Trade"]] = relationship("Trade", back_populates="user", cascade="all, delete-orphan")
    token_launches: Mapped[List["TokenLaunch"]] = relationship("TokenLaunch", back_populates="user", cascade="all, delete-orphan")
    bot_wallets: Mapped[List["BotWallet"]] = relationship("BotWallet", back_populates="user", cascade="all, delete-orphan")

    __table_args__ = (
        Index('ix_users_role_enabled', "role", "creator_enabled"),
        Index('ix_users_premium_status', "is_premium", "premium_end_date"),
    )

# ============================================
# NEW CREATOR-SPECIFIC MODELS
# ============================================

class TokenLaunch(Base):
    __tablename__ = "token_launches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    launch_id: Mapped[str] = mapped_column(String, unique=True, index=True)
    user_wallet_address: Mapped[str] = mapped_column(
        ForeignKey("users.wallet_address", ondelete="CASCADE"), index=True
    )
    
    # Token information
    mint_address: Mapped[Optional[str]] = mapped_column(String, nullable=True, index=True)
    metadata_for_token: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)
    
    # Launch configuration
    config: Mapped[Dict[str, Any]] = mapped_column(JSON)
    
    # Status tracking
    status: Mapped[LaunchStatus] = mapped_column(Enum(LaunchStatus), default=LaunchStatus.SETUP)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    current_step: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # Results
    result: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)
    success: Mapped[bool] = mapped_column(Boolean, default=False)
    
    # Transactions
    creator_tx_hash: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    bot_buy_bundle_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    bot_sell_bundle_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    
    # Performance metrics
    total_profit: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    roi: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    duration: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # seconds
    
    # Timestamps
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    
    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="token_launches")
    bots: Mapped[List["BotWallet"]] = relationship("BotWallet", back_populates="launch")
    
    __table_args__ = (
        Index('ix_token_launches_user_status', "user_wallet_address", "status"),
        Index('ix_token_launches_timestamp', "started_at"),
    )


class BotWallet(Base):
    __tablename__ = "bot_wallets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_wallet_address: Mapped[str] = mapped_column(
        ForeignKey("users.wallet_address", ondelete="CASCADE"), index=True
    )
    launch_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("token_launches.launch_id", ondelete="CASCADE"), nullable=True, index=True
    )
    
    # Bot wallet info (encrypted)
    public_key: Mapped[str] = mapped_column(String, index=True)
    encrypted_private_key: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    is_generated: Mapped[bool] = mapped_column(Boolean, default=True)
    
    # Status and configuration
    status: Mapped[BotStatus] = mapped_column(Enum(BotStatus), default=BotStatus.PENDING)
    buy_amount: Mapped[float] = mapped_column(Float, default=0.0)
    funded_amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    buy_tx_hash: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    sell_tx_hash: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    
    # Pre-funding status
    is_pre_funded: Mapped[bool] = mapped_column(Boolean, default=False)
    pre_funded_amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    pre_funded_tx_hash: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    
    # Balance tracking
    current_balance: Mapped[float] = mapped_column(Float, default=0.0)
    token_balance: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Performance metrics
    profit: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    roi: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    last_updated: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="bot_wallets")
    launch: Mapped[Optional["TokenLaunch"]] = relationship("TokenLaunch", back_populates="bots")
    
    __table_args__ = (
        Index('ix_bot_wallets_user_status', "user_wallet_address", "status"),
        Index('ix_bot_wallets_launch_status', "launch_id", "status"),
        Index('ix_bot_wallets_pre_funded', "is_pre_funded", "user_wallet_address"),
    )




# ──────────────────────────────────────────────────────────────
# 3. Trade (belongs to ONE user)
# ──────────────────────────────────────────────────────────────
class Trade(Base):
    __tablename__ = "trades"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_wallet_address: Mapped[str] = mapped_column(
        ForeignKey("users.wallet_address", ondelete="CASCADE"), index=True
    )
    
    # Trade type - 'sniper_buy', 'sniper_sell', 'creator_buy', 'creator_sell', 'bot_buy', 'bot_sell'
    trade_type: Mapped[str] = mapped_column(String)

    # Token information
    mint_address: Mapped[str] = mapped_column(String, index=True)
    token_symbol: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    
    # Amounts
    amount_sol: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    amount_tokens: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    price_sol_per_token: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    price_usd_at_trade: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    price_sol_at_trade: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    sniper_buy_tx_hash: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    sniper_sell_tx_hash: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    
    # Profit tracking
    profit_usd: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    profit_sol: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    log_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    buy_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    entry_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    stop_loss: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    take_profit: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    liquidity_at_buy: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    slippage_bps: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    
    token_amounts_purchased: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    token_decimals: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    sell_reason: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    swap_provider: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    buy_timestamp: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    sell_timestamp: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    
    solscan_buy_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    solscan_sell_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    dexscreener_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    jupiter_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    
    # 🔥 FEE TRACKING FIELDS - Using Float instead of Numeric
    fee_applied: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    fee_amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # Amount of fee collected
    fee_percentage: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # Percentage (e.g., 1.0 for 1%)
    fee_bps: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # Basis points (e.g., 100 for 1%)
    fee_mint: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # Which token the fee was collected in
    fee_collected_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)  # When fee was collected

    # 🔥 ADD THIS FIELD to store strategy JSON
    strategy_data: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # Transactions
    tx_hash: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    bundle_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    
    # Profit tracking
    profit_sol: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    profit_usd: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Related info
    launch_id: Mapped[Optional[str]] = mapped_column(String, nullable=True, index=True)
    bot_wallet_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    
    # Metadata
    metadata_for_token: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)
    
    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    user: Mapped["User"] = relationship("User", back_populates="trades")
    
    # Indexes for better performance
    __table_args__ = (
        Index('ix_trades_user_timestamp', "user_wallet_address", "buy_timestamp"),
        Index('ix_trades_mint_user', "mint_address", "user_wallet_address"),
        Index('ix_trades_profit', "user_wallet_address", "profit_usd"),
        Index('ix_trades_fee_applied', "fee_applied", "buy_timestamp"),  # New index for fee queries
        Index('ix_trades_user_type', "user_wallet_address", "trade_type", "created_at"),
        Index('ix_trades_launch', "launch_id", "created_at"),
        Index('ix_trades_mint_type', "mint_address", "trade_type"),
    )

# ============================================
# NEW LAUNCH STATS MODEL
# ============================================

class LaunchStats(Base):
    __tablename__ = "launch_stats"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    date: Mapped[datetime] = mapped_column(DateTime, index=True)
    
    # Aggregate stats
    total_launches: Mapped[int] = mapped_column(Integer, default=0)
    successful_launches: Mapped[int] = mapped_column(Integer, default=0)
    failed_launches: Mapped[int] = mapped_column(Integer, default=0)
    total_profit: Mapped[float] = mapped_column(Float, default=0.0)
    average_roi: Mapped[float] = mapped_column(Float, default=0.0)
    
    # Bot performance
    total_bots_used: Mapped[int] = mapped_column(Integer, default=0)
    successful_bot_trades: Mapped[int] = mapped_column(Integer, default=0)
    total_bot_profit: Mapped[float] = mapped_column(Float, default=0.0)
    
    # User distribution
    active_creators: Mapped[int] = mapped_column(Integer, default=0)
    active_snipers: Mapped[int] = mapped_column(Integer, default=0)


# ============================================
# NEW LAUNCH QUEUE MODEL
# ============================================

class LaunchQueue(Base):
    __tablename__ = "launch_queue"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_wallet_address: Mapped[str] = mapped_column(String, index=True)
    launch_id: Mapped[str] = mapped_column(String, unique=True, index=True)
    
    # Queue status
    status: Mapped[str] = mapped_column(String, default="pending")  # pending, processing, completed, failed
    priority: Mapped[int] = mapped_column(Integer, default=0)  # Higher = higher priority
    
    # Launch config
    config: Mapped[Dict[str, Any]] = mapped_column(JSON)
    metadata_for_token: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)
    
    # Timing
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    scheduled_for: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    
    # Result
    result: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)
    
    __table_args__ = (
        Index('ix_launch_queue_status_priority', "status", "priority", "created_at"),
        Index('ix_launch_queue_scheduled', "scheduled_for", "status"),
    )


# ──────────────────────────────────────────────────────────────
# 4. Subscription
# ──────────────────────────────────────────────────────────────
class Subscription(Base):
    __tablename__ = "subscriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_wallet_address: Mapped[str] = mapped_column(
        ForeignKey("users.wallet_address", ondelete="CASCADE"), index=True
    )
    plan_name: Mapped[str] = mapped_column(String)
    payment_provider_id: Mapped[str] = mapped_column(String)
    start_date: Mapped[datetime] = mapped_column(DateTime)
    end_date: Mapped[datetime] = mapped_column(DateTime)
    
    
    