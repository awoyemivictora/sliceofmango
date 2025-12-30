from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict, Any
from datetime import datetime


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    wallet_address: str
    
