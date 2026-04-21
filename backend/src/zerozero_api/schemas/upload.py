"""Upload response schemas.

Implements the Phase 2 uploads contract from
``docs/PHASE2_CONTRACTS.md`` (Uploads section).

Only a response schema is declared here — request bodies arrive as
``multipart/form-data`` (FastAPI ``UploadFile``), not JSON, so there's no
Pydantic request model to define.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

__all__ = ["UploadOut"]


class UploadOut(BaseModel):
    """Response returned by ``POST /uploads/image``.

    ``width`` / ``height`` are ``None`` in Phase 2 — Pillow is not in the
    dependency set yet, so we don't decode the image server-side. When
    Pillow is added in Phase 3+, populate these by probing the image
    bytes before writing to storage.
    """

    model_config = ConfigDict(str_strip_whitespace=True)

    url: str = Field(description="Publicly reachable URL to the stored asset.")
    key: str = Field(description="Opaque storage key (e.g. `2026/04/<uuid>.jpg`).")
    size: int = Field(ge=0, description="Byte size of the stored file.")
    width: int | None = Field(default=None, description="Pixel width (None until Pillow).")
    height: int | None = Field(default=None, description="Pixel height (None until Pillow).")
    content_type: str = Field(description="MIME type of the stored file.")
