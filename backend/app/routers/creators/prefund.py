import asyncio
from datetime import datetime
import json 
import logging
from typing import Dict, List, Optional
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import User, BotWallet, BotStatus
from app.schemas.creators.tokencreate import BotWalletStatus, PreFundRequest, PreFundResponse
from app.security import get_current_user
from app.utils import redis_client
from app.services.onchain_integration import onchain_client


logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/creators/prefund",
    tags=['Bot Pre-Funding']
)


class BotPreFundingManager:
    """Managees bot wallet pre-funding"""
    
    def __init__(self, user: User, db: AsyncSession):
        self.user = user 
        self.db = db 
        
    async def get_available_bots(self, count: int) -> List[BotWallet]:
        """Get available bot wallets for pre-funding"""
        stmt = select(BotWallet).where(
            BotWallet.user_wallet_address == self.user.wallet_address,
            BotWallet.status.in_([BotStatus.PENDING, BotStatus.READY]),
            BotWallet.is_pre_funded == False
        ).limit(count)
        
        result = await self.db.execute(stmt)
        bots = result.scalars().all()
        
        if len(bots) < count:
            # Try to generate more bots if needed
            bots_needed = count - len(bots)
            await self._generate_more_bots(bots_needed)
            
            # Try again
            result = await self.db.execute(stmt)
            bots = result.scalars().all()
        
        return bots 
    
    async def _generate_more_bots(self, count: int):
        """Generate additional bot wallets if needed"""
        try:
            from app.routers.creators.user import generate_bot_wallets_for_user
            
            await generate_bot_wallets_for_user(
                self.user.wallet_address,
                self.db,
                count
            )
            await asyncio.sleep(1)  # Give time for generation
        except Exception as e:
            logger.error(f"Failed to generate more bots: {e}")


    async def pre_fund_bots(
        self,
        bot_wallets: List[BotWallet],
        pre_fund_amount: float,
        buy_amount: float 
    ) -> Dict:
        """Pre-fund bot wallets with SOL"""
        
        # Validate amounts
        if pre_fund_amount <= buy_amount:
            raise ValueError("Pre-fund amount must be greater than buy amount")
        
        if buy_amount <= 0:
            raise ValueError("Buy amount must be positive")
        
        # Prepare bot configs for on-chain service
        bot_configs = []
        for wallet in bot_wallets:
            bot_configs.append({
                "public_key": wallet.public_key,
                "amount_sol": pre_fund_amount
            })
        
        try:
            # Call on-chain service to pre-fund
            result = await onchain_client.fund_bots(
                user_wallet=self.user.wallet_address,
                bot_wallets=bot_configs,
                use_jito=True   # Always use Jito for pre-funding for speed
            )
            
            if not result.get("success"):
                error_msg = result.get("error", "Unknown error")
                raise Exception(f"Pre-funding failed: {error_msg}")
            
            # Update bot wallet status
            signatures = result.get("signatures", [])
            for i, wallet in enumerate(bot_wallets):
                wallet.is_pre_funded = True 
                wallet.pre_funded_amount = pre_fund_amount
                wallet.pre_funded_tx_hash = signatures[i] if i < len(signatures) else None 
                wallet.funded_amount = buy_amount   # Set the intended buy amount
                wallet.current_balance = pre_fund_amount
                wallet.status = BotStatus.FUNDED
                wallet.last_updated = datetime.utcnow()
            
            await self.db.commit()
            
            return {
                "success": True,
                "pre_funded_count": len(bot_wallets),
                "total_pre_funded": pre_fund_amount * len(bot_wallets),
                "signatures": signatures,
                "bundle_id": result.get("bundle_id")
            }
            
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Bot pre-funding failed: {e}", exc_info=True)
            raise 



@router.post("/fund-bot-wallets", response_model=PreFundResponse)
async def pre_fund_bot_wallets(
    request: PreFundRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Pre-fund bot wallets before launch
    """
    try:
        # Validate amounts
        if request.pre_fund_amount <= request.buy_amount:
            raise HTTPException(status_code=400, detail=f"Pre-fund amount ({request.pre_fund_amount}) must be greater than buy amount ({request.buy_amount})")
        
        if request.buy_amount <= 0:
            raise HTTPException(status_code=500, detail="Buy amount must be positive")
        
        # Check user balance
        from app.routers.creators.user import get_sol_balance
        user_balance = await get_sol_balance(current_user.wallet_address)
        
        total_required = request.pre_fund_amount * request.bot_count
        if user_balance < total_required * 1.1: # 10% buffer
            raise HTTPException(status_code=400, detail=f"Insufficient balance. Need {total_required:.4f} SOL for {request.bot_count} bots, have {user_balance:.4f} SOL")
        
        # Initialize manager
        manager = BotPreFundingManager(current_user, db)
        
        # Get available bots
        bots = await manager.get_available_bots(request.bot_count)
        
        if len(bots) < request.bot_count:
            raise HTTPException(status_code=400, detail=f"Only {len(bots)} bot wallets available. Need {request.bot_count}")
        
        # Pre-fund bots
        result = await manager.pre_fund_bots(
            bots,
            request.pre_fund_amount,
            request.buy_amount
        )
        
        # Cache pre-funded bot info
        await redis_client.setex(
            f"prefund:{current_user.wallet_address}",
            3600,   # 1 hour
            json.dumps({
                "bot_count": len(bots),
                "pre_fund_amount": request.pre_fund_amount,
                "buy_amount": request.buy_amount,
                "timestamp": datetime.utcnow().isoformat()
            })
        )
        
        return PreFundResponse(
            success=True,
            message=f"Successfully pre-funded {len(bots)} bot wallets",
            pre_funded_count=len(bots),
            total_pre_funded=request.pre_fund_amount * len(bots),
            signatures=result.get("signatures", []),
            bundle_id=result.get("bundle_id")
        )
        
    except HTTPException:
        raise 
    except Exception as e:
        logger.error(f"Pre-funding failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Pre-funding failed: {str(e)}")

@router.get("/get-funded-bot-wallets", response_model=List[BotWalletStatus])
async def get_pre_funded_bots(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get list of pre-funded bot wallets"""
    try:
        stmt = select(BotWallet).where(
            BotWallet.user_wallet_address == current_user.wallet_address,
            BotWallet.is_pre_funded == True,
            BotWallet.status == BotStatus.FUNDED
        ).order_by(BotWallet.created_at.desc())
        
        result = await db.execute(stmt)
        bots = result.scalars().all()
        
        bot_statuses = []
        for bot in bots:
            bot_statuses.append(BotWalletStatus(
                id=bot.id,
                public_key=bot.public_key,
                status=bot.status.value,
                pre_funded_amount=bot.pre_funded_amount,
                funded_amount=bot.funded_amount,
                current_balance=bot.current_balance,
                is_pre_funded=bot.is_pre_funded,
                pre_funded_tx_hash=bot.pre_funded_tx_hash,
                created_at=bot.created_at,
                last_updated=bot.last_updated
            ))
        
        return bot_statuses
    
    except Exception as e:
        logger.error(f"Failed to get pre-funded bots: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get pre-funded bots: {str(e)}")


@router.post("/reset/{bot_id}")
async def reset_bot_pre_funding(
    bot_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Reset a bot's pre-funding status (if pre-funding failed)"""
    try:
        stmt = select(BotWallet).where(
            BotWallet.id == bot_id,
            BotWallet.user_wallet_address == current_user.wallet_address
        )
        
        result = await db.execute(stmt)
        bot = result.scalar_one_or_none()
        
        if not bot:
            raise HTTPException(status_code=404, detail="Bot wallet not found")
        
        # Reset pre-funding status
        bot.is_pre_funded = False 
        bot.pre_funded_amount = None
        bot.pre_funded_tx_hash = None 
        bot.current_balance = 0.0
        bot.status = BotStatus.PENDING
        bot.last_updated = datetime.utcnow()
        
        await db.commit()
        
        return {
            "success": True,
            "message": f"Bot wallet {bot.public_key[:8]}... reset successfully",
            "bot_id": bot_id 
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to reset bot pre-funding: {e}")
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to reset bot pre-funding: {str(e)}")

