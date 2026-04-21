"""Pydantic v2 models for WebSocket messages (Phase 4 contract).

All WS messages serialize through ``WsMessage``, a discriminated union keyed
on the ``type`` field. This keeps client + server in lock-step and gives us
exhaustive typing at the call site.

Shape reference: ``docs/PHASE4_CONTRACTS.md`` section "WebSocket endpoints".
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal, Union
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from zerozero_api.domain.enums import OrderStatus

__all__ = [
    "AssignmentMessage",
    "AssignmentPoint",
    "EtaMessage",
    "PartnerLocationMessage",
    "PingMessage",
    "PongMessage",
    "StatusMessage",
    "WsMessage",
    "dump",
]


class _Base(BaseModel):
    model_config = ConfigDict(extra="forbid", use_enum_values=True)


class StatusMessage(_Base):
    type: Literal["status"] = "status"
    status: OrderStatus
    note: str | None = None
    at: datetime


class PartnerLocationMessage(_Base):
    type: Literal["partner_location"] = "partner_location"
    lat: float
    lng: float
    heading: float | None = None
    speed: float | None = None
    at: datetime


class EtaMessage(_Base):
    type: Literal["eta"] = "eta"
    minutes: int
    at: datetime


class AssignmentPoint(_Base):
    lat: float
    lng: float
    # Free-form label — ``name`` for pickup (restaurant) and ``label`` for drop
    # (address) per the contract. Accept either.
    name: str | None = None
    label: str | None = None


class AssignmentMessage(_Base):
    type: Literal["assignment"] = "assignment"
    order_id: UUID
    pickup: AssignmentPoint
    drop: AssignmentPoint
    at: datetime


class PingMessage(_Base):
    type: Literal["ping"] = "ping"


class PongMessage(_Base):
    type: Literal["pong"] = "pong"


# Discriminated union — Pydantic v2 chooses the concrete variant via ``type``.
WsMessage = Annotated[
    Union[
        StatusMessage,
        PartnerLocationMessage,
        EtaMessage,
        AssignmentMessage,
        PingMessage,
        PongMessage,
    ],
    Field(discriminator="type"),
]


def dump(msg: BaseModel | dict[str, Any]) -> str:
    """Serialize a WsMessage (or any dict) to a compact JSON string.

    Routes either through Pydantic's JSON encoder (handles ``datetime``,
    ``UUID`` etc.) or via ``json.dumps`` with a safe default for plain dicts
    that may already contain stringified values.
    """
    if isinstance(msg, BaseModel):
        return msg.model_dump_json()
    import json

    def _default(obj: Any) -> Any:
        if isinstance(obj, datetime):
            return obj.isoformat()
        if isinstance(obj, UUID):
            return str(obj)
        raise TypeError(f"unserializable: {type(obj).__name__}")

    return json.dumps(msg, separators=(",", ":"), default=_default)
