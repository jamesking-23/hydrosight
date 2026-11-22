"""HS-AI-001..008: assistant switch, token cap, append-only log, tenant isolation.
Needs the PostGIS migration chain (CI); skipped locally."""

import json

import psycopg
from conftest import World
from helpers import fails

NoPerm = psycopg.errors.InsufficientPrivilege
Check = psycopg.errors.CheckViolation

LOG = "select public.log_assistant_turn(%s, %s, %s, null, %s::jsonb, %s::jsonb, %s, %s, 'test', 'fake', '{}'::jsonb)"


def _log(w: World, who: str, org, status: str = "answered", tin: int = 100, tout: int = 50):  # type: ignore[no-untyped-def]
    w.as_(who)
    return w.db.one(
        LOG,
        (org, "Which stations are stale?", status, json.dumps({"observed": []}), "[]", tin, tout),
    )


def test_off_by_default_and_reports_why(geo_world: World) -> None:
    world = geo_world
    world.as_("alice")
    r = world.db.one("select public.assistant_begin(%s)", (world.org_a,))
    assert r == {"allowed": False, "reason": "not_enabled"}


def test_only_admins_set_the_cap_and_values_are_bounded(geo_world: World) -> None:
    world = geo_world
    world.as_("carol")
    with fails(NoPerm):
        world.db.run("select public.set_assistant_limit(%s, true, 50000, 4000)", (world.org_a,))
    world.as_("alice")
    with fails(Check):
        world.db.run("select public.set_assistant_limit(%s, true, 10, 4000)", (world.org_a,))
    with fails(NoPerm):
        world.db.run("select public.set_assistant_limit(%s, true, 50000, 4000)", (world.org_b,))
    world.db.run("select public.set_assistant_limit(%s, true, 50000, 4000)", (world.org_a,))
    r = world.db.one("select public.assistant_begin(%s)", (world.org_a,))
    assert (
        r["allowed"] is True and r["remaining_tokens"] == 50000 and r["max_tokens_per_turn"] == 4000
    )


def test_cap_blocks_after_usage_and_shrinks_per_turn_budget(geo_world: World) -> None:
    world = geo_world
    world.as_("alice")
    world.db.run("select public.set_assistant_limit(%s, true, 1000, 4000)", (world.org_a,))
    _log(world, "carol", world.org_a, tin=500, tout=400)
    world.as_("carol")
    r = world.db.one("select public.assistant_begin(%s)", (world.org_a,))
    assert r["allowed"] is True and r["remaining_tokens"] == 100 and r["max_tokens_per_turn"] == 100
    _log(world, "carol", world.org_a, tin=60, tout=60)
    world.as_("carol")
    r = world.db.one("select public.assistant_begin(%s)", (world.org_a,))
    assert r["allowed"] is False and r["reason"] == "daily_cap_reached"


def test_cap_is_per_organisation(geo_world: World) -> None:
    world = geo_world
    world.as_("alice")
    world.db.run("select public.set_assistant_limit(%s, true, 1000, 4000)", (world.org_a,))
    _log(world, "carol", world.org_a, tin=900, tout=200)
    world.as_("bob")
    world.db.run("select public.set_assistant_limit(%s, true, 1000, 4000)", (world.org_b,))
    assert world.db.one("select public.assistant_begin(%s)", (world.org_b,))["allowed"] is True


def test_roles_without_permission_cannot_use_or_log(geo_world: World) -> None:
    world = geo_world
    for who in ("dave", "frank"):  # community_member, field_technician
        world.as_(who)
        with fails(NoPerm):
            world.db.run("select public.assistant_begin(%s)", (world.org_a,))
        with fails(NoPerm):
            world.db.run(LOG, (world.org_a, "q", "answered", "{}", "[]", 1, 1))
    world.as_("bob")
    with fails(NoPerm):  # another organisation's admin
        world.db.run("select public.assistant_begin(%s)", (world.org_a,))


def test_log_is_append_only_even_for_superuser(geo_world: World) -> None:
    world = geo_world
    tid = _log(world, "carol", world.org_a)
    world.db.su()
    with fails(NoPerm):
        world.db.run("update public.assistant_turns set question = 'x' where id = %s", (tid,))
    with fails(NoPerm):
        world.db.run("delete from public.assistant_turns where id = %s", (tid,))


def test_turn_visibility_own_for_users_all_for_admin_none_cross_tenant(geo_world: World) -> None:
    world = geo_world
    _log(world, "carol", world.org_a)
    _log(world, "eve", world.org_a)
    world.as_("carol")
    assert world.db.one("select count(*) from public.assistant_turns") == 1
    world.as_("alice")
    assert world.db.one("select count(*) from public.assistant_turns") == 2
    world.as_("bob")
    assert world.db.one("select count(*) from public.assistant_turns") == 0


def test_cannot_forge_other_users_or_unknown_status(geo_world: World) -> None:
    world = geo_world
    world.as_("carol")
    with fails(Check):
        world.db.run(LOG, (world.org_a, "q", "approved", "{}", "[]", 1, 1))
    tid = _log(world, "carol", world.org_a)
    world.db.su()
    assert (
        world.db.one("select user_id from public.assistant_turns where id = %s", (tid,))
        == world.users["carol"]
    )
