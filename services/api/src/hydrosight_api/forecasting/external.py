"""Interface for outputs from external hydrological and hydraulic models and services.

HEC-HMS, HEC-RAS, LISFLOOD, GloFAS and Google Flood Hub are NOT integrated. Access and licence
terms are unverified for each (docs/DATA_SOURCES.md). An adapter cannot be registered without a
recorded licence check, and its output is always stored as a forecast from that named source,
never as HydroSight's own skill."""

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol


@dataclass(frozen=True)
class ExternalForecast:
    station_code: str
    issued_at: datetime
    valid_from: datetime
    valid_to: datetime
    probability: float | None
    p10: float | None
    p50: float | None
    p90: float | None
    unit: str | None
    source_run_id: str  # the provider's own run or product id, kept for provenance


class ExternalModelAdapter(Protocol):
    name: str
    licence_note: str  # what was checked, when, and where (never empty)
    licence_verified: bool

    def fetch(self, station_codes: list[str], since: datetime) -> list[ExternalForecast]: ...


_REGISTRY: dict[str, ExternalModelAdapter] = {}


def register_adapter(adapter: ExternalModelAdapter) -> None:
    if not adapter.licence_verified or len(adapter.licence_note.strip()) < 20:
        raise ValueError(
            f"{adapter.name}: licence and access must be verified and recorded before integration"
        )
    if adapter.name in _REGISTRY:
        raise ValueError(f"{adapter.name} is already registered")
    _REGISTRY[adapter.name] = adapter


def registered() -> list[str]:
    return sorted(_REGISTRY)
