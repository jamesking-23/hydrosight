"""Forecast verification scores (build prompt section 11). Pure functions, no I/O.

Only measured values are returned. There are no acceptance targets here: what counts as good
enough is set by the owner and local hydrology and disaster-management experts."""

from collections.abc import Sequence
from dataclasses import dataclass
from statistics import median


@dataclass(frozen=True)
class Contingency:
    hits: int
    misses: int
    false_alarms: int
    correct_negatives: int

    @property
    def n(self) -> int:
        return self.hits + self.misses + self.false_alarms + self.correct_negatives


def contingency(warned: Sequence[bool], observed: Sequence[bool]) -> Contingency:
    if len(warned) != len(observed):
        raise ValueError("warned and observed must have the same length")
    h = m = f = c = 0
    for w, o in zip(warned, observed, strict=True):
        if w and o:
            h += 1
        elif o:
            m += 1
        elif w:
            f += 1
        else:
            c += 1
    return Contingency(h, m, f, c)


def pod(c: Contingency) -> float | None:
    """Probability of detection = hits / (hits + misses). None when there were no events."""
    d = c.hits + c.misses
    return c.hits / d if d else None


def far(c: Contingency) -> float | None:
    """False alarm ratio = false alarms / (hits + false alarms). None when nothing was warned."""
    d = c.hits + c.false_alarms
    return c.false_alarms / d if d else None


def csi(c: Contingency) -> float | None:
    """Critical success index = hits / (hits + misses + false alarms)."""
    d = c.hits + c.misses + c.false_alarms
    return c.hits / d if d else None


def brier(probs: Sequence[float], observed: Sequence[bool]) -> float | None:
    """Brier score = mean((p - o)^2); 0 is perfect, lower is better."""
    if len(probs) != len(observed):
        raise ValueError("probs and observed must have the same length")
    if not probs:
        return None
    if any(not 0.0 <= p <= 1.0 for p in probs):
        raise ValueError("probabilities must be between 0 and 1")
    return sum((p - float(o)) ** 2 for p, o in zip(probs, observed, strict=True)) / len(probs)


def reliability(
    probs: Sequence[float], observed: Sequence[bool], bins: int = 10
) -> list[dict[str, float | int]]:
    """Reliability diagram data: per probability bin, how often the event really happened.
    Empty bins are omitted, never filled in."""
    if bins < 2:
        raise ValueError("need at least 2 bins")
    out: list[dict[str, float | int]] = []
    for b in range(bins):
        lo, hi = b / bins, (b + 1) / bins
        idx = [i for i, p in enumerate(probs) if (lo <= p < hi) or (b == bins - 1 and p == 1.0)]
        if not idx:
            continue
        out.append(
            {
                "bin_low": lo,
                "bin_high": hi,
                "n": len(idx),
                "mean_forecast": sum(probs[i] for i in idx) / len(idx),
                "observed_frequency": sum(1 for i in idx if observed[i]) / len(idx),
            }
        )
    return out


def median_lead_time_s(lead_times_s: Sequence[float]) -> float | None:
    """Median over events that were warned in time. Missed events are not in this list: report
    them through POD."""
    return float(median(lead_times_s)) if lead_times_s else None
