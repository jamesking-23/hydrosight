"""HS-PRD-001..008: verification metrics, baselines, hold-out discipline, gates. No database."""

import math
from datetime import UTC, datetime

import pytest

from hydrosight_api.forecasting import external, metrics
from hydrosight_api.forecasting.baselines import (
    EmpiricalExceedance,
    Persistence,
    RainfallAccumulation,
    RateOfRise,
    quantile,
)
from hydrosight_api.forecasting.fixtures import synthetic_catchment
from hydrosight_api.forecasting.harness import SYNTHETIC_NOTE, BacktestConfig, backtest
from hydrosight_api.forecasting.ml_gate import TrainingDataRefused, require_real_training_data
from hydrosight_api.forecasting.series import Prediction, Series, weakest_origin

T0 = datetime(2024, 1, 1, tzinfo=UTC)
BASIS = "Bankfull level from the 2019 channel survey (test fixture, not a real basis)"


# --- metrics: hand-computed values ------------------------------------------------------
def test_scores_match_hand_calculation() -> None:
    warned = [True, True, True, False, False, False, False, True]
    observed = [True, True, False, True, False, False, False, False]
    c = metrics.contingency(warned, observed)
    assert (c.hits, c.misses, c.false_alarms, c.correct_negatives) == (2, 1, 2, 3)
    assert metrics.pod(c) == pytest.approx(2 / 3)
    assert metrics.far(c) == pytest.approx(2 / 4)
    assert metrics.csi(c) == pytest.approx(2 / 5)


def test_scores_are_none_not_zero_when_undefined() -> None:
    c = metrics.contingency([False, False], [False, False])
    assert metrics.pod(c) is None and metrics.far(c) is None and metrics.csi(c) is None
    assert metrics.brier([], []) is None


def test_brier_and_validation() -> None:
    assert metrics.brier([1.0, 0.0], [True, False]) == 0.0
    assert metrics.brier([0.0, 1.0], [True, False]) == 1.0
    assert metrics.brier([0.7, 0.2], [True, False]) == pytest.approx((0.09 + 0.04) / 2)
    with pytest.raises(ValueError):
        metrics.brier([1.2], [True])
    with pytest.raises(ValueError):
        metrics.contingency([True], [True, False])


def test_reliability_bins_omit_empty_and_include_one() -> None:
    r = metrics.reliability([0.05, 0.05, 0.95, 1.0], [False, True, True, True], bins=10)
    assert [b["n"] for b in r] == [2, 2]
    assert r[0]["observed_frequency"] == 0.5 and r[1]["observed_frequency"] == 1.0


def test_quantile_interpolates() -> None:
    assert quantile([0.0, 10.0], 0.5) == 5.0
    assert quantile([1.0, 2.0, 3.0], 0.0) == 1.0 and quantile([1.0, 2.0, 3.0], 1.0) == 3.0


# --- series / leakage ----------------------------------------------------------------------
def test_upto_hides_the_future() -> None:
    s = Series(T0, 1, (1.0, 2.0, 3.0, 4.0), "synthetic", "m")
    assert s.upto(1).values == (1.0, 2.0)
    with pytest.raises(ValueError):
        Series(datetime(2024, 1, 1), 1, (1.0,), "synthetic", "m")  # naive time refused


def test_one_synthetic_input_makes_the_run_synthetic() -> None:
    assert weakest_origin("real_confirmed", "synthetic") == "synthetic"
    assert weakest_origin("real_confirmed", "real_unconfirmed") == "real_unconfirmed"


class _Spy:
    """Records what the model was shown, to prove it never sees past the issue time."""

    name, version, kind = "spy", "1", "baseline"

    def __init__(self) -> None:
        self.fit_train_end = -1
        self.lengths: list[int] = []

    def fit(self, stage: Series, rain: Series | None, **kw: int | float) -> None:
        self.fit_train_end = int(kw["train_end"])

    def predict(self, stage: Series, rain: Series | None, **kw: int | float) -> Prediction:
        self.lengths.append(len(stage))
        return Prediction(0.5, 0.0, 0.0, 0.0, {})


def _cfg(**over: object) -> BacktestConfig:
    base: dict[str, object] = dict(
        horizon_steps=6, threshold=1.2, threshold_unit="m", threshold_basis=BASIS,
        warn_probability=0.5, train_end=3000, holdout_start=3000, holdout_end=3200,
    )  # fmt: skip
    base.update(over)
    return BacktestConfig(**base)  # type: ignore[arg-type]


def test_model_never_sees_beyond_issue_time_and_fit_stops_at_train_end() -> None:
    stage, rain = synthetic_catchment(4000)
    spy = _Spy()
    backtest(spy, stage, rain, _cfg())
    assert spy.fit_train_end == 3000
    assert spy.lengths[0] == 3001  # index 3000 is the first issue time
    assert spy.lengths == list(range(3001, 3001 + len(spy.lengths)))


# --- harness validation ----------------------------------------------------------------------
@pytest.mark.parametrize(
    "over",
    [
        {"threshold_basis": "too short"},
        {"threshold_unit": " "},
        {"warn_probability": 0.0},
        {"train_end": 3100},  # training would overlap the hold-out
        {"holdout_end": 9999},
        {"extreme_threshold": 1.0},
    ],
)
def test_backtest_config_refuses_unsafe_settings(over: dict[str, object]) -> None:
    stage, rain = synthetic_catchment(4000)
    with pytest.raises(ValueError):
        backtest(Persistence(), stage, rain, _cfg(**over))


# --- end to end on labelled synthetic fixtures ---------------------------------------------------
@pytest.fixture(scope="module")
def data() -> tuple[Series, Series]:
    return synthetic_catchment(24 * 365)


def _models() -> list[object]:
    return [
        Persistence(),
        RateOfRise(lookback_steps=3),
        RainfallAccumulation(decay=0.9, window_steps=12, n_bins=4),
        EmpiricalExceedance(),
    ]


def test_every_baseline_runs_and_is_labelled_synthetic(data: tuple[Series, Series]) -> None:
    stage, rain = data
    thr = 1.5  # fixture-only level for invented data; no meaning for any real river
    cfg = _cfg(threshold=thr, train_end=6000, holdout_start=6000, holdout_end=8000,
               extreme_threshold=2.0)  # fmt: skip
    for m in _models():
        res = backtest(m, stage, rain, cfg)  # type: ignore[arg-type]
        assert res.is_synthetic and res.evaluation_origin == "synthetic"
        assert res.notes == SYNTHETIC_NOTE
        c = res.contingency
        assert c.n == res.n_forecasts > 1000
        assert res.brier is not None and 0.0 <= res.brier <= 1.0
        row = res.to_row()
        assert row["is_synthetic"] is True
        assert (
            row["hits"] + row["misses"] + row["false_alarms"] + row["correct_negatives"]
            == row["n_forecasts"]
        )
        for k in ("pod", "far", "csi"):
            assert row[k] is None or 0.0 <= row[k] <= 1.0  # type: ignore[operator]


def test_events_exist_and_lead_time_is_measured(data: tuple[Series, Series]) -> None:
    stage, rain = data
    thr = 1.5  # fixture-only
    cfg = _cfg(
        threshold=thr, train_end=6000, holdout_start=6000, holdout_end=8000, warn_probability=0.3
    )
    res = backtest(RateOfRise(lookback_steps=3), stage, rain, cfg)
    assert res.n_events > 0 and res.median_lead_time_s is not None
    assert 0 < res.median_lead_time_s <= 6 * 3600  # never longer than the horizon


def test_perfect_foresight_oracle_scores_perfectly() -> None:
    """The harness itself must score a known-good forecaster correctly: sanity check on the
    machinery, not a statement about any real model."""
    stage, rain = synthetic_catchment(4000)
    thr = 1.0

    class Oracle:
        name, version, kind = "oracle", "1", "baseline"

        def fit(self, *a: object, **k: object) -> None: ...

        def predict(self, st: Series, ra: Series | None, **k: float) -> Prediction:
            i = len(st) - 1
            truth = any((v or 0) >= thr for v in stage.values[i + 1 : i + 7])  # reads the future
            return Prediction(1.0 if truth else 0.0, 0.0, 0.0, 0.0, {})

    res = backtest(Oracle(), stage, rain, _cfg(threshold=thr, holdout_end=3990))  # type: ignore[arg-type]
    assert res.brier == 0.0
    assert res.contingency.misses == 0 and res.contingency.false_alarms == 0
    assert res.contingency.hits > 0 and res.pod is not None and math.isclose(res.pod, 1.0)


def test_baselines_refuse_too_little_training_data() -> None:
    stage, rain = synthetic_catchment(60)
    with pytest.raises(ValueError):
        Persistence().fit(stage, rain, train_end=12, horizon_steps=6, threshold=1.0)


def test_rainfall_model_needs_rain() -> None:
    stage, _ = synthetic_catchment(2000)
    with pytest.raises(ValueError):
        RainfallAccumulation(0.9, 12, 4).fit(
            stage, None, train_end=1500, horizon_steps=6, threshold=1.0
        )


# --- ML gate + external plug-ins ---------------------------------------------------------------
def test_ml_gate_refuses_synthetic_and_unconfirmed_data() -> None:
    stage, rain = synthetic_catchment(100)
    with pytest.raises(TrainingDataRefused):
        require_real_training_data(stage, rain)
    unconfirmed = Series(T0, 1, (1.0,), "real_unconfirmed", "m")
    with pytest.raises(TrainingDataRefused):
        require_real_training_data(unconfirmed)
    ok = Series(T0, 1, (1.0,), "real_confirmed", "m")
    require_real_training_data(ok, ok)
    with pytest.raises(TrainingDataRefused):  # one weak input is enough to refuse
        require_real_training_data(ok, stage)


class _Adapter:
    def __init__(self, name: str, verified: bool, note: str) -> None:
        self.name, self.licence_verified, self.licence_note = name, verified, note

    def fetch(self, station_codes: list[str], since: datetime) -> list[external.ExternalForecast]:
        return []


def test_external_adapter_needs_a_recorded_licence_check() -> None:
    with pytest.raises(ValueError):
        external.register_adapter(_Adapter("glofas", False, ""))
    with pytest.raises(ValueError):
        external.register_adapter(_Adapter("glofas", True, "ok"))  # note too thin
    external.register_adapter(
        _Adapter("test-only", True, "Terms read on 2026-11-21 at example.org (test)")
    )
    assert "test-only" in external.registered()
    with pytest.raises(ValueError):
        external.register_adapter(
            _Adapter("test-only", True, "Terms read on 2026-11-21 at example.org (test)")
        )
