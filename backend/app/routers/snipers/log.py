# from datetime import datetime
# import uuid
# from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
# from sqlalchemy.ext.asyncio import AsyncSession
# from sqlalchemy.future import select
# from app.database import get_db
# from app.models import User
# from app.dependencies import get_current_user_by_wallet
# from app.schemas.snipers.trade import SnipeResponse
# from app.utils.bot_logger import get_logger
# from typing import List, Dict, Any

# logger = get_logger(__name__)

# router = APIRouter(
#     prefix="/snipe",
#     tags=['Snipe']
# )


# @router.get("/all-snipes", response_model=List[SnipeResponse])
# async def get_user_snipe_logs(
#     current_user: User = Depends(get_current_user_by_wallet),
#     db: AsyncSession = Depends(get_db),
#     limit: int = 10,
#     offset: int = 0
# ):
#     """
#     Retrieves a list of a user's past snipe operations and their logs.
#     """
#     result = await db.execute(
#         select(Snipe)
#         .where(Snipe.user_wallet_address == current_user.wallet_address)
#         .order_by(Snipe.started_at.desc())
#         .limit(limit)
#         .offset(offset)
#     )
#     snipes = result.scalars().all()
#     logger.info(f"Retrieved {len(snipes)} snipe logs for user {current_user.wallet_address}")
#     return snipes




# @router.get("/{snipe_id}/full_log", response_model=Dict[str, Any])
# async def get_single_snipe_full_log(
#     snipe_id: str,
#     current_user: User = Depends(get_current_user_by_wallet),
#     db: AsyncSession = Depends(get_db)
# ):
#     """
#     Retrieves the full log details for a specific snipe operation.
#     """
#     result = await db.execute(select(Snipe).where(Snipe.id == snipe_id))
#     snipe_record = result.scalar_one_or_none()

#     if not snipe_record or snipe_record.user_wallet_address != current_user.wallet_address:
#         raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Snipe log not found or not authorized.")

#     logger.info(f"Retrieved full log for snipe {snipe_id} for user {current_user.wallet_address}")
#     return {"snipe_id": snipe_record.id, "logs": snipe_record.logs, "status": snipe_record.status}


# # In-memory store for active snipes and WebSocket connections
# # In a production system, this would be a distributed store like Redis
# # and sniping tasks would be managed by a job queue (e.g., Celery).
# active_snipes = {} # {snipe_id: {"user_wallet": ..., "task": ..., "status": ..., "logs": [...]}}
# active_connections: Dict[str, WebSocket] = {} # {wallet_address: websocket}

# async def run_snipe_task(
#     snipe_id: str,
#     user_wallet_address: str,
#     encrypted_private_key_hex: str,
#     token_address: str,
#     amount_sol: float,
#     slippage: float,
#     is_buy: bool,
#     db_session: AsyncSession # Pass a new session for the background task
# ):
#     """
#     The actual sniping logic that runs in the background.
#     This simulates the interaction with Solana DEXs.
#     """
#     logger.info(f"Starting snipe task {snipe_id} for user {user_wallet_address} on token {token_address}")
    
#     # Update snipe status in DB
#     try:
#         result = await db_session.execute(select(Snipe).where(Snipe.id == snipe_id))
#         snipe_record = result.scalar_one_or_none()
#         if snipe_record:
#             snipe_record.status = "active"
#             snipe_record.logs.append({"timestamp": str(uuid.uuid4()), "message": "Snipe task initiated."})
#             await db_session.commit()
#             await db_session.refresh(snipe_record)
            
#             # Send initial log to WebSocket
#             if user_wallet_address in active_connections:
#                 await active_connections[user_wallet_address].send_json(
#                     {"type": "snipe_log", "snipe_id": snipe_id, "message": "Snipe task initiated."}
#                 )

#         else:
#             logger.error(f"Snipe record {snipe_id} not found for update.")
#             return

#         transaction_signature = None
        
#         # Determine if it's a Pump.fun or Raydium snipe based on token or strategy
#         # For a real system, you'd have more sophisticated detection or user input
#         if "pump.fun" in token_address.lower() or "pumpfun" in token_address.lower(): # Simplified check
#             logger.info(f"Attempting Pump.fun buy for {token_address} with {amount_sol} SOL.")
#             snipe_record.logs.append({"timestamp": str(uuid.uuid4()), "message": f"Attempting Pump.fun buy for {token_address}..."})
#             await db_session.commit()
#             if user_wallet_address in active_connections:
#                 await active_connections[user_wallet_address].send_json(
#                     {"type": "snipe_log", "snipe_id": snipe_id, "message": f"Attempting Pump.fun buy for {token_address}..."}
#                 )
#             transaction_signature = await perform_pumpfun_buy(
#                 encrypted_private_key_hex,
#                 token_address,
#                 amount_sol,
#                 slippage
#             )
#         else:
#             logger.info(f"Attempting Raydium {'buy' if is_buy else 'sell'} for {token_address} with {amount_sol} SOL.")
#             snipe_record.logs.append({"timestamp": str(uuid.uuid4()), "message": f"Attempting Raydium {'buy' if is_buy else 'sell'} for {token_address}..."})
#             await db_session.commit()
#             if user_wallet_address in active_connections:
#                 await active_connections[user_wallet_address].send_json(
#                     {"type": "snipe_log", "snipe_id": snipe_id, "message": f"Attempting Raydium {'buy' if is_buy else 'sell'} for {token_address}..."}
#                 )
            
#             # For Raydium, mint_in and mint_out depend on is_buy
#             mint_in = "SOL" if is_buy else token_address
#             mint_out = token_address if is_buy else "SOL"
            
#             transaction_signature = await perform_raydium_swap(
#                 encrypted_private_key_hex,
#                 mint_in,
#                 mint_out,
#                 amount_sol,
#                 slippage,
#                 is_buy
#             )

#         if transaction_signature:
#             snipe_record.status = "completed"
#             snipe_record.transaction_signature = transaction_signature
#             snipe_record.profit_loss = 0.0 # Placeholder: calculate real P/L later
#             snipe_record.completed_at = datetime.now()
#             snipe_record.logs.append({"timestamp": str(uuid.uuid4()), "message": f"Snipe successful! Tx: {transaction_signature}"})
#             logger.info(f"Snipe {snipe_id} completed successfully. Tx: {transaction_signature}")
#             if user_wallet_address in active_connections:
#                 await active_connections[user_wallet_address].send_json(
#                     {"type": "snipe_result", "snipe_id": snipe_id, "status": "completed", "transaction_signature": transaction_signature}
#                 )
#         else:
#             snipe_record.status = "failed"
#             snipe_record.logs.append({"timestamp": str(uuid.uuid4()), "message": "Snipe failed or transaction not confirmed."})
#             logger.error(f"Snipe {snipe_id} failed.")
#             if user_wallet_address in active_connections:
#                 await active_connections[user_wallet_address].send_json(
#                     {"type": "snipe_result", "snipe_id": snipe_id, "status": "failed", "message": "Snipe failed or transaction not confirmed."}
#                 )
#     except Exception as e:
#         logger.error(f"Unhandled error in snipe task {snipe_id}: {e}")
#         if snipe_record:
#             snipe_record.status = "failed"
#             snipe_record.logs.append({"timestamp": str(uuid.uuid4()), "message": f"Unhandled error: {e}"})
#             if user_wallet_address in active_connections:
#                 await active_connections[user_wallet_address].send_json(
#                     {"type": "snipe_result", "snipe_id": snipe_id, "status": "failed", "message": f"Unhandled error during snipe: {e}"}
#                 )
#     finally:
#         if snipe_record:
#             await db_session.commit()
#             await db_session.close() # Close session for background task
#         # Remove from active snipes dict (if using in-memory)
#         active_snipes.pop(snipe_id, None)



# @router.post("/start", response_model=SnipeResponse, status_code=status.HTTP_202_ACCEPTED)
# async def start_snipe(
#     snipe_in: SnipeCreate,
#     background_tasks: BackgroundTasks,
#     current_user: User = Depends(get_current_user_by_wallet),
#     db: AsyncSession = Depends(get_db)
# ):
#     """
#     Starts a new snipe operation in the background.
#     """
#     new_snipe = Snipe(
#         user_wallet_address=current_user.wallet_address,
#         token_address=snipe_in.token_address,
#         amount_sol=snipe_in.amount_sol,
#         slippage=snipe_in.slippage,
#         is_buy=snipe_in.is_buy,
#         status="pending"
#     )
#     db.add(new_snipe)
#     await db.commit()
#     await db.refresh(new_snipe)
    
#     # Pass a new DB session factory for the background task to manage its own session
#     # This prevents session conflicts.
#     background_tasks.add_task(
#         run_snipe_task,
#         snipe_id=new_snipe.id,
#         user_wallet_address=current_user.wallet_address,
#         encrypted_private_key_hex=current_user.encrypted_private_key, # Pass the encrypted key
#         token_address=snipe_in.token_address,
#         amount_sol=snipe_in.amount_sol,
#         slippage=snipe_in.slippage,
#         is_buy=snipe_in.is_buy,
#         db_session=AsyncSessionLocal() # Pass a new session instance
#     )

#     # Store snipe task details in memory (or Redis)
#     active_snipes[new_snipe.id] = {
#         "user_wallet": current_user.wallet_address,
#         "status": "pending",
#         "logs": ["Snipe request received and background task initiated."]
#     }
#     logger.info(f"Snipe {new_snipe.id} initiated for {current_user.wallet_address}")
#     return new_snipe



# @router.post("/stop/{snipe_id}", response_model=SnipeResponse)
# async def stop_snipe(
#     snipe_id: str,
#     current_user: User = Depends(get_current_user_by_wallet),
#     db: AsyncSession = Depends(get_db)
# ):
#     """
#     Attempts to stop an active snipe. (Complex to implement for on-chain txs).
#     """
#     # This is highly theoretical for blockchain transactions that are already sent.
#     # You can't "stop" a sent transaction. This would primarily be for stopping
#     # the bot from *sending* a transaction if it's still in a pending state
#     # before broadcast. Or, for cancelling monitoring.
    
#     # Fetch snipe from DB
#     result = await db.execute(select(Snipe).where(Snipe.id == snipe_id))
#     snipe_record = result.scalar_one_or_none()

#     if not snipe_record or snipe_record.user_wallet_address != current_user.wallet_address:
#         raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Snipe not found or not authorized.")

#     if snipe_record.status in ["completed", "failed", "cancelled"]:
#         raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Snipe is already finished.")

#     # Mark as cancelled and update DB
#     snipe_record.status = "cancelled"
#     snipe_record.logs.append({"timestamp": str(uuid.uuid4()), "message": "Snipe cancelled by user."})
#     await db.commit()
#     await db.refresh(snipe_record)

#     # In a real system with Celery, you'd try to revoke the task here.
#     if snipe_id in active_snipes:
#         active_snipes.pop(snipe_id) # Remove from in-memory tracking

#     logger.info(f"Snipe {snipe_id} for {current_user.wallet_address} cancelled.")
#     return snipe_record





# @router.get("/status/{snipe_id}", response_model=SnipeResponse)
# async def get_snipe_status(
#     snipe_id: str,
#     current_user: User = Depends(get_current_user_by_wallet),
#     db: AsyncSession = Depends(get_db)
# ):
#     """
#     Retrieves the current status and logs of a specific snipe.
#     """
#     result = await db.execute(select(Snipe).where(Snipe.id == snipe_id))
#     snipe_record = result.scalar_one_or_none()

#     if not snipe_record or snipe_record.user_wallet_address != current_user.wallet_address:
#         raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Snipe not found or not authorized.")
    
#     logger.info(f"Retrieving status for snipe {snipe_id} for {current_user.wallet_address}")
#     return snipe_record




# # WebSocket endpoint for real-time logs
# @router.websocket("/ws/{wallet_address}")
# async def websocket_snipe_logs(websocket: WebSocket, wallet_address: str):
#     await websocket.accept()
#     active_connections[wallet_address] = websocket
#     logger.info(f"WebSocket connected for wallet: {wallet_address}")
#     try:
#         while True:
#             # Keep connection alive, maybe send heartbeats or listen for client messages
#             await websocket.receive_text() # Client can send messages, e.g., "ping"
#     except WebSocketDisconnect:
#         logger.info(f"WebSocket disconnected for wallet: {wallet_address}")
#         del active_connections[wallet_address]
#     except Exception as e:
#         logger.error(f"WebSocket error for {wallet_address}: {e}")
#         del active_connections[wallet_address]
        
        