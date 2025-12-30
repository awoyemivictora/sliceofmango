from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict, Any
from datetime import datetime


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



class UserProfile(BaseModel):
    wallet_address: str
    is_premium: bool




