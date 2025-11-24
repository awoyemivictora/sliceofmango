import logging
import httpx

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def get_dexscreener_data(mint_address: str) -> dict:
    """
    Asynchronously fetches pool data from Dexscreener for the given token mint on Solana.
    Extracts the following fields:
      - dexscreener_url: The URL for the pool on Dexscreener.
      - pair_address: The pool's pair address.
      - price_native: The native price as a string.
      - price_usd: The USD price as a string.
      - liquidity: The liquidity in USD.
      - market_cap: The market capitalization.
      - pair_created_at: The timestamp (epoch) when the pair was created.
      - websites: Concatenated website URLs (if any).
      - twitter: The Twitter URL from socials.
      - telegram: The Telegram URL from socials.
      - token_name: The name of the base token.
      - token_symbol: The symbol of the base token.
      - dex_id: The DEX identifier.
      - volume_h24: 24-hour trading volume.
      - volume_h6: 6-hour trading volume.
      - volume_h1: 1-hour trading volume.
      - volume_m5: 5-minute trading volume.
      - price_change_m5: 5-mins price change percentage.
      - price_change_h1: 1-hour price change percentage.
      - price_change_h6: 6-hour price change percentage.
      - price_change_h24: 24-hour price change percentage.
    Returns a dict with these fields (or default values if not found).
    """
    url = f"https://api.dexscreener.com/token-pairs/v1/solana/{mint_address}"
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()
        
        # Dexscreener returns an array of pool objects.
        if not data or not isinstance(data, list) or len(data) == 0:
            logger.info(f"No Dexscreener data found for {mint_address}")
            return {}
        
        # We'll use the first pool for our data.
        pool = data[0]

        # Extract basic fields.
        dexscreener_url = pool.get("url", "")
        pair_address = pool.get("pairAddress", "")
        price_native = pool.get("priceNative", "")
        price_usd = pool.get("priceUsd", "")
        liquidity_obj = pool.get("liquidity", {})
        liquidity_usd = liquidity_obj.get("usd", 0.0)
        market_cap = pool.get("marketCap", 0.0)
        pair_created_at = pool.get("pairCreatedAt", 0)
        dex_id = pool.get("dexId", "")
        fdv = pool.get("fdv", 0.0)

        # Extract base token info
        base_token = pool.get("baseToken", {})
        token_name = base_token.get("name", "")
        token_symbol = base_token.get("symbol", "")

        # Extract volume data
        volume = pool.get("volume", {})
        volume_h24 = volume.get("h24", 0.0)
        volume_h6 = volume.get("h6", 0.0)
        volume_h1 = volume.get("h1", 0.0)
        volume_m5 = volume.get("m5", 0.0)

        # Extract price change data
        price_change = pool.get("priceChange", {})
        price_change_h1 = price_change.get("h1", 0.0)
        price_change_m5 = price_change.get("m5", 0.0)
        price_change_h6 = price_change.get("h6", 0.0)
        price_change_h24 = price_change.get("h24", 0.0)

        # Extract websites and socials from the "info" object.
        info = pool.get("info", {})
        # For websites, the API returns an array; join them if available.
        websites_list = info.get("websites", [])
        if websites_list and isinstance(websites_list, list):
            # Each item is expected to be a dict with a "url" key.
            websites = ", ".join([item.get("url", "").strip() for item in websites_list if item.get("url")])
            if not websites:
                websites = "N/A"
        else:
            websites = "N/A"

        # For socials, iterate over the array to find Twitter and Telegram.
        socials = info.get("socials", [])
        twitter = "N/A"
        telegram = "N/A"
        if socials and isinstance(socials, list):
            for social in socials:
                social_type = social.get("type", "").lower()
                social_url = social.get("url", "").strip()
                if social_type == "twitter" and social_url:
                    twitter = social_url
                elif social_type == "telegram" and social_url:
                    telegram = social_url

        return {
            "dexscreener_url": dexscreener_url,
            "pair_address": pair_address,
            "price_native": price_native,
            "price_usd": price_usd,
            "liquidity": liquidity_usd,
            "market_cap": market_cap,  # Note: Fixed typo from 'market_cap' to match your docstring
            "pair_created_at": pair_created_at,
            "websites": websites,
            "twitter": twitter,
            "telegram": telegram,
            "token_name": token_name,
            "token_symbol": token_symbol,
            "dex_id": dex_id,
            "liquidity_usd": liquidity_obj.get("usd", 0.0),
            "fdv": pool.get("fdv", 0.0),
            "volume_h24": volume_h24,
            "volume_h6": volume_h6,
            "volume_h1": volume_h1,
            "volume_m5": volume_m5,
            "price_change_m5": price_change_m5,
            "price_change_h1": price_change_h1,
            "price_change_h6": price_change_h6,
            "price_change_h24": price_change_h24,
        }
    except httpx.HTTPStatusError as e:
        logger.error(f"HTTP error fetching Dexscreener data for {mint_address}: {e.response.status_code}")
        return {}
    except Exception as e:
        logger.error(f"Error fetching Dexscreener data for {mint_address}: {e}")
        return {}

