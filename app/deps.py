"""FastAPI dependencies: session, current user, permission gates."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .db import get_session
from .models import Role, User
from .security import decode_token, has_permission

SessionDep = Annotated[Session, Depends(get_session)]


def _anonymous_admin(session: Session) -> User:
    """Used only when AUTH_REQUIRED=0 (local development)."""
    user = session.execute(select(User).where(User.username == "admin")).scalar_one_or_none()
    if user is None:
        user = User(username="admin", full_name="Local Administrator", role=Role.ADMINISTRATOR, password_hash="")
        session.add(user)
        session.flush()
    return user


def current_user(
    session: SessionDep,
    authorization: Annotated[str | None, Header()] = None,
) -> User:
    if not settings.auth_required:
        return _anonymous_admin(session)

    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    payload = decode_token(authorization.split(" ", 1)[1].strip())
    if payload is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    user = session.get(User, payload["sub"])
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Unknown or inactive user")
    return user


UserDep = Annotated[User, Depends(current_user)]


def require(permission: str):
    """Route dependency enforcing one permission from the RBAC matrix."""

    def guard(user: UserDep) -> User:
        if not has_permission(user.role, permission):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"Role {user.role.value} does not have permission '{permission}'.",
            )
        return user

    return guard
