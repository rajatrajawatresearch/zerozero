"""WebSocket package — Phase 4 real-time layer.

Re-exports the singleton ``manager``, pub/sub publishers, close codes, and
message models so other agents can ``from zerozero_api.ws import ...``
without memorising the internal module layout.
"""

from __future__ import annotations

from zerozero_api.services.event_bus import (
    publish_order_event,
    publish_partner_event,
    publish_public_event,
)
from zerozero_api.ws.auth import (
    WS_CLOSE_FORBIDDEN,
    WS_CLOSE_NOT_FOUND,
    WS_CLOSE_UNAUTHORIZED,
    ws_get_user_from_token,
)
from zerozero_api.ws.connection_manager import ConnectionManager, manager
from zerozero_api.ws.events import (
    AssignmentMessage,
    AssignmentPoint,
    EtaMessage,
    PartnerLocationMessage,
    PingMessage,
    PongMessage,
    StatusMessage,
    WsMessage,
    dump,
)

__all__ = [
    "AssignmentMessage",
    "AssignmentPoint",
    "ConnectionManager",
    "EtaMessage",
    "PartnerLocationMessage",
    "PingMessage",
    "PongMessage",
    "StatusMessage",
    "WS_CLOSE_FORBIDDEN",
    "WS_CLOSE_NOT_FOUND",
    "WS_CLOSE_UNAUTHORIZED",
    "WsMessage",
    "dump",
    "manager",
    "publish_order_event",
    "publish_partner_event",
    "publish_public_event",
    "ws_get_user_from_token",
]
