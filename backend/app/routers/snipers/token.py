from datetime import datetime
from fastapi import Depends, APIRouter, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
import os
from dotenv import load_dotenv
import logging
from app.models import User, NewTokens
from app.security import get_current_user
from app.utils.dexscreener_api import get_dexscreener_data
from app.utils.raydium_apis import get_raydium_pool_info
from app.utils.solscan_apis import get_solscan_token_meta
from app.utils.token_safety import check_token_safety


# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load your environment variables and API keys.
load_dotenv()

router = APIRouter(
    prefix="/token",
    tags=['Token']
)

# Endpoint to receive new tokens from on-chain indexer
@router.post("/webhook/new-token")
async def receive_new_token(
    token_data: dict,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    """
    Receive new token data from on-chain indexer
    Expected format:
    {
        "Name": "benito",
        "Symbol": "benito",
        "Uri": "https://ipfs.io/ipfs/bafkreihnqnfzb4ikw7axhvizcj2ypdlpplgsxwkyhotianhb6ifrlnmkdi",
        "Mint": "8X42kzn2XghUsFzKvxZ1sscyBTHNwuPoAvjQQ3Lxpump",
        "Bonding_Curve": "A19He1CvAtTK3nUyTVVJ8nfCvuJJXejmHUqb72e1XJMQ",
        "Creator": "H19cRLRAcvXpRaeWyAhDhPsk3iCRVES8T56wAUJYE6BG",
        "signature": "2MG2Nbp6xqp8BAUkquVVpYk6iW2PznjofALGajLNPH5bLaRpjw2omeh1XEJnXnmpHyGDatvPB3v4G8DHpjRj2Qv7",
        "timestamp": "2025-12-15T08:11:03.001Z"
    }
    """
    try:
        # Validate required fields
        required_fields = ["Mint", "Name", "Symbol", "signature"]
        for field in required_fields:
            if field not in token_data:
                raise HTTPException(
                    status_code=400,
                    detail=f"Missing required field: {field}"
                )
            
            mint_address = token_data["Mint"]
            
            # Check if token already exists
            from sqlalchemy import select 
            result = await db.execute(
                select(NewTokens).where(NewTokens.mint_address == mint_address)
            )
            existing = result.scalar_one_or_none()
            
            if existing:
                logger.info(f"Token {mint_address[:8]} already exists, skipping")
                return {"status": "skipped", "message": "Token alreaedy processed"}
            
            # Convert UTC datetime to naive datetime
            if 'timestamp' in token_data:
                if isinstance(token_data['timestamp'], str):
                    # Parse and remove timezone
                    dt = datetime.fromisoformat(token_data['timestamp'].replace('Z', ''))
                    token_data['timestamp'] = dt  # Already naive
                
                elif hasattr(token_data['timestamp'], 'tzinfo') and token_data['timestamp'].tzinfo:
                    # Remove timezone info
                    token_data['timestamp'] = token_data['timestamp'].replace(tzinfo=None)

            # Create new token entry
            new_token = NewTokens(
                mint_address=mint_address,
                bonding_curve=token_data.get("Bonding_Curve"),
                timestamp=token_data.get('timestamp') or datetime.utcnow(),
                signature=token_data["signature"],
                tx_type="pumpfun_token_create",
                metadata_status="pending",
                metadata_retry_count=0,
                last_metadata_update=None,
                next_reprocess_time=datetime.utcnow(),
                dexscreener_processed=False,
                webacy_processed=False,
                profitability_processed=False,
                last_error=None,
                total_processing_time_ms=None
            )
            
            db.add(new_token)
            await db.commit()
            
            logger.info(f"✅ New token received from on-chain: {token_data['Name']} ({token_data['Symbol']}) - {mint_address[:8]}")
            
        
        
    except Exception as e:
        logger.error(f"Error processing token webhook: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Endpoint to get safety report for a mint_address
@router.get("/safety-check/{mint_address}")
async def get_token_safety_report(mint_address: str, current_user: User = Depends(get_current_user)):
    """Endpoint to get full safety report for a token"""
    return await check_token_safety(mint_address)



# Endpoint to get the token metadata for a mint_address from DEXSCREENER
@router.get("/metadata/{mint_address}")
async def get_token_metadata(mint_address: str, current_user: User = Depends(get_current_user)):
    """Combined token metadaa from all dexscreener api"""
    dex_data = await get_dexscreener_data(mint_address)
    
    return {
        "dex_data": dex_data
    }


# Endpoint to get the token metadata for a mint_address from SOLSCAN
@router.get("/metadata/{mint_address}")
async def get_token_metadata(mint_address: str, current_user: User = Depends(get_current_user)):
    """Combined token metadaa from solscan api"""
    solscan_data = await get_solscan_token_meta(mint_address)
    
    return {
        "solscan_data": solscan_data,
    }


# Endpoint to get the token metadata for a mint_address from RAYDIUM
@router.get("/metadata/{mint_address}")
async def get_token_metadata(mint_address: str, current_user: User = Depends(get_current_user)):
    """Combined token metadaa from raydium"""
    raydium_data = await get_raydium_pool_info(mint_address)
    
    return {
        "raydium_data": raydium_data,
    }


# Endpoint to get the token metadata for a mint_address from ALL ENDPOINTS (DEXSCREENER, SOLSCAN & RAYDIUM)
@router.get("/metadata/{mint_address}")
async def get_token_metadata(mint_address: str, current_user: User = Depends(get_current_user)):
    """Combined token metadaa from all sources"""
    dex_data = await get_dexscreener_data(mint_address)
    raydium_data = await get_raydium_pool_info(mint_address)
    solscan_data = await get_solscan_token_meta(mint_address)
    
    
    return {
        "dex_data": dex_data,
        "raydium_data": raydium_data,
        "solscan_data": solscan_data,
        "safety_report": await check_token_safety(mint_address)
    }



