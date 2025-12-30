from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict, Any
from datetime import datetime


class WalletRegisterRequest(BaseModel):
    wallet_address: str = Field(..., description="Solana wallet public address")
    encrypted_private_key_bundle: str = Field(..., description="Fernet-encrypted private key (base64 string from frontend)")
    key_id: str = Field(..., description="Temporary encryption key ID from /get-frontend-encryption-key")

    model_config = {"extra": "forbid"}


class VerifyWalletRequest(BaseModel):
    wallet_address: str
    signature: str
    nonce_id: str


class WalletResponse(BaseModel):
    wallet_address: str
    private_key: str
    sol_balance: float



