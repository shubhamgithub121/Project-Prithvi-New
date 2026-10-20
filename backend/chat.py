import json
import logging
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Any, Iterator, Literal, Optional

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from db.supabase import client as supabase
from auth import get_current_user
from chatbot import engine
from chatbot.flows import FLOWS, public_flows
from chatbot.tools import rows_of

logger = logging.getLogger(__name__)

chat_router = APIRouter(prefix="/chat")

MAX_MESSAGE_CHARS = 500
HISTORY_MESSAGES = 20  # last 10 turns
RATE_LIMITS = [(60, 20), (86400, 200)]  # (window seconds, max messages)

_hits: dict[str, deque[float]] = defaultdict(deque)


class ChatRequest(BaseModel):
    message: Optional[str] = Field(default=None, max_length=MAX_MESSAGE_CHARS)
    flow: Optional[str] = None
    session_id: Optional[uuid.UUID] = None


class FeedbackRequest(BaseModel):
    session_id: uuid.UUID
    message_id: uuid.UUID
    rating: Literal["up", "down"]


def get_optional_user(authorization: Optional[str] = Header(None)) -> Any:
    if not authorization:
        return None
    try:
        return get_current_user(authorization)
    except HTTPException:
        return None  # expired/invalid token: treat as a guest rather than failing the chat


def _check_rate_limit(key: str) -> None:
    now = time.monotonic()
    hits = _hits[key]
    while hits and now - hits[0] > RATE_LIMITS[-1][0]:
        hits.popleft()
    for window, limit in RATE_LIMITS:
        if sum(1 for t in hits if now - t <= window) >= limit:
            raise HTTPException(status_code=429, detail="Too many messages. Please wait a bit and try again.")
    hits.append(now)


def _display_name(user: Any) -> Optional[str]:
    if not user:
        return None
    meta = getattr(user, "user_metadata", None) or {}
    email = getattr(user, "email", None) or ""
    return meta.get("full_name") or meta.get("name") or email.split("@")[0] or "there"


def _own_session(session_id: Optional[uuid.UUID], user_id: Optional[str]) -> Optional[dict[str, Any]]:
    """The session if the caller may use it: a guest session, or one owned by this user."""
    if not session_id:
        return None
    rows = rows_of(supabase.table("chat_sessions").select("*").eq("id", str(session_id)).execute())
    if not rows or rows[0]["user_id"] not in (None, user_id):
        return None
    return rows[0]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _save_message(session_id: str, role: str, content: str, meta: Optional[dict[str, Any]] = None) -> str:
    message_id = str(uuid.uuid4())
    supabase.table("chat_messages").insert({
        "id": message_id, "session_id": session_id, "role": role,
        "content": content, "meta": meta or {}, "created_at": _now(),
    }).execute()
    return message_id


def _load_history(session_id: str) -> list[dict[str, Any]]:
    rows = rows_of(
        supabase.table("chat_messages").select("role, content").eq("session_id", session_id)
        .order("created_at", desc=True).limit(HISTORY_MESSAGES).execute()
    )
    history: list[dict[str, Any]] = []
    for row in reversed(rows):
        if history and history[-1]["role"] == row["role"]:
            history[-1]["content"] += "\n\n" + row["content"]  # e.g. a turn that errored before replying
        else:
            history.append({"role": row["role"], "content": row["content"]})
    while history and history[0]["role"] != "user":
        history.pop(0)
    return history


def _sse(event: dict[str, Any]) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


@chat_router.get("/flows")
async def list_flows():
    return public_flows()


@chat_router.get("/history")
async def get_history(session_id: uuid.UUID, authorization: Optional[str] = Header(None)):
    user = get_optional_user(authorization)
    session = _own_session(session_id, user.id if user else None)
    if not session:
        raise HTTPException(status_code=404, detail="Chat not found")
    rows = rows_of(
        supabase.table("chat_messages").select("id, role, content, feedback, created_at")
        .eq("session_id", session["id"]).order("created_at", desc=True).limit(50).execute()
    )
    return list(reversed(rows))


@chat_router.post("")
def chat(body: ChatRequest, request: Request, authorization: Optional[str] = Header(None)):
    user = get_optional_user(authorization)
    user_id = user.id if user else None

    flow: dict[str, Any] = {}
    if body.flow is not None:
        flow = FLOWS.get(body.flow, {})
        if not flow:
            raise HTTPException(status_code=400, detail="Unknown flow")
        user_text = flow["label"]
    else:
        user_text = (body.message or "").strip()
        if not user_text:
            raise HTTPException(status_code=400, detail="Message is empty")

    _check_rate_limit(user_id or f"ip:{request.client.host if request.client else 'unknown'}")

    session = _own_session(body.session_id, user_id)
    if session is None:
        session = {"id": str(uuid.uuid4()), "user_id": user_id}
        supabase.table("chat_sessions").insert({**session, "created_at": _now(), "updated_at": _now()}).execute()
    elif user_id and session["user_id"] is None:
        # A guest who signed in mid-chat: the session becomes theirs.
        supabase.table("chat_sessions").update({"user_id": user_id}).eq("id", session["id"]).execute()
    session_id = session["id"]

    history = _load_history(session_id)
    _save_message(session_id, "user", user_text, {"flow": body.flow} if body.flow else None)

    def events() -> Iterator[str]:
        yield _sse({"type": "session", "session_id": session_id})
        if "reply" in flow:
            reply, meta = flow["reply"], {"flow": body.flow}
            yield _sse({"type": "text", "text": reply})
        else:
            prompt = flow.get("prompt", user_text)
            reply, meta = "", {}
            for event in engine.run_turn(history + [{"role": "user", "content": prompt}], user_id, _display_name(user)):
                if event["type"] == "final":
                    reply, meta = event["text"], event["meta"]
                else:
                    yield _sse(event)
        try:
            message_id = _save_message(session_id, "assistant", reply or engine.SORRY, meta)
            supabase.table("chat_sessions").update({"updated_at": _now()}).eq("id", session_id).execute()
        except Exception as e:
            logger.error(f"Failed to save chat reply: {e}")
            message_id = None
        yield _sse({"type": "done", "message_id": message_id})

    return StreamingResponse(
        events(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@chat_router.post("/feedback")
async def feedback(body: FeedbackRequest, authorization: Optional[str] = Header(None)):
    user = get_optional_user(authorization)
    session = _own_session(body.session_id, user.id if user else None)
    if not session:
        raise HTTPException(status_code=404, detail="Chat not found")
    rows = rows_of(
        supabase.table("chat_messages").select("id").eq("id", str(body.message_id))
        .eq("session_id", session["id"]).eq("role", "assistant").execute()
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Message not found")
    supabase.table("chat_messages").update({"feedback": body.rating}).eq("id", str(body.message_id)).execute()
    return {"ok": True}
