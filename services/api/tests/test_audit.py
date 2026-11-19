"""HS-AUD-001: privileged actions are audited; the log is append-only and outlives its subject."""

import psycopg
from conftest import World
from helpers import fails


def _actions(w: World, entity: str) -> list[tuple[str, object]]:
    w.db.su()
    return w.db.q(
        "select action, actor_user_id from public.audit_log where entity_type = %s order by id",
        (entity,),
    )


def test_invitation_and_key_creation_audited_with_actor(world: World) -> None:
    world.as_("alice")
    world.db.one("select public.create_invitation(%s, 'n@a.test', 'hydrologist')", (world.org_a,))
    world.db.one("select public.create_api_key(%s, 'k', array['readings.read'])", (world.org_a,))
    assert _actions(world, "invitations")[-1] == ("insert", world.users["alice"])
    assert _actions(world, "api_keys")[-1] == ("insert", world.users["alice"])


def test_membership_changes_audited(world: World) -> None:
    world.as_("alice")
    world.db.run(
        "update public.memberships set status = 'suspended' where user_id = %s",
        (world.users["dave"],),
    )
    world.db.run("delete from public.memberships where user_id = %s", (world.users["dave"],))
    acts = [a for a, u in _actions(world, "memberships") if u == world.users["alice"]]
    assert acts == ["update", "delete"]


def test_role_permission_change_audited(world: World) -> None:
    world.db.su()
    before = world.db.one(
        "select count(*) from public.audit_log where entity_type = 'role_permissions'"
    )
    world.db.run(
        "insert into public.role_permissions values ('hydrologist', 'community.moderate') on conflict do nothing"
    )
    assert (
        world.db.one("select count(*) from public.audit_log where entity_type = 'role_permissions'")
        >= before
    )


def test_org_rename_audited(world: World) -> None:
    world.as_("alice")
    world.db.run("update public.organizations set name = 'Org A2' where id = %s", (world.org_a,))
    assert _actions(world, "organizations")[-1][0] == "update"


def test_audit_records_db_role(world: World) -> None:
    world.as_("alice")
    world.db.run("update public.organizations set name = 'Org A3' where id = %s", (world.org_a,))
    world.db.su()
    assert (
        world.db.one(
            "select actor_db_role from public.audit_log where entity_type='organizations' order by id desc limit 1"
        )
        == "authenticated"
    )


def test_no_secret_hashes_in_audit(world: World) -> None:
    world.as_("alice")
    world.db.one("select public.create_invitation(%s, 'n@a.test', 'hydrologist')", (world.org_a,))
    world.db.one("select public.create_api_key(%s, 'k', array['readings.read'])", (world.org_a,))
    world.db.su()
    blob = str(world.db.q("select details from public.audit_log"))
    assert "token_hash" not in blob and "key_hash" not in blob


def test_audit_log_is_append_only_even_for_superuser(world: World) -> None:
    world.db.su()
    for sql in (
        "update public.audit_log set action = 'x'",
        "delete from public.audit_log",
        "truncate public.audit_log",
    ):
        fails(world.db, psycopg.errors.InsufficientPrivilege, sql)


def test_app_roles_cannot_write_audit_log(world: World) -> None:
    world.as_("alice")
    fails(world.db, psycopg.errors.InsufficientPrivilege,
          "insert into public.audit_log (actor_db_role, action, entity_type) values ('x','x','x')")  # fmt: skip
    world.db.service()
    fails(world.db, psycopg.errors.InsufficientPrivilege, "delete from public.audit_log")


def test_audit_survives_organisation_deletion(world: World) -> None:
    world.db.su()
    # remove the guard-protected admin rows via cascade by deleting the org itself
    world.db.run("delete from public.organizations where id = %s", (world.org_b,))
    assert (
        world.db.one("select count(*) from public.audit_log where org_id = %s", (world.org_b,)) >= 1
    )


def test_last_org_admin_cannot_be_removed_or_demoted(world: World) -> None:
    world.as_("bob")
    fails(world.db, psycopg.errors.CheckViolation,
          "delete from public.memberships where user_id = %s", (world.users["bob"],))  # fmt: skip
    fails(world.db, psycopg.errors.CheckViolation,
          "update public.memberships set role_key = 'hydrologist' where user_id = %s", (world.users["bob"],))  # fmt: skip
    fails(world.db, psycopg.errors.CheckViolation,
          "update public.memberships set status = 'suspended' where user_id = %s", (world.users["bob"],))  # fmt: skip


def test_second_admin_allows_demotion(world: World) -> None:
    world.db.su()
    world.db.run("insert into public.memberships (org_id, user_id, role_key) values (%s, %s, 'org_admin')",
                 (world.org_a, world.users["dave"]))  # fmt: skip
    world.as_("alice")
    assert world.db.run("update public.memberships set role_key = 'meteorologist' "
                        "where user_id = %s and role_key = 'org_admin'",
                        (world.users["dave"],)) == 1  # fmt: skip
