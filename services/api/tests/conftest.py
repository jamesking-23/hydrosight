"""Shared fixtures for the database tests.

Database tests run against a REAL PostgreSQL:
  * CI: set TEST_DATABASE_URL to a superuser connection string (a fresh database is created).
  * Locally: `uv run --python 3.12 pytest` uses the `pgserver` dev dependency (no Docker).
A missing database is a test FAILURE, never a silent skip.
"""

import json
import os
import re
import tempfile
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import psycopg
import pytest
from psycopg.conninfo import make_conninfo

REPO_ROOT = Path(__file__).resolve().parents[3]
MIGRATIONS = REPO_ROOT / "db" / "migrations"
STUB = Path(__file__).parent / "sql" / "supabase_stub.sql"


def _bootstrap(url: str) -> None:
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute(STUB.read_text())
        available = {r[0] for r in conn.execute("select name from pg_available_extensions")}
        for path in sorted(MIGRATIONS.glob("*.sql")):
            sql = path.read_text()
            if "-- requires: postgis" in sql[:200] and "postgis" not in available:
                continue  # spatial migrations need PostGIS; CI and Supabase have it
            # Local pgserver has no PostGIS/pgcrypto. The security logic under test does not use
            # them, so drop only those CREATE EXTENSION lines when the server cannot provide them.
            for ext in ("postgis", "pgcrypto"):
                if ext not in available:
                    pattern = rf"^create extension if not exists {ext}[^;]*;"
                    sql = re.sub(pattern, "-- extension unavailable here", sql, flags=re.M)
            conn.execute(sql)


@pytest.fixture(scope="session")
def db_url() -> Iterator[str]:
    admin_url = os.environ.get("TEST_DATABASE_URL")
    server = None
    if not admin_url:
        try:
            import pgserver
        except ImportError:
            pytest.fail(
                "No test database: set TEST_DATABASE_URL, or run `uv run --python 3.12 pytest` "
                "(pgserver is only installable on Python < 3.13)."
            )
        server = pgserver.get_server(tempfile.mkdtemp(prefix="hs-pg-"))
        admin_url = server.get_uri()
    name = f"hs_test_{uuid.uuid4().hex[:8]}"
    with psycopg.connect(admin_url, autocommit=True) as admin:
        admin.execute(f'create database "{name}"')  # noqa: S608
    url = make_conninfo(admin_url, dbname=name)
    try:
        _bootstrap(url)
        yield url
    finally:
        with psycopg.connect(admin_url, autocommit=True) as admin:
            admin.execute(f'drop database if exists "{name}" with (force)')  # noqa: S608
        if server is not None:
            server.cleanup()


class Db:
    """One transaction per test (rolled back). Switch identity the way Supabase does:
    SET ROLE + request.jwt.claims."""

    def __init__(self, conn: psycopg.Connection[Any]) -> None:
        self.conn = conn

    def q(self, sql: str, params: tuple[Any, ...] | None = None) -> list[tuple[Any, ...]]:
        cur = self.conn.execute(sql, params)  # type: ignore[arg-type]
        return cur.fetchall() if cur.description else []

    def one(self, sql: str, params: tuple[Any, ...] | None = None) -> Any:
        return self.q(sql, params)[0][0]

    def run(self, sql: str, params: tuple[Any, ...] | None = None) -> int:
        return self.conn.execute(sql, params).rowcount  # type: ignore[arg-type]

    def _set(self, role: str | None, claims: dict[str, Any] | None) -> None:
        self.conn.execute("reset role")
        self.conn.execute(
            "select set_config('request.jwt.claims', %s, true)",
            (json.dumps(claims) if claims else "",),
        )
        if role:
            self.conn.execute(f"set local role {role}")

    def su(self) -> None:
        self._set(None, None)

    def anon(self) -> None:
        self._set("anon", {"role": "anon"})

    def service(self) -> None:
        self._set("service_role", {"role": "service_role"})

    def act(self, user_id: uuid.UUID, email: str, aal: str = "aal2") -> None:
        claims = {"sub": str(user_id), "email": email, "aal": aal, "role": "authenticated"}
        self._set("authenticated", claims)


@pytest.fixture
def db(db_url: str) -> Iterator[Db]:
    conn = psycopg.connect(db_url)  # autocommit off: everything is rolled back
    try:
        yield Db(conn)
    finally:
        conn.rollback()
        conn.close()


@dataclass
class World:
    db: Db
    org_a: uuid.UUID
    org_b: uuid.UUID
    users: dict[str, uuid.UUID]

    def email(self, name: str) -> str:
        return f"{name}@{'b' if name == 'bob' else 'a'}.test"

    def as_(self, name: str, aal: str = "aal2") -> None:
        self.db.act(self.users[name], self.email(name), aal)


@pytest.fixture
def world(db: Db) -> World:
    """Two organisations. A: alice (org_admin), carol (hydrologist), dave (community_member),
    eve (government_authority), frank (field_technician). B: bob (org_admin)."""
    users = {}
    for name in ("alice", "bob", "carol", "dave", "eve", "frank"):
        domain = "b" if name == "bob" else "a"
        users[name] = db.one(
            "insert into auth.users (email) values (%s) returning id", (f"{name}@{domain}.test",)
        )
    org_a = db.one(
        "insert into public.organizations (name, slug) values ('Org A', 'org-a') returning id"
    )
    org_b = db.one(
        "insert into public.organizations (name, slug) values ('Org B', 'org-b') returning id"
    )
    members = [
        (org_a, "alice", "org_admin"),
        (org_b, "bob", "org_admin"),
        (org_a, "carol", "hydrologist"),
        (org_a, "dave", "community_member"),
        (org_a, "eve", "government_authority"),
        (org_a, "frank", "field_technician"),
    ]
    for org, name, role in members:
        db.run(
            "insert into public.memberships (org_id, user_id, role_key) values (%s, %s, %s)",
            (org, users[name], role),
        )
    return World(db, org_a, org_b, users)


@pytest.fixture(scope="session")
def postgis(db_url: str) -> bool:
    """Spatial tests need PostGIS. Locally (pgserver) they skip loudly; CI sets REQUIRE_POSTGIS=1
    so a missing PostGIS there is a failure, never a silent skip."""
    with psycopg.connect(db_url) as conn:
        has = conn.execute("select 1 from pg_extension where extname = 'postgis'").fetchone()
    if has:
        return True
    if os.environ.get("REQUIRE_POSTGIS"):
        pytest.fail("REQUIRE_POSTGIS is set but PostGIS is not installed in the test database")
    pytest.skip("PostGIS not available in this database (spatial tests run in CI)")


SEED = REPO_ROOT / "db" / "seed" / "demo_stations.sql"


@pytest.fixture
def geo_world(world: World, postgis: bool) -> World:
    """`world` plus the migration-0003 schema; demo seed is applied by tests that need it."""
    return world
