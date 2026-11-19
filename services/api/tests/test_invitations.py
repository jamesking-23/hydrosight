"""HS-IAM-003: invitations are hashed, single-use, expiring, email-bound; membership only via accept."""

import psycopg
import pytest
from conftest import World
from helpers import fails

Q_INV = "select public.create_invitation(%s, %s, %s)"


def _new_user(w: World, email: str) -> object:
    w.db.su()
    return w.db.one("insert into auth.users (email) values (%s) returning id", (email,))


def _invite(w: World, email: str = "newbie@a.test", role: str = "hydrologist") -> str:
    w.as_("alice")
    return str(w.db.one(Q_INV, (w.org_a, email, role)))


def test_token_is_never_stored_in_clear(world: World) -> None:
    token = _invite(world)
    assert token.startswith("hsi_")
    world.db.su()
    stored = world.db.one("select token_hash from public.invitations where email = 'newbie@a.test'")
    assert stored != token
    assert token not in str(world.db.q("select * from public.invitations"))
    assert token not in str(world.db.q("select details from public.audit_log"))
    assert world.db.one("select private.hash_secret(%s)", (token,)) == stored


def test_accept_creates_membership_once(world: World) -> None:
    token = _invite(world)
    uid = _new_user(world, "newbie@a.test")
    world.db.act(uid, "newbie@a.test", "aal1")  # type: ignore[arg-type]
    member_id = world.db.one("select public.accept_invitation(%s)", (token,))
    assert member_id is not None
    assert (
        world.db.one("select role_key from public.memberships where id = %s", (member_id,))
        == "hydrologist"
    )
    fails(
        world.db,
        psycopg.errors.InvalidParameterValue,
        "select public.accept_invitation(%s)",
        (token,),
    )


def test_wrong_email_cannot_accept(world: World) -> None:
    token = _invite(world)
    world.as_("dave")
    fails(
        world.db,
        psycopg.errors.InvalidParameterValue,
        "select public.accept_invitation(%s)",
        (token,),
    )
    world.db.su()
    assert world.db.one(
        "select accepted_at is null from public.invitations where email='newbie@a.test'"
    )


def test_garbage_and_missing_tokens_give_same_generic_error(world: World) -> None:
    world.as_("dave")
    for bad in ("hsi_nope", "", "x"):
        with (
            pytest.raises(psycopg.errors.InvalidParameterValue, match="invalid invitation"),
            world.db.conn.transaction(),
        ):
            world.db.conn.execute("select public.accept_invitation(%s)", (bad,))


def test_anonymous_cannot_accept(world: World) -> None:
    token = _invite(world)
    world.db.anon()
    fails(
        world.db,
        psycopg.errors.InsufficientPrivilege,
        "select public.accept_invitation(%s)",
        (token,),
    )


def test_expired_invitation_rejected(world: World) -> None:
    token = _invite(world)
    uid = _new_user(world, "newbie@a.test")
    world.db.su()
    world.db.run("update public.invitations set created_at = now() - interval '9 days', "
                 "expires_at = now() - interval '1 day'")  # fmt: skip
    world.db.act(uid, "newbie@a.test")  # type: ignore[arg-type]
    fails(
        world.db,
        psycopg.errors.InvalidParameterValue,
        "select public.accept_invitation(%s)",
        (token,),
    )


def test_revoked_invitation_rejected(world: World) -> None:
    token = _invite(world)
    inv_id = world.db.one("select id from public.invitations where email = 'newbie@a.test'")
    world.db.one("select public.revoke_invitation(%s) is null", (inv_id,))
    uid = _new_user(world, "newbie@a.test")
    world.db.act(uid, "newbie@a.test")  # type: ignore[arg-type]
    fails(
        world.db,
        psycopg.errors.InvalidParameterValue,
        "select public.accept_invitation(%s)",
        (token,),
    )


def test_cannot_revoke_other_orgs_invitation(world: World) -> None:
    world.as_("bob")
    inv_b = world.db.one(Q_INV, (world.org_b, "x@b.test", "hydrologist"))
    assert inv_b
    world.db.su()
    inv_id_b = world.db.one("select id from public.invitations where org_id = %s", (world.org_b,))
    world.as_("alice")
    fails(
        world.db,
        psycopg.errors.InsufficientPrivilege,
        "select public.revoke_invitation(%s)",
        (inv_id_b,),
    )


@pytest.mark.parametrize(
    "role", ["super_admin", "platform_admin", "public_visitor", "no_such_role"]
)
def test_platform_or_unknown_roles_cannot_be_invited(world: World, role: str) -> None:
    world.as_("alice")
    fails(world.db, psycopg.errors.ForeignKeyViolation, Q_INV, (world.org_a, "x@a.test", role))


@pytest.mark.parametrize("ttl", ["0 days", "-1 day", "31 days"])
def test_invitation_lifetime_bounded(world: World, ttl: str) -> None:
    world.as_("alice")
    fails(world.db, psycopg.errors.InvalidParameterValue,
          "select public.create_invitation(%s, 'x@a.test', 'hydrologist', %s::interval)",
          (world.org_a, ttl))  # fmt: skip


def test_email_is_normalised(world: World) -> None:
    world.as_("alice")
    world.db.one(Q_INV, (world.org_a, "  Mixed@A.Test ", "hydrologist"))
    assert (
        world.db.one("select email from public.invitations where org_id = %s", (world.org_a,))
        == "mixed@a.test"
    )


def test_admin_bootstrap_creates_org_and_admin_invite(world: World) -> None:
    world.db.service()
    token = world.db.one(
        "select public.admin_create_organization('Org C', 'org-c', 'Chief@C.test')"
    )
    world.db.su()
    uid = _new_user(world, "chief@c.test")
    world.db.act(uid, "chief@c.test", "aal2")  # type: ignore[arg-type]
    world.db.one("select public.accept_invitation(%s)", (token,))
    assert world.db.one("select count(*) from public.organizations") == 1
    assert world.db.one("select role_key from public.memberships") == "org_admin"
