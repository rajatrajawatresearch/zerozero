"""CLI entry point for the seeder.

Invocations
-----------

.. code-block:: bash

    # Run all stages idempotently.
    python -m zerozero_api.seed run

    # Drop everything first, then re-seed.
    python -m zerozero_api.seed run --reset
    python -m zerozero_api.seed --reset          # short form (root cmd)

    # Only specific stages (comma-separated).
    python -m zerozero_api.seed run --only restaurants,menu_items
"""

from __future__ import annotations

import asyncio

import typer
from rich.console import Console
from rich.table import Table

from zerozero_api.seed.runner import SEED_STAGES, SeedSummary, run_seed

app = typer.Typer(
    help="Seed the ZeroZero database with deterministic demo data.",
    no_args_is_help=False,
    add_completion=False,
)
console = Console()


def _print_summary(summary: SeedSummary) -> None:
    """Render the seed result as a pretty Rich table."""
    table = Table(
        title="[bold green]Seed complete[/bold green]",
        show_header=True,
        header_style="bold cyan",
    )
    table.add_column("Stage", style="white")
    table.add_column("Rows", justify="right", style="green")

    for stage in SEED_STAGES:
        if stage in summary.counts:
            table.add_row(stage, str(summary.counts[stage]))
        else:
            table.add_row(stage, "[dim]skipped[/dim]")

    console.print(table)
    if summary.reset:
        console.print("[yellow]↻ Reset mode: all tables were truncated before seed.[/yellow]")


def _parse_only(raw: str | None) -> list[str] | None:
    if raw is None:
        return None
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    return parts or None


@app.callback(invoke_without_command=True)
def _root(
    ctx: typer.Context,
    reset: bool = typer.Option(
        False,
        "--reset",
        help="Truncate all seedable tables before inserting.",
    ),
    only: str | None = typer.Option(
        None,
        "--only",
        help="Comma-separated stages to run. Default = all stages.",
    ),
) -> None:
    """Root command: ``python -m zerozero_api.seed [--reset] [--only ...]``.

    If no explicit subcommand is invoked (e.g. the bare
    ``python -m zerozero_api.seed --reset`` form from the project README),
    we treat it as an alias for ``run``.
    """
    if ctx.invoked_subcommand is not None:
        return
    summary = asyncio.run(run_seed(reset=reset, only=_parse_only(only)))
    _print_summary(summary)


@app.command("run")
def run(
    reset: bool = typer.Option(
        False,
        "--reset",
        help="Truncate all seedable tables before inserting.",
    ),
    only: str | None = typer.Option(
        None,
        "--only",
        help="Comma-separated stages to run. Default = all stages.",
    ),
) -> None:
    """Run the seeder. See module docstring for usage examples."""
    summary = asyncio.run(run_seed(reset=reset, only=_parse_only(only)))
    _print_summary(summary)


if __name__ == "__main__":
    app()
