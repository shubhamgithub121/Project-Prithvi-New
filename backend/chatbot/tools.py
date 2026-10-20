"""Tools the chat model may call.

All tools are read-only. Cancelling is never done by the model: the
`request_cancel_pickup` tool only asks the widget to show a confirm button,
which then calls the existing POST /api/pickups/{id}/cancel endpoint.
"""
import json
from typing import Any, Optional, cast

from openai.types.chat import ChatCompletionToolParam

from db.supabase import client as supabase
from pickups import RATE_PER_KG

TIERS = [("Sapling", 0), ("Sprout", 5), ("Tree", 20), ("Forest Guardian", 50)]
CO2_PER_KG = 2.5
TIME_SLOT_LABELS = {"8-12": "8 AM - 12 PM", "12-16": "12 PM - 4 PM", "16-20": "4 PM - 8 PM"}
MAX_WEIGHT_KG = 1000

_SPECS: list[tuple[str, str, dict[str, Any]]] = [
    (
        "get_my_pickups",
        "List the signed-in user's 10 most recent pickups with date, time slot, city, "
        "weight, estimated earnings and status. The widget also shows them as cards. "
        "Use for tracking, status or history questions.",
        {"type": "object", "properties": {}},
    ),
    (
        "get_my_impact",
        "Get the signed-in user's totals from non-cancelled pickups: kg recycled, "
        "estimated earnings, CO2 reduced, current eco tier and kg needed for the next tier.",
        {"type": "object", "properties": {}},
    ),
    (
        "estimate_earnings",
        "Calculate estimated earnings for a given weight of plastic at the current rate.",
        {
            "type": "object",
            "properties": {"weight_kg": {"type": "number", "description": "Weight of plastic in kg."}},
            "required": ["weight_kg"],
        },
    ),
    (
        "request_cancel_pickup",
        "Show the user a confirm button to cancel one of their scheduled pickups. "
        "This does NOT cancel anything; the pickup is cancelled only if the user taps "
        "the button. Get the pickup id from get_my_pickups first.",
        {
            "type": "object",
            "properties": {"pickup_id": {"type": "string", "description": "Id of the pickup to cancel."}},
            "required": ["pickup_id"],
        },
    ),
]
TOOLS: list[ChatCompletionToolParam] = [
    {"type": "function", "function": {"name": n, "description": d, "parameters": params}} for n, d, params in _SPECS
]

STATUS_TEXT = {
    "get_my_pickups": "Checking your pickups…",
    "get_my_impact": "Adding up your impact…",
    "estimate_earnings": "Calculating…",
    "request_cancel_pickup": "Preparing cancellation…",
}


class ToolError(Exception):
    pass


def _pickup_card(p: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": p["id"],
        "pickup_date": p["pickup_date"],
        "time_slot": TIME_SLOT_LABELS.get(p["time_slot"], p["time_slot"]),
        "city": p.get("city"),
        "estimated_weight_kg": p["estimated_weight_kg"],
        "estimated_earnings": p["estimated_earnings"],
        "status": p["status"],
    }


def _user_pickups(user_id: str, limit: Optional[int] = None) -> list[dict[str, Any]]:
    query = supabase.table("pickups").select("*").eq("user_id", user_id).order("created_at", desc=True)
    if limit:
        query = query.limit(limit)
    return rows_of(query.execute())


def rows_of(response: Any) -> list[dict[str, Any]]:
    return cast(list[dict[str, Any]], response.data or [])


def tier_info(kg: float) -> dict[str, Any]:
    current = [t for t in TIERS if kg >= t[1]][-1]
    nxt = next((t for t in TIERS if t[1] > kg), None)
    return {
        "tier": current[0],
        "next_tier": nxt[0] if nxt else None,
        "kg_to_next_tier": round(nxt[1] - kg, 1) if nxt else 0,
    }


def run_tool(name: str, args: Any, user_id: Optional[str]) -> tuple[str, Optional[dict[str, Any]]]:
    """Run a tool. Returns (result for the model, optional UI event for the widget).

    Raises ToolError for problems the model should see as an error result.
    """
    if not isinstance(args, dict):
        raise ToolError("Invalid tool input.")

    if name == "estimate_earnings":
        weight = args.get("weight_kg")
        if isinstance(weight, bool) or not isinstance(weight, (int, float)):
            raise ToolError("weight_kg must be a number.")
        if weight < 0.5 or weight > MAX_WEIGHT_KG:
            raise ToolError(f"weight_kg must be between 0.5 and {MAX_WEIGHT_KG}.")
        earnings = round(weight * RATE_PER_KG, 2)
        return json.dumps({"weight_kg": weight, "rate_per_kg": RATE_PER_KG, "estimated_earnings_rs": earnings}), None

    if name not in ("get_my_pickups", "get_my_impact", "request_cancel_pickup"):
        raise ToolError(f"Unknown tool: {name}")
    if not user_id:
        raise ToolError("The user is not signed in. Ask them to sign in at /login to see their own pickups.")

    if name == "get_my_pickups":
        cards = [_pickup_card(p) for p in _user_pickups(user_id, limit=10)]
        return json.dumps({"pickups": cards}), {"type": "pickups", "pickups": cards}

    if name == "get_my_impact":
        active = [p for p in _user_pickups(user_id) if p["status"] != "cancelled"]
        kg = round(sum(p["estimated_weight_kg"] for p in active), 1)
        return json.dumps({
            "active_pickups": len(active),
            "total_kg": kg,
            "estimated_earnings_rs": round(sum(p["estimated_earnings"] for p in active), 2),
            "co2_reduced_kg": round(kg * CO2_PER_KG, 1),
            **tier_info(kg),
        }), None

    # request_cancel_pickup
    pickup_id = args.get("pickup_id")
    if not isinstance(pickup_id, str) or not pickup_id:
        raise ToolError("pickup_id is required.")
    rows = rows_of(supabase.table("pickups").select("*").eq("id", pickup_id).eq("user_id", user_id).execute())
    if not rows:
        raise ToolError("No pickup with that id belongs to this user.")
    if rows[0]["status"] != "scheduled":
        raise ToolError(f"This pickup is already {rows[0]['status']} and cannot be cancelled.")
    card = _pickup_card(rows[0])
    return (
        json.dumps({"confirm_button_shown": True, "pickup": card,
                    "note": "Not cancelled yet. It is cancelled only if the user taps Confirm."}),
        {"type": "confirm_cancel", "pickup": card},
    )
