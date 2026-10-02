"""Owner login / logout, and "who am I" for the frontend. Policy and tokens
live in core/auth.py."""
from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from backend.app.core import auth
from backend.app.core.config import settings
from backend.app.core.rate_limit import rate_limit

router = APIRouter(tags=["auth"])


class LoginRequest(BaseModel):
    password: str


def _me(role: str, client: str) -> dict:
    if not settings.auth_enabled:
        return {"role": auth.OWNER, "auth": False, "guest": None}
    guest = {
        "enabled": settings.GUEST_ENABLED,
        "limit": settings.GUEST_DAILY_LIMIT,
        "remaining": auth.guest_quota.remaining(client) if settings.GUEST_ENABLED else 0,
        "tools": auth.GUEST_TOOLS if settings.GUEST_ENABLED else [],
    }
    return {"role": role, "auth": True, "guest": guest}


@router.get("/api/auth/me")
async def me(request: Request):
    return _me(auth.role_of(request), auth.client_of(request.scope))


@router.post("/api/auth/login", dependencies=[Depends(rate_limit("login"))])
async def login(body: LoginRequest, request: Request):
    if not settings.auth_enabled:
        return _me(auth.OWNER, auth.client_of(request.scope))
    if not auth.check_password(body.password):
        return JSONResponse(status_code=401, content={"detail": "wrong_password", "message": "Sai mật khẩu."})
    response = JSONResponse(_me(auth.OWNER, auth.client_of(request.scope)))
    response.set_cookie(
        auth.COOKIE_NAME,
        auth.issue_token(),
        max_age=settings.SESSION_DAYS * 24 * 3600,
        httponly=True,
        samesite="strict",
        secure=settings.COOKIE_SECURE,
        path="/",
    )
    return response


@router.post("/api/auth/logout")
async def logout(request: Request, response: Response):
    response.delete_cookie(
        auth.COOKIE_NAME, httponly=True, samesite="strict", secure=settings.COOKIE_SECURE, path="/",
    )
    role = auth.OWNER if not settings.auth_enabled else auth.GUEST
    return _me(role, auth.client_of(request.scope))
