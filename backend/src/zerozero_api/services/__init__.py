"""Service layer — business logic lives here.

Routers stay thin: they parse input, call a service function, and
serialize the result. Services raise typed errors from
:mod:`zerozero_api.core.errors` (``NotFoundError`` / ``ConflictError`` /
``PermissionError_``) rather than ``HTTPException`` so they stay
framework-agnostic and easy to unit-test.
"""

from __future__ import annotations

from zerozero_api.services import address_service, auth_service, user_service

__all__ = ["address_service", "auth_service", "user_service"]
