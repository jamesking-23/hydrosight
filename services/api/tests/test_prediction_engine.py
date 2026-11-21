"""HS-PRD-009..020: model registry governance, immutable predictions and backtests, tenant
isolation, and the database side of the engine. Needs PostGIS (CI); skipped locally."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import psycopg
from conftest import World
from helpers import fails
from test_stations import _station

from hydrosight_api.forecasting.engine import predict_station
from hydrosight_api.forecasting.fixtures import synthetic_catchment

NoPerm = psycopg.errors.InsufficientPrivilege
BadState = psycopg.errors.ObjectNotInPrerequisiteState
BadInput = psycopg.errors.InvalidParameterValue
Check = psycopg.errors.CheckViolation

REG = "select public.register_model_version(%s, %s, %s, %s, %s, null, null, null, %s::public.data_origin, %s)"
BASIS = "Bankfull level from a 2019 survey (test fixture)"


def _register(w: World, who: str, name: str = "persistence", *, kind: str = "baseline",
              origin: str = "synthetic", evidence: str | None = None,
              org: Any = None, version: str = "1") -> uuid.UUID:  # fmt: skip
    w.as_(who)
    return w.db.one(
        REG, (org or w.org_a, name, version, kind, "flood_occurrence", origin, evidence)
    )  # type: ignore[no-any-return]


BT_SQL = (
    "insert into public.backtest_runs (org_id, model_version_id, station_id, evaluation_origin,"
    " holdout_start, holdout_end, horizon_hours, event_threshold, event_threshold_unit,"
    " event_basis, n_forecasts, hits, misses, false_alarms, correct_negatives, is_synthetic,"
    " run_by) values (%s,%s,%s,%s, now() - interval '10 days', now(), 6, 1.5, 'm', %s,"
    " %s,%s,%s,%s,%s, %s, 'test')"
)


def _bt_args(org: Any, model: Any, station: Any, origin: str, **over: Any) -> tuple[Any, ...]:
    v: dict[str, Any] = dict(n=10, hits=2, misses=1, fa=1, cn=6, basis=BASIS)
    v.update(over)
    return (org, model, station, origin, v["basis"], v["n"], v["hits"], v["misses"], v["fa"],
            v["cn"], origin == "synthetic")  # fmt: skip


def _backtest(w: World, org: Any, model: Any, station: Any, origin: str = "real_confirmed",
              **over: Any) -> None:  # fmt: skip
    w.db.service()
    w.db.run(BT_SQL, _bt_args(org, model, station, origin, **over))


PRED_SQL = (
    "insert into public.predictions (org_id, station_id, model_version_id, target, issued_at,"
    " valid_from, valid_to, horizon_hours, probability, p10, p50, p90, unit, source_type,"
    " input_snapshot, status) values (%s,%s,%s,%s, now(), now(), now() + interval '6 hours', 6,"
    " %s, %s, %s, %s, 'm', %s, %s::jsonb, %s)"
)


def _pred_args(w: World, model: Any, station: Any, **over: Any) -> tuple[Any, ...]:
    v: dict[str, Any] = dict(target="flood_occurrence", prob=0.4, source="forecast", p=(None, None, None),
                             snapshot='{"stage_sensor_id": "x"}', status="unvalidated")  # fmt: skip
    v.update(over)
    return (
        w.org_a,
        station,
        model,
        v["target"],
        v["prob"],
        *v["p"],
        v["source"],
        v["snapshot"],
        v["status"],
    )


def _prediction(w: World, model: Any, station: Any, **over: Any) -> None:
    w.db.service()
    w.db.run(PRED_SQL, _pred_args(w, model, station, **over))


def _station_a(w: World) -> Any:
    w.db.su()
    return _station(w, w.org_a)


# --- registry governance ---------------------------------------------------------------------
def test_registrant_rules(geo_world: World) -> None:
    w = geo_world
    mid = _register(w, "carol")  # hydrologist may register synthetic baselines
    w.db.su()
    assert (
        w.db.one("select status::text from public.model_versions where id = %s", (mid,))
        == "unvalidated"
    )
    w.as_("dave")  # community member
    fails(w.db, NoPerm, REG, (w.org_a, "x", "1", "baseline", "flood_occurrence", "synthetic", None))
    w.as_("carol")  # may not claim data is real
    fails(
        w.db,
        NoPerm,
        REG,
        (w.org_a, "y", "1", "baseline", "flood_occurrence", "real_confirmed", "survey"),
    )


def test_learned_models_need_confirmed_real_data(geo_world: World) -> None:
    w = geo_world
    w.as_("carol")
    for origin in ("synthetic", "real_unconfirmed"):
        fails(w.db, Check, REG, (w.org_a, "gbm", "1", "ml", "flood_occurrence", origin, None))
    w.as_("alice")  # a models.promote holder can confirm real data, with evidence
    fails(w.db, Check, REG, (w.org_a, "gbm", "1", "ml", "flood_occurrence", "real_confirmed", None))
    assert _register(
        w, "alice", "gbm", kind="ml", origin="real_confirmed", evidence="dataset DOI x"
    )


def test_extent_and_impact_are_refused(geo_world: World) -> None:
    w = geo_world
    w.as_("carol")
    for target in ("extent", "impact", "depth"):
        fails(w.db, Check, REG, (w.org_a, "z", "1", "baseline", target, "synthetic", None))


def test_promotion_gates(geo_world: World) -> None:
    w = geo_world
    st = _station_a(w)
    promote = "select public.promote_model_version(%s, %s::public.service_status, %s)"
    synth = _register(w, "carol")
    real = _register(
        w, "alice", "rate_of_rise", origin="real_confirmed", evidence="dataset ref", version="1-lb3"
    )

    w.as_("eve")
    fails(w.db, BadState, promote, (synth, "validated", "https://evidence.example/1"))  # synthetic
    fails(
        w.db, BadState, promote, (real, "validated", "https://evidence.example/1")
    )  # no real backtest
    _backtest(w, w.org_a, real, st, origin="synthetic")
    w.as_("eve")
    fails(
        w.db, BadState, promote, (real, "validated", "https://evidence.example/1")
    )  # synthetic backtest
    _backtest(w, w.org_a, real, st, origin="real_confirmed")
    w.as_("eve")
    fails(w.db, BadInput, promote, (real, "validated", " "))  # evidence is required
    fails(
        w.db, BadState, promote, (real, "operational", "https://evidence.example/1")
    )  # skips validated
    w.as_("carol")
    fails(w.db, NoPerm, promote, (real, "validated", "https://evidence.example/1"))  # no authority
    w.as_("alice")
    fails(
        w.db, NoPerm, promote, (real, "validated", "https://evidence.example/1")
    )  # own registration
    w.as_("eve")
    w.db.run(promote, (real, "validated", "https://evidence.example/1"))
    w.db.su()
    assert (
        w.db.one("select status::text from public.model_versions where id = %s", (real,))
        == "validated"
    )
    w.as_("eve")
    w.db.run(promote, (real, "operational", "https://evidence.example/2"))
    w.db.run(promote, (real, "unvalidated", None))  # demotion needs no evidence
    w.db.su()
    row = w.db.q(
        "select status::text, promoted_by, evidence_url from public.model_versions where id = %s",
        (real,),
    )
    assert row == [("unvalidated", None, None)]


def test_status_and_identity_cannot_be_edited_directly(geo_world: World) -> None:
    w = geo_world
    mid = _register(w, "carol")
    w.db.su()  # even the table owner goes through promote_model_version
    fails(
        w.db, NoPerm, "update public.model_versions set status = 'validated' where id = %s", (mid,)
    )
    fails(w.db, BadState, "update public.model_versions set name = 'renamed' where id = %s", (mid,))
    fails(w.db, BadState, "delete from public.model_versions where id = %s", (mid,))
    w.as_("alice")
    fails(
        w.db,
        NoPerm,
        "update public.model_versions set status = 'operational' where id = %s",
        (mid,),
    )
    fails(w.db, NoPerm, "insert into public.model_versions (org_id, name, version, kind, target)"
          " values (%s, 'n', '1', 'baseline', 'stage')", (w.org_a,))  # fmt: skip
    w.db.service()
    fails(w.db, NoPerm, "insert into public.model_versions (org_id, name, version, kind, target)"
          " values (%s, 'n', '1', 'baseline', 'stage')", (w.org_a,))  # fmt: skip


# --- predictions and backtests ---------------------------------------------------------------
def test_prediction_rules(geo_world: World) -> None:
    w = geo_world
    st = _station_a(w)
    mid = _register(w, "carol")
    _prediction(w, mid, st)  # valid
    w.db.service()
    for over in (
        {"prob": None},  # occurrence needs a probability
        {"prob": 1.4},
        {"source": "measured"},  # a prediction is never a measurement
        {"snapshot": "{}"},  # no inputs recorded
        {"status": "validated"},  # the engine cannot promote
        {"target": "extent"},  # no extent or depth without a calibrated hydraulic model
        {"target": "stage", "prob": None},  # stage needs p10 <= p50 <= p90
        {"target": "stage", "prob": None, "p": (3.0, 2.0, 1.0)},
    ):
        fails(w.db, Check, PRED_SQL, _pred_args(w, mid, st, **over))
    w.db.run(PRED_SQL, _pred_args(w, mid, st, target="stage", prob=None, p=(1.0, 2.0, 3.0)))


def test_predictions_and_backtests_are_immutable(geo_world: World) -> None:
    w = geo_world
    st = _station_a(w)
    mid = _register(w, "carol")
    _prediction(w, mid, st)
    _backtest(w, w.org_a, mid, st, origin="synthetic")
    w.db.su()  # even the table owner cannot rewrite history (trigger)
    fails(w.db, BadState, "update public.predictions set probability = 0.99")
    fails(w.db, BadState, "delete from public.predictions")
    fails(w.db, BadState, "update public.backtest_runs set pod = 1")
    fails(w.db, BadState, "delete from public.backtest_runs")
    w.db.service()  # the engine role can only append (no grant)
    fails(w.db, NoPerm, "update public.predictions set probability = 0.99")
    fails(w.db, NoPerm, "delete from public.predictions")
    fails(w.db, NoPerm, "update public.backtest_runs set pod = 1")
    fails(w.db, NoPerm, "delete from public.backtest_runs")


def test_only_the_engine_role_appends(geo_world: World) -> None:
    w = geo_world
    st = _station_a(w)
    mid = _register(w, "carol")
    w.as_("alice")  # no app role can write predictions or backtests
    fails(w.db, NoPerm, PRED_SQL, _pred_args(w, mid, st))
    fails(w.db, NoPerm, "delete from public.predictions")
    w.db.anon()
    fails(w.db, NoPerm, "select * from public.predictions")


def test_backtest_must_be_internally_consistent(geo_world: World) -> None:
    w = geo_world
    st = _station_a(w)
    mid = _register(w, "carol")
    w.db.service()
    fails(w.db, Check, BT_SQL, _bt_args(w.org_a, mid, st, "synthetic", basis="too short"))
    fails(w.db, Check, BT_SQL, _bt_args(w.org_a, mid, st, "synthetic", cn=7))  # counts must add up
    fails(w.db, Check, BT_SQL, _bt_args(w.org_a, mid, st, "synthetic", n=-1))
    w.db.run(BT_SQL, _bt_args(w.org_a, mid, st, "synthetic"))
    liar = (*_bt_args(w.org_a, mid, st, "synthetic")[:-1], False)  # synthetic data, flag says no
    fails(w.db, Check, BT_SQL, liar)


# --- tenant isolation -----------------------------------------------------------------------------
def test_other_organisations_see_and_do_nothing(geo_world: World) -> None:
    w = geo_world
    st = _station_a(w)
    mid = _register(w, "carol")
    _prediction(w, mid, st)
    _backtest(w, w.org_a, mid, st, origin="synthetic")
    w.as_("bob")
    for t in ("model_versions", "predictions", "backtest_runs", "flood_events"):
        assert w.db.q(f"select 1 from public.{t}") == []  # noqa: S608
    fails(w.db, NoPerm, REG, (w.org_a, "x", "1", "baseline", "flood_occurrence", "synthetic", None))
    fails(
        w.db,
        NoPerm,
        "select public.promote_model_version(%s, 'validated', 'https://e.example/1')",
        (mid,),
    )
    w.as_("carol")
    assert len(w.db.q("select 1 from public.model_versions")) == 1
    assert len(w.db.q("select 1 from public.predictions")) == 1
    w.as_("dave")  # a community member has no model permissions
    assert w.db.q("select 1 from public.model_versions") == []
    assert w.db.q("select 1 from public.backtest_runs") == []


def test_a_model_cannot_be_used_across_organisations(geo_world: World) -> None:
    w = geo_world
    st_a = _station_a(w)
    w.db.su()
    st_b = _station(w, w.org_b, code="ST-B")
    mid_b = _register(w, "bob", org=w.org_b)
    w.db.service()
    fails(w.db, psycopg.errors.ForeignKeyViolation, PRED_SQL, _pred_args(w, mid_b, st_a))
    fails(
        w.db,
        psycopg.errors.ForeignKeyViolation,
        BT_SQL,
        _bt_args(w.org_a, mid_b, st_a, "synthetic"),
    )
    assert st_b


# --- flood events (ground truth) ---------------------------------------------------------------------
EVT = (
    "select public.record_flood_event(%s, %s, now() - interval '3 days', now() - interval '2 days',"
    " 2.1, 'm', 'overtopped at the bridge', %s, %s::public.data_origin, %s::public.source_type)"
)


def test_flood_events_need_evidence_and_honest_origin(geo_world: World) -> None:
    w = geo_world
    st = _station_a(w)
    w.as_("carol")
    assert w.db.one(EVT, (w.org_a, st, "district report 2026-03", "real_unconfirmed", "measured"))
    fails(w.db, Check, EVT, (w.org_a, st, "", "real_unconfirmed", "measured"))  # evidence required
    fails(
        w.db, Check, EVT, (w.org_a, st, "ref", "synthetic", "measured")
    )  # origin must match source
    fails(
        w.db, NoPerm, EVT, (w.org_a, st, "ref", "real_confirmed", "measured")
    )  # not hers to confirm
    w.as_("alice")
    assert w.db.one(EVT, (w.org_a, st, "ref", "real_confirmed", "measured"))
    w.as_("dave")
    fails(w.db, NoPerm, EVT, (w.org_a, st, "ref", "real_unconfirmed", "measured"))


# --- the engine on stored readings -----------------------------------------------------------------
def _seed_station_with_history(
    w: World, source: str = "synthetic", hours: int = 24 * 30
) -> tuple[Any, datetime]:
    w.db.su()
    st = _station(w, w.org_a)
    stage, rain = synthetic_catchment(hours, seed=3)
    end = datetime.now(UTC).replace(minute=0, second=0, microsecond=0)
    for kind, unit, series in (("water_level", "m", stage), ("rainfall", "mm", rain)):
        sensor = w.db.one(
            "insert into public.sensors (org_id, station_id, kind, unit, expected_interval_s,"
            " source_type) values (%s, %s, %s, %s, 3600, %s) returning id",
            (w.org_a, st, kind, unit, source),
        )
        rows = [
            (w.org_a, sensor, end - timedelta(hours=hours - 1 - i), v, source)
            for i, v in enumerate(series.values)
        ]
        with w.db.conn.cursor() as cur:
            cur.executemany(
                "insert into public.readings (org_id, sensor_id, observed_at, value, source_type)"
                " values (%s, %s, %s, %s, %s)",
                rows,
            )
    return st, end


def _rule(w: World, *, status: str = "active") -> None:
    w.db.su()
    w.db.run(
        "insert into public.threshold_rules (org_id, name, scope, sensor_kind, comparator,"
        " threshold_value, level, rationale, evidence_ref, status, drafted_by, approved_by,"
        " approved_at) values (%s, 'bankfull', 'organisation', 'water_level', '>=', 1.5, 'watch',"
        " %s, 'survey-2019', %s, %s, %s, now())",
        (w.org_a, BASIS, status, w.users["carol"], w.users["eve"] if status == "active" else None),
    )


def test_engine_issues_labelled_predictions_for_registered_models(geo_world: World) -> None:
    w = geo_world
    st, end = _seed_station_with_history(w)
    _rule(w)
    _register(w, "carol", "persistence")
    _register(w, "carol", "rate_of_rise", version="1-lb3")
    _register(w, "carol", "unknown_model")  # registered but no implementation: skipped, said so
    w.db.service()
    rep = predict_station(w.db.conn, w.org_a, st, horizon_hours=6, now=end + timedelta(hours=1))
    assert rep["issued"] == 2 and any("unknown_model" in s for s in rep["skipped"])
    w.db.su()
    rows = w.db.q(
        "select source_type::text, status::text, probability, input_snapshot from public.predictions"
    )
    assert len(rows) == 2
    for source, status, prob, snap in rows:
        assert source == "synthetic" and status == "unvalidated" and 0 <= prob <= 1
        assert snap["threshold"]["rationale"] == BASIS and snap["data_origin"] == "synthetic"
        assert snap["stage_sensor_id"] and snap["n_hours"] == 24 * 30


def test_engine_refuses_without_documented_threshold_or_with_stale_input(geo_world: World) -> None:
    w = geo_world
    st, end = _seed_station_with_history(w)
    _register(w, "carol", "persistence")
    w.db.service()
    rep = predict_station(w.db.conn, w.org_a, st, horizon_hours=6, now=end + timedelta(hours=1))
    assert rep["issued"] == 0 and "no active threshold" in rep["skipped"][0]
    _rule(w, status="draft")  # a draft rule is not a basis
    w.db.service()
    assert (
        predict_station(w.db.conn, w.org_a, st, horizon_hours=6, now=end + timedelta(hours=1))[
            "issued"
        ]
        == 0
    )
    _rule(w)
    w.db.service()
    stale = predict_station(w.db.conn, w.org_a, st, horizon_hours=6, now=end + timedelta(hours=9))
    assert stale["issued"] == 0 and "stale input" in stale["skipped"][0]
    short = predict_station(w.db.conn, w.org_a, st, horizon_hours=6, now=end + timedelta(hours=1))
    assert short["issued"] == 1  # fresh again: forecasts resume


def test_engine_never_uses_estimated_or_bad_readings(geo_world: World) -> None:
    w = geo_world
    st, end = _seed_station_with_history(w, hours=24 * 20)
    _rule(w)
    _register(w, "carol", "persistence")
    w.db.su()
    w.db.run("update public.readings set quality = 'bad'")  # QC marked everything bad
    w.db.service()
    rep = predict_station(w.db.conn, w.org_a, st, horizon_hours=6, now=end + timedelta(hours=1))
    assert rep["issued"] == 0 and "no usable" in rep["skipped"][0]
