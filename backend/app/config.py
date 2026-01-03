import os
from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict
from dotenv import load_dotenv
import redis

load_dotenv() # Load environment variables from .env file

class Settings(BaseSettings):
    ENVIRONMENT: str = os.getenv("ENVIRONMENT")
    model_config = SettingsConfigDict(env_file='.env', extra='ignore')

    DATABASE_URL: str = os.getenv("DATABASE_URL", "postgresql+asyncpg://user:password@localhost/solsniper_db")
    JWT_SECRET_KEY: str = os.getenv("JWT_SECRET_KEY", "your_super_secret_jwt_key") # Change this in production!
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30

    SOLANA_RPC_URL: str = os.getenv("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com")
    SOLANA_WEBSOCKET_URL: str = os.getenv("SOLANA_WEBSOCKET_URL", "wss://api.mainnet-beta.solana.com/")

    DEXSCREENER_API_URL: str = os.getenv("DEXSCREENER_API_URL", "https://api.dexscreener.com/latest/dex/tokens/")
    RUGCHECK_API_URL: str = os.getenv("RUGCHECK_API_URL", "https://api.rugcheck.xyz/v1/tokens/") # Confirm actual endpoint
    
    TWITTER_BEARER_TOKEN: Optional[str] = os.getenv("TWITTER_BEARER_TOKEN") # For Twitter API v2
    OPENAI_API_KEY: Optional[str] = os.getenv("OPENAI_API_KEY")
    
    STRIPE_PREMIUM_PRICE_ID: str = os.getenv("STRIPE_PREMIUM_PRICE_ID", "99")
    STRIPE_SECRET_KEY: str = os.getenv("STRIPE_SECRET_KEY", "")

    ENCRYPTION_KEY: str = os.getenv("ENCRYPTION_KEY", "a_very_strong_32_byte_key_for_aes_encryption!") # 32-byte key for AES256
    WEBACY_API_URL: str = os.getenv("WEBACY_API_URL", "https://api.webacy.com/v1/risk")
    WEBACY_TOKEN: str = os.getenv("WEBACY_TOKEN", "")
    
    REDIS_HOST: str = os.getenv("REDIS_HOST", "localhost")
    REDIS_PORT: int = int(os.getenv("REDIS_PORT", "6379"))  # Fixed: was "ე6379"
    REDIS_DB: int = int(os.getenv("REDIS_DB", "0"))
    
    DEX_AGGREGATOR_API_HOST: str = os.getenv("DEX_AGGREGATOR_API_HOST")
    TAVILY_API_KEY: str = os.getenv("TAVILY_API_KEY")
    
    JUPITER_PLATFORM_FEE_BPS: str = os.getenv("JUPITER_PLATFORM_FEE_BPS")
    JUPITER_REFERRAL_ACCOUNT: str = os.getenv("JUPITER_FEE_ACCOUNT")
    JUPITER_PLATFORM_FEE_BPS: str = os.getenv("JUPITER_PLATFORM_FEE_BPS")
    JUPITER_API_KEY: str = os.getenv("JUPITER_API_KEY", "")
    
    MIN_BUY_SOL: str = os.getenv("SOL_MINT")
    
    SOL_MINT: str = os.getenv("SOL_MINT")
    
    GRPC_URL: str = os.getenv("GRPC_URL")
    GRPC_TOKEN: str = os.getenv("GRPC_TOKEN")    
    
    PUMPFUN_PROGRAM: str = os.getenv("PUMPFUN_PROGRAM")
    RAYDIUM_PROGRAM: str = os.getenv("RAYDIUM_PROGRAM")
    RAYDIUM_FEE_ACCOUNT: str = os.getenv("RAYDIUM_FEE_ACCOUNT")
    
    BOT_OWNER_WALLET: str = os.getenv("BOT_OWNER_WALLET")
    BOT_OWNER_PRIVATE_KEY: str = os.getenv("BOT_OWNER_PRIVATE_KEY")
    
    
    JUPITER_REFERRAL_PROJECT: str = os.getenv("JUPITER_REFERRAL_PROJECT")
    
    # Jito Configuration
    JITO_BLOCK_ENGINE_URL: str = os.getenv("JITO_BLOCK_ENGINE_URL")
    JITO_MIN_TIP_LAMPORTS: int = os.getenv("JITO_MIN_TIP_LAMPORTS")
    JITO_MAX_TIP_LAMPORTS: int = os.getenv("JITO_MAX_TIP_LAMPORTS")
    JITO_USE_FOR_CRITICAL_TRADES: bool = os.getenv("JITO_USE_FOR_CRITICAL_TRADES")

    ONCHAIN_API_KEY: str = os.getenv("ONCHAIN_API_KEY")
    
    OPENAI_API_KEY: str = os.getenv("ONCHAIN_API_KEY")
    OPENAI_TIMEOUT: str = os.getenv("OPENAI_TIMEOUT")
    OPENAI_MODEL: str = os.getenv("OPENAI_MODEL")
    OPENAI_IMAGE_MODEL: str = os.getenv("OPENAI_IMAGE_MODEL")
    
    ONCHAIN_CLIENT_URL: str = os.getenv("ONCHAIN_CLIENT_URL")
    
    # Cloudflare R2 Settings
    CLOUDFLARE_R2_ACCOUNT_ID: str = ""
    CLOUDFLARE_R2_ACCESS_KEY_ID: str = ""
    CLOUDFLARE_R2_SECRET_ACCESS_KEY: str = ""
    CLOUDFLARE_R2_BUCKET_NAME: str = "flashsniper-assets"
    CLOUDFLARE_R2_PUBLIC_URL: str = "https://pub<your-bucket-id>.r2.dev"    # From R2 dashboard

    PINATA_API_KEY: str = ""
    PINATA_SECRET_KEY: str = ""
    PINATA_JWT: str = ""
    
    # IPFS Gateways (fallback options)
    IPFS_GATEWAYS: list = [
        "https://ipfs.io/ipfs/{cid}",
        "https://gateway.pinata.cloud/ipfs/{cid}",
        "https://cloudflare-ipfs.com/ipfs/{cid}"
    ]
    
    
settings = Settings()



# ----------------------------------------------------------------------
# Build the Redis client **after** settings are validated
# ----------------------------------------------------------------------
redis_client = redis.Redis(host=settings.REDIS_HOST, port=6379, db=0, decode_responses=False)

