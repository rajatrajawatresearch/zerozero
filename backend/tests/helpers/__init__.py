"""Shared test helpers for Phase 2 backend tests.

Re-exports the factory + auth helpers so test modules can do::

    from tests.helpers import make_user, make_authenticated_client, auth_headers
"""

from __future__ import annotations

from tests.helpers.factories import (
    DEFAULT_PASSWORD,
    auth_headers,
    make_authenticated_client,
    make_user,
    signup_and_login,
)

__all__ = [
    "DEFAULT_PASSWORD",
    "auth_headers",
    "make_authenticated_client",
    "make_user",
    "signup_and_login",
]
