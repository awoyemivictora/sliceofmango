from typing import Dict, Optional
import httpx
import logging
import os
from dotenv import load_dotenv
import asyncio
from typing import Optional, Dict, Any
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type



load_dotenv()

logger = logging.getLogger(__name__)




async def get_raydium_pool_info(pool_id: str) -> Optional[Dict]:
    """
    Fetches Raydium V3 pool info for a given token mint address.
    Note: Raydium V3 API does not directly allow querying by token mint address
          to get a pool ID. You typically need the pool ID to query specific pool info.
          The provided documentation shows `/pools/info/ids` which takes a pool ID.
          To find a pool by mint address, one would usually need to:
          1. Query a list of all pools and filter (similar to your original approach,
             but Raydium V3's primary 'get all pools' equivalent might be different or
             require more complex logic, e.g., iterating through a large dataset or
             using a separate 'pools by mint' endpoint if available).
          2. Use an endpoint that specifically allows querying by two mints (base and quote).
             The Solana Stack Exchange search result mentions `/pools/info/mint` which takes `mint1` and `mint2`.
             This is the most direct way to find a specific pool for a given token pair if you know both.

          Given the provided Raydium documentation `/pools/info/ids`,
          this function will assume you **already know the pool ID** or
          that the `mint_address` *is* actually a `pool_id`.
          If the goal is to find a pool *given only one token's mint address*,
          it would require a different approach than what's directly supported by
          the provided Raydium V3 `ids` endpoint.

          For demonstration, I'll adapt it to use the `ids` endpoint, assuming
          `mint_address` might sometimes be treated as a `pool_id` for direct lookup,
          or highlight the limitation. If you need to find pools by a *single* token,
          we'd need to consider different Raydium V3 endpoints or strategies (e.g.,
          `pools/info/mint` if you can infer the other token like WSOL/USDC).

          Let's assume the intent is to find a pool where `mint_address` is the `pool_id`.
          If not, the strategy needs to be clarified, as directly searching for a pool
          by *one* constituent mint on the V3 `pools/info/ids` endpoint isn't supported.
    """
    # The provided Raydium V3 API doc shows /pools/info/ids which takes a pool ID.
    # It does *not* directly support finding a pool given *one* token's mint address
    # among its base_mint or quote_mint, without knowing the pool ID first.
    #
    # To find a pool by a single mint, we would typically need an endpoint that lists
    # all pools (which can be very large) and then filter, or an endpoint
    # like the `/pools/info/mint` mentioned in the Stack Exchange result,
    # which requires *both* mint addresses (e.g., your_token_mint and WSOL).
    #
    # For this rewrite, I will use the `/pools/info/ids` endpoint as per your provided documentation.
    # This means the `mint_address` parameter here should ideally be a Raydium Pool ID,
    # not necessarily a token mint address if you expect to find a pool based on one of its constituent tokens.
    #
    # If your `mint_address` *is* intended to be the pool ID, the function works.
    # If `mint_address` is a token's mint (e.g., JUP), and you want to find a pool where JUP is
    # base or quote, the current Raydium V3 documentation you provided does not show a direct
    # way to do that using a single mint.

    pool_id_candidate = pool_id # Assuming mint_address might be a pool ID for direct lookup

    try:
        url = f"https://api-v3.raydium.io/pools/info/ids?ids={pool_id_candidate}"
        async with httpx.AsyncClient() as client:
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()

            if data.get("success") and data.get("data"):
                # Raydium V3 returns a list of pools, even for a single ID query
                pools = data["data"]
                if pools:
                    pool = pools[0] # Take the first pool if multiple are returned (should be 1 for ID query)
                    
                    # Extracting relevant information based on Raydium V3 response structure
                    return {
                        "type": pool.get("type"),
                        "programId": pool.get("programId"),
                        "id": pool.get("id"),
                        "mintA": pool.get("mintA"), # Returns the entire mintA dictionary
                        "mintB": pool.get("mintB"), # Returns the entire mintB dictionary
                        "config": pool.get("config"), # Returns the entire config dictionary
                        "price": pool.get("price"),
                        "mintAmountA": pool.get("mintAmountA"),
                        "mintAmountB": pool.get("mintAmountB"),
                        "feeRate": pool.get("feeRate"),
                        "openTime": pool.get("openTime"),
                        "tvl": pool.get("tvl"),
                        "day": pool.get("day"), # Returns the entire day dictionary
                        "week": pool.get("week"), # Returns the entire week dictionary
                        "month": pool.get("month"), # Returns the entire month dictionary
                        "pooltype": pool.get("pooltype"),
                        "rewardDefaultInfos": pool.get("rewardDefaultInfos"),
                        "farmUpcomingCount": pool.get("farmUpcomingCount"),
                        "farmOngoingCount": pool.get("farmOngoingCount"),
                        "farmFinishedCount": pool.get("farmFinishedCount"),
                        "lpMint": pool.get("lpMint"), # Returns the entire lpMint dictionary
                        "lpPrice": pool.get("lpPrice"),
                        "lpAmount": pool.get("lpAmount"),
                        "burnPercent": pool.get("burnPercent"), 
                        "launchMigratePool": pool.get("launchMigratePool")
                    }
            logger.info(f"No Raydium V3 pool found for ID: {pool_id_candidate}")
            return None
    except httpx.HTTPStatusError as e:
        logger.error(f"HTTP error fetching Raydium V3 pool info for {pool_id_candidate}: {e.response.status_code} - {e.response.text}")
        return None
    except httpx.RequestError as e:
        logger.error(f"Network error fetching Raydium V3 pool info for {pool_id_candidate}: {e}")
        return None
    except Exception as e:
        logger.error(f"An unexpected error occurred while fetching Raydium V3 pool info for {pool_id_candidate}: {e}")
        return None







# Example usage (for testing)
# async def main():
#     # --- Raydium V3 Pool Info Test ---
#     test_raydium_pool_id = "FTvEjJSKyckm2LXWJrvEbNB6PjpL1FV8M3NJnH8qWdbu"
#     print(f"\n--- Fetching Raydium V3 Pool Info for ID: {test_raydium_pool_id} ---")
#     raydium_pool = await get_raydium_pool_info(test_raydium_pool_id)
#     if raydium_pool:
#         import json
#         print(json.dumps(raydium_pool, indent=2))
#     else:
#         print(f"Failed to fetch Raydium V3 pool info for ID: {test_raydium_pool_id}")


# if __name__ == "__main__":
#     import asyncio
#     asyncio.run(main())










class RaydiumDataNotReadyError(Exception):
    """Custom exception for when Raydium data isn't populated yet"""
    pass

def is_raydium_data_ready(data: Dict) -> bool:
    """Check if Raydium API has populated the necessary data"""
    if not data or not isinstance(data, dict):
        return False
    
    # Check if we have the basic pool structure
    if not data.get("data") or not isinstance(data["data"], list) or len(data["data"]) == 0:
        return False
    
    pool = data["data"][0]
    
    # Check for critical fields that should be populated
    required_fields = ["mintA", "mintB", "openTime", "tvl"]
    for field in required_fields:
        if not pool.get(field):
            return False
    
    # Check if TVL is more than just a placeholder (0 or very small)
    tvl = pool.get("tvl", 0)
    if tvl == 0 or (isinstance(tvl, (int, float)) and tvl < 0.1):
        return False
    
    # Check if mint amounts are populated
    mint_amount_a = pool.get("mintAmountA", 0)
    mint_amount_b = pool.get("mintAmountB", 0)
    if mint_amount_a == 0 or mint_amount_b == 0:
        return False
    
    return True

@retry(
    stop=stop_after_attempt(8),  # Increased attempts for Raydium
    wait=wait_exponential(multiplier=2, min=5, max=60),  # Longer waits: 5s, 10s, 20s, 40s, 60s...
    retry=retry_if_exception_type(RaydiumDataNotReadyError)
)
async def get_raydium_pool_info_with_retry(pool_id: str) -> Dict[str, Any]:
    """
    Enhanced Raydium pool info fetcher with proper retry logic
    for new pools that take time to populate data
    """
    try:
        logger.info(f"🔍 Fetching Raydium data for {pool_id[:8]}...")
        data = await get_raydium_pool_info(pool_id)
        
        if not is_raydium_data_ready(data):
            logger.warning(f"⚠️ Raydium data not ready for {pool_id[:8]}, retrying...")
            raise RaydiumDataNotReadyError(f"Raydium data not populated for {pool_id}")
        
        logger.info(f"✅ Raydium data ready for {pool_id[:8]}")
        return data
        
    except Exception as e:
        if isinstance(e, RaydiumDataNotReadyError):
            raise  # Re-raise for tenacity
        logger.error(f"❌ Error fetching Raydium data for {pool_id[:8]}: {e}")
        raise RaydiumDataNotReadyError(f"Raydium API error: {e}")

async def wait_for_raydium_data(pool_id: str, max_wait_seconds: int = 300) -> Optional[Dict[str, Any]]:
    """
    Wait for Raydium data to be populated with timeout
    """
    start_time = asyncio.get_event_loop().time()
    
    while (asyncio.get_event_loop().time() - start_time) < max_wait_seconds:
        try:
            data = await get_raydium_pool_info_with_retry(pool_id)
            if is_raydium_data_ready(data):
                return data
        except RaydiumDataNotReadyError:
            # Wait before next attempt
            await asyncio.sleep(10)
        except Exception as e:
            logger.error(f"Unexpected error waiting for Raydium data: {e}")
            await asyncio.sleep(10)
    
    logger.error(f"⏰ Timeout waiting for Raydium data for {pool_id[:8]}")
    return None


