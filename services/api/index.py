"""Vercel entrypoint for the HydroSight API.

Vercel looks for a top-level ASGI `app` in a file such as index.py. The real application
lives in src/hydrosight_api/main.py; this shim only makes it importable without requiring
the project itself to be pip-installed in the Vercel build.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))

from hydrosight_api.main import app  # noqa: E402

__all__ = ["app"]
