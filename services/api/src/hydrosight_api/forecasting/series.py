"""Regular time series and the model interface.

A model is only ever shown `Series.upto(i)`: the data up to and including the issue time. It
cannot see the future, so a backtest cannot leak the answer by accident."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal, Protocol

DataOrigin = Literal["synthetic", "real_unconfirmed", "real_confirmed"]
_RANK: dict[str, int] = {"synthetic": 0, "real_unconfirmed": 1, "real_confirmed": 2}


def weakest_origin(*origins: DataOrigin) -> DataOrigin:
    """The least trustworthy origin among the inputs: one synthetic input makes the whole run
    synthetic."""
    return min(origins, key=lambda o: _RANK[o])


@dataclass(frozen=True)
class Series:
    start: datetime
    step_h: int
    values: tuple[float | None, ...]
    origin: DataOrigin
    unit: str

    def __post_init__(self) -> None:
        if self.step_h < 1:
            raise ValueError("step_h must be at least 1")
        if self.start.tzinfo is None:
            raise ValueError("series start must be timezone-aware")

    def __len__(self) -> int:
        return len(self.values)

    def time(self, i: int) -> datetime:
        return self.start + timedelta(hours=self.step_h * i)

    def upto(self, i: int) -> "Series":
        """Everything observed up to and including index i, nothing later."""
        return Series(self.start, self.step_h, self.values[: i + 1], self.origin, self.unit)


@dataclass(frozen=True)
class Prediction:
    probability: float  # P(an observation reaches the threshold within the horizon)
    p10: float  # stage at the end of the horizon
    p50: float
    p90: float
    inputs: dict[str, float | int | str]  # what the number was computed from


class Model(Protocol):
    name: str
    version: str
    kind: str  # baseline | ml | hybrid | external

    def fit(
        self,
        stage: Series,
        rain: Series | None,
        *,
        train_end: int,
        horizon_steps: int,
        threshold: float,
    ) -> None:
        """Learn only from indices below train_end, and only labels that finish before it."""
        ...

    def predict(
        self, stage: Series, rain: Series | None, *, horizon_steps: int, threshold: float
    ) -> Prediction | None:
        """`stage` and `rain` end at the issue time. None means 'cannot forecast now'."""
        ...
