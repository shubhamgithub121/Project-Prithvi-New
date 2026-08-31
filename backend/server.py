from fastapi import FastAPI, APIRouter, Depends, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Any, List, Optional, cast
from datetime import datetime, timezone
from pathlib import Path
import logging
import os
import uuid
import contextlib

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from db.supabase import client as supabase
from auth import get_current_user, get_profile
from tracking import tracking_router, start_poller


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    start_poller()
    yield
    # Shutdown (if needed)

app = FastAPI(lifespan=lifespan)
api_router = APIRouter(prefix="/api")
api_router.include_router(tracking_router)


# ---------- Request / Response models ----------

class RegisterRequest(BaseModel):
    name: str
    email: str
    password: str
    phone: Optional[str] = None

class LoginRequest(BaseModel):
    email: str
    password: str

class AuthResponse(BaseModel):
    access_token: str
    user: dict

class ProfileResponse(BaseModel):
    id: str
    name: str
    email: str
    phone: Optional[str] = None
    role: str
    created_at: str

class OAuthUrlResponse(BaseModel):
    url: str
    provider: str

class OAuthCallbackRequest(BaseModel):
    auth_code: str

class OAuthIdTokenRequest(BaseModel):
    provider: str
    token: str
    nonce: Optional[str] = None

class StatusCheck(BaseModel):
    id: str
    client_name: str
    timestamp: datetime

class StatusCheckCreate(BaseModel):
    client_name: str


# ---------- Auth endpoints ----------

@api_router.post("/auth/register")
async def register(body: RegisterRequest):
    from auth import register_user
    auth_resp = register_user(body.email, body.password, body.name, body.phone)
    return AuthResponse(
        access_token=auth_resp.session.access_token,
        user=auth_resp.user.model_dump(),
    )


@api_router.post("/auth/login")
async def login(body: LoginRequest):
    from auth import login_user
    auth_resp = login_user(body.email, body.password)
    return AuthResponse(
        access_token=auth_resp.session.access_token,
        user=auth_resp.user.model_dump(),
    )


@api_router.get("/auth/me", response_model=ProfileResponse)
async def me(current_user=Depends(get_current_user)):
    profile = get_profile(current_user.id)
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    return ProfileResponse(
        id=profile["id"],
        name=profile["name"],
        email=profile["email"],
        phone=profile.get("phone"),
        role=profile["role"],
        created_at=profile["created_at"].isoformat() if isinstance(profile["created_at"], datetime) else str(profile["created_at"]),
    )


# ---------- OAuth endpoints ----------

@api_router.get("/auth/oauth/{provider}")
async def oauth_url(provider: str, redirect_to: Optional[str] = None, scopes: Optional[str] = None):
    from auth import get_oauth_url
    url = get_oauth_url(provider, redirect_to, scopes)
    return OAuthUrlResponse(url=url, provider=provider)


@api_router.post("/auth/oauth/callback")
async def oauth_callback(body: OAuthCallbackRequest):
    from auth import exchange_code_for_session
    auth_resp = exchange_code_for_session(body.auth_code)
    return AuthResponse(
        access_token=auth_resp.session.access_token,
        user=auth_resp.user.model_dump(),
    )


@api_router.post("/auth/oauth/token")
async def oauth_id_token(body: OAuthIdTokenRequest):
    from auth import sign_in_with_id_token
    auth_resp = sign_in_with_id_token(body.provider, body.token, body.nonce)
    return AuthResponse(
        access_token=auth_resp.session.access_token,
        user=auth_resp.user.model_dump(),
    )


# ---------- Status check endpoints (keep for health) ----------

@api_router.get("/")
async def root():
    return {"message": "Hello World"}


@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    status_obj = StatusCheck(
        id=str(uuid.uuid4()),
        client_name=input.client_name,
        timestamp=datetime.now(timezone.utc),
    )
    doc = status_obj.model_dump()
    doc["timestamp"] = doc["timestamp"].isoformat()
    supabase.table("status_checks").insert(doc).execute()
    return status_obj


@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    response = supabase.table("status_checks").select("*").execute()
    records = cast(list[dict[str, Any]], response.data or [])
    for r in records:
        if isinstance(r.get("timestamp"), str):
            r["timestamp"] = datetime.fromisoformat(r["timestamp"])
    return records


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)
