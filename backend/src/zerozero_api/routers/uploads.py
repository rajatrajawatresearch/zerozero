"""Image upload endpoint.

Implements the Phase 2 uploads contract from
``docs/PHASE2_CONTRACTS.md`` > Uploads:

    POST /uploads/image   multipart/form-data, field=file
      -> UploadOut

Rules enforced here:
  * Auth: ``Depends(get_current_user)`` — logged-in only.
  * Allowed content types: ``image/jpeg``, ``image/png``, ``image/webp``.
    Anything else -> 415.
  * Max size 10 MB (streamed cap). Larger -> 413.
  * Filename is discarded; only the MIME type drives the stored extension.

Width / height probing is deferred to Phase 3+ when Pillow lands in the
dependency set; until then the response carries ``width=None,
height=None`` (see ``schemas.upload.UploadOut``).
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from zerozero_api.core.deps import get_current_user
from zerozero_api.domain.user import User
from zerozero_api.schemas.upload import UploadOut
from zerozero_api.services.storage import (
    StorageDriver,
    extension_for_content_type,
    generate_key,
    get_storage,
)

# OPTIONAL: pillow — when added to pyproject.toml, decode the bytes here
# to populate width/height before returning UploadOut.

__all__ = ["router"]


router = APIRouter(prefix="/uploads", tags=["uploads"])


_ALLOWED_CONTENT_TYPES: frozenset[str] = frozenset(
    {"image/jpeg", "image/png", "image/webp"}
)

# 10 MB hard cap (contract says "up to 10 MB"; docs advertise 5 MB as the
# product-level limit — enforce the larger technical cap here so the 413
# surfaces cleanly even if a client over-sends).
_MAX_BYTES: int = 10 * 1024 * 1024
# Size of each read chunk while we count bytes. 64 KiB is a good balance
# between syscall overhead and memory pressure on tiny uploads.
_CHUNK: int = 64 * 1024


def _storage_dep() -> StorageDriver:
    """FastAPI dep wrapper so tests can override the driver cleanly."""
    return get_storage()


@router.post(
    "/image",
    response_model=UploadOut,
    status_code=status.HTTP_201_CREATED,
    summary="Upload an image and get its public URL",
)
async def upload_image(
    file: Annotated[UploadFile, File(description="Image file (jpeg/png/webp, up to 10 MB)")],
    current_user: Annotated[User, Depends(get_current_user)],
    storage: Annotated[StorageDriver, Depends(_storage_dep)],
) -> UploadOut:
    """Persist an uploaded image and return its public URL.

    The handler streams the body into memory with an early-exit cap so a
    hostile client can't OOM the worker by sending a 10 GB file with a
    small declared size.
    """
    content_type = (file.content_type or "").lower().strip()
    if content_type not in _ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="unsupported_media_type",
        )

    data = await _read_with_cap(file, _MAX_BYTES)

    # Generate a server-owned key — never trust the client filename.
    key = generate_key(
        filename=file.filename or "",
        user_id=current_user.id,
    )
    # Normalise the extension to match the sniffed content type so
    # e.g. a PNG uploaded as ``photo`` (no suffix) still lands as ``.png``.
    key = _swap_extension(key, extension_for_content_type(content_type))

    url = await storage.put(key, data, content_type)

    return UploadOut(
        url=url,
        key=key,
        size=len(data),
        width=None,  # TODO(phase3+): populate via Pillow once added.
        height=None,
        content_type=content_type,
    )


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


async def _read_with_cap(file: UploadFile, max_bytes: int) -> bytes:
    """Read ``file`` into memory, rejecting anything over ``max_bytes``.

    We read in chunks so we can stop early instead of buffering a
    multi-GB payload only to reject it afterwards. Returns the full body
    on success.
    """
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(_CHUNK)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="file_too_large",
            )
        chunks.append(chunk)
    return b"".join(chunks)


def _swap_extension(key: str, ext: str) -> str:
    """Replace the extension on a ``generate_key`` output.

    ``generate_key`` derives its extension from the (untrusted) filename;
    once we know the content type we want the on-disk extension to match
    the MIME. Keeping this in the router (not the service) means
    ``generate_key`` stays a pure function of ``(filename, user_id)``.
    """
    dot = key.rfind(".")
    slash = key.rfind("/")
    if dot == -1 or dot < slash:
        return f"{key}{ext}"
    return f"{key[:dot]}{ext}"
