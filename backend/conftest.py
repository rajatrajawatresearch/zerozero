"""Root conftest for the backend project.

Hoists the `tests.conftest` plugin so that pytest discovers the session-scoped
testcontainer fixtures (postgres/redis) and the per-test `client`/`db_session`
fixtures when tests are invoked from either the `backend/` directory or the
repository root.
"""

from __future__ import annotations

pytest_plugins = ["tests.conftest"]
