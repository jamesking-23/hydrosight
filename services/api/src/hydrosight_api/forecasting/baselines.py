"""Baseline models. Anything fancier has to beat these on the same backtest.

Probabilities are Laplace-smoothed event frequencies, (k + 1) / (n + 2), so a small training
set never produces a claim of certainty. Smoothing and the decay and window arguments are
modelling choices, not validated values: they are required arguments, never silent defaults."""

from collections.abc import Sequence

from hydrosight_api.forecasting.series import Prediction, Series


def quantile(sorted_values: Sequence[float], q: float) -> float:
    if not sorted_values:
        raise ValueError("no values")
    if not 0.0 <= q <= 1.0:
        raise ValueError("q must be between 0 and 1")
    pos = q * (len(sorted_values) - 1)
    lo = int(pos)
    hi = min(lo + 1, len(sorted_values) - 1)
    return sorted_values[lo] + (sorted_values[hi] - sorted_values[lo]) * (pos - lo)


def smoothed(k: int, n: int) -> float:
    return (k + 1) / (n + 2)


def window_after(stage: Series, i: int, horizon_steps: int) -> list[float] | None:
    """Observations i+1 .. i+horizon, or None if any is missing or out of range."""
    if i + horizon_steps >= len(stage):
        return None
    w = stage.values[i + 1 : i + horizon_steps + 1]
    if any(v is None for v in w):
        return None
    return [v for v in w if v is not None]


def training_samples(
    stage: Series, train_end: int, horizon_steps: int, start: int = 0
) -> list[tuple[int, float, float, float]]:
    """(index, stage now, max over horizon, stage at end of horizon). The whole label window
    must finish before train_end, so training never touches the holdout."""
    out: list[tuple[int, float, float, float]] = []
    for i in range(start, train_end - horizon_steps):
        now = stage.values[i]
        w = window_after(stage, i, horizon_steps)
        if now is None or w is None:
            continue
        out.append((i, now, max(w), w[-1]))
    return out


def _spread(centre: float, deltas: list[float]) -> tuple[float, float, float]:
    s = sorted(deltas)
    return (
        centre + quantile(s, 0.1),
        centre + quantile(s, 0.5),
        centre + quantile(s, 0.9),
    )


class Persistence:
    """Tomorrow looks like now, with the spread of how much the stage really changed over the
    horizon in the training period."""

    name, version, kind = "persistence", "1", "baseline"

    def __init__(self) -> None:
        self._d_max: list[float] = []
        self._d_end: list[float] = []

    def fit(
        self,
        stage: Series,
        rain: Series | None,
        *,
        train_end: int,
        horizon_steps: int,
        threshold: float,
    ) -> None:
        s = training_samples(stage, train_end, horizon_steps)
        if len(s) < 10:
            raise ValueError("not enough training samples (need at least 10)")
        self._d_max = [mx - now for _, now, mx, _ in s]
        self._d_end = sorted(end - now for _, now, _, end in s)

    def predict(
        self, stage: Series, rain: Series | None, *, horizon_steps: int, threshold: float
    ) -> Prediction | None:
        now = stage.values[-1] if len(stage) else None
        if now is None or not self._d_end:
            return None
        k = sum(1 for d in self._d_max if now + d >= threshold)
        p10, p50, p90 = _spread(now, self._d_end)
        return Prediction(
            smoothed(k, len(self._d_max)),
            p10,
            p50,
            p90,
            {"stage_now": now, "n_train": len(self._d_max)},
        )


class RateOfRise:
    """Extend the recent rise (or fall) over the last `lookback_steps` to the end of the horizon,
    with the spread of how wrong that was in the training period."""

    name, kind = "rate_of_rise", "baseline"

    def __init__(self, lookback_steps: int) -> None:
        if lookback_steps < 1:
            raise ValueError("lookback_steps must be at least 1")
        self.lookback = lookback_steps
        self.version = f"1-lb{lookback_steps}"
        self._res_max: list[float] = []
        self._res_end: list[float] = []

    def _slope(self, stage: Series, i: int) -> float | None:
        if i - self.lookback < 0:
            return None
        a, b = stage.values[i - self.lookback], stage.values[i]
        return None if a is None or b is None else (b - a) / self.lookback

    def fit(
        self,
        stage: Series,
        rain: Series | None,
        *,
        train_end: int,
        horizon_steps: int,
        threshold: float,
    ) -> None:
        self._res_max, self._res_end = [], []
        for i, now, mx, end in training_samples(stage, train_end, horizon_steps, self.lookback):
            sl = self._slope(stage, i)
            if sl is None:
                continue
            self._res_max.append(mx - (now + max(sl, 0.0) * horizon_steps))
            self._res_end.append(end - (now + sl * horizon_steps))
        if len(self._res_max) < 10:
            raise ValueError("not enough training samples (need at least 10)")
        self._res_end.sort()

    def predict(
        self, stage: Series, rain: Series | None, *, horizon_steps: int, threshold: float
    ) -> Prediction | None:
        if not self._res_end or not len(stage):
            return None
        i = len(stage) - 1
        sl, now = self._slope(stage, i), stage.values[i]
        if sl is None or now is None:
            return None
        proj_max = now + max(sl, 0.0) * horizon_steps
        k = sum(1 for r in self._res_max if proj_max + r >= threshold)
        p10, p50, p90 = _spread(now + sl * horizon_steps, self._res_end)
        return Prediction(
            smoothed(k, len(self._res_max)),
            p10,
            p50,
            p90,
            {"stage_now": now, "slope_per_step": sl, "lookback_steps": self.lookback},
        )


class RainfallAccumulation:
    """Antecedent wetness: a decaying sum of recent rain, API = sum(rain[i-j] * decay**j), grouped
    into bins of the training period. The forecast is how often the event followed in that bin."""

    name, kind = "rainfall_accumulation", "baseline"

    def __init__(self, decay: float, window_steps: int, n_bins: int) -> None:
        if not 0.0 < decay < 1.0:
            raise ValueError("decay must be between 0 and 1")
        if window_steps < 1 or n_bins < 2:
            raise ValueError("window_steps >= 1 and n_bins >= 2 are required")
        self.decay, self.window, self.n_bins = decay, window_steps, n_bins
        self.version = f"1-d{decay}-w{window_steps}-b{n_bins}"
        self._edges: list[float] = []
        self._bins: list[tuple[int, int, list[float]]] = []  # (n, events, end deltas)

    def index(self, rain: Series, i: int) -> float | None:
        if i - self.window + 1 < 0 or i >= len(rain):
            return None
        total = 0.0
        for j in range(self.window):
            v = rain.values[i - j]
            if v is None:
                return None
            total += v * self.decay**j
        return total

    def _bin(self, value: float) -> int:
        return sum(1 for e in self._edges if value >= e)

    def fit(
        self,
        stage: Series,
        rain: Series | None,
        *,
        train_end: int,
        horizon_steps: int,
        threshold: float,
    ) -> None:
        if rain is None:
            raise ValueError("rainfall_accumulation needs a rainfall series")
        rows: list[tuple[float, bool, float]] = []
        for i, now, mx, end in training_samples(stage, train_end, horizon_steps, self.window - 1):
            api = self.index(rain, i)
            if api is not None:
                rows.append((api, mx >= threshold, end - now))
        if len(rows) < 10 * self.n_bins:
            raise ValueError("not enough training samples for the number of bins")
        apis = sorted(r[0] for r in rows)
        self._edges = [quantile(apis, b / self.n_bins) for b in range(1, self.n_bins)]
        grouped: list[list[tuple[float, bool, float]]] = [[] for _ in range(self.n_bins)]
        for r in rows:
            grouped[self._bin(r[0])].append(r)
        self._bins = [
            (len(g), sum(1 for _, ev, _ in g if ev), sorted(d for _, _, d in g)) for g in grouped
        ]

    def predict(
        self, stage: Series, rain: Series | None, *, horizon_steps: int, threshold: float
    ) -> Prediction | None:
        if rain is None or not self._bins or not len(stage):
            return None
        i = len(stage) - 1
        now, api = stage.values[i], self.index(rain, i)
        if now is None or api is None:
            return None
        n, k, deltas = self._bins[self._bin(api)]
        if not deltas:
            return None
        p10, p50, p90 = _spread(now, deltas)
        return Prediction(
            smoothed(k, n),
            p10,
            p50,
            p90,
            {"stage_now": now, "antecedent_index": api, "bin": self._bin(api), "n_bin": n},
        )


class EmpiricalExceedance:
    """Climatology: how often the event happened in the training period, whatever the conditions."""

    name, version, kind = "empirical_exceedance", "1", "baseline"

    def __init__(self) -> None:
        self._n = 0
        self._k = 0
        self._d_end: list[float] = []

    def fit(
        self,
        stage: Series,
        rain: Series | None,
        *,
        train_end: int,
        horizon_steps: int,
        threshold: float,
    ) -> None:
        s = training_samples(stage, train_end, horizon_steps)
        if len(s) < 10:
            raise ValueError("not enough training samples (need at least 10)")
        self._n, self._k = len(s), sum(1 for _, _, mx, _ in s if mx >= threshold)
        self._d_end = sorted(end - now for _, now, _, end in s)

    def predict(
        self, stage: Series, rain: Series | None, *, horizon_steps: int, threshold: float
    ) -> Prediction | None:
        now = stage.values[-1] if len(stage) else None
        if now is None or not self._d_end:
            return None
        p10, p50, p90 = _spread(now, self._d_end)
        return Prediction(
            smoothed(self._k, self._n), p10, p50, p90, {"stage_now": now, "n_train": self._n}
        )
