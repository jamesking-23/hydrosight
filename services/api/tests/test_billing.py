"""HS-BIL-001..010: demo intake, plans, entitlements, limits, invoices.
Needs the PostGIS migration chain (CI); skipped locally."""

import json
import re
from typing import Any

import psycopg
from conftest import World
from helpers import fails

NoPerm = psycopg.errors.InsufficientPrivilege
Check = psycopg.errors.CheckViolation
BadInput = psycopg.errors.InvalidParameterValue
Limit = psycopg.errors.ConfigurationLimitExceeded
TooMany = psycopg.errors.ProgramLimitExceeded

DEMO = "select public.submit_demo_request(%s, %s, %s, null, 'Uganda', 'Early warning', 'Hello', %s, 'v1')"
SAVE = "select public.save_plan(%s, %s, '', %s, 10, %s::jsonb, %s)"
POINT = "extensions.st_setsrid(extensions.st_makepoint(%s, %s), 4326)"


def _platform(w: World) -> Any:
    """A platform administrator (no organisation membership)."""
    w.db.su()
    uid = w.db.one("insert into auth.users (email) values ('grace@platform.test') returning id")
    w.db.run(
        "insert into public.platform_memberships (user_id, role_key) values (%s, 'platform_admin')",
        (uid,),
    )
    w.users["grace"] = uid
    w.email = lambda n: "grace@platform.test" if n == "grace" else f"{n}@a.test"  # type: ignore[method-assign]
    return uid


def _plan(w: World, key: str, limits: dict[str, Any], features: list[str], published: bool = True):  # type: ignore[no-untyped-def]
    w.as_("grace")
    w.db.run(SAVE, (key, key.title(), published, json.dumps(limits), features))


def _station(w: World, code: str) -> None:
    w.db.su()
    w.db.run(
        f"insert into public.stations (org_id, code, name, geom, source_type) values (%s, %s, %s, {POINT}, 'measured')",
        (w.org_a, code, code, 32.5, 0.3),
    )


# --- public demo intake ----------------------------------------------------------------------
def test_anyone_can_request_a_demo_and_only_the_platform_reads_it(geo_world: World) -> None:
    w = geo_world
    _platform(w)
    w.db.anon()
    rid = w.db.one(DEMO, ("Jane Doe", "jane@example.org", "Kasese District", True))
    assert rid
    fails(w.db, NoPerm, "select * from public.demo_requests")
    w.as_("alice")
    assert w.db.one("select count(*) from public.demo_requests") == 0  # an org admin sees nothing
    w.as_("grace")
    assert w.db.one("select count(*) from public.demo_requests") == 1
    w.db.run("select public.update_demo_request(%s, 'contacted', 'Called')", (rid,))
    assert w.db.one("select status from public.demo_requests where id = %s", (rid,)) == "contacted"
    w.as_("alice")
    fails(w.db, NoPerm, "select public.update_demo_request(%s, 'closed', null)", (rid,))


def test_demo_intake_validation_dedupe_and_cap(geo_world: World) -> None:
    w = geo_world
    w.db.anon()
    fails(w.db, BadInput, DEMO, ("Jane Doe", "jane@example.org", "Org", False))  # no consent
    fails(w.db, Check, DEMO, ("Jane Doe", "not-an-email", "Org", True))
    a = w.db.one(DEMO, ("Jane Doe", "jane@example.org", "Org", True))
    b = w.db.one(DEMO, ("Jane Doe", "JANE@example.org", "Org", True))
    assert a == b  # same address within a day: one request
    w.db.su()
    for i in range(29):
        w.db.run(
            "insert into public.demo_requests (name, email, organisation, consent_version) "
            "values ('Flood Bot', %s, 'Org', 'v1')",
            (f"bot{i}@example.org",),
        )
    w.db.anon()
    fails(w.db, TooMany, DEMO, ("Late Comer", "late@example.org", "Org", True))


# --- plans -----------------------------------------------------------------------------------
def test_plans_are_public_only_when_published_and_only_the_platform_edits(geo_world: World) -> None:
    w = geo_world
    _platform(w)
    _plan(w, "pilot", {"locations": 2}, ["map"], published=False)
    _plan(w, "standard", {"locations": 5, "sensors": None}, ["map", "analytics"], published=True)
    w.db.anon()
    assert w.db.one("select array_agg(key) from public.plans") == ["standard"]
    assert w.db.one("select count(*) from public.plan_limits") == 2
    assert w.db.one("select count(*) from public.plan_features") == 2
    w.as_("alice")
    fails(w.db, NoPerm, SAVE, ("x", "X", True, "{}", []))
    w.as_("grace")
    assert w.db.one("select count(*) from public.plans") == 2  # the platform sees drafts


def test_a_price_needs_amount_currency_interval_and_basis(geo_world: World) -> None:
    w = geo_world
    _platform(w)
    w.as_("grace")
    fails(
        w.db,
        Check,
        "select public.save_plan('p1', 'P1', '', true, 1, '{}'::jsonb, '{}', 100, 'UGX', 'month', null)",
    )
    w.db.run(
        "select public.save_plan('p2', 'P2', '', true, 1, '{}'::jsonb, '{}', 100, 'ugx', 'month', 'owner quote 2026')"
    )
    assert w.db.one("select price_currency from public.plans where key = 'p2'") == "UGX"


# --- entitlements ----------------------------------------------------------------------------
def test_unassigned_org_is_not_gated_and_says_so(geo_world: World) -> None:
    w = geo_world
    for i in range(3):
        _station(w, f"S-{i}")
    w.as_("alice")
    e = w.db.one("select public.entitlements(%s)", (w.org_a,))
    assert e["managed"] is False and e["usage"]["locations"] == 3


def test_limits_block_new_records_but_not_existing_ones(geo_world: World) -> None:
    w = geo_world
    _platform(w)
    _station(w, "S-0")
    _station(w, "S-1")
    _plan(w, "small", {"locations": 2, "sensors": 1, "users": 6}, ["map"])
    w.db.run("select public.assign_plan(%s, 'small', 'active', null, 'pilot')", (w.org_a,))
    w.db.su()
    fails(
        w.db,
        Limit,
        f"insert into public.stations (org_id, code, name, geom, source_type) values (%s, 'S-2', 'S-2', {POINT}, 'measured')",
        (w.org_a, 32.5, 0.3),
    )
    sid = w.db.one("select id from public.stations where code = 'S-0'")
    ins = (
        "insert into public.sensors (org_id, station_id, kind, unit, expected_interval_s, source_type) "
        "values (%s, %s, 'water_level', 'm', 300, 'measured')"
    )
    w.db.run(ins, (w.org_a, sid))
    fails(w.db, Limit, ins, (w.org_a, sid))
    assert w.db.one("select count(*) from public.stations where org_id = %s", (w.org_a,)) == 2


def test_user_limit_counts_people_once_and_blocks_a_new_person(geo_world: World) -> None:
    w = geo_world
    _platform(w)
    _plan(w, "tiny", {"users": 5}, ["map"])  # alice, carol, dave, eve, frank are already 5
    w.db.run("select public.assign_plan(%s, 'tiny', 'active', null, null)", (w.org_a,))
    w.db.su()
    extra_role = "insert into public.memberships (org_id, user_id, role_key) values (%s, %s, 'meteorologist')"
    w.db.run(
        extra_role, (w.org_a, w.users["carol"])
    )  # an existing person with a second role: allowed
    newbie = w.db.one("insert into auth.users (email) values ('new@a.test') returning id")
    fails(w.db, Limit, extra_role, (w.org_a, newbie))


def test_missing_limit_means_zero_and_null_means_unlimited(geo_world: World) -> None:
    w = geo_world
    _platform(w)
    _plan(w, "zero", {}, ["map"])
    _plan(w, "open", {"locations": None}, ["map"])
    ins = f"insert into public.stations (org_id, code, name, geom, source_type) values (%s, 'ZZ', 'ZZ', {POINT}, 'measured')"
    w.as_("grace")
    w.db.run("select public.assign_plan(%s, 'zero', 'active', null, null)", (w.org_a,))
    w.db.su()
    fails(w.db, Limit, ins, (w.org_a, 32.5, 0.3))
    w.as_("grace")
    w.db.run("select public.assign_plan(%s, 'open', 'active', null, null)", (w.org_a,))
    w.db.su()
    w.db.run(ins, (w.org_a, 32.5, 0.3))
    w.as_("alice")
    e = w.db.one("select public.entitlements(%s)", (w.org_a,))
    assert e["limits"]["locations"]["unlimited"] is True


def test_inactive_plan_blocks_creation_and_features(geo_world: World) -> None:
    w = geo_world
    _platform(w)
    _plan(w, "full", {"locations": 10}, ["map", "assistant"])
    for status, ends in (("suspended", None), ("ended", None), ("active", "2020-01-01")):
        w.as_("grace")
        if ends:
            w.db.su()
            w.db.run(
                "insert into public.org_plans (org_id, plan_key, status, starts_at, ends_at) "
                "values (%s, 'full', 'active', '2019-01-01', %s) on conflict (org_id) do update "
                "set status = 'active', starts_at = '2019-01-01', ends_at = %s",
                (w.org_a, ends, ends),
            )
        else:
            w.db.run("select public.assign_plan(%s, 'full', %s, null, null)", (w.org_a, status))
        w.db.su()
        fails(
            w.db,
            Limit,
            f"insert into public.stations (org_id, code, name, geom, source_type) values (%s, 'N', 'N', {POINT}, 'measured')",
            (w.org_a, 32.5, 0.3),
        )
        w.as_("alice")
        assert w.db.one("select public.entitlements(%s)", (w.org_a,))["in_force"] is False
        r = w.db.one("select public.assistant_begin(%s)", (w.org_a,))
        assert r == {"allowed": False, "reason": "not_in_plan"}


def test_feature_gate_on_assets_and_assistant(geo_world: World) -> None:
    w = geo_world
    _platform(w)
    _plan(w, "basic", {"locations": 10}, ["map"])
    w.as_("grace")
    w.db.run("select public.assign_plan(%s, 'basic', 'active', null, null)", (w.org_a,))
    w.as_("alice")
    fails(
        w.db,
        Limit,
        "select public.add_asset(%s, 'Clinic', 'building', %s)",
        (w.org_a, '{"type":"Point","coordinates":[32.5,0.3]}'),
    )
    assert w.db.one("select public.assistant_begin(%s)", (w.org_a,))["reason"] == "not_in_plan"
    _plan(w, "plus", {"locations": 10}, ["map", "assets", "assistant"])
    w.db.run("select public.assign_plan(%s, 'plus', 'trial', null, null)", (w.org_a,))
    w.as_("alice")
    assert w.db.one(
        "select public.add_asset(%s, 'Clinic', 'building', %s)",
        (w.org_a, '{"type":"Point","coordinates":[32.5,0.3]}'),
    )
    assert w.db.one("select public.assistant_begin(%s)", (w.org_a,))["reason"] == "not_enabled"


def test_entitlements_are_visible_to_members_only_and_plans_to_billing_roles(
    geo_world: World,
) -> None:
    w = geo_world
    _platform(w)
    _plan(w, "basic", {"locations": 1}, ["map"])
    w.as_("grace")
    w.db.run("select public.assign_plan(%s, 'basic', 'active', null, null)", (w.org_a,))
    w.as_("bob")
    fails(w.db, NoPerm, "select public.entitlements(%s)", (w.org_a,))
    assert w.db.one("select count(*) from public.org_plans") == 0
    w.as_("carol")  # a member, but not a billing role
    assert w.db.one("select public.entitlements(%s)", (w.org_a,))["plan_key"] == "basic"
    assert w.db.one("select count(*) from public.org_plans") == 0
    w.as_("alice")
    assert w.db.one("select count(*) from public.org_plans") == 1
    fails(w.db, NoPerm, "select public.assign_plan(%s, 'basic', 'active', null, null)", (w.org_a,))


# --- invoices --------------------------------------------------------------------------------
LINES = json.dumps([{"description": "Platform, Jan 2026", "quantity": 1, "amount": 1000}])
DRAFT = "select public.create_invoice_draft(%s, '2026-01-01', '2026-01-31', 'ugx', %s::jsonb, 180, 'VAT', '2026-02-15', null)"


def test_invoice_lifecycle_numbering_and_immutability(geo_world: World) -> None:
    w = geo_world
    _platform(w)
    w.as_("grace")
    iid = w.db.one(DRAFT, (w.org_a, LINES))
    row = w.db.one(
        "select (total, status, currency)::text from public.invoices where id = %s", (iid,)
    )
    assert "1180" in row and "draft" in row and "UGX" in row
    w.as_("alice")
    assert (
        w.db.one("select count(*) from public.invoices") == 0
    )  # drafts are not visible to the customer
    w.as_("grace")
    num = w.db.one("select public.issue_invoice(%s)", (iid,))
    assert re.fullmatch(r"HS-\d{4}-\d{6}", num)
    fails(
        w.db,
        NoPerm,
        "update public.invoices set total = 1, subtotal = 1, tax_amount = 0 where id = %s",
        (iid,),
    )
    fails(w.db, NoPerm, "delete from public.invoices where id = %s", (iid,))
    w.as_("alice")
    assert w.db.one("select count(*) from public.invoices") == 1
    w.as_("bob")
    assert w.db.one("select count(*) from public.invoices") == 0
    w.as_("grace")
    fails(w.db, Check, "select public.mark_invoice_paid(%s, 'mobile money', 'x')", (iid,))
    w.db.run("select public.mark_invoice_paid(%s, 'mobile money', 'TXN-12345')", (iid,))
    fails(w.db, BadInput, "select public.void_invoice(%s, 'oops mistake')", (iid,))


def test_invoice_input_rules_and_roles(geo_world: World) -> None:
    w = geo_world
    _platform(w)
    w.as_("alice")
    fails(w.db, NoPerm, DRAFT, (w.org_a, LINES))
    w.as_("grace")
    fails(w.db, BadInput, DRAFT, (w.org_a, "[]"))
    fails(w.db, BadInput, DRAFT, (w.org_a, json.dumps([{"description": "x", "amount": -1}])))
    iid = w.db.one(DRAFT, (w.org_a, LINES))
    w.db.run("select public.void_invoice(%s, 'wrong customer')", (iid,))
    fails(w.db, BadInput, "select public.issue_invoice(%s)", (iid,))


def test_platform_org_list_is_platform_only(geo_world: World) -> None:
    w = geo_world
    _platform(w)
    w.as_("grace")
    assert w.db.one("select count(*) from public.platform_orgs()") >= 1
    w.as_("alice")  # an ordinary organisation member
    fails(w.db, NoPerm, "select * from public.platform_orgs()")
