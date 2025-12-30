# scripts/migrate_bot_wallets.py
import asyncio
import base58
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import select
from app.models import BotWallet, User
from app.security import encrypt_private_key_backend
from app.config import settings

async def migrate_bot_wallets():
    engine = create_async_engine(settings.DATABASE_URL)
    AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    async with AsyncSessionLocal() as db:
        # Get all bot wallets with unencrypted private keys
        stmt = select(BotWallet).where(BotWallet.encrypted_private_key == None)  # Adjust based on your column name
        result = await db.execute(stmt)
        bot_wallets = result.scalars().all()
        
        print(f"Found {len(bot_wallets)} bot wallets to migrate")
        
        for wallet in bot_wallets:
            try:
                # If you have old base58 private keys
                if hasattr(wallet, 'private_key_base58') and wallet.private_key_base58:
                    # Decode base58
                    private_key_bytes = base58.b58decode(wallet.private_key_base58)
                    
                    # Encrypt with backend master key
                    encrypted_key = encrypt_private_key_backend(private_key_bytes)
                    
                    # Update wallet
                    wallet.encrypted_private_key = encrypted_key
                    
                    print(f"Migrated wallet: {wallet.public_key[:8]}...")
                    
            except Exception as e:
                print(f"Failed to migrate wallet {wallet.public_key[:8]}: {e}")
                continue
        
        await db.commit()
        print("Migration complete!")

if __name__ == "__main__":
    asyncio.run(migrate_bot_wallets())
    
    