"""Seed package.

Populates the ZeroZero database with deterministic fixture data for local
development and CI. Entry point is the ``typer`` CLI in ``__main__.py``:

.. code-block:: bash

    # Idempotent seed (safe to re-run)
    python -m zerozero_api.seed run

    # Wipe and re-seed
    python -m zerozero_api.seed run --reset

    # Only selected seeders (comma-separated)
    python -m zerozero_api.seed run --only restaurants,menu_items

The public orchestrator is :func:`zerozero_api.seed.runner.run_seed`.
"""

from __future__ import annotations

from zerozero_api.seed.runner import run_seed

__all__ = ["run_seed"]
