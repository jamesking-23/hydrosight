"""HS-ALT-001..008: threshold rules, alert lifecycle and governance, engine, notifications.
Needs PostGIS (CI); skipped locally with an explicit reason."""

import json
from datetime import UTC, datetime, timedelta
from typing import Any

import psycopg
import pytest
from conftest import World
from helpers import fails
from test_readings import _sensor

NoPerm = psycopg.errors.InsufficientPrivilege
BadInput = psycopg.errors.InvalidParameterValue
BadState = psycopg.errors.ObjectNotInPrerequisiteState
Check = psycopg.errors.CheckViolation


def _iso(delta: timedelta = timedelta()) -> str:
    return (datetime.now(UTC) + delta).isoformat()


def _add_user(w: World, name: str, role: str, org: Any = None) -> None:
    w.db.su()
    uid = w.db.one("insert into auth.users (email) values (%s) returning id", (f"{name}@a.test",))
    w.db.run(
        "insert into public.memberships (org_id, user_id, role_key) values (%s, %s, %s)",
        (org or w.org_a, uid, role),
    )
    w.users[name] = uid


def _reading(w: World, sensor: Any, value: float, age_s: int = 60) -> None:
    w.db.su()
    org = w.db.one("select org_id from public.sensors where id = %s", (sensor,))
    w.db.run(
        "insert into public.readings (org_id, sensor_id, observed_at, value, source_type)"
        " values (%s, %s, now() - make_interval(secs => %s), %s, 'measured')",
        (org, sensor, age_s, value),
    )


def _evaluate(w: World, sensors: list[Any] | None = None) -> dict[str, Any]:
    w.db.service()
    arr = [str(s) for s in sensors] if sensors is not None else None
    return w.db.one("select public.evaluate_thresholds_for(%s::uuid[])", (arr,))  # type: ignore[no-any-return]


def _rule(w: World, sensor: Any = None, *, scope: str = "sensor", kind: str | None = None,
          cmp: str = ">=", value: float = 5.0, level: str = "warning", hyst: float = 0.0,
          cooldown: int = 0, activate: bool = True) -> Any:  # fmt: skip
    w.as_("carol")
    scope_id = sensor if scope == "sensor" else None
    rid = w.db.one(
        "select public.draft_threshold_rule(%s, 'Test rule', %s::public.rule_scope, %s, %s, %s, %s,"
        " %s::public.alert_level, %s, %s, %s, %s)",
        (w.org_a, scope, scope_id, kind, cmp, value, level, hyst, cooldown,
         "Bankfull stage from the 2019 cross-section survey.", "survey-2019-xs-12"),
    )  # fmt: skip
    if activate:
        w.as_("eve")
        w.db.q("select public.activate_threshold_rule(%s)", (rid,))
    return rid


EVIDENCE = json.dumps([{"type": "observation", "note": "gauge reading at 14:00"}])


def _human_alert(w: World, who: str = "carol", station: Any = None, *, audience: str = "public",
                 origin: str = "human_emergency", level: str = "warning", complete: bool = True,
                 attribution: str | None = None) -> Any:  # fmt: skip
    w.as_(who)
    return w.db.one(
        "select public.create_alert_draft(%s, %s::public.alert_origin, %s::public.alert_level, 'Flood at Test Bridge',"
        " 'Test Bridge', %s, 'flood', %s, %s, %s, %s, 'medium', %s::jsonb, %s::public.alert_audience, %s, null, %s)",
        (w.org_a, origin, level, station,
         "Next 6 hours" if complete else None, "About 12 hours" if complete else None,
         "Move to higher ground" if complete else None, "District Disaster Office" if complete else None,
         EVIDENCE if complete else "[]", audience, _iso(timedelta(hours=6)), attribution),
    )  # fmt: skip


def _flow_to(
    w: World, alert: Any, stage: str, drafter: str = "carol", approver: str = "eve"
) -> None:
    """Advance: submitted -> approved -> published."""
    w.as_(drafter)
    w.db.q("select public.submit_alert(%s)", (alert,))
    if stage == "submitted":
        return
    w.as_(approver)
    w.db.q("select public.approve_alert(%s)", (alert,))
    if stage == "approved":
        return
    w.db.q("select public.publish_alert(%s)", (alert,))


def _status(w: World, alert: Any) -> str:
    w.db.su()
    return str(w.db.one("select status::text from public.alerts where id = %s", (alert,)))


# ----------------------------------------------------------------------------- threshold rules


def test_no_builtin_thresholds_and_engine_idle_without_rules(geo_world: World) -> None:
    w = geo_world
    _, s = _sensor(w, w.org_a)
    _reading(w, s, 9999.0)
    w.db.su()
    assert w.db.one("select count(*) from public.threshold_rules") == 0
    res = _evaluate(w)
    assert res["evaluated"] == 0 and res["created"] == 0


def test_rule_cannot_be_activated_without_documented_basis(geo_world: World) -> None:
    w = geo_world
    _, s = _sensor(w, w.org_a)
    w.as_("carol")
    base = (w.org_a, "R", "sensor", s, None, ">=", 5.0, "warning", 0, 0)
    for rationale, evidence in [
        (None, "ref-1"),
        ("too short", "ref-1"),
        ("A real written rationale here.", None),
        ("A real written rationale here.", "x"),
    ]:
        rid = w.db.one(
            "select public.draft_threshold_rule(%s,%s,%s::public.rule_scope,%s,%s,%s,%s,%s::public.alert_level,%s,%s,%s,%s)",
            (*base, rationale, evidence),
        )
        w.as_("eve")
        fails(w.db, BadInput, "select public.activate_threshold_rule(%s)", (rid,))
        w.as_("carol")
    # direct bypass attempt is stopped by the database constraint too
    w.db.su()
    fails(
        w.db,
        Check,
        "update public.threshold_rules set status = 'active', approved_by = %s, approved_at = now()",
        (w.users["eve"],),
    )


def test_rule_drafter_cannot_approve_own_rule_even_by_direct_write(geo_world: World) -> None:
    w = geo_world
    _, s = _sensor(w, w.org_a)
    rid = _rule(w, s, activate=False)
    w.db.su()
    fails(
        w.db,
        Check,
        "update public.threshold_rules set status='active', approved_by = drafted_by, approved_at = now() where id = %s",
        (rid,),
    )
    w.as_("carol")  # drafts but holds no approve permission
    fails(w.db, NoPerm, "select public.activate_threshold_rule(%s)", (rid,))
    w.as_("dave")
    fails(
        w.db,
        NoPerm,
        "select public.draft_threshold_rule(%s, 'x', 'organisation', null, 'water_level', '>=', 1, 'watch', 0, 0, 'long enough rationale text', 'ref')",
        (w.org_a,),
    )


def test_active_rule_is_immutable_and_retire_is_final(geo_world: World) -> None:
    w = geo_world
    _, s = _sensor(w, w.org_a)
    rid = _rule(w, s)
    w.db.su()
    fails(
        w.db,
        BadState,
        "update public.threshold_rules set threshold_value = 99 where id = %s",
        (rid,),
    )
    w.as_("eve")
    w.db.q("select public.retire_threshold_rule(%s)", (rid,))
    w.db.su()
    fails(
        w.db, BadState, "update public.threshold_rules set status = 'active' where id = %s", (rid,)
    )


def test_rule_scope_must_belong_to_org_and_other_tenants_cannot_see_rules(geo_world: World) -> None:
    w = geo_world
    _, sensor_b = _sensor(w, w.org_b)
    w.as_("carol")
    fails(
        w.db,
        BadInput,
        "select public.draft_threshold_rule(%s,'x','sensor',%s,null,'>=',1,'watch',0,0,'long enough rationale text','ref')",
        (w.org_a, sensor_b),
    )
    _, s = _sensor(w, w.org_a, code="ST-A2")
    _rule(w, s)
    w.as_("bob")
    assert w.db.one("select count(*) from public.threshold_rules") == 0


# ----------------------------------------------------------------------------- engine


def test_breach_creates_one_internal_draft_with_provenance_and_never_duplicates(
    geo_world: World,
) -> None:
    w = geo_world
    _, s = _sensor(w, w.org_a)
    rid = _rule(w, s, cooldown=3600)
    _reading(w, s, 6.2)
    first = _evaluate(w, [s])
    assert first["created"] == 1
    for _ in range(3):  # same breach, evaluated again and again
        again = _evaluate(w, [s])
        assert again["created"] == 0 and again["duplicate_suppressed"] == 1
    w.db.su()
    row = w.db.q(
        "select origin::text, audience::text, status::text, drafted_by, rule_id, evidence from public.alerts"
    )
    assert len(row) == 1
    origin, audience, status, drafted_by, rule_id, evidence = row[0]
    assert (origin, audience, status, drafted_by, rule_id) == (
        "sensor_threshold",
        "internal",
        "draft",
        None,
        rid,
    )
    ev = evidence[0]
    assert (
        ev["value"] == 6.2
        and ev["source_type"] == "measured"
        and ev["rule_evidence_ref"] == "survey-2019-xs-12"
    )
    assert "Bankfull" in ev["rule_rationale"]


def test_below_threshold_creates_nothing_and_lower_bound_rules_work(geo_world: World) -> None:
    w = geo_world
    _, s = _sensor(w, w.org_a)
    _rule(w, s, value=5.0)
    _reading(w, s, 4.99)
    assert _evaluate(w, [s])["created"] == 0
    _, s2 = _sensor(w, w.org_a, code="ST-LOW")
    _rule(w, s2, cmp="<=", value=0.3, level="watch")
    _reading(w, s2, 0.2)
    assert _evaluate(w, [s2])["created"] == 1


def test_hysteresis_prevents_flapping(geo_world: World) -> None:
    w = geo_world
    _, s = _sensor(w, w.org_a)
    _rule(w, s, value=5.0, hyst=1.0, cooldown=0)
    _reading(w, s, 6.0, age_s=600)
    assert _evaluate(w, [s])["created"] == 1
    alert = _first_open(w)
    w.as_("eve")
    w.db.q("select public.cancel_alert(%s, 'handled by operator')", (alert,))
    _reading(w, s, 4.5, age_s=500)  # inside the band: not re-armed
    assert _evaluate(w, [s])["rearmed"] == 0
    _reading(w, s, 5.5, age_s=400)  # breaches again, but the rule is still disarmed
    res = _evaluate(w, [s])
    assert res["created"] == 0 and res["duplicate_suppressed"] == 1
    _reading(w, s, 3.9, age_s=300)  # clearly below threshold - hysteresis: re-armed
    assert _evaluate(w, [s])["rearmed"] == 1
    _reading(w, s, 6.1, age_s=200)
    assert _evaluate(w, [s])["created"] == 1


def _first_open(w: World) -> Any:
    w.db.su()
    return w.db.one(
        "select id from public.alerts where status in ('draft','in_review','approved','published') order by created_at limit 1"
    )


def test_cooldown_suppresses_a_quick_repeat_then_allows_a_new_event(geo_world: World) -> None:
    w = geo_world
    _, s = _sensor(w, w.org_a)
    _rule(w, s, value=5.0, hyst=0.0, cooldown=3600)
    _reading(w, s, 6.0, age_s=600)
    assert _evaluate(w, [s])["created"] == 1
    alert = _first_open(w)
    w.as_("eve")
    w.db.q("select public.cancel_alert(%s, 'false trigger, checked on site')", (alert,))
    _reading(w, s, 1.0, age_s=500)
    _evaluate(w, [s])  # re-arms
    _reading(w, s, 6.5, age_s=100)
    assert _evaluate(w, [s])["cooldown_suppressed"] == 1
    w.db.su()
    w.db.run(
        "alter table public.alerts disable trigger alerts_guard"
    )  # test-only: age the closed alert
    w.db.run("update public.alerts set created_at = now() - interval '2 hours'")
    w.db.run("alter table public.alerts enable trigger alerts_guard")
    assert _evaluate(w, [s])["created"] == 1


def test_maintenance_window_suppresses_alerts(geo_world: World) -> None:
    w = geo_world
    station, s = _sensor(w, w.org_a)
    _rule(w, s)
    _reading(w, s, 9.0)
    w.as_("frank")  # field technician holds devices.manage
    w.db.run(
        "insert into public.maintenance_windows (org_id, station_id, starts_at, ends_at, reason)"
        " values (%s, %s, now() - interval '1 hour', now() + interval '1 hour', 'Sensor recalibration')",
        (w.org_a, station),
    )
    res = _evaluate(w, [s])
    assert res["maintenance_suppressed"] == 1 and res["created"] == 0


def test_stale_sensor_never_triggers_from_last_known_value(geo_world: World) -> None:
    w = geo_world
    _, s = _sensor(w, w.org_a, interval=900)
    _rule(w, s)
    _reading(w, s, 9.0, age_s=3600)  # last value is an hour old; sensor expected every 15 min
    res = _evaluate(w, [s])
    assert res["skipped_not_live"] == 1 and res["created"] == 0


def test_suspect_and_bad_quality_readings_are_ignored(geo_world: World) -> None:
    w = geo_world
    _, s = _sensor(w, w.org_a)
    _rule(w, s)
    w.db.su()
    w.db.run(
        "insert into public.readings (org_id, sensor_id, observed_at, value, source_type, quality)"
        " values (%s, %s, now() - interval '1 minute', 9.0, 'measured', 'suspect')",
        (w.org_a, s),
    )
    assert _evaluate(w, [s])["evaluated"] == 0


def test_organisation_scope_matches_by_kind_and_never_crosses_tenants(geo_world: World) -> None:
    w = geo_world
    _, a1 = _sensor(w, w.org_a, kind="water_level", code="A-1")
    _, a2 = _sensor(w, w.org_a, kind="rainfall", code="A-2")
    _, b1 = _sensor(w, w.org_b, kind="water_level", code="B-1")
    _rule(w, scope="organisation", kind="water_level", value=2.0)
    for sensor in (a1, a2, b1):
        _reading(w, sensor, 10.0)
    res = _evaluate(w)
    assert res["created"] == 1
    w.db.su()
    assert w.db.one("select sensor_id from public.alerts") == a1


# ----------------------------------------------------------------------------- lifecycle


def test_end_to_end_draft_approve_publish_cancel_with_history(geo_world: World) -> None:
    w = geo_world
    station, _ = _sensor(w, w.org_a)
    alert = _human_alert(w, station=station)
    _flow_to(w, alert, "published")
    assert _status(w, alert) == "published"
    w.as_("eve")
    w.db.q("select public.cancel_alert(%s, 'River receded, hazard has passed')", (alert,))
    assert _status(w, alert) == "cancelled"
    w.db.su()
    events = w.db.q(
        "select to_status::text, actor_id from public.alert_events where alert_id = %s order by id",
        (alert,),
    )
    assert [e[0] for e in events] == ["draft", "in_review", "approved", "published", "cancelled"]
    assert events[1][1] == w.users["carol"] and events[2][1] == w.users["eve"]
    assert w.db.one("select count(*) from public.audit_log where entity_type = 'alerts'") >= 5


def test_public_warning_cannot_be_approved_by_its_own_drafter(geo_world: World) -> None:
    w = geo_world
    _add_user(w, "gina", "government_authority")
    alert = _human_alert(w, who="eve")  # a government authority may draft too
    _flow_to(w, alert, "submitted", drafter="eve")
    w.as_("eve")
    fails(w.db, NoPerm, "select public.approve_alert(%s)", (alert,))
    # and the database refuses it even if the function is bypassed
    w.db.su()
    fails(
        w.db,
        Check,
        "update public.alerts set status = 'approved', approved_by = drafted_by, approved_at = now() where id = %s",
        (alert,),
    )
    w.as_("gina")
    w.db.q("select public.approve_alert(%s)", (alert,))
    w.db.q("select public.publish_alert(%s)", (alert,))
    assert _status(w, alert) == "published"


def test_publication_needs_the_permissions_and_the_right_state(geo_world: World) -> None:
    w = geo_world
    station, _ = _sensor(w, w.org_a)
    alert = _human_alert(w, station=station)
    w.as_("eve")
    fails(w.db, BadState, "select public.approve_alert(%s)", (alert,))  # still a draft
    fails(w.db, BadState, "select public.publish_alert(%s)", (alert,))
    w.as_("carol")
    w.db.q("select public.submit_alert(%s)", (alert,))
    fails(w.db, NoPerm, "select public.approve_alert(%s)", (alert,))  # hydrologist cannot approve
    w.as_("eve")
    fails(w.db, BadState, "select public.publish_alert(%s)", (alert,))  # approval comes first
    w.db.q("select public.approve_alert(%s)", (alert,))
    w.as_("carol")
    fails(w.db, NoPerm, "select public.publish_alert(%s)", (alert,))
    w.as_("alice")  # org admin: not a publisher either
    fails(w.db, NoPerm, "select public.publish_alert(%s)", (alert,))
    w.as_("dave")
    fails(w.db, NoPerm, "select public.publish_alert(%s)", (alert,))


def test_only_a_human_can_move_an_alert_forward_and_the_engine_has_no_such_rights(
    geo_world: World,
) -> None:
    w = geo_world
    _, s = _sensor(w, w.org_a)
    _rule(w, s)
    _reading(w, s, 9.0)
    _evaluate(w, [s])
    alert = _first_open(w)
    w.db.service()  # the backend role cannot approve or publish
    for fn in ("approve_alert", "publish_alert", "submit_alert"):
        fails(w.db, NoPerm, f"select public.{fn}(%s)", (alert,))
    w.as_("eve")
    fails(
        w.db, BadState, "select public.publish_alert(%s)", (alert,)
    )  # system drafts are not publishable
    # skipping states is blocked in the database itself
    w.db.su()
    fails(w.db, BadState, "update public.alerts set status = 'published' where id = %s", (alert,))


def test_humans_cannot_forge_system_origins_and_official_warnings_need_attribution(
    geo_world: World,
) -> None:
    w = geo_world
    w.as_("carol")
    for origin in ("sensor_threshold", "model_risk"):
        fails(
            w.db,
            BadInput,
            "select public.create_alert_draft(%s, %s::public.alert_origin, 'watch', 't', 'loc')",
            (w.org_a, origin),
        )
    fails(
        w.db,
        Check,
        "select public.create_alert_draft(%s, 'official_warning', 'warning', 't', 'loc')",
        (w.org_a,),
    )
    assert _human_alert(
        w,
        origin="official_warning",
        attribution="Ministry of Water and Environment, bulletin 12/2026",
    )


def test_submit_requires_all_required_alert_content(geo_world: World) -> None:
    w = geo_world
    alert = _human_alert(w, complete=False)
    w.as_("carol")
    with pytest.raises(
        BadInput,
        match="expected_timing.*duration.*recommended_action.*issuing_authority.*supporting_evidence",
    ):
        w.db.q("select public.submit_alert(%s)", (alert,))


def test_approved_content_is_immutable_and_updates_are_new_versions(geo_world: World) -> None:
    w = geo_world
    station, _ = _sensor(w, w.org_a)
    alert = _human_alert(w, station=station)
    _flow_to(w, alert, "approved")
    w.db.su()
    fails(
        w.db, BadState, "update public.alerts set title = 'Quietly changed' where id = %s", (alert,)
    )
    fails(
        w.db, BadState, "update public.alerts set level = 'severe_warning' where id = %s", (alert,)
    )
    w.as_("eve")
    w.db.q("select public.publish_alert(%s)", (alert,))
    w.as_("carol")
    new = w.db.one(
        "select public.new_alert_version(%s, %s::jsonb)",
        (alert, json.dumps({"level": "severe_warning"})),
    )
    fails(
        w.db, BadState, "select public.new_alert_version(%s)", (alert,)
    )  # one in progress at a time
    assert (
        _status(w, alert) == "published"
    )  # the old version stays in force until the new one is approved
    _flow_to(w, new, "published")
    assert _status(w, alert) == "updated" and _status(w, new) == "published"
    w.db.su()
    assert w.db.one("select version from public.alerts where id = %s", (new,)) == 2


def test_closed_alerts_cannot_change(geo_world: World) -> None:
    w = geo_world
    alert = _human_alert(w)
    w.as_("carol")
    w.db.q("select public.cancel_alert(%s, 'raised by mistake')", (alert,))
    fails(w.db, BadState, 'select public.edit_alert_draft(%s, \'{"title": "x"}\'::jsonb)', (alert,))
    fails(w.db, BadInput, "select public.cancel_alert(%s, '')", (alert,))
    w.db.su()
    fails(w.db, BadState, "update public.alerts set status = 'draft' where id = %s", (alert,))


def test_drafts_are_editable_only_by_their_drafter_and_only_listed_fields(geo_world: World) -> None:
    w = geo_world
    alert = _human_alert(w)
    w.as_("carol")
    w.db.q('select public.edit_alert_draft(%s, \'{"title": "Updated title"}\'::jsonb)', (alert,))
    fails(
        w.db,
        BadInput,
        'select public.edit_alert_draft(%s, \'{"status": "approved"}\'::jsonb)',
        (alert,),
    )
    _add_user(w, "hana", "hydrologist")
    w.as_("hana")
    fails(
        w.db, NoPerm, 'select public.edit_alert_draft(%s, \'{"title": "hijack"}\'::jsonb)', (alert,)
    )


def test_system_draft_is_adopted_by_the_human_who_edits_it_then_needs_a_different_approver(
    geo_world: World,
) -> None:
    w = geo_world
    _, s = _sensor(w, w.org_a)
    _rule(w, s)
    _reading(w, s, 9.0)
    _evaluate(w, [s])
    alert = _first_open(w)
    w.as_("eve")
    w.db.q(
        "select public.edit_alert_draft(%s, %s::jsonb)",
        (
            alert,
            json.dumps(
                {
                    "audience": "public",
                    "expected_timing": "Within 3 hours",
                    "duration_text": "Until the river falls below bankfull",
                    "recommended_action": "Avoid the river bank",
                    "issuing_authority": "Test District",
                    "expires_at": _iso(timedelta(hours=8)),
                }
            ),
        ),
    )
    w.db.q("select public.submit_alert(%s)", (alert,))
    fails(
        w.db, NoPerm, "select public.approve_alert(%s)", (alert,)
    )  # eve adopted it, so cannot approve it
    _add_user(w, "gina", "government_authority")
    w.as_("gina")
    w.db.q("select public.approve_alert(%s)", (alert,))


def test_acknowledgement_and_escalation(geo_world: World) -> None:
    w = geo_world
    alert = _human_alert(w, audience="internal")
    _flow_to(w, alert, "published")
    w.db.su()
    w.db.run(
        "update public.alerts set ack_due_at = now() - interval '1 minute' where id = %s", (alert,)
    )
    assert w.db.q("select id from public.alerts_escalation_due") == [(alert,)]
    w.db.service()
    assert w.db.one("select public.escalate_alerts()") == 1
    w.db.su()
    assert w.db.one("select escalation_level from public.alerts where id = %s", (alert,)) == 1
    assert (
        w.db.one(
            "select count(*) from public.alert_events where alert_id = %s and event = 'escalated'",
            (alert,),
        )
        == 1
    )
    w.as_("dave")  # community member holds neither readings.read nor a warnings permission
    fails(w.db, NoPerm, "select public.ack_alert(%s)", (alert,))
    w.as_("carol")
    w.db.q("select public.ack_alert(%s)", (alert,))
    w.db.su()
    w.db.run(
        "update public.alerts set ack_due_at = now() - interval '1 minute' where id = %s", (alert,)
    )
    w.db.service()
    assert w.db.one("select public.escalate_alerts()") == 0  # acknowledged: no further escalation


def test_expiry(geo_world: World) -> None:
    w = geo_world
    alert = _human_alert(w, audience="internal")
    _flow_to(w, alert, "published")
    w.db.su()
    w.db.run("alter table public.alerts disable trigger alerts_guard")  # test-only: age the alert
    w.db.run(
        "update public.alerts set expires_at = now() - interval '1 minute' where id = %s", (alert,)
    )
    w.db.run("alter table public.alerts enable trigger alerts_guard")
    w.db.service()
    assert w.db.one("select public.expire_alerts()") == 1
    assert _status(w, alert) == "expired"


def test_false_alarm_tagging_needs_review_rights(geo_world: World) -> None:
    w = geo_world
    alert = _human_alert(w, audience="internal")
    w.as_("carol")
    fails(w.db, NoPerm, "select public.tag_false_alarm(%s, true, 'x')", (alert,))
    w.as_("eve")
    w.db.q("select public.tag_false_alarm(%s, true, 'sensor was being cleaned')", (alert,))
    w.db.su()
    assert w.db.one("select false_alarm from public.alerts where id = %s", (alert,)) is True


def test_conflicting_alerts_are_listed_together_with_official_first(geo_world: World) -> None:
    w = geo_world
    station, _ = _sensor(w, w.org_a)
    a1 = _human_alert(w, station=station, audience="internal", level="watch")
    a2 = _human_alert(w, station=station, audience="internal", level="severe_warning", origin="official_warning",
                      attribution="Ministry of Water and Environment bulletin 12/2026")  # fmt: skip
    _flow_to(w, a1, "published")
    _flow_to(w, a2, "published")
    w.as_("carol")
    rows = w.db.q(
        "select origin::text, level::text, has_conflict, origin_rank from public.alerts_active_ranked order by origin_rank"
    )
    assert [r[0] for r in rows] == ["official_warning", "human_emergency"]
    assert all(
        r[2] for r in rows
    )  # both rows say there is a conflict; neither silently overrides the other


# ----------------------------------------------------------------------------- visibility and isolation


def test_alert_visibility_and_tenant_isolation(geo_world: World) -> None:
    w = geo_world
    station, _ = _sensor(w, w.org_a)
    draft = _human_alert(w, station=station, audience="internal")
    published = _human_alert(w, station=station, audience="internal")
    _flow_to(w, published, "published")
    seen = {}
    for who in ("carol", "eve", "frank", "dave", "bob"):
        w.as_(who)
        seen[who] = {str(r[0]) for r in w.db.q("select id from public.alerts")}
    assert seen["carol"] == {str(draft), str(published)}  # drafters and approvers see drafts
    assert seen["eve"] == {str(draft), str(published)}
    assert seen["frank"] == {str(published)}  # readers only see released alerts
    assert seen["dave"] == set() and seen["bob"] == set()
    w.as_("bob")
    for rel in (
        "alert_events",
        "alert_acks",
        "threshold_rules",
        "notification_jobs",
        "subscriptions",
    ):
        assert w.db.one(f"select count(*) from public.{rel}") == 0, rel  # noqa: S608
    w.db.anon()
    fails(w.db, NoPerm, "select count(*) from public.alerts")


def test_app_roles_cannot_write_alert_tables_directly(geo_world: World) -> None:
    w = geo_world
    alert = _human_alert(w)
    for who in ("carol", "eve", "alice"):
        w.as_(who)
        fails(w.db, NoPerm, "update public.alerts set status = 'approved' where id = %s", (alert,))
        fails(
            w.db,
            NoPerm,
            "insert into public.alerts (org_id, origin, level, title, location_text) values (%s, 'human_emergency', 'watch', 't', 'l')",
            (w.org_a,),
        )
        fails(w.db, NoPerm, "delete from public.alert_events")
        fails(
            w.db,
            NoPerm,
            "insert into public.threshold_rules (org_id, name, scope, comparator, threshold_value, level, drafted_by) values (%s, 'x', 'organisation', '>=', 1, 'watch', %s)",
            (w.org_a, w.users[who]),
        )
        fails(w.db, NoPerm, "update public.notification_settings set mode = 'live'")
    w.db.su()  # history is append-only even for the table owner
    fails(w.db, NoPerm, "update public.alert_events set note = 'rewritten'")
    fails(w.db, NoPerm, "delete from public.alert_events")


# ----------------------------------------------------------------------------- notifications


def _subscribe(w: World, station: Any, address: str, channel: str = "sms") -> None:
    w.as_("alice")
    w.db.run(
        "insert into public.subscriptions (org_id, station_id, channel, address, consent_text)"
        " values (%s, %s, %s, %s, 'Opted in by SMS keyword JOIN')",
        (w.org_a, station, channel, address),
    )


def _jobs(w: World) -> list[tuple[str, str]]:
    w.db.su()
    return [
        (r[0], r[1])
        for r in w.db.q("select channel, status from public.notification_jobs order by id")
    ]


def test_only_published_public_alerts_queue_notifications_with_opted_in_subscribers(
    geo_world: World,
) -> None:
    w = geo_world
    station, _ = _sensor(w, w.org_a)
    _subscribe(w, station, "+256700000001")
    _subscribe(w, station, "a@example.test", "email")
    internal = _human_alert(w, station=station, audience="internal")
    _flow_to(w, internal, "published")
    assert _jobs(w) == []  # internal advisories notify nobody
    public = _human_alert(w, station=station)
    _flow_to(w, public, "submitted")
    assert _jobs(w) == []  # not published yet
    w.as_("eve")
    w.db.q("select public.approve_alert(%s)", (public,))
    w.db.q("select public.publish_alert(%s)", (public,))
    assert sorted(_jobs(w)) == [("email", "queued"), ("sms", "queued")]


def test_notification_caps_are_applied_and_visible_not_silent(geo_world: World) -> None:
    w = geo_world
    station, _ = _sensor(w, w.org_a)
    for i in range(3):
        _subscribe(w, station, f"+25670000010{i}")
    w.db.su()
    w.db.run(
        "insert into public.notification_settings (org_id, per_alert_cap) values (%s, 2)",
        (w.org_a,),
    )
    assert (
        w.db.one("select mode from public.notification_settings") == "dry_run"
    )  # default is the safe mode
    alert = _human_alert(w, station=station)
    _flow_to(w, alert, "published")
    assert sorted(s for _, s in _jobs(w)) == ["queued", "queued", "suppressed_cap"]


def test_cancelling_before_dispatch_suppresses_queued_notifications(geo_world: World) -> None:
    w = geo_world
    station, _ = _sensor(w, w.org_a)
    _subscribe(w, station, "+256700000555")
    alert = _human_alert(w, station=station)
    _flow_to(w, alert, "published")
    w.as_("eve")
    w.db.q("select public.cancel_alert(%s, 'issued for the wrong river')", (alert,))
    assert [s for _, s in _jobs(w)] == ["suppressed_cancelled"]


def test_subscriptions_need_consent_and_are_org_scoped(geo_world: World) -> None:
    w = geo_world
    station, _ = _sensor(w, w.org_a)
    w.as_("alice")
    fails(
        w.db,
        Check,
        "insert into public.subscriptions (org_id, station_id, channel, address, consent_text) values (%s, %s, 'sms', '+256700', '')",
        (w.org_a, station),
    )
    w.as_("bob")
    fails(
        w.db,
        NoPerm,
        "insert into public.subscriptions (org_id, station_id, channel, address, consent_text) values (%s, %s, 'sms', '+256700', 'ok consent')",
        (w.org_a, station),
    )
    w.as_("carol")  # hydrologist cannot manage subscriber contact details
    assert w.db.one("select count(*) from public.subscriptions") == 0


def test_warning_roles_get_nothing_without_mfa(geo_world: World) -> None:
    w = geo_world
    alert = _human_alert(w, audience="internal")
    w.as_("eve", aal="aal1")  # government authority without MFA
    assert w.db.q("select id from public.alerts") == []
    fails(w.db, NoPerm, "select public.approve_alert(%s)", (alert,))
