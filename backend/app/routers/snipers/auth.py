import base64
import os
import traceback
import redis.asyncio as redis
import uuid
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.database import get_db
from app.schemas.snipers.token import TokenResponse
from app.schemas.snipers.wallet import VerifyWalletRequest, WalletRegisterRequest
from app.security import create_access_token, encrypt_private_key_backend
from app.models import User, UserRole
from app.utils.bot_logger import get_logger
from cryptography.fernet import Fernet
from app.middleware.rate_limiter import rate_limit
from solders.pubkey import Pubkey
from solders.keypair import Keypair
from nacl.signing import VerifyKey
from nacl.exceptions import BadSignatureError
from app.config import settings

logger = get_logger(__name__)

router = APIRouter(prefix="/auth", tags=["Auth"])

import redis.asyncio as redis

# Add this at the top of your file (after imports)
async def strict_limit(request: Request):
    return await rate_limit(request, calls=5, per_seconds=60)

async def normal_limit(request: Request):
    return await rate_limit(request, calls=10, per_seconds=60)

# FORCE BYTES — THIS IS THE MISSING PIECE
redis_client = redis.Redis(
    host=settings.REDIS_HOST,
    port=6379,
    db=0,
    decode_responses=False,   # ← MUST be False
    encoding="utf-8",
    socket_connect_timeout=5,
    socket_timeout=5
)

@router.get("/get-nonce")
async def get_nonce(_: bool = Depends(normal_limit)):
    try:
        nonce = str(uuid.uuid4())
        nonce_id = base64.urlsafe_b64encode(os.urandom(16)).decode("utf-8")
        # await redis_client.setex(f"nonce:{nonce_id}", 300, nonce)
        await redis_client.setex(f"nonce:{nonce_id}", 300, nonce.encode('utf-8'))
        logger.info(f"Generated nonce: {nonce_id}")
        return {"nonce_id": nonce_id, "nonce": nonce}
    except Exception as e:
        logger.error(f"Failed to generate nonce: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to generate nonce")

@router.get("/get-frontend-encryption-key")
async def get_frontend_encryption_key(_: bool = Depends(rate_limit)):
    try:
        # Generate proper Fernet key (bytes)
        fernet_key_bytes = Fernet.generate_key()  # ← bytes: b'gAAAAAB...'
        # key_id = base64.urlsafe_b64encode(os.urandom(16)).rstrip(b'=').decode()
        key_id = base64.urlsafe_b64encode(os.urandom(16)).decode()

        # Store the RAW BYTES in Redis
        await redis_client.setex(f"frontend_key:{key_id}", 300, fernet_key_bytes)

        # Send the key as standard base64 string (with + and /)
        key_b64_str = fernet_key_bytes.decode('utf-8')

        logger.info(f"Generated frontend encryption key: {key_id}")
        return {"key_id": key_id, "key": key_b64_str}

    except Exception as e:
        logger.error(f"Failed to generate encryption key: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to generate encryption key")
    
    
@router.post("/verify-wallet")
async def verify_wallet(
    data: VerifyWalletRequest,
    db: AsyncSession = Depends(get_db),
    _: bool = Depends(strict_limit)  # ← NOW WORKS
):
    wallet_address = data.wallet_address
    signature = data.signature
    nonce_id = data.nonce_id
    try:
        nonce_bytes = await redis_client.get(f"nonce:{nonce_id}")
        if not nonce_bytes:
            logger.error(f"Nonce not found or expired for nonce_id: {nonce_id}")
            raise HTTPException(status_code=400, detail="Nonce not found or expired")

        # FIX: Handle bytes from Redis
        nonce = nonce_bytes.decode('utf-8') if isinstance(nonce_bytes, bytes) else nonce_bytes

        pubkey = Pubkey.from_string(wallet_address)
        verify_key = VerifyKey(bytes(pubkey))
        signature_bytes = bytes.fromhex(signature)

        try:
            verify_key.verify(nonce.encode(), signature_bytes)
        except BadSignatureError:
            logger.error(f"Invalid signature for wallet: {wallet_address}")
            raise HTTPException(status_code=400, detail="Invalid signature")

        await redis_client.delete(f"nonce:{nonce_id}")
        logger.info(f"Wallet verified successfully: {wallet_address}")
        return {"status": "Wallet verified"}

    except Exception as e:
        logger.error(f"Wallet verification failed: {str(e)}")
        raise HTTPException(status_code=400, detail=f"Verification failed: {str(e)}")


from sqlalchemy.dialects.postgresql import insert
from sqlalchemy import update

# @router.post("/register-or-login")
# async def register_or_login_wallet(
#     request: WalletRegisterRequest,
#     db: AsyncSession = Depends(get_db),
#     _: bool = Depends(strict_limit)
# ):
#     try:
#         wallet_address = request.wallet_address
#         encrypted_private_key_bundle = request.encrypted_private_key_bundle
#         key_id = request.key_id

#         # === Decrypt the private key sent from frontend ===
#         temp_key_bytes = await redis_client.get(f"frontend_key:{key_id}")
#         print(f"KEY_ID FROM FRONTEND: '{key_id}'")
#         print(f"REDIS LOOKUP RESULT: {temp_key_bytes}")
#         if not temp_key_bytes:
#             logger.error(f"Temporary key expired or not found: {key_id}")
#             raise HTTPException(status_code=400, detail="Encryption key expired. Please refresh.")

#         try:
#             fernet = Fernet(temp_key_bytes)  # temp_key_bytes is already bytes

#             # Fix URL-safe base64 padding
#             token_fixed = encrypted_private_key_bundle \
#                 .replace('-', '+') \
#                 .replace('_', '/') \
#                 + '=' * ((4 - len(encrypted_private_key_bundle) % 4) % 4)

#             decrypted_bytes = fernet.decrypt(token_fixed.encode('utf-8'))
#             raw_private_key_base64 = decrypted_bytes.decode('utf-8')
#             raw_private_key_bytes = base64.b64decode(raw_private_key_base64)

#             if len(raw_private_key_bytes) != 64:
#                 raise HTTPException(status_code=400, detail="Invalid private key length")

#         except Exception as e:
#             logger.error(f"Decryption failed | key_id: {key_id} | error: {e}")
#             raise HTTPException(status_code=400, detail="Failed to decrypt wallet. Please try again.")

#         # === Encrypt private key with backend master key ===
#         backend_encrypted_pk = encrypt_private_key_backend(raw_private_key_bytes)
#         logger.info(f"Private key encrypted with backend master key for {wallet_address}")

#         # === ATOMIC UPSERT: Insert new user if not exists (safe under concurrency) ===
#         insert_stmt = insert(User).values(
#             wallet_address=wallet_address,
#             encrypted_private_key=backend_encrypted_pk,
#             # Default settings (adjust if you have more defaults in your model)
#             is_premium=False,
#             buy_amount_sol=0.1,
#             buy_slippage_bps=1000,
#             sell_take_profit_pct=50.0,
#             sell_stop_loss_pct=20.0,
#             sell_timeout_seconds=3600,
#             sell_slippage_bps=1000,
#             bot_check_interval_seconds=10,
#             partial_sell_pct=70.0,
#             trailing_sl_pct=15.0,
#             rug_liquidity_drop_pct=20.0,
#         )

#         # If user already exists → do nothing (no error)
#         do_nothing_stmt = insert_stmt.on_conflict_do_nothing(
#             index_elements=['wallet_address']  # your primary key
#         )
#         await db.execute(do_nothing_stmt)

#         # === Always update the encrypted private key (important on re-login) ===
#         update_stmt = (
#             update(User)
#             .where(User.wallet_address == wallet_address)
#             .values(encrypted_private_key=backend_encrypted_pk)
#         )
#         await db.execute(update_stmt)

#         await db.commit()

#         # === Fetch the user (now guaranteed to exist) ===
#         result = await db.execute(select(User).where(User.wallet_address == wallet_address))
#         user = result.scalar_one()

#         # Clean up the temporary key
#         await redis_client.delete(f"frontend_key:{key_id}")

#         # Generate JWT
#         access_token = await create_access_token(data={"sub": user.wallet_address})

#         logger.info(f"User successfully logged in / registered: {wallet_address}")

#         return TokenResponse(
#             access_token=access_token,
#             token_type="bearer",
#             wallet_address=user.wallet_address
#         )

#     except HTTPException:
#         raise
#     except Exception as e:
#         logger.error(f"Unexpected error in register-or-login: {traceback.format_exc()}")
#         raise HTTPException(status_code=500, detail="Internal server error") 
    
# app/routers/snipers/auth.py

@router.post("/register-or-login")
async def register_or_login_wallet(
    request: WalletRegisterRequest,
    db: AsyncSession = Depends(get_db),
    _: bool = Depends(strict_limit)
):
    try:
        wallet_address = request.wallet_address
        encrypted_private_key_bundle = request.encrypted_private_key_bundle
        key_id = request.key_id

        # === Decrypt the private key sent from frontend ===
        temp_key_bytes = await redis_client.get(f"frontend_key:{key_id}")
        print(f"KEY_ID FROM FRONTEND: '{key_id}'")
        print(f"REDIS LOOKUP RESULT: {temp_key_bytes}")
        if not temp_key_bytes:
            logger.error(f"Temporary key expired or not found: {key_id}")
            raise HTTPException(status_code=400, detail="Encryption key expired. Please refresh.")

        try:
            fernet = Fernet(temp_key_bytes)
            token_fixed = encrypted_private_key_bundle \
                .replace('-', '+') \
                .replace('_', '/') \
                + '=' * ((4 - len(encrypted_private_key_bundle) % 4) % 4)

            decrypted_bytes = fernet.decrypt(token_fixed.encode('utf-8'))
            raw_private_key_base64 = decrypted_bytes.decode('utf-8')
            raw_private_key_bytes = base64.b64decode(raw_private_key_base64)

            if len(raw_private_key_bytes) != 64:
                raise HTTPException(status_code=400, detail="Invalid private key length")

        except Exception as e:
            logger.error(f"Decryption failed | key_id: {key_id} | error: {e}")
            raise HTTPException(status_code=400, detail="Failed to decrypt wallet. Please try again.")

        # === Encrypt private key with backend master key ===
        backend_encrypted_pk = encrypt_private_key_backend(raw_private_key_bytes)
        logger.info(f"Private key encrypted with backend master key for {wallet_address}")

        # === ATOMIC UPSERT: Insert new user if not exists (safe under concurrency) ===
        # FIX: Use the correct column names that match your User model
        # insert_stmt = insert(User).values(
        #     wallet_address=wallet_address,
        #     encrypted_private_key=backend_encrypted_pk,
        #     # Default settings - using the correct column names from your User model
        #     is_premium=False,
        #     # CORRECTED: Use sniper_ prefix for these fields
        #     sniper_buy_amount_sol=0.1,  # Changed from buy_amount_sol
        #     sniper_buy_slippage_bps=1000,  # Changed from buy_slippage_bps
        #     sniper_sell_take_profit_pct=50.0,  # Changed from sell_take_profit_pct
        #     sniper_sell_stop_loss_pct=20.0,  # Changed from sell_stop_loss_pct
        #     sniper_sell_timeout_seconds=3600,  # Changed from sell_timeout_seconds
        #     sniper_sell_slippage_bps=1000,  # Changed from sell_slippage_bps
        #     sniper_bot_check_interval_seconds=10,  # Changed from bot_check_interval_seconds
        #     sniper_partial_sell_pct=70.0,  # Changed from partial_sell_pct
        #     sniper_trailing_sl_pct=15.0,  # Changed from trailing_sl_pct
        #     sniper_rug_liquidity_drop_pct=20.0,  # Changed from rug_liquidity_drop_pct
        #     # Add other default values for required fields
        #     role=UserRole.SNIPER,
        #     creator_enabled=False,
        #     creator_total_launches=0,
        #     creator_successful_launches=0,
        #     creator_total_profit=0.0,
        #     creator_average_roi=0.0,
        #     creator_wallet_balance=0.0,
        #     creator_min_balance_required=5.0,
        #     default_bot_count=5,
        #     default_bot_buy_amount=0.05,
        #     default_creator_buy_amount=0.5,
        #     default_sell_strategy_type="volume_based",
        #     total_volume_sol=0.0,
        #     total_fees_paid_sol=0.0,
        #     total_trades=0,
        #     fee_tier="standard",
        #     prefer_ata_reuse=True,
        #     ata_rent_paid_sol=0.0,
        #     jito_reserved_tip_amount=0.0,
        #     jito_current_tip_balance=0.0,
        #     jito_tip_per_tx=100_000,
        #     jito_tip_account_initialized=False,
        # )

        insert_stmt = insert(User).values(
        wallet_address=wallet_address,
        encrypted_private_key=backend_encrypted_pk,

        # === Sniper defaults (these do NOT have model defaults in some cases, so keep them) ===
        is_premium=False,
        sniper_buy_amount_sol=0.1,
        sniper_buy_slippage_bps=1000,
        sniper_sell_take_profit_pct=50.0,
        sniper_sell_stop_loss_pct=20.0,
        sniper_sell_timeout_seconds=3600,
        sniper_sell_slippage_bps=1000,
        sniper_bot_check_interval_seconds=10,
        sniper_partial_sell_pct=70.0,
        sniper_trailing_sl_pct=15.0,
        sniper_rug_liquidity_drop_pct=20.0,

        # === Only set fields that have NO default in the model or must be explicit ===
        role=UserRole.SNIPER,  # Has default, but safe to set
        creator_enabled=False,  # Has default, but we want to be explicit on first login

        # === DO NOT SET ANY OF THESE — let model defaults apply ===
        # creator_total_launches=0,
        # creator_successful_launches=0,
        # creator_total_profit=0.0,
        # creator_average_roi=0.0,
        # creator_wallet_balance=0.0,
        # creator_min_balance_required=5.0,          ← REMOVE THIS LINE!
        # default_bot_count=5,                       ← REMOVE
        # default_bot_buy_amount=0.05,               ← REMOVE
        # default_creator_buy_amount=0.5,            ← REMOVE
        # default_sell_strategy_type="volume_based", ← REMOVE
        # total_volume_sol=0.0,
        # total_fees_paid_sol=0.0,
        # total_trades=0,
        # fee_tier="standard",
        # prefer_ata_reuse=True,
        # ata_rent_paid_sol=0.0,
        # jito_reserved_tip_amount=0.0,
        # jito_current_tip_balance=0.0,
        # jito_tip_per_tx=100_000,
        # jito_tip_account_initialized=False,

        # These are safe to omit — all have defaults in the model
    )
            
        # If user already exists → do nothing (no error)
        do_nothing_stmt = insert_stmt.on_conflict_do_nothing(
            index_elements=['wallet_address']
        )
        await db.execute(do_nothing_stmt)

        # === Always update the encrypted private key (important on re-login) ===
        update_stmt = (
            update(User)
            .where(User.wallet_address == wallet_address)
            .values(encrypted_private_key=backend_encrypted_pk)
        )
        await db.execute(update_stmt)

        await db.commit()

        # === Fetch the user (now guaranteed to exist) ===
        result = await db.execute(select(User).where(User.wallet_address == wallet_address))
        user = result.scalar_one()

        # Clean up the temporary key
        await redis_client.delete(f"frontend_key:{key_id}")

        # Generate JWT
        access_token = await create_access_token(data={"sub": user.wallet_address})

        logger.info(f"User successfully logged in / registered: {wallet_address}")

        return TokenResponse(
            access_token=access_token,
            token_type="bearer",
            wallet_address=user.wallet_address
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in register-or-login: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail="Internal server error")
    
    
async def rotate_master_key(old_key: str, new_key: str, db: AsyncSession):
    try:
        old_fernet = Fernet(old_key.encode())
        new_fernet = Fernet(new_key.encode())
        result = await db.execute(select(User))
        users = result.scalars().all()
        for user in users:
            raw_pk = old_fernet.decrypt(user.encrypted_private_key)
            user.encrypted_private_key = new_fernet.encrypt(raw_pk)
        await db.commit()
        logger.info("Master key rotation completed successfully")
    except Exception as e:
        logger.error(f"Master key rotation failed: {str(e)}")
        raise HTTPException(status_code=500, detail="Master key rotation failed")
    
    
    