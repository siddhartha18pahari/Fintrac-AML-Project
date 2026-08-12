from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select

from .. import audit
from ..config import settings
from ..deps import SessionDep, UserDep, require
from ..models import User
from ..schemas import LoginRequest, TokenResponse, UserCreate
from ..security import PERMISSIONS, has_permission, hash_password, issue_token, verify_password
from ..serializers import user_json

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, session: SessionDep) -> TokenResponse:
    user = session.execute(select(User).where(User.username == body.username)).scalar_one_or_none()
    # Constant-ish response regardless of which half failed, so the endpoint is
    # not a username oracle.
    if user is None or not user.is_active or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    token = issue_token(user.id, user.username, user.role)
    audit.record(
        session,
        action="USER_LOGIN",
        object_type="user",
        object_id=user.id,
        actor_id=user.id,
        actor_name=user.username,
    )
    session.commit()
    return TokenResponse(
        access_token=token,
        expires_in=settings.token_ttl_seconds,
        user=user_json(user),
    )


@router.get("/me")
def me(user: UserDep) -> dict:
    return {
        "user": user_json(user),
        "permissions": sorted(p for p in PERMISSIONS if has_permission(user.role, p)),
    }


@router.get("/users")
def list_users(session: SessionDep, _: User = Depends(require("case:view"))) -> dict:
    rows = session.execute(select(User).order_by(User.id)).scalars().all()
    return {"users": [user_json(u) for u in rows]}


@router.post("/users", status_code=status.HTTP_201_CREATED)
def create_user(body: UserCreate, session: SessionDep, actor: User = Depends(require("admin"))) -> dict:
    if session.execute(select(User).where(User.username == body.username)).scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "username already exists")
    user = User(
        username=body.username,
        full_name=body.full_name,
        role=body.role,
        password_hash=hash_password(body.password),
    )
    session.add(user)
    session.flush()
    audit.record(
        session,
        action="USER_CREATED",
        object_type="user",
        object_id=user.id,
        actor_id=actor.id,
        actor_name=actor.username,
        after={"username": user.username, "role": user.role.value},
    )
    session.commit()
    return user_json(user)
