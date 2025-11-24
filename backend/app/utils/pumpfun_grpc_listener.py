# app/utils/pumpfun_grpc_listener.py
import asyncio
import logging
from datetime import datetime, timedelta
from app.database import AsyncSessionLocal
from app.models import NewTokens
from app.main import safe_enrich_token
from app.config import settings

logger = logging.getLogger(__name__)

# Use Yellowstone gRPC (Shyft, Helius, QuickNode)
GRPC_URL = settings.GRPC_URL  # or helius, quicknode, etc.
GRPC_TOKEN = settings.GRPC_TOKEN   # put in .env

# Pump.fun program
PUMPFUN_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"

async def pumpfun_migration_listener():
    """Listen for Pump.fun → Raydium migrations using account updates"""
    try:
        from triton_yellowstone_grpc import Client
        from triton_yellowstone_grpc.proto import SubscribeRequest, CommitmentLevel
    except ImportError:
        logger.error("Install triton-yellowstone-grpc: pip install triton-yellowstone-grpc")
        return

    client = Client(GRPC_URL, GRPC_TOKEN)
    
    request = SubscribeRequest(
        accounts={
            "pumpfun_migration": {
                "owner": [PUMPFUN_PROGRAM],
                "filters": [
                    {
                        "memcmp": {
                            "offset": "1",  # offset of 'complete' boolean in Pump.fun bonding curve
                            "bytes": "AQ==",  # base64 for 1 (True)
                        }
                    }
                ],
            }
        },
        commitment=CommitmentLevel.PROCESSED,
    )

    while True:
        try:
            logger.info("Pump.fun → Raydium migration listener started...")
            stream = await client.subscribe()

            # Error handling
            async def on_error(error):
                logger.error(f"gRPC stream error: {error}")
                raise error

            stream.on("error", on_error)

            # Subscribe
            await stream.write(request)

            async for data in stream:
                if not data.update_account:
                    continue

                account = data.update_account.account
                if not account:
                    continue

                # Decode account data
                try:
                    # First 8 bytes = discriminator, next is mint (44 bytes from offset 8+32+1?)
                    # Known layout: mint is at offset 48
                    mint_bytes = account.data[48:48+32]
                    mint = base58.b58encode(mint_bytes).decode()

                    if len(mint) != 44:
                        continue

                    logger.info(f"PUMPFUN → RAYDIUM MIGRATION DETECTED: {mint[:8]}...")

                    # Immediately trigger processing (no delay!)
                    async with AsyncSessionLocal() as db:
                        exists = await db.get(NewTokens, mint) or (
                            await db.execute(select(NewTokens).where(NewTokens.mint_address == mint))
                        ).scalar_one_or_none()

                        if not exists:
                            new_token = NewTokens(
                                mint_address=mint,
                                pool_id="pumpfun_migration",
                                timestamp=datetime.utcnow(),
                                signature="pumpfun",
                                tx_type="pumpfun_migration",
                                metadata_status="pending",
                                next_reprocess_time=datetime.utcnow() + timedelta(seconds=3),  # FAST!
                                dexscreener_processed=False,
                            )
                            db.add(new_token)
                            await db.commit()
                            logger.info(f"Pump.fun token queued for analysis: {mint}")

                            # Trigger analysis immediately
                            asyncio.create_task(safe_enrich_token(mint, db))

                except Exception as e:
                    logger.error(f"Error processing pump.fun migration: {e}")

        except Exception as e:
            logger.error(f"Pump.fun listener crashed: {e}")
            await asyncio.sleep(5)
            
            
            