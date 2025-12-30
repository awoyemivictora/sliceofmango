from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict, Any
from datetime import datetime


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



