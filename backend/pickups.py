from datetime import date, datetime, timezone
from typing import Any, Optional
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator

from db.supabase import client as supabase
from auth import get_current_user
import tracking

RATE_PER_KG = 15
ALLOWED_TIME_SLOTS = {"8-12", "12-16", "16-20"}
ALLOWED_PLASTIC_TYPES = {"pet", "hdpe", "ldpe", "pp", "mixed", ""}

pickups_router = APIRouter(prefix="/pickups")


class PickupCreate(BaseModel):
    address: str
    city: str
    pincode: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    pickup_date: date
    time_slot: str
    plastic_type: Optional[str] = ""
    estimated_weight_kg: float

    @field_validator("address", "city")
    @classmethod
    def not_blank(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("must not be blank")
        return v.strip()

    @field_validator("pincode")
    @classmethod
    def valid_pincode(cls, v: str) -> str:
        if not re.fullmatch(r"[0-9]{6}", v or ""):
            raise ValueError("pincode must be exactly 6 digits")
        return v

    @field_validator("pickup_date")
    @classmethod
    def not_in_past(cls, v: date) -> date:
        if v < datetime.now(timezone.utc).date():
            raise ValueError("pickup_date cannot be in the past")
        return v

    @field_validator("time_slot")
    @classmethod
    def valid_time_slot(cls, v: str) -> str:
        if v not in ALLOWED_TIME_SLOTS:
            raise ValueError(f"time_slot must be one of {sorted(ALLOWED_TIME_SLOTS)}")
        return v

    @field_validator("plastic_type")
    @classmethod
    def valid_plastic_type(cls, v: Optional[str]) -> str:
        v = v or ""
        if v not in ALLOWED_PLASTIC_TYPES:
            raise ValueError(f"plastic_type must be one of {sorted(ALLOWED_PLASTIC_TYPES)}")
        return v

    @field_validator("estimated_weight_kg")
    @classmethod
    def min_weight(cls, v: float) -> float:
        if v < 0.5:
            raise ValueError("estimated_weight_kg must be at least 0.5")
        return v


def _get_owned_pickup(pickup_id: str, user_id: str) -> dict[str, Any]:
    response = supabase.table("pickups").select("*").eq("id", pickup_id).execute()
    records = response.data or []
    if not records or records[0]["user_id"] != user_id:
        raise HTTPException(status_code=404, detail="Pickup not found")
    return records[0]


@pickups_router.post("/")
async def create_pickup(body: PickupCreate, current_user=Depends(get_current_user)):
    rider_id = f"dummy-{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": current_user.id,
        "rider_id": rider_id,
        "address": body.address,
        "city": body.city,
        "pincode": body.pincode,
        "lat": body.lat,
        "lng": body.lng,
        "pickup_date": body.pickup_date.isoformat(),
        "time_slot": body.time_slot,
        "plastic_type": body.plastic_type,
        "estimated_weight_kg": body.estimated_weight_kg,
        "estimated_earnings": round(body.estimated_weight_kg * RATE_PER_KG, 2),
        "status": "scheduled",
        "created_at": now,
        "updated_at": now,
    }
    supabase.table("pickups").insert(doc).execute()
    tracking.start_tracking(rider_id)
    return doc


@pickups_router.get("/me")
async def list_my_pickups(current_user=Depends(get_current_user)):
    response = (
        supabase.table("pickups")
        .select("*")
        .eq("user_id", current_user.id)
        .order("created_at", desc=True)
        .execute()
    )
    return response.data or []


@pickups_router.get("/{pickup_id}/location")
async def get_pickup_location(pickup_id: str, current_user=Depends(get_current_user)):
    pickup = _get_owned_pickup(pickup_id, current_user.id)
    location = tracking.get_latest_location(pickup["rider_id"])
    if not location:
        return {"message": "No location found yet"}
    return location


@pickups_router.post("/{pickup_id}/cancel")
async def cancel_pickup(pickup_id: str, current_user=Depends(get_current_user)):
    pickup = _get_owned_pickup(pickup_id, current_user.id)
    tracking.stop_tracking(pickup["rider_id"])
    now = datetime.now(timezone.utc).isoformat()
    supabase.table("pickups").update({"status": "cancelled", "updated_at": now}).eq("id", pickup_id).execute()
    return {"id": pickup_id, "status": "cancelled"}
