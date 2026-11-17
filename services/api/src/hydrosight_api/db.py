import psycopg


def check_database(database_url: str, timeout_seconds: int = 3) -> tuple[bool, str]:
    """Return (ok, detail). Never raises: readiness must report failure explicitly."""
    if not database_url:
        return False, "DATABASE_URL is not set"
    try:
        with (
            psycopg.connect(database_url, connect_timeout=timeout_seconds) as conn,
            conn.cursor() as cur,
        ):
            cur.execute("select 1")
            cur.fetchone()
    except Exception as exc:  # noqa: BLE001 - report any failure, don't hide it
        return False, f"database unreachable: {type(exc).__name__}"
    return True, "ok"
