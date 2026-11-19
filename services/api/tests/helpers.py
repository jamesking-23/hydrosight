from typing import Any

import pytest


def fails(db: Any, exc: type[Exception], sql: str, params: tuple[Any, ...] | None = None) -> None:
    """Assert the statement raises `exc`. A savepoint keeps the surrounding test transaction usable."""
    with pytest.raises(exc), db.conn.transaction():
        db.conn.execute(sql, params)
