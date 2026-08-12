"""Authentication, password hashing and role-based access control.

Deliberately dependency-free (stdlib ``hashlib``/``hmac``) so the project runs
without a crypto stack.  This is adequate for a self-hosted demo; a production
deployment should front the API with a real IdP and rotate ``SECRET_KEY`` out of
the environment into a secret manager.  See docs/SECURITY.md.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time

from .config import settings
from .models import Role

_PBKDF2_ROUNDS = 240_000


# ---------------------------------------------------------------------------
# Passwords
# ---------------------------------------------------------------------------


def hash_password(password: str, *, salt: bytes | None = None) -> str:
    salt = salt or os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ROUNDS)
    return f"pbkdf2_sha256${_PBKDF2_ROUNDS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algo, rounds, salt_hex, digest_hex = encoded.split("$")
    except ValueError:
        return False
    if algo != "pbkdf2_sha256":
        return False
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(rounds))
    return hmac.compare_digest(digest.hex(), digest_hex)


# ---------------------------------------------------------------------------
# Tokens (compact signed JSON, JWT-shaped but self-contained)
# ---------------------------------------------------------------------------


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64d(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def issue_token(user_id: int, username: str, role: Role) -> str:
    payload = {
        "sub": user_id,
        "usr": username,
        "role": role.value,
        "exp": int(time.time()) + settings.token_ttl_seconds,
        "jti": secrets.token_hex(8),
    }
    body = _b64e(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    sig = hmac.new(settings.secret_key.encode("utf-8"), body.encode("ascii"), hashlib.sha256).digest()
    return f"{body}.{_b64e(sig)}"


def decode_token(token: str) -> dict | None:
    try:
        body, sig = token.split(".")
    except ValueError:
        return None
    expected = hmac.new(settings.secret_key.encode("utf-8"), body.encode("ascii"), hashlib.sha256).digest()
    if not hmac.compare_digest(_b64e(expected), sig):
        return None
    try:
        payload = json.loads(_b64d(body))
    except Exception:
        return None
    if payload.get("exp", 0) < time.time():
        return None
    return payload


# ---------------------------------------------------------------------------
# RBAC
# ---------------------------------------------------------------------------

#: Permission -> roles allowed.  Mirrors the matrix in docs/SECURITY.md.
PERMISSIONS: dict[str, set[Role]] = {
    "case:view": {Role.ANALYST, Role.SENIOR_ANALYST, Role.COMPLIANCE_OFFICER, Role.APPROVER, Role.AUDITOR, Role.ADMINISTRATOR},
    "case:note": {Role.ANALYST, Role.SENIOR_ANALYST, Role.COMPLIANCE_OFFICER, Role.APPROVER, Role.ADMINISTRATOR},
    "case:assign": {Role.SENIOR_ANALYST, Role.COMPLIANCE_OFFICER, Role.ADMINISTRATOR},
    "case:escalate": {Role.ANALYST, Role.SENIOR_ANALYST, Role.COMPLIANCE_OFFICER, Role.ADMINISTRATOR},
    "case:decide": {Role.SENIOR_ANALYST, Role.COMPLIANCE_OFFICER, Role.ADMINISTRATOR},
    "case:override_risk": {Role.SENIOR_ANALYST, Role.COMPLIANCE_OFFICER, Role.ADMINISTRATOR},
    "case:approve": {Role.APPROVER, Role.COMPLIANCE_OFFICER, Role.ADMINISTRATOR},
    "alert:triage": {Role.ANALYST, Role.SENIOR_ANALYST, Role.COMPLIANCE_OFFICER, Role.ADMINISTRATOR},
    "report:build": {Role.ANALYST, Role.SENIOR_ANALYST, Role.COMPLIANCE_OFFICER, Role.ADMINISTRATOR},
    "report:submit": {Role.APPROVER, Role.COMPLIANCE_OFFICER, Role.ADMINISTRATOR},
    "audit:view": {Role.SENIOR_ANALYST, Role.COMPLIANCE_OFFICER, Role.APPROVER, Role.AUDITOR, Role.ADMINISTRATOR},
    "pipeline:run": {Role.COMPLIANCE_OFFICER, Role.ADMINISTRATOR},
    "admin": {Role.ADMINISTRATOR},
}


def has_permission(role: Role, permission: str) -> bool:
    return role in PERMISSIONS.get(permission, set())
