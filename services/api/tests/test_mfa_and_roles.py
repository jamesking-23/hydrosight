"""HS-IAM-001 (MFA for privileged roles) and HS-IAM-002 (roles/permissions as data)."""

import psycopg
import pytest
from conftest import World
from helpers import fails

ALL_ROLES = {
    "super_admin", "platform_admin", "org_admin", "government_authority", "hydrologist",
    "meteorologist", "emergency_response_officer", "field_technician", "sensor_operator",
    "enterprise_customer", "community_leader", "community_member", "public_visitor",
}  # fmt: skip


def test_all_required_roles_exist_as_data(world: World) -> None:
    assert {r[0] for r in world.db.q("select key from public.roles")} == ALL_ROLES


def test_every_role_with_privileged_permission_requires_mfa(world: World) -> None:
    assert (
        world.db.q("""
        select distinct r.key from public.role_permissions rp
        join public.permissions p on p.key = rp.permission_key
        join public.roles r on r.key = rp.role_key
        where p.privileged and not r.requires_mfa
    """)
        == []
    )


def test_cannot_grant_privileged_permission_to_non_mfa_role(world: World) -> None:
    fails(
        world.db, psycopg.errors.CheckViolation,
        "insert into public.role_permissions values ('hydrologist', 'warnings.approve')",
    )  # fmt: skip


def test_cannot_switch_off_mfa_for_a_privileged_role(world: World) -> None:
    fails(
        world.db, psycopg.errors.CheckViolation,
        "update public.roles set requires_mfa = false where key = 'org_admin'",
    )  # fmt: skip


def test_platform_and_public_roles_cannot_be_org_roles(world: World) -> None:
    for role in ("super_admin", "platform_admin", "public_visitor"):
        fails(
            world.db, psycopg.errors.ForeignKeyViolation,
            "insert into public.memberships (org_id, user_id, role_key) values (%s, %s, %s)",
            (world.org_a, world.users["bob"], role),
        )  # fmt: skip


@pytest.mark.parametrize("name", ["alice", "eve", "frank"])
def test_privileged_roles_get_nothing_without_mfa(world: World, name: str) -> None:
    world.as_(name, aal="aal1")
    assert world.db.q("select id from public.organizations") == []
    # Only the user's own membership is visible (so the UI can demand MFA); nobody else's.
    assert world.db.q("select user_id from public.memberships") == [(world.users[name],)]
    for table in ("invitations", "api_keys", "audit_log"):
        assert world.db.one(f"select count(*) from public.{table}") == 0, table  # noqa: S608


def test_privileged_role_with_mfa_gets_access(world: World) -> None:
    world.as_("alice", aal="aal2")
    assert [r[0] for r in world.db.q("select id from public.organizations")] == [world.org_a]


def test_privileged_user_without_mfa_can_still_see_own_membership(world: World) -> None:
    """So the UI knows it must demand MFA enrolment/verification."""
    world.as_("alice", aal="aal1")
    rows = world.db.q("select role_key from public.memberships where user_id = %s",
                      (world.users["alice"],))  # fmt: skip
    assert rows == [("org_admin",)]


def test_privileged_actions_denied_without_mfa(world: World) -> None:
    world.as_("alice", aal="aal1")
    fails(
        world.db, psycopg.errors.InsufficientPrivilege,
        "select public.create_invitation(%s, 'n@x.test', 'hydrologist')", (world.org_a,),
    )  # fmt: skip


def test_non_privileged_role_works_without_mfa(world: World) -> None:
    world.as_("carol", aal="aal1")  # hydrologist
    assert [r[0] for r in world.db.q("select id from public.organizations")] == [world.org_a]


def test_hydrologist_cannot_see_admin_data(world: World) -> None:
    world.as_("alice")
    world.db.one("select public.create_invitation(%s, 'n@x.test', 'hydrologist')", (world.org_a,))
    world.as_("carol")
    for table in ("invitations", "api_keys", "audit_log"):
        assert world.db.one(f"select count(*) from public.{table}") == 0, table  # noqa: S608
    fails(
        world.db, psycopg.errors.InsufficientPrivilege,
        "select public.create_invitation(%s, 'n@x.test', 'hydrologist')", (world.org_a,),
    )  # fmt: skip
    fails(
        world.db, psycopg.errors.InsufficientPrivilege,
        "select public.create_api_key(%s, 'k', array['readings.read'])", (world.org_a,),
    )  # fmt: skip


def test_community_member_sees_only_self_and_org(world: World) -> None:
    world.as_("dave")
    assert world.db.one("select count(*) from public.organizations") == 1
    assert world.db.q("select user_id from public.memberships") == [(world.users["dave"],)]


def test_government_authority_reads_audit_but_cannot_invite(world: World) -> None:
    world.as_("alice")
    world.db.one("select public.create_invitation(%s, 'n@x.test', 'hydrologist')", (world.org_a,))
    world.as_("eve")
    assert world.db.one("select count(*) from public.audit_log where org_id = %s",
                        (world.org_a,)) >= 1  # fmt: skip
    fails(
        world.db, psycopg.errors.InsufficientPrivilege,
        "select public.create_invitation(%s, 'n@x.test', 'hydrologist')", (world.org_a,),
    )  # fmt: skip


def test_field_technician_has_device_rights_but_no_audit_access(world: World) -> None:
    world.as_("frank")
    assert world.db.one("select private.has_permission(%s, 'devices.manage')", (world.org_a,))
    assert world.db.one("select count(*) from public.audit_log") == 0


def test_app_roles_cannot_change_reference_data(world: World) -> None:
    world.as_("alice")
    for sql in (
        "insert into public.roles (key, label, scope) values ('x', 'x', 'org')",
        "insert into public.role_permissions values ('community_member', 'org.manage')",
        "update public.permissions set privileged = false",
        "delete from public.role_permissions",
    ):
        fails(world.db, psycopg.errors.InsufficientPrivilege, sql)


def test_secret_hash_columns_are_never_selectable(world: World) -> None:
    world.as_("alice")
    fails(
        world.db, psycopg.errors.InsufficientPrivilege, "select token_hash from public.invitations"
    )
    fails(world.db, psycopg.errors.InsufficientPrivilege, "select key_hash from public.api_keys")
    fails(world.db, psycopg.errors.InsufficientPrivilege, "select * from public.api_keys")
