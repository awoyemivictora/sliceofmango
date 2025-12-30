from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict, Any
from datetime import datetime


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



