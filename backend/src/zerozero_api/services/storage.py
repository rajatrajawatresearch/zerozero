"""Storage driver abstraction.

Phase 2 ships the ``local`` driver (writes under ``STORAGE_LOCAL_PATH`` and
serves via FastAPI ``StaticFiles``). The S3-compatible driver is a
skeleton — ``boto3`` is already pinned in ``pyproject.toml`` so we can
fill it in without dep churn when a cloud target is wired up.

Contract (from ``docs/PHASE2_CONTRACTS.md`` > Uploads):

    POST /uploads/image  (multipart, field=file)
      -> {url, key, size, width, height, content_type}

The driver is selected by ``Settings.STORAGE_DRIVER`` at call time, so
swapping drivers in tests is a settings override away.
"""

from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Protocol, runtime_checkable
from uuid import UUID, uuid4

from zerozero_api.settings import Settings, get_settings

__all__ = [
    "LocalDisk",
    "S3Compat",
    "StorageDriver",
    "generate_key",
    "get_storage",
]


# ---------------------------------------------------------------------------
# Allowed extensions
# ---------------------------------------------------------------------------

# Only the extensions we accept at the router layer. Keeping this tight
# here (rather than in the router) means every driver sees a sanitised
# key — no user-controlled path segments ever hit the filesystem.
_ALLOWED_EXTENSIONS: frozenset[str] = frozenset({".jpg", ".jpeg", ".png", ".webp"})
_CONTENT_TYPE_TO_EXT: dict[str, str] = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


# ---------------------------------------------------------------------------
# Protocol
# ---------------------------------------------------------------------------


@runtime_checkable
class StorageDriver(Protocol):
    """Minimal driver surface consumed by the uploads router.

    Implementations MUST be safe to call concurrently — the router does
    not serialise writes.
    """

    async def put(self, key: str, data: bytes, content_type: str) -> str:
        """Persist ``data`` under ``key`` and return its public URL."""
        ...

    async def delete(self, key: str) -> None:
        """Best-effort delete. Missing keys must NOT raise."""
        ...

    def public_url(self, key: str) -> str:
        """Build the publicly reachable URL for ``key``."""
        ...


# ---------------------------------------------------------------------------
# Local disk driver
# ---------------------------------------------------------------------------


class LocalDisk:
    """Filesystem-backed driver used in dev + tests.

    Writes under ``root`` and serves via FastAPI ``StaticFiles`` mounted at
    ``/uploads`` in ``main.py``. Writes are atomic (``<key>.tmp`` +
    rename) so a half-written file never becomes visible to the web
    server.
    """

    def __init__(self, root: Path, base_url: str) -> None:
        self._root = root.resolve()
        self._base_url = base_url.rstrip("/")
        self._root.mkdir(parents=True, exist_ok=True)

    # -- public API ----------------------------------------------------------

    async def put(self, key: str, data: bytes, content_type: str) -> str:
        target = self._safe_target(key)
        await asyncio.to_thread(self._write_atomic, target, data)
        return self.public_url(key)

    async def delete(self, key: str) -> None:
        target = self._safe_target(key)

        def _unlink() -> None:
            try:
                target.unlink()
            except FileNotFoundError:
                return

        await asyncio.to_thread(_unlink)

    def public_url(self, key: str) -> str:
        # ``key`` is always forward-slash-delimited (we build it that way).
        return f"{self._base_url}/uploads/{key.lstrip('/')}"

    # -- helpers -------------------------------------------------------------

    def _safe_target(self, key: str) -> Path:
        """Resolve ``key`` under ``root`` and reject path traversal.

        Even though our callers build the key themselves, this guard
        means a bug elsewhere can't escape ``root``.
        """
        candidate = (self._root / key).resolve()
        try:
            candidate.relative_to(self._root)
        except ValueError as exc:  # pragma: no cover - defensive
            raise ValueError(f"invalid storage key: {key!r}") from exc
        return candidate

    @staticmethod
    def _write_atomic(target: Path, data: bytes) -> None:
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_suffix(target.suffix + ".tmp")
        tmp.write_bytes(data)
        os.replace(tmp, target)


# ---------------------------------------------------------------------------
# S3-compatible driver (SKELETON)
# ---------------------------------------------------------------------------


class S3Compat:
    """Skeleton for S3 / MinIO / R2 backed storage.

    Intentionally raises ``NotImplementedError`` in Phase 2. ``boto3`` is
    already pinned in ``pyproject.toml`` dependencies, so implementing
    this is a pure-code change — no dep bump required. When wiring up,
    use ``aioboto3`` or wrap sync ``boto3`` calls in ``asyncio.to_thread``.
    """

    def __init__(
        self,
        *,
        bucket: str,
        region: str | None = None,
        endpoint_url: str | None = None,
        public_base_url: str | None = None,
    ) -> None:
        self._bucket = bucket
        self._region = region
        self._endpoint_url = endpoint_url
        self._public_base_url = (public_base_url or "").rstrip("/")

    async def put(self, key: str, data: bytes, content_type: str) -> str:  # pragma: no cover - skeleton
        # TODO(phase3+): use boto3 (already in pyproject.toml) —
        #   session = boto3.session.Session(region_name=self._region)
        #   client = session.client("s3", endpoint_url=self._endpoint_url)
        #   await asyncio.to_thread(
        #       client.put_object,
        #       Bucket=self._bucket, Key=key, Body=data, ContentType=content_type,
        #   )
        raise NotImplementedError("S3Compat.put is not implemented in Phase 2")

    async def delete(self, key: str) -> None:  # pragma: no cover - skeleton
        raise NotImplementedError("S3Compat.delete is not implemented in Phase 2")

    def public_url(self, key: str) -> str:  # pragma: no cover - skeleton
        if self._public_base_url:
            return f"{self._public_base_url}/{key.lstrip('/')}"
        raise NotImplementedError("S3Compat.public_url requires public_base_url")


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def get_storage(settings: Settings | None = None) -> StorageDriver:
    """Return the configured storage driver.

    Called per-request by the uploads router. Cheap to construct — the
    ``LocalDisk`` ctor only ensures the root exists — so we don't bother
    caching.
    """
    s = settings or get_settings()
    driver = s.STORAGE_DRIVER.lower()

    if driver == "local":
        return LocalDisk(root=Path(s.STORAGE_LOCAL_PATH), base_url=s.APP_BASE_URL)
    if driver in {"s3", "s3compat"}:
        # Configured via env in Phase 3+; raise eagerly so misconfig is loud.
        raise NotImplementedError(
            "STORAGE_DRIVER='s3' is a skeleton in Phase 2; use 'local' for now."
        )
    raise ValueError(f"unsupported STORAGE_DRIVER: {s.STORAGE_DRIVER!r}")


# ---------------------------------------------------------------------------
# Key generation
# ---------------------------------------------------------------------------


def generate_key(filename: str, user_id: UUID) -> str:
    """Build a storage key like ``2026/04/<uuid>.jpg``.

    Only the extension is derived from ``filename`` — the caller-supplied
    name is discarded to prevent path-traversal and to keep keys opaque.
    ``user_id`` is accepted for future use (per-user folders, audit logs)
    but intentionally NOT embedded in the key today so a URL leak doesn't
    expose the uploader.
    """
    _ = user_id  # reserved; see docstring
    ext = _extract_extension(filename)
    now = datetime.now(tz=timezone.utc)
    return f"{now:%Y}/{now:%m}/{uuid4().hex}{ext}"


def _extract_extension(filename: str) -> str:
    """Pull a lower-case, allow-listed extension from ``filename``.

    Returns ``.jpg`` as a safe default when the extension is missing or
    not on the allow-list — the router has already gate-checked the
    content type, so a default here is just belt-and-braces.
    """
    if not filename:
        return ".jpg"
    suffix = Path(filename).suffix.lower()
    if suffix in _ALLOWED_EXTENSIONS:
        # Normalise ``.jpeg`` -> ``.jpg`` to keep the key set tidy.
        return ".jpg" if suffix == ".jpeg" else suffix
    return ".jpg"


def extension_for_content_type(content_type: str) -> str:
    """Public helper so the router can pick an extension from MIME.

    Used when the client omits / mangles the filename — we still write a
    file with the correct extension based on the sniffed content type.
    """
    return _CONTENT_TYPE_TO_EXT.get(content_type.lower(), ".jpg")
