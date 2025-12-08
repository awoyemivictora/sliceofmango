# app/models.py
from sqlalchemy import (
    BigInteger, Column, Index, Integer, Numeric, String, Float, Boolean, DateTime, ForeignKey, Text, func
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from datetime import datetime
from typing import Optional, List


class Base(DeclarativeBase):
    pass


# ──────────────────────────────────────────────────────────────
# 1. New Tokens & Metadata (shared across all users)
# ──────────────────────────────────────────────────────────────
# class NewTokens(Base):
#     __tablename__ = "new_tokens"

#     pool_id: Mapped[Optional[str]] = mapped_column(String, nullable=False, primary_key=True)
#     mint_address: Mapped[str] = mapped_column(String, index=True)
#     timestamp: Mapped[datetime] = mapped_column(DateTime, default=func.now())
#     signature: Mapped[str] = mapped_column(String)
#     tx_type: Mapped[str] = mapped_column(String)
    
#     # Enhanced status tracking
#     metadata_status: Mapped[str] = mapped_column(String, default="pending")  # pending → processing → completed → needs_update → failed
#     metadata_retry_count: Mapped[int] = mapped_column(Integer, default=0)
#     last_metadata_update: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
#     next_reprocess_time: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    
#     # Processing stages tracking (for debugging and partial completion)
#     dexscreener_processed: Mapped[bool] = mapped_column(Boolean, default=False)
#     raydium_processed: Mapped[bool] = mapped_column(Boolean, default=False)
#     webacy_processed: Mapped[bool] = mapped_column(Boolean, default=False)
#     tavily_processed: Mapped[bool] = mapped_column(Boolean, default=False)
#     profitability_processed: Mapped[bool] = mapped_column(Boolean, default=False)
    
#     # Error tracking
#     last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
#     # Performance metrics
#     total_processing_time_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    
#     # Indexes for better query performance
#     __table_args__ = (
#         Index('ix_new_tokens_status_timestamp', "metadata_status", "timestamp"),
#         Index('ix_new_tokens_reprocess_time', "next_reprocess_time"),
#         Index('ix_new_tokens_mint_status', "mint_address", "metadata_status"),
#     )


class NewTokens(Base):
    __tablename__ = "new_tokens"

    mint_address: Mapped[str] = mapped_column(String, primary_key=True, unique=True, index=True)
    pool_id: Mapped[Optional[str]] = mapped_column(String, nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=func.now())
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
    token_decimals: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, server_default="9", default=9)
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

    wallet_address: Mapped[str] = mapped_column(String, primary_key=True, index=True)
    encrypted_private_key: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    is_premium: Mapped[bool] = mapped_column(Boolean, default=False)
    premium_start_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    premium_end_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # Custom RPCs
    custom_rpc_https: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    custom_rpc_wss: Mapped[Optional[str]] = mapped_column(String, nullable=True)

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
    buy_amount_sol: Mapped[float] = mapped_column(Float, default=0.1)
    buy_slippage_bps: Mapped[int] = mapped_column(Integer, default=1000)
    
    # Sell Trading Settings
    sell_take_profit_pct: Mapped[float] = mapped_column(Float, default=50.0)
    sell_stop_loss_pct: Mapped[float] = mapped_column(Float, default=20.0)
    sell_timeout_seconds: Mapped[int] = mapped_column(Integer, default=3600)
    sell_slippage_bps: Mapped[int] = mapped_column(Integer, default=1000)
    
    bot_check_interval_seconds: Mapped[int] = mapped_column(Integer, default=10)
    
    # For Trade Monitoring Flexibility [I STILL NEED TO ADD THIS TO FRONTEND AS WELL]
    partial_sell_pct: Mapped[float] = mapped_column(Float, default=70.0)  # Sell 70% on early profit
    trailing_sl_pct: Mapped[float] = mapped_column(Float, default=15.0)   # Trailing SL drop from peak
    rug_liquidity_drop_pct: Mapped[float] = mapped_column(Float, default=20.0)  # Rug if liquidity drops >20%

    trades: Mapped[List["Trade"]] = relationship("Trade", back_populates="user", cascade="all, delete-orphan")


# ──────────────────────────────────────────────────────────────
# 3. Trade (belongs to ONE user)
# ──────────────────────────────────────────────────────────────
class Trade(Base):
    __tablename__ = "trades"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_wallet_address: Mapped[str] = mapped_column(
        ForeignKey("users.wallet_address", ondelete="CASCADE"), index=True
    )

    mint_address: Mapped[str] = mapped_column(String, index=True)
    token_symbol: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    trade_type: Mapped[str] = mapped_column(String)
    amount_sol: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    amount_tokens: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    price_sol_per_token: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    price_usd_at_trade: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    buy_tx_hash: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    sell_tx_hash: Mapped[Optional[str]] = mapped_column(String, nullable=True)
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

    user: Mapped["User"] = relationship("User", back_populates="trades")
    
    # Indexes for better performance
    __table_args__ = (
        Index('ix_trades_user_timestamp', "user_wallet_address", "buy_timestamp"),
        Index('ix_trades_mint_user', "mint_address", "user_wallet_address"),
        Index('ix_trades_profit', "user_wallet_address", "profit_usd"),
        Index('ix_trades_fee_applied', "fee_applied", "buy_timestamp"),  # New index for fee queries
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
    
    
    