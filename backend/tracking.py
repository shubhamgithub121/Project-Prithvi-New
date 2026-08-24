import os
import time
import requests
import asyncio
from datetime import datetime, timezone
import logging
import uuid
import threading
from fastapi import APIRouter

from db.supabase import client as supabase

logger = logging.getLogger(__name__)

ACTIVE_RIDERS = set()
POLL_INTERVAL = int(os.environ.get("TRACKING_POLL_INTERVAL", 3))
DUMMY_URL = os.environ.get("TRACKING_DUMMY_URL", "https://mock-rider-api.example.com/location/{rider_id}")

tracking_router = APIRouter(prefix="/riders")


def fetch_dummy_location(rider_id: str) -> dict:
    """
    Isolated dummy fetch logic to simulate rider location updates.
    Trivial to replace or delete when the real rider app backend is ready.
    """
    try:
        url = DUMMY_URL.format(rider_id=rider_id)
        if "mock-rider-api.example.com" in url:
            # Simulate mock location changes
            return {
                "lat": 37.7749 + (uuid.uuid4().int % 1000) / 100000.0,
                "lng": -122.4194 + (uuid.uuid4().int % 1000) / 100000.0,
                "heading": (uuid.uuid4().int % 360),
                "speed": (uuid.uuid4().int % 30),
            }
        else:
            resp = requests.get(url, timeout=5)
            resp.raise_for_status()
            return resp.json()
    except Exception as e:
        logger.error(f"Error fetching dummy location for {rider_id}: {e}")
        return None


def tracking_loop():
    logger.info("Starting rider location tracking poller loop...")
    while True:
        try:
            # Copy to avoid size changing during iteration
            riders = list(ACTIVE_RIDERS)
            for rider_id in riders:
                loc = fetch_dummy_location(rider_id)
                if loc:
                    now = datetime.now(timezone.utc).isoformat()
                    
                    latest_doc = {
                        "rider_id": rider_id,
                        "lat": loc["lat"],
                        "lng": loc["lng"],
                        "heading": loc["heading"],
                        "speed": loc["speed"],
                        "recorded_at": now
                    }
                    
                    history_doc = latest_doc.copy()
                    history_doc["id"] = str(uuid.uuid4())
                    
                    # Upsert into latest table (for realtime subscription)
                    supabase.table("rider_locations_latest").upsert(latest_doc).execute()
                    
                    # Insert into history
                    supabase.table("rider_locations").insert(history_doc).execute()
        except Exception as e:
            logger.error(f"Tracking loop error: {e}")
            
        time.sleep(POLL_INTERVAL)


def start_poller():
    t = threading.Thread(target=tracking_loop, daemon=True)
    t.start()


@tracking_router.post("/{rider_id}/tracking/start")
async def start_tracking(rider_id: str):
    ACTIVE_RIDERS.add(rider_id)
    return {"message": f"Tracking started for {rider_id}", "status": "active"}


@tracking_router.post("/{rider_id}/tracking/stop")
async def stop_tracking(rider_id: str):
    ACTIVE_RIDERS.discard(rider_id)
    return {"message": f"Tracking stopped for {rider_id}", "status": "inactive"}


@tracking_router.get("/{rider_id}/location")
async def get_location(rider_id: str):
    try:
        response = supabase.table("rider_locations_latest").select("*").eq("rider_id", rider_id).execute()
        if response.data:
            return response.data[0]
        return {"message": "No location found for rider"}
    except Exception as e:
        logger.error(f"Failed to fetch location for {rider_id}: {e}")
        return {"error": "Failed to retrieve location"}
