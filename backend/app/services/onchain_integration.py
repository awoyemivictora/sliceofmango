import asyncio 
import json
import logging
from typing import Dict, List, Optional, Any 
import httpx 
from datetime import datetime 

from app.config import settings
from app.utils import redis_client

logger = logging.getLogger(__name__)

class OnChainServiceClient:
    """Client for communicating with the on-chain TypeScript service"""
    
    def __init__(self):
        self.base_url = settings.ONCHAIN_CLIENT_URL
        self.api_key = settings.ONCHAIN_API_KEY
        self.client_timeout = 30.0
        self.retry_count = 3
        
    async def _make_request(
        self,
        method: str, 
        endpoint: str, 
        data: Optional[Dict] = None, 
        retry: int = 0
    ) -> Dict[str, Any]:
        """Make HTTP request to on-chain service with retry logic"""
        try:
            url = f"{self.base_url}{endpoint}"
            
            async with httpx.AsyncClient(timeout=self.client_timeout) as client:
                headers = {
                    "Content-Type": "application/json",
                    "X-API-Key": self.api_key
                }
                
                if method == "POST":
                    response = await client.post(url, json=data, headers=headers)
                
                elif method == "GET":
                    response = await client.get(url, headers=headers)
                else:
                    raise ValueError(f"Unsupported method: {method}")
                
                if response.status_code == 200:
                    return response.json()
                elif response.status_code == 401:
                    logger.error(f"Authentication failed for on-chain service: {response.text}")
                    raise Exception("On-chain service authentication failed")
                else:
                    error_msg = f"HTTP {response.status_code}: {response.text}"
                    if retry < self.retry_count:
                        wait_time = 1 * (retry + 1)
                        logger.warning(f"Retrying {endpoint} in {wait_time}s...")
                        await asyncio.sleep(wait_time)
                        return await self._make_request(method, endpoint, data, retry + 1)
                    else:
                        raise Exception(error_msg)
                    
        except Exception as e:
            logger.error(f"On-chain service request failed: {e}")
            if retry < self.retry_count:
                wait_time = 1 * (retry + 1)
                await asyncio.sleep(wait_time)
                return await self._make_request(method, endpoint, data, retry + 1)
            else:
                raise
    
    async def health_check(self) -> bool:
        """Check if on-chain service is healthy"""
        try:
            result = await self._make_request("GET", "/health")
            return result.get("status") == "healthy"
        except Exception as e:
            logger.error(f"On-chain service health check failed: {e}")
            return False 

    async def create_token(
        self,
        user_wallet: str,
        metadata_for_token: Dict[str, Any],
        encrypted_private_key: Optional[str] = None,  # Make it optional
        use_jito: bool = True 
    ) -> Dict[str, Any]:
        """Create a new token on-chain"""
        # Prepare payload - only include encrypted_private_key if provided
        payload = {
            "user_wallet": user_wallet,
            "metadata": metadata_for_token,
            "use_jito": use_jito
        }
        
        # Only add encrypted_private_key if it exists (for backward compatibility)
        if encrypted_private_key:
            payload["encrypted_private_key"] = encrypted_private_key
        
        return await self._make_request("POST", "/api/onchain/create-token", payload)

    async def fund_bots(
        self,
        user_wallet: str,
        bot_wallets: List[Dict[str, Any]],
        use_jito: bool = True 
    ) -> Dict[str, Any]:
        """Fund bot wallets with SOL"""
        payload = {
            "user_wallet": user_wallet,
            "bot_wallets": bot_wallets,
            "use_jito": use_jito
        }
        
        return await self._make_request("POST", "/api/onchain/fund-bots", payload)
    
    async def execute_buy(
        self,
        user_wallet: str,
        mint_address: str,
        amount_sol: float,
        bot_wallets: Optional[List[Dict[str, Any]]] = None,  # Changed from Dict to List
        use_jito: bool = True 
    ) -> Dict[str, Any]:
        """Execute buy transaction"""
        payload = {
            "user_wallet": user_wallet,
            "mint_address": mint_address,
            "amount_sol": amount_sol,
            "use_jito": use_jito
        }
        
        if bot_wallets:
            payload["bot_wallets"] = bot_wallets
            
        # Call the correct endpoint
        if bot_wallets:
            return await self._make_request("POST", "/api/onchain/execute-bot-buys", payload)
        else:
            return await self._make_request("POST", "/api/onchain/buy", payload)
        
    async def create_token_with_creator_buy(
        self,
        user_wallet: str,
        metadata_for_token: Dict[str, Any],
        creator_buy_amount: float = 0.001,
        use_jito: bool = True,
        creator_override: Optional[str] = None
    ) -> Dict[str, Any]:
        """Create token with immediate creator buy"""
        try:
            logger.info(f"Creating token with creator buy for {user_wallet}")
            
            payload = {
                "action": "create_token_with_buy",
                "user_wallet": user_wallet,
                "metadata": metadata_for_token,
                "creator_buy_amount": creator_buy_amount,
                "use_jito": use_jito,
                "creator_override": creator_override
            }
            
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    f"{self.base_url}/api/onchain/create-token-with-buy",
                    json=payload,
                    headers={"X-API-Key": self.api_key}
                )
                
                if response.status_code != 200:
                    error_text = response.text[:500] if response.text else "No error message"
                    return {
                        "success": False,
                        "error": f"HTTP {response.status_code}: {error_text}"
                    }
                
                return response.json()
                
        except httpx.TimeoutException:
            logger.error("Create token with buy request timed out")
            return {"success": False, "error": "Request timed out"}
        except Exception as e:
            logger.error(f"Create token with buy failed: {e}", exc_info=True)
            return {"success": False, "error": str(e)}
        
# Singleton instance
onchain_client = OnChainServiceClient()
        
        
        
