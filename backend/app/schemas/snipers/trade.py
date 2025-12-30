from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict, Any
from datetime import datetime


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


class ImmediateSnipeTrade(BaseModel):
    user_wallet_address: str 
    mint_address: str 
    token_symbol: str 
    token_name: str 
    trade_type: str 
    amount_sol: float 
    bundle_id: str 
    timestamp: str 
    

class ImmediateSnipeRequest(BaseModel):
    trades: List[ImmediateSnipeTrade]
    token_data: Dict[str, Any]
    bundle_id: str 
    
    

class BulkTradeLog(BaseModel):
    trades: List[dict]


    
