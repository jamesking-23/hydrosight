"""HS-TEN-001: a user in org A can never read or write org B data (rule 7).

These run as the real `authenticated` / `anon` database roles with RLS in force, i.e. the same
path PostgREST and any direct database role would take.
"""

import psycopg
import pytest
from conftest import World
from helpers import fails

TABLES = [
    "organizations", "profiles", "memberships", "invitations", "api_keys", "audit_log",
    "platform_memberships", "roles", "permissions", "role_permissions",
]  # fmt: skip


def test_user_sees_only_own_org(world: World) -> None:
    world.as_("alice")
    assert [r[0] for r in world.db.q("select id from public.organizations")] == [world.org_a]
    world.as_("bob")
    assert [r[0] for r in world.db.q("select id from public.organizations")] == [world.org_b]


def test_cannot_read_other_orgs_members(world: World) -> None:
    world.as_("alice")
    assert (
        world.db.one("select count(*) from public.memberships where org_id = %s", (world.org_b,))
        == 0
    )
    assert (
        world.db.one("select count(*) from public.memberships where org_id = %s", (world.org_a,))
        == 5
    )


@pytest.mark.parametrize(("me", "other"), [("alice", "org_b"), ("bob", "org_a")])
def test_cannot_write_other_org(world: World, me: str, other: str) -> None:
    other_org = getattr(world, other)
    world.as_(me)
    assert (
        world.db.run("update public.organizations set name = 'Hacked' where id = %s", (other_org,))
        == 0
    )
    assert (
        world.db.run(
            "update public.memberships set status = 'suspended' where org_id = %s", (other_org,)
        )
        == 0
    )
    assert world.db.run("delete from public.memberships where org_id = %s", (other_org,)) == 0
    world.db.su()
    assert world.db.one(
        "select name from public.organizations where id = %s", (other_org,)
    ).startswith("Org ")
    assert (
        world.db.one(
            "select count(*) from public.memberships where org_id = %s and status = 'active'",
            (other_org,),
        )
        >= 1
    )


@pytest.mark.parametrize(("me", "other"), [("alice", "org_b"), ("bob", "org_a")])
def test_cannot_use_functions_on_other_org(world: World, me: str, other: str) -> None:
    other_org = getattr(world, other)
    world.as_(me)
    fails(
        world.db, psycopg.errors.InsufficientPrivilege,
        "select public.create_invitation(%s, 'x@y.test', 'hydrologist')", (other_org,),
    )  # fmt: skip
    fails(
        world.db, psycopg.errors.InsufficientPrivilege,
        "select public.create_api_key(%s, 'k', array['readings.read'])", (other_org,),
    )  # fmt: skip


@pytest.mark.parametrize(("me", "other"), [("alice", "org_b"), ("bob", "org_a")])
def test_cannot_read_other_orgs_audit_invites_keys(world: World, me: str, other: str) -> None:
    mine = world.org_a if me == "alice" else world.org_b
    world.as_(me)
    world.db.one("select public.create_invitation(%s, 'n@x.test', 'hydrologist')", (mine,))
    world.db.one("select public.create_api_key(%s, 'k', array['readings.read'])", (mine,))
    other_org = getattr(world, other)
    for table in ("audit_log", "invitations", "api_keys"):
        sql = f"select count(*) from public.{table} where org_id = %s"  # noqa: S608
        assert world.db.one(sql, (other_org,)) == 0, table
        assert world.db.one(sql, (mine,)) >= 1, table


def test_anonymous_has_no_access_to_any_table(world: World) -> None:
    world.db.anon()
    for table in TABLES:
        fails(
            world.db, psycopg.errors.InsufficientPrivilege,
            f"select count(*) from public.{table}",  # noqa: S608
        )  # fmt: skip


def test_authenticated_cannot_insert_memberships_directly(world: World) -> None:
    world.as_("alice")
    fails(
        world.db, psycopg.errors.InsufficientPrivilege,
        "insert into public.memberships (org_id, user_id, role_key) values (%s, %s, 'org_admin')",
        (world.org_a, world.users["bob"]),
    )  # fmt: skip


def test_authenticated_cannot_create_organisations(world: World) -> None:
    world.as_("alice")
    fails(
        world.db, psycopg.errors.InsufficientPrivilege,
        "insert into public.organizations (name, slug) values ('Rogue', 'rogue')",
    )  # fmt: skip
    fails(
        world.db, psycopg.errors.InsufficientPrivilege,
        "select public.admin_create_organization('Rogue', 'rogue', 'a@b.test')",
    )  # fmt: skip


def test_profiles_are_tenant_scoped(world: World) -> None:
    world.as_("alice")  # org_admin has members.read
    emails = {r[0] for r in world.db.q("select email from public.profiles")}
    assert "carol@a.test" in emails
    assert "bob@b.test" not in emails
    world.as_("carol")  # hydrologist: no members.read => only self
    assert [r[0] for r in world.db.q("select email from public.profiles")] == ["carol@a.test"]


def test_user_can_edit_only_own_display_name(world: World) -> None:
    world.as_("carol")
    assert world.db.run("update public.profiles set display_name = 'C' where user_id = %s",
                        (world.users["carol"],)) == 1  # fmt: skip
    assert world.db.run("update public.profiles set display_name = 'X' where user_id = %s",
                        (world.users["dave"],)) == 0  # fmt: skip
    fails(
        world.db, psycopg.errors.InsufficientPrivilege,
        "update public.profiles set email = 'x@y.test' where user_id = %s", (world.users["carol"],),
    )  # fmt: skip


def test_profile_created_and_synced_from_auth_users(world: World) -> None:
    db = world.db
    uid = db.one("insert into auth.users (email) values ('MiXed@Case.TEST') returning id")
    assert (
        db.one("select email from public.profiles where user_id = %s", (uid,)) == "mixed@case.test"
    )
    db.run("update auth.users set email = 'New@Case.test' where id = %s", (uid,))
    assert db.one("select email from public.profiles where user_id = %s", (uid,)) == "new@case.test"
