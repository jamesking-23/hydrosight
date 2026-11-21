"""Backtesting harness: temporal hold-out, verification scores, lead time, extreme events.

How it stays honest:
  * The model is fitted on indices before `train_end` only (labels included) and is then shown
    `Series.upto(i)` for each issue time i in the hold-out, never anything later.
  * The event threshold, its written basis and the warning probability are supplied by the
    caller. There are no defaults, because there are no universal flood thresholds.
  * A run on synthetic input is marked synthetic and says so in its notes. It tests the pipeline;
    it says nothing about skill on real rivers."""

from dataclasses import dataclass, field
from typing import Any

from hydrosight_api.forecasting import metrics
from hydrosight_api.forecasting.series import (
    DataOrigin,
    Model,
    Prediction,
    Series,
    weakest_origin,
)

SYNTHETIC_NOTE = (
    "SYNTHETIC DATA: this run tests the software pipeline only. It says nothing about how well "
    "the model would perform on a real river."
)


@dataclass(frozen=True)
class BacktestConfig:
    horizon_steps: int
    threshold: float
    threshold_unit: str
    threshold_basis: str  # why this threshold counts as an event, in words (>= 20 characters)
    warn_probability: float  # forecast probability at or above which a warning is counted
    train_end: int  # index; training data are strictly before this
    holdout_start: int
    holdout_end: int  # exclusive
    issue_every_steps: int = 1
    extreme_threshold: float | None = None

    def validate(self, n: int) -> None:
        if self.horizon_steps < 1:
            raise ValueError("horizon_steps must be at least 1")
        if len(self.threshold_basis.strip()) < 20:
            raise ValueError("state why this threshold marks an event (at least 20 characters)")
        if not self.threshold_unit.strip():
            raise ValueError("threshold_unit is required")
        if not 0.0 < self.warn_probability <= 1.0:
            raise ValueError("warn_probability must be in (0, 1]")
        if not 0 < self.train_end <= self.holdout_start:
            raise ValueError("training must end before the hold-out starts")
        if self.holdout_end > n or self.holdout_end - self.holdout_start <= self.horizon_steps:
            raise ValueError("hold-out is too short or runs past the data")
        if self.issue_every_steps < 1:
            raise ValueError("issue_every_steps must be at least 1")
        if self.extreme_threshold is not None and self.extreme_threshold <= self.threshold:
            raise ValueError("extreme_threshold must be above the event threshold")


@dataclass
class BacktestResult:
    model_name: str
    model_version: str
    evaluation_origin: DataOrigin
    config: BacktestConfig
    horizon_hours: int
    n_forecasts: int
    skipped: int
    contingency: metrics.Contingency
    pod: float | None
    far: float | None
    csi: float | None
    brier: float | None
    median_lead_time_s: float | None
    reliability: list[dict[str, float | int]]
    extreme_events: dict[str, Any]
    n_events: int
    is_synthetic: bool
    notes: str
    predictions: list[tuple[int, Prediction]] = field(default_factory=list, repr=False)

    def to_row(self) -> dict[str, Any]:
        """Column values for public.backtest_runs (ids and run_by are added by the caller)."""
        c, cfg = self.contingency, self.config
        return {
            "evaluation_origin": self.evaluation_origin,
            "horizon_hours": self.horizon_hours,
            "event_threshold": cfg.threshold,
            "event_threshold_unit": cfg.threshold_unit,
            "event_basis": cfg.threshold_basis,
            "n_forecasts": self.n_forecasts,
            "hits": c.hits,
            "misses": c.misses,
            "false_alarms": c.false_alarms,
            "correct_negatives": c.correct_negatives,
            "pod": self.pod,
            "far": self.far,
            "csi": self.csi,
            "brier": self.brier,
            "median_lead_time_s": self.median_lead_time_s,
            "reliability": self.reliability,
            "extreme_events": self.extreme_events,
            "is_synthetic": self.is_synthetic,
            "notes": self.notes,
        }


def _event_runs(stage: Series, threshold: float, lo: int, hi: int) -> list[tuple[int, float]]:
    """Onsets of exceedance in [lo, hi): (index of first value >= threshold, peak of that run)."""
    runs: list[tuple[int, float]] = []
    i = lo
    while i < hi:
        v = stage.values[i]
        prev = stage.values[i - 1] if i > 0 else None
        if v is not None and v >= threshold and (prev is None or prev < threshold):
            peak, j = v, i
            while j < len(stage) and (x := stage.values[j]) is not None and x >= threshold:
                peak = max(peak, x)
                j += 1
            runs.append((i, peak))
            i = j
        else:
            i += 1
    return runs


def backtest(
    model: Model,
    stage: Series,
    rain: Series | None,
    cfg: BacktestConfig,
    *,
    keep_predictions: bool = False,
) -> BacktestResult:
    cfg.validate(len(stage))
    if rain is not None and (rain.start != stage.start or rain.step_h != stage.step_h):
        raise ValueError("rainfall and stage must share the same start time and step")
    origin = weakest_origin(stage.origin, *([rain.origin] if rain is not None else []))
    h = cfg.horizon_steps
    model.fit(stage, rain, train_end=cfg.train_end, horizon_steps=h, threshold=cfg.threshold)

    probs: list[float] = []
    obs: list[bool] = []
    issued: dict[int, tuple[float, bool]] = {}  # index -> (probability, warned)
    kept: list[tuple[int, Prediction]] = []
    skipped = 0
    for i in range(cfg.holdout_start, cfg.holdout_end - h, cfg.issue_every_steps):
        window = stage.values[i + 1 : i + h + 1]
        seen = [v for v in window if v is not None]
        if any(v >= cfg.threshold for v in seen):
            event = True
        elif len(seen) < len(window):
            skipped += 1  # outcome unknown: a gap with no exceedance seen
            continue
        else:
            event = False
        pred = model.predict(
            stage.upto(i),
            rain.upto(i) if rain is not None else None,
            horizon_steps=h,
            threshold=cfg.threshold,
        )
        if pred is None:
            skipped += 1
            continue
        probs.append(pred.probability)
        obs.append(event)
        issued[i] = (pred.probability, pred.probability >= cfg.warn_probability)
        if keep_predictions:
            kept.append((i, pred))

    warned = [p >= cfg.warn_probability for p in probs]
    c = metrics.contingency(warned, obs)

    leads: list[float] = []
    runs = _event_runs(stage, cfg.threshold, cfg.holdout_start + 1, cfg.holdout_end)
    extreme_n = extreme_hit = 0
    for onset, peak in runs:
        early = [
            i
            for i in range(max(onset - h, cfg.holdout_start), onset)
            if i in issued and issued[i][1]
        ]
        in_range = any(i in issued for i in range(max(onset - h, cfg.holdout_start), onset))
        if early:
            leads.append((onset - min(early)) * stage.step_h * 3600.0)
        if cfg.extreme_threshold is not None and peak >= cfg.extreme_threshold and in_range:
            extreme_n += 1
            extreme_hit += 1 if early else 0
    extreme: dict[str, Any] = {
        "extreme_threshold": cfg.extreme_threshold,
        "events": extreme_n,
        "detected": extreme_hit,
        "pod": (extreme_hit / extreme_n) if extreme_n else None,
    }
    synthetic = origin == "synthetic"
    return BacktestResult(
        model_name=model.name,
        model_version=model.version,
        evaluation_origin=origin,
        config=cfg,
        horizon_hours=h * stage.step_h,
        n_forecasts=len(probs),
        skipped=skipped,
        contingency=c,
        pod=metrics.pod(c),
        far=metrics.far(c),
        csi=metrics.csi(c),
        brier=metrics.brier(probs, obs),
        median_lead_time_s=metrics.median_lead_time_s(leads),
        reliability=metrics.reliability(probs, obs),
        extreme_events=extreme,
        n_events=len(runs),
        is_synthetic=synthetic,
        notes=SYNTHETIC_NOTE if synthetic else f"{origin.replace('_', ' ')} data",
        predictions=kept,
    )
