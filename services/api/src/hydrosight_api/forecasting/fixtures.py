"""Synthetic fixtures for testing the pipeline and UI. Always labelled synthetic.

Never use these to claim model skill: the generator's own rules decide the answer."""

import math
import random
from datetime import UTC, datetime

from hydrosight_api.forecasting.series import Series


def synthetic_catchment(
    n: int = 24 * 365, seed: int = 7, start: datetime | None = None
) -> tuple[Series, Series]:
    """(stage_m, rain_mm_per_h), hourly. Rain arrives in storms; the river rises with a lag
    and recedes slowly. Entirely invented."""
    rng = random.Random(seed)  # noqa: S311 - reproducible synthetic fixture, not security
    start = start or datetime(2024, 1, 1, tzinfo=UTC)
    rain: list[float | None] = []
    stage: list[float | None] = []
    storm_left, intensity, rise, store = 0, 0.0, 0.0, 0.0
    for t in range(n):
        if storm_left == 0 and rng.random() < 0.012 * (
            1.4 + math.sin(2 * math.pi * t / (24 * 180))
        ):
            storm_left, intensity = rng.randint(2, 10), rng.uniform(2.0, 18.0)
        r = rng.uniform(0.3, 1.0) * intensity if storm_left > 0 else 0.0
        storm_left = max(storm_left - 1, 0)
        store = store * 0.9 + r
        rise = max(0.0, rise * 0.96 + 0.004 * store + rng.gauss(0, 0.002))
        level = 0.3 + rise
        rain.append(round(r, 3))
        stage.append(round(level, 4))
    return (
        Series(start, 1, tuple(stage), "synthetic", "m"),
        Series(start, 1, tuple(rain), "synthetic", "mm/h"),
    )
