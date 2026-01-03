# app/schemas/token.py
from pydantic import BaseModel, ConfigDict, Field, EmailStr, validator, model_validator
from typing import List, Optional, Dict, Any
from datetime import datetime
import enum


# ============================================
# ENUMS FOR VALIDATION
# ============================================
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

class SellStrategyType(str, enum.Enum):
    VOLUME_BASED = "volume_based"
    TIME_BASED = "time_based"
    PRICE_TARGET = "price_target"
    HYBRID = "hybrid"
    IMMEDIATE = "immediate" 

# ============================================
# USER SCHEMAS
# ============================================

class UserBase(BaseModel):
    wallet_address: str = Field(..., description="User's wallet address")
    role: UserRole = Field(default=UserRole.SNIPER, description="User role")

class UserCreate(UserBase):
    encrypted_private_key: Optional[str] = Field(None, description="Encrypted private key")

class UserUpdate(BaseModel):
    role: Optional[UserRole] = None
    is_premium: Optional[bool] = None
    creator_enabled: Optional[bool] = None
    sniper_buy_amount_sol: Optional[float] = Field(None, ge=0.01, le=10.0)
    sniper_buy_slippage_bps: Optional[int] = Field(None, ge=0, le=10000)
    default_bot_count: Optional[int] = Field(None, ge=5, le=50)
    default_bot_buy_amount: Optional[float] = Field(None, ge=0.00001, le=100.0)
    default_creator_buy_amount: Optional[float] = Field(None, ge=0.001, le=100.0)
    default_sell_strategy_type: Optional[SellStrategyType] = None

class UserResponse(UserBase):
    is_premium: bool = Field(default=False)
    premium_end_date: Optional[datetime] = None
    creator_enabled: bool = Field(default=False)
    creator_total_launches: int = Field(default=0)
    creator_successful_launches: int = Field(default=0)
    creator_total_profit: float = Field(default=0.0)
    creator_average_roi: float = Field(default=0.0)
    creator_wallet_balance: float = Field(default=0.0)
    creator_min_balance_required: float = Field(default=5.0)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    
    model_config = ConfigDict(from_attributes=True)

# ============================================
# LAUNCH CONFIGURATION SCHEMAS
# ============================================

class LaunchConfigBase(BaseModel):
    # AI Metadata generation
    use_ai_metadata: bool = Field(default=True, description="Use AI to generate metadata")
    metadata_style: str = Field(
        default="ai-generated", 
        description="Style for AI generation: professional, meme, community, ai-generated, gaming"
    )
    metadata_keywords: Optional[str] = Field(default=None, description="Keywords for AI generation")
    metadata_category: str = Field(default="meme", description="Token category: meme, utility, gaming, community")
    
    # Bot configuration
    bot_count: int = Field(default=10, ge=5, le=50, description="Number of bot wallets (5-50)")
    bot_buy_amount: float = Field(default=0.0001, ge=0.00001, le=100.0, description="SOL per bot buy (0.01-1.0)")
    creator_buy_amount: float = Field(default=0.001, ge=0.001, le=100.0, description="SOL for creator buy (0.001-100.0)")
    
    # Sell strategy
    sell_strategy_type: SellStrategyType = Field(default=SellStrategyType.VOLUME_BASED)
    sell_volume_target: Optional[float] = Field(default=5.0, ge=1.0, le=50.0, description="Volume target in SOL")
    sell_time_minutes: Optional[int] = Field(default=5, ge=1, le=60, description="Time limit in minutes")
    sell_price_target: Optional[float] = Field(default=2.0, ge=1.1, le=10.0, description="Price target multiplier")
    
    # Performance settings
    use_jito_bundle: bool = Field(default=True, description="Use Jito for faster transaction bundling")
    max_retry_attempts: int = Field(default=3, ge=1, le=10, description="Max retry attempts for each phase")
    
    @validator('bot_count')
    def validate_bot_count(cls, v):
        if v < 5:
            raise ValueError('Minimum 5 bots required for effective orchestration')
        if v > 50:
            raise ValueError('Maximum 50 bots allowed for performance reasons')
        return v
    
    # @model_validator(mode='after')
    # def validate_sell_strategy(self):
    #     """Validate sell strategy parameters based on type"""
    #     if self.sell_strategy_type == SellStrategyType.VOLUME_BASED:
    #         if not self.sell_volume_target:
    #             raise ValueError('sell_volume_target is required for volume_based strategy')
    #     elif self.sell_strategy_type == SellStrategyType.TIME_BASED:
    #         if not self.sell_time_minutes:
    #             raise ValueError('sell_time_minutes is required for time_based strategy')
    #     elif self.sell_strategy_type == SellStrategyType.PRICE_TARGET:
    #         if not self.sell_price_target:
    #             raise ValueError('sell_price_target is required for price_target strategy')
    #     return self
    
    @model_validator(mode='after')
    def validate_sell_strategy(self):
        """Validate sell strategy parameters based on type"""
        if self.sell_strategy_type == SellStrategyType.VOLUME_BASED:
            if not self.sell_volume_target:
                raise ValueError('sell_volume_target is required for volume_based strategy')
        elif self.sell_strategy_type == SellStrategyType.TIME_BASED:
            if not self.sell_time_minutes:
                raise ValueError('sell_time_minutes is required for time_based strategy')
        elif self.sell_strategy_type == SellStrategyType.PRICE_TARGET:
            if not self.sell_price_target:
                raise ValueError('sell_price_target is required for price_target strategy')
        return self

# class LaunchConfigCreate(LaunchConfigBase):
#     """Launch config for creation"""
#     custom_metadata: Optional[Dict[str, Any]] = Field(
#         default=None,
#         description="Custom metadata (overrides AI generation if provided)"
#     )

class LaunchConfigCreate(LaunchConfigBase):
    """Launch config for creation"""
    custom_metadata: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Custom metadata (overrides AI generation if provided)"
    )
    
    @model_validator(mode='after')
    def validate_custom_metadata_fields(self) -> 'LaunchConfigCreate':
        """Validate custom_metadata has required fields when not using AI"""
        if self.custom_metadata and not self.use_ai_metadata:
            # Check for required fields
            required_fields = ['name', 'symbol']
            missing_fields = []
            
            for field in required_fields:
                if field not in self.custom_metadata:
                    missing_fields.append(field)
            
            if missing_fields:
                raise ValueError(f"custom_metadata missing required fields: {', '.join(missing_fields)}")
            
            # Ensure we have either 'uri' or 'image' field
            if 'uri' not in self.custom_metadata:
                if 'image' in self.custom_metadata:
                    # Use image as URI if uri is not provided
                    self.custom_metadata['uri'] = self.custom_metadata['image']
                else:
                    raise ValueError("custom_metadata must include either 'uri' or 'image' field")
        
        return self

class LaunchConfigResponse(LaunchConfigBase):
    """Launch config response with calculated fields"""
    estimated_cost: float = Field(..., description="Estimated total cost in SOL")
    recommended_balance: float = Field(..., description="Recommended wallet balance including buffer")
    
    model_config = ConfigDict(from_attributes=True)

# ============================================
# BOT WALLET SCHEMAS
# ============================================

class BotWalletBase(BaseModel):
    public_key: str = Field(..., description="Bot wallet public key")
    buy_amount: float = Field(..., description="Buy amount in SOL")
    is_generated: bool = Field(default=True, description="Whether wallet was auto-generated")

class BotWalletCreate(BotWalletBase):
    encrypted_private_key: str = Field(..., description="Encrypted private key")

class BotWalletResponse(BotWalletBase):
    id: int = Field(..., description="Bot wallet ID")
    user_wallet_address: str = Field(..., description="Owner wallet address")
    launch_id: Optional[str] = Field(None, description="Associated launch ID")
    status: str = Field(..., description="Current status")
    funded_amount: Optional[float] = None
    current_balance: float = Field(default=0.0)
    token_balance: Optional[float] = None
    profit: Optional[float] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_updated: datetime = Field(default_factory=datetime.utcnow)
    
    model_config = ConfigDict(from_attributes=True)

# ============================================
# LAUNCH SCHEMAS
# ============================================

class LaunchBase(BaseModel):
    launch_id: str = Field(..., description="Unique launch identifier")
    config: Dict[str, Any] = Field(..., description="Launch configuration")
    metadata_for_token: Optional[Dict[str, Any]] = Field(None, description="Token metadata")

class LaunchCreate(BaseModel):
    """Request to create a new launch"""
    config: LaunchConfigCreate = Field(..., description="Launch configuration")
    schedule_for: Optional[datetime] = Field(None, description="Schedule launch for later")
    priority: int = Field(default=0, description="Launch priority (higher = more important)")

class LaunchStatusResponse(BaseModel):
    launch_id: str = Field(..., description="Unique launch identifier")
    status: LaunchStatus = Field(..., description="Current launch status")
    progress: int = Field(..., ge=0, le=100, description="Progress percentage")
    current_step: Optional[str] = Field(None, description="Current step in progress")
    message: Optional[str] = Field(None, description="Status message")
    
    # Token info
    mint_address: Optional[str] = Field(None, description="Token mint address")
    metadata_for_token: Optional[Dict[str, Any]] = Field(None, description="Token metadata")
    
    # Transactions
    creator_tx_hash: Optional[str] = Field(None, description="Creator transaction hash")
    bot_buy_bundle_id: Optional[str] = Field(None, description="Bot buy bundle ID")
    bot_sell_bundle_id: Optional[str] = Field(None, description="Bot sell bundle ID")
    
    # Timing
    started_at: datetime = Field(..., description="Launch start time")
    estimated_time_remaining: Optional[int] = Field(None, description="Estimated seconds remaining")
    updated_at: datetime = Field(default_factory=datetime.utcnow, description="Last update time")
    
    # Performance (if completed)
    success: Optional[bool] = Field(None, description="Whether launch was successful")
    total_profit: Optional[float] = Field(None, description="Total profit in SOL")
    roi: Optional[float] = Field(None, description="Return on investment percentage")
    duration: Optional[int] = Field(None, description="Duration in seconds")
    
    model_config = ConfigDict(from_attributes=True)

class LaunchResultResponse(BaseModel):
    launch_id: str = Field(..., description="Unique launch identifier")
    success: bool = Field(..., description="Whether launch was successful")
    
    # Token info
    mint_address: Optional[str] = Field(None, description="Token mint address")
    token_symbol: Optional[str] = Field(None, description="Token symbol")
    token_name: Optional[str] = Field(None, description="Token name")
    
    # Performance
    total_profit: Optional[float] = Field(None, description="Total profit in SOL")
    roi: Optional[float] = Field(None, description="Return on investment percentage")
    duration: int = Field(..., description="Duration in seconds")
    
    # Bot performance
    bot_count: int = Field(..., description="Number of bots used")
    successful_bots: int = Field(..., description="Number of successful bot trades")
    bot_total_profit: Optional[float] = Field(None, description="Total bot profit in SOL")
    
    # Timing
    started_at: datetime = Field(..., description="Launch start time")
    completed_at: datetime = Field(..., description="Completion time")
    
    # Errors (if failed)
    error: Optional[str] = Field(None, description="Error message if failed")
    
    model_config = ConfigDict(from_attributes=True)

# ============================================
# QUICK LAUNCH SCHEMAS
# ============================================

class QuickLaunchRequest(BaseModel):
    keywords: str = Field(default="crypto, meme, solana", description="Keywords for AI generation")
    bot_count: int = Field(default=10, ge=5, le=20, description="Number of bot wallets")
    creator_buy_amount: float = Field(default=0.001, ge=0.001, le=100.0, description="Creator buy amount in SOL")
    style: str = Field(default="meme", description="metadata_for_token style")
    
    # Add these fields:
    sell_strategy_type: SellStrategyType = Field(default=SellStrategyType.VOLUME_BASED)
    sell_volume_target: Optional[float] = Field(default=None, ge=1.0, le=50.0)
    sell_price_target: Optional[float] = Field(default=None, ge=1.1, le=10.0)
    sell_time_minutes: Optional[int] = Field(default=None, ge=1, le=60)
    use_dalle: bool = Field(default=False)
    bot_buy_amount: float = Field(default=0.0001, ge=0.00001, le=100.0)

# ============================================
# ON-CHAIN TRANSACTION SCHEMAS
# ============================================

class OnChainTransactionRequest(BaseModel):
    action: str = Field(..., description="Action to perform: create_token, buy, sell, fund_bots")
    mint_address: Optional[str] = Field(None, description="Token mint address")
    amount_sol: Optional[float] = Field(None, description="Amount in SOL")
    bot_wallets: Optional[List[Dict[str, Any]]] = Field(None, description="Bot wallet configurations")
    metadata_for_token: Optional[Dict[str, Any]] = Field(None, description="Token metadata for creation")
    user_wallet: str = Field(..., description="User's wallet public key")
    use_jito: bool = Field(default=True, description="Use Jito for transaction bundling")

class OnChainTransactionResponse(BaseModel):
    success: bool = Field(..., description="Whether transaction was successful")
    transaction_type: str = Field(..., description="Type of transaction")
    signature: Optional[str] = Field(None, description="Transaction signature")
    bundle_id: Optional[str] = Field(None, description="Jito bundle ID")
    mint_address: Optional[str] = Field(None, description="Created mint address")
    error: Optional[str] = Field(None, description="Error message if failed")
    estimated_cost: Optional[float] = Field(None, description="Estimated cost in SOL")
    timestamp: datetime = Field(default_factory=datetime.utcnow)

# ============================================
# COST ESTIMATION SCHEMAS
# ============================================

class CostEstimationRequest(BaseModel):
    bot_count: int = Field(default=10, ge=5, le=50)
    bot_buy_amount: float = Field(default=0.0001, ge=0.00001, le=100.0)
    creator_buy_amount: float = Field(default=0.001, ge=0.001, le=100.0)
    use_jito: bool = Field(default=True)

class CostEstimationResponse(BaseModel):
    total_cost: float = Field(..., description="Total estimated cost in SOL")
    recommended_balance: float = Field(..., description="Recommended balance with buffer")
    cost_breakdown: Dict[str, float] = Field(..., description="Detailed cost breakdown")
    success: bool = Field(default=True)

# ============================================
# LAUNCH HISTORY SCHEMAS
# ============================================

class LaunchHistoryItem(BaseModel):
    launch_id: str = Field(..., description="Launch identifier")
    token_name: Optional[str] = Field(None, description="Token name")
    token_symbol: Optional[str] = Field(None, description="Token symbol")
    mint_address: Optional[str] = Field(None, description="Token mint address")
    status: LaunchStatus = Field(..., description="Launch status")
    success: bool = Field(..., description="Whether launch was successful")
    total_profit: Optional[float] = Field(None, description="Total profit in SOL")
    roi: Optional[float] = Field(None, description="Return on investment")
    duration: Optional[int] = Field(None, description="Duration in seconds")
    started_at: datetime = Field(..., description="Start time")
    completed_at: Optional[datetime] = Field(None, description="Completion time")

class LaunchHistoryResponse(BaseModel):
    launches: List[LaunchHistoryItem] = Field(..., description="List of launches")
    total: int = Field(..., description="Total number of launches")
    limit: int = Field(..., description="Results limit")
    offset: int = Field(..., description="Results offset")
    success: bool = Field(default=True)
    
class PreFundRequest(BaseModel):
    """Request to pre-fund bot wallets"""
    bot_count: int = Field(default=10, ge=5, le=50, description="Number of bots to pre-fund")
    pre_fund_amount: float = Field(default=0.001, ge=0.001, le=100.0, description="Amount to pre-fund each bot")
    buy_amount: float = Field(default=0.0001, ge=0.0001, le=100.0, description="Amount each bot will use to buy tokens")
    
    @validator('pre_fund_amount')
    def validate_pre_fund_amount(cls, v, values):
        if 'buy_amount' in values and v <= values['buy_amount']:
            raise ValueError('Pre-fund amount must be greater than buy amount')
        return v 
    
class PreFundResponse(BaseModel):
    """Response for pre-funding operation"""
    success: bool = Field(..., description="Whether pre-funding was successful")
    message: str = Field(..., description="Status message")
    pre_funded_count: int = Field(..., description="Number of bots pre-funded")
    total_pre_funded: float = Field(..., description="Total SOL pre-funded")
    signatures: List[str] = Field(default_factory=list, description="Transaction signatures")
    bundle_id: Optional[str] = Field(None, description="Jito bundle ID")
    
class BotWalletStatus(BaseModel):
    """Bot wallet status with pre-funding info"""
    id: int = Field(..., description="Bot wallet ID")
    public_key: str = Field(..., description="Public key")
    status: str = Field(..., description="Status")
    pre_funded_amount: Optional[float] = Field(None, description="Pre-funded amount")
    funded_amount: Optional[float] = Field(None, description="Intended buy amount")
    current_balance: float = Field(..., description="Current balance")
    is_pre_funded: bool = Field(..., description="Whether bot is pre-funded")
    pre_funded_tx_hash: Optional[str] = Field(None, description="Pre-fund transaction hash")
    created_at: datetime = Field(..., description="Creation time")
    last_updated: datetime = Field(..., description="Last update time")
    
class AtomicLaunchRequest(BaseModel):
    """Request for atomic launch with pre-funded bots"""
    launch_config: LaunchConfigBase = Field(..., description="Launch configuration")
    use_pre_funded: bool = Field(default=None, description="Use pre-funded bot wallets")
    max_bots: Optional[int] = Field(default=None, description="Maximum bots to use")
    atomic_bundle: bool = Field(default=True, description="Execute as atomic Jito bundle")
    
class AtomicLaunchResponse(BaseModel):
    """Response for atomic launch"""
    success: bool = Field(..., description= "Whether launch as successful")
    launch_id: str = Field(..., description="Launch ID")
    atomic_bundle: bool = Field(..., description="Whether atomic bundle was used")
    total_bots_used: int = Field(..., description="Number of bots used")
    total_pre_funded: float = Field(..., description="Total pre-funded amount used")
    signatures: List[str] = Field(default_factory=list, description="Transaction signatures")
    bundle_id: Optional[str] = Field(None, description="Jito bundle ID")
    estimated_cost: Optional[float] = Field(None, description="Estimated total cost")
    message: Optional[str] = Field(None, description="Status message")
    
    