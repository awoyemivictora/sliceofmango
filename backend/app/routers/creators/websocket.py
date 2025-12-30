# app/routers/creators/websocket.py
from datetime import datetime
import json
import logging
from typing import Dict, List
import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db


logger = logging.getLogger(__name__)

router = APIRouter()

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}
    
    async def connect(self, websocket: WebSocket, launch_id: str):
        await websocket.accept()
        if launch_id not in self.active_connections:
            self.active_connections[launch_id] = []
        self.active_connections[launch_id].append(websocket)
        logger.info(f"WebSocket connected for launch {launch_id}")
    
    def disconnect(self, websocket: WebSocket, launch_id: str):
        if launch_id in self.active_connections:
            self.active_connections[launch_id].remove(websocket)
            if not self.active_connections[launch_id]:
                del self.active_connections[launch_id]
        logger.info(f"WebSocket disconnected for launch {launch_id}")
    
    async def send_personal_message(self, message: str, launch_id: str):
        if launch_id in self.active_connections:
            for connection in self.active_connections[launch_id]:
                try:
                    await connection.send_text(message)
                except Exception as e:
                    logger.error(f"Failed to send message to launch {launch_id}: {e}")
    
    async def broadcast(self, message: str):
        for launch_id in self.active_connections:
            await self.send_personal_message(message, launch_id)

manager = ConnectionManager()

@router.websocket("/ws/launch/{launch_id}")
async def websocket_endpoint(websocket: WebSocket, launch_id: str):
    await manager.connect(websocket, launch_id)
    
    try:
        while True:
            # Wait for client messages (can be used for control)
            data = await websocket.receive_text()
            message = json.loads(data)
            
            # Handle client messages if needed
            if message.get("type") == "ping":
                await manager.send_personal_message(
                    json.dumps({"type": "pong", "timestamp": datetime.utcnow().isoformat()}),
                    launch_id
                )
                
    except WebSocketDisconnect:
        manager.disconnect(websocket, launch_id)
    except Exception as e:
        logger.error(f"WebSocket error for launch {launch_id}: {e}")
        manager.disconnect(websocket, launch_id)

# Helper to send status updates from LaunchCoordinator
async def send_launch_status_update(launch_id: str, status_data: Dict):
    """Send status update to connected WebSocket clients"""
    message = {
        "type": "status_update",
        "launch_id": launch_id,
        "timestamp": datetime.utcnow().isoformat(),
        **status_data
    }
    await manager.send_personal_message(json.dumps(message), launch_id)
    
    
    