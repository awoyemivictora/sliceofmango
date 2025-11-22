import base64
import os
import traceback
import redis.asyncio as redis
import uuid
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.database import get_db
from app.schemas import TokenResponse, VerifyWalletRequest, WalletRegisterRequest
from app.security import create_access_token, encrypt_private_key_backend
from app.models import User
from app.utils.bot_logger import get_logger
from cryptography.fernet import Fernet
from app.middleware.rate_limiter import rate_limit
from solders.pubkey import Pubkey
from solders.keypair import Keypair
from nacl.signing import VerifyKey
from nacl.exceptions import BadSignatureError
from app.config import settings
from jupiter_python_sdk.jupiter import Jupiter

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

        # === FIXED: Get the RAW BYTES from Redis (we stored bytes!) ===
        temp_key_bytes = await redis_client.get(f"frontend_key:{key_id}")
        print(f"KEY_ID FROM FRONTEND: '{key_id}'")
        print(f"REDIS LOOKUP RESULT: {temp_key_bytes}")
        if not temp_key_bytes:
            logger.error(f"Temporary key expired or not found: {key_id}")
            raise HTTPException(status_code=400, detail="Encryption key expired. Please refresh.")

        # === CRITICAL FIX: temp_key_bytes is BYTES, not string! ===
        try:
            fernet = Fernet(temp_key_bytes)  # ← Direct from bytes! No .encode()

            # Fix URL-safe base64 from frontend (our encrypt() uses - and _)
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
            logger.error(f"Decryption failed | key_id: {key_id} | error: {e} | token: {encrypted_private_key_bundle[:60]}...")
            raise HTTPException(status_code=400, detail="Failed to decrypt wallet. Please try again.")

        # === Rest of your logic (unchanged) ===
        backend_encrypted_pk = encrypt_private_key_backend(raw_private_key_bytes)
        logger.info(f"Private key encrypted with backend master key for {wallet_address}")

        result = await db.execute(select(User).filter_by(wallet_address=wallet_address))
        user = result.scalar_one_or_none()

        if user:
            user.encrypted_private_key = backend_encrypted_pk
            await db.commit()
            await db.refresh(user)
            logger.info(f"Existing user updated: {wallet_address}")
        else:
            user = User(wallet_address=wallet_address, encrypted_private_key=backend_encrypted_pk)
            db.add(user)
            await db.commit()
            await db.refresh(user)
            logger.info(f"New user registered: {wallet_address}")

        await redis_client.delete(f"frontend_key:{key_id}")

        access_token = await create_access_token(data={"sub": user.wallet_address})
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
    
    
    