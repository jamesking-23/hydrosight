"""HS-IAM-004: API keys are hashed, scoped, expiring, revocable; never privileged."""

import psycopg
import pytest
from conftest import World
from helpers import fails

Q_KEY = "select public.create_api_key(%s, %s, %s)"


def _key(w: World, scopes: list[str] | None = None) -> str:
    w.as_("alice")
    return str(w.db.one(Q_KEY, (w.org_a, "ingest", scopes or ["readings.read"])))


def test_key_not_stored_in_clear_and_shown_once(world: World) -> None:
    key = _key(world)
    assert key.startswith("hsk_")
    world.db.su()
    row = world.db.q("select key_prefix, key_hash from public.api_keys")[0]
    assert key.split("_")[1] == row[0]
    assert row[1] != key and key not in str(world.db.q("select * from public.api_keys"))
    assert key not in str(world.db.q("select details from public.audit_log"))


def test_privileged_scopes_refused(world: World) -> None:
    world.as_("alice")
    for scope in (
        "warnings.approve",
        "warnings.publish",
        "org.manage",
        "audit.read",
        "apikeys.manage",
    ):
        fails(world.db, psycopg.errors.InvalidParameterValue, Q_KEY, (world.org_a, "k", [scope]))


def test_unknown_or_empty_scopes_refused(world: World) -> None:
    world.as_("alice")
    fails(world.db, psycopg.errors.InvalidParameterValue, Q_KEY, (world.org_a, "k", ["nope.read"]))
    fails(world.db, psycopg.errors.InvalidParameterValue, Q_KEY, (world.org_a, "k", []))


def test_scope_cannot_exceed_creator(world: World) -> None:
    world.db.su()
    missing = world.db.one("""
        select p.key from public.permissions p
        where not p.privileged and not exists (
          select 1 from public.role_permissions rp where rp.role_key = 'org_admin' and rp.permission_key = p.key)
        limit 1""")
    if missing is None:
        pytest.skip("org_admin holds every non-privileged permission")
    world.as_("alice")
    fails(world.db, psycopg.errors.InsufficientPrivilege, Q_KEY, (world.org_a, "k", [missing]))


def test_expiry_must_be_in_future(world: World) -> None:
    world.as_("alice")
    fails(world.db, psycopg.errors.InvalidParameterValue,
          "select public.create_api_key(%s, 'k', array['readings.read'], now() - interval '1 hour')",
          (world.org_a,))  # fmt: skip


def test_verify_is_service_role_only(world: World) -> None:
    key = _key(world)
    world.as_("alice")
    fails(
        world.db,
        psycopg.errors.InsufficientPrivilege,
        "select * from public.verify_api_key(%s)",
        (key,),
    )
    world.db.anon()
    fails(
        world.db,
        psycopg.errors.InsufficientPrivilege,
        "select * from public.verify_api_key(%s)",
        (key,),
    )


def test_verify_returns_org_and_scopes(world: World) -> None:
    key = _key(world, ["readings.read", "sensors.read"])
    world.db.service()
    rows = world.db.q("select * from public.verify_api_key(%s)", (key,))
    assert len(rows) == 1
    assert rows[0][1] == world.org_a and sorted(rows[0][2]) == ["readings.read", "sensors.read"]
    assert world.db.q("select * from public.verify_api_key('hsk_wrong')") == []


def test_revoked_key_fails_verification(world: World) -> None:
    key = _key(world)
    key_id = world.db.one("select id from public.api_keys")
    world.db.one("select public.revoke_api_key(%s) is null", (key_id,))
    world.db.service()
    assert world.db.q("select * from public.verify_api_key(%s)", (key,)) == []


def test_expired_key_fails_verification(world: World) -> None:
    key = _key(world)
    world.db.su()
    world.db.run(
        "update public.api_keys set created_at = now() - interval '2 days', expires_at = now() - interval '1 day'"
    )
    world.db.service()
    assert world.db.q("select * from public.verify_api_key(%s)", (key,)) == []


def test_other_org_cannot_revoke(world: World) -> None:
    _key(world)
    world.db.su()
    key_id = world.db.one("select id from public.api_keys")
    world.as_("bob")
    fails(
        world.db,
        psycopg.errors.InsufficientPrivilege,
        "select public.revoke_api_key(%s)",
        (key_id,),
    )


def test_verification_does_not_flood_audit_log(world: World) -> None:
    key = _key(world)
    world.db.su()
    before = world.db.one("select count(*) from public.audit_log where entity_type = 'api_keys'")
    world.db.service()
    for _ in range(3):
        world.db.q("select * from public.verify_api_key(%s)", (key,))
    world.db.su()
    assert (
        world.db.one("select count(*) from public.audit_log where entity_type = 'api_keys'")
        == before
    )
    assert world.db.one("select last_used_at is not null from public.api_keys")
