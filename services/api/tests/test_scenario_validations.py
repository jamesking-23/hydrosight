"""HS-SCN-005: saved scenario comparisons (migration 0015): permissions, tenant isolation,
immutability and promotion rules."""

import json
import uuid
from typing import Any

import psycopg
from conftest import World
from helpers import fails

NoPerm = psycopg.errors.InsufficientPrivilege
BadInput = psycopg.errors.InvalidParameterValue
Check = psycopg.errors.CheckViolation
Locked = psycopg.errors.ObjectNotInPrerequisiteState

REC = (
    "select public.record_scenario_validation(%s, 'Event A', '2024-05-02', 'https://e.example/report',"
    " 'Kabale tile', 'Copernicus GLO-30', 'Copernicus DEM licence', %s, %s::jsonb, 0.1, %s::jsonb, %s::jsonb,"
    " %s::public.data_origin)"
)
INPUTS = json.dumps({"rainMmPerHour": 60, "durationHours": 3})
POINTS = json.dumps([{"x": 1, "y": 2, "label": "p", "wet": True}])
CMP = json.dumps({"counts": {"points": 1, "agree": 1}})
PROMOTE = "select public.promote_scenario_validation(%s, %s::public.service_status, %s)"


def _rec(
    w: World, who: str, *, org: Any = None, demo: bool = False, origin: str = "real_unconfirmed"
) -> uuid.UUID:
    w.as_(who)
    return w.db.one(REC, (org or w.org_a, demo, INPUTS, POINTS, CMP, origin))  # type: ignore[no-any-return]


def test_hs_scn_005_record_needs_models_manage(geo_world: World) -> None:
    w = geo_world
    assert _rec(w, "carol")  # hydrologist has models.manage
    w.as_("dave")  # community member has none
    fails(w.db, NoPerm, REC, (w.org_a, False, INPUTS, POINTS, CMP, "real_unconfirmed"))
    w.as_("bob")  # another organisation's admin
    fails(w.db, NoPerm, REC, (w.org_a, False, INPUTS, POINTS, CMP, "real_unconfirmed"))


def test_hs_scn_005_demo_terrain_and_empty_input_refused(geo_world: World) -> None:
    w = geo_world
    w.as_("carol")
    fails(w.db, Check, REC, (w.org_a, True, INPUTS, POINTS, CMP, "real_unconfirmed"))
    fails(w.db, Check, REC, (w.org_a, False, "{}", POINTS, CMP, "real_unconfirmed"))
    fails(w.db, Check, REC, (w.org_a, False, INPUTS, "[]", CMP, "real_unconfirmed"))


def test_hs_scn_005_only_promote_holder_confirms_event(geo_world: World) -> None:
    w = geo_world
    w.as_("carol")
    fails(w.db, NoPerm, REC, (w.org_a, False, INPUTS, POINTS, CMP, "real_confirmed"))
    assert _rec(w, "alice", origin="real_confirmed")  # org_admin holds manage and promote
    w.as_("eve")  # government_authority can review but not record
    fails(w.db, NoPerm, REC, (w.org_a, False, INPUTS, POINTS, CMP, "real_unconfirmed"))


def test_hs_scn_005_tenant_isolation(geo_world: World) -> None:
    w = geo_world
    rid = _rec(w, "carol")
    w.as_("carol")
    assert w.db.q("select id from public.scenario_validations") == [(rid,)]
    w.as_("bob")
    assert w.db.q("select id from public.scenario_validations") == []
    fails(w.db, NoPerm, PROMOTE, (rid, "validated", "https://e.example/review"))


def test_hs_scn_005_promotion_rules(geo_world: World) -> None:
    w = geo_world
    unconfirmed = _rec(w, "carol")
    confirmed = _rec(w, "alice", origin="real_confirmed")
    w.as_("eve")
    fails(
        w.db, Locked, PROMOTE, (unconfirmed, "validated", "https://e.example/review")
    )  # event not confirmed
    fails(w.db, BadInput, PROMOTE, (confirmed, "validated", ""))  # evidence link required
    fails(w.db, BadInput, PROMOTE, (confirmed, "operational", "https://e.example/review"))
    w.as_("alice")
    fails(
        w.db, NoPerm, PROMOTE, (confirmed, "validated", "https://e.example/review")
    )  # recorder cannot promote
    w.as_("carol")
    fails(
        w.db, NoPerm, PROMOTE, (confirmed, "validated", "https://e.example/review")
    )  # hydrologist has no promote
    w.as_("eve")
    w.db.run(PROMOTE, (confirmed, "validated", "https://e.example/review"))
    assert (
        w.db.one("select status::text from public.scenario_validations where id = %s", (confirmed,))
        == "validated"
    )
    w.as_("carol")
    fails(w.db, NoPerm, PROMOTE, (confirmed, "unvalidated", None))  # hydrologist cannot demote


def test_hs_scn_005_immutable_and_no_direct_status_change(geo_world: World) -> None:
    w = geo_world
    rid = _rec(w, "alice", origin="real_confirmed")
    w.db.su()
    fails(
        w.db,
        Locked,
        "update public.scenario_validations set event_name = 'x' where id = %s",
        (rid,),
    )
    fails(
        w.db,
        NoPerm,
        "update public.scenario_validations set status = 'validated' where id = %s",
        (rid,),
    )
    fails(w.db, Locked, "delete from public.scenario_validations where id = %s", (rid,))
