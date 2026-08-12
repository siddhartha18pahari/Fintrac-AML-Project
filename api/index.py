"""Vercel serverless entrypoint.

Vercel's Python runtime serves any ASGI application exported as ``app`` from a
file under ``api/``.  This module only adds the project root to ``sys.path``
(the function's working directory is the repo root, but imports are resolved
relative to this file) and triggers the idempotent bootstrap, because Vercel's
adapter does not reliably run ASGI lifespan events.

Everything else lives in ``app.main`` and is identical to the local server.
"""

from __future__ import annotations

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.main import app, bootstrap  # noqa: E402

# Runs once per cold start, and only when AUTO_MIGRATE is on.  Turn it off in
# the Vercel environment after the database has been provisioned so that a
# traffic spike does not have every new instance issuing DDL.
bootstrap()

__all__ = ["app"]
