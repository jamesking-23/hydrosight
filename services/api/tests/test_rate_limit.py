"""HS-SEC-001: ingestion is rate limited per API key and overall, by a database counter."""

from typing import Any

import psycopg
import pytest
from conftest import World
from helpers import fails

from hydrosight_api.config import Settings
from hydrosight_api.ingest import rate_allowed


class _Cur:
    def __init__(self, v: Any) -> None:
        self.v = v

    def fetchone(self) -> Any:
        return self.v


class _Tx:
    def __enter__(self) -> None:
        return None

    def __exit__(self, *a: Any) -> bool:
        return False


class _Conn:
    """Stands in for a connection: a scripted answer per call, and a record of the keys used."""

    def __init__(self, answers: list[Any], boom: bool = False) -> None:
        self.answers, self.calls, self.boom = answers, [], boom

    def transaction(self) -> _Tx:
        return _Tx()

    def execute(self, sql: str, params: tuple[Any, ...]) -> _Cur:
        if self.boom:
            raise psycopg.OperationalError("down")
        self.calls.append(params)
        return _Cur((self.answers.pop(0),))


S = Settings(rate_limit_per_key_per_min=5, rate_limit_global_per_min=50)


def test_allowed_when_both_buckets_have_room_and_key_is_hashed() -> None:
    c = _Conn([True, True])
    assert rate_allowed(c, S, "hsk_secret") is True
    assert c.calls[0] == (c.calls[0][0], 5) and "hsk_secret" not in c.calls[0][0]
    assert c.calls[1] == (50,)


@pytest.mark.parametrize("answers", [[False, True], [True, False], [False, False]])
def test_refused_when_either_bucket_is_full(answers: list[bool]) -> None:
    assert rate_allowed(_Conn(answers), S, "k") is False


def test_fails_open_if_the_counter_is_unreadable() -> None:
    assert rate_allowed(_Conn([], boom=True), S, "k") is True


def test_counter_function_counts_and_refuses_over_the_limit(world: World) -> None:
    w = world
    w.db.su()
    got = [w.db.one("select public.rate_hit('t:a', 3, 60)") for _ in range(5)]
    assert got == [True, True, True, False, False]
    assert w.db.one("select public.rate_hit('t:b', 3, 60)") is True  # separate bucket
    fails(w.db, psycopg.errors.InvalidParameterValue, "select public.rate_hit('t:c', 0, 60)")


def test_counters_are_closed_to_ordinary_roles(world: World) -> None:
    w = world
    w.as_("alice")
    fails(w.db, psycopg.errors.InsufficientPrivilege, "select public.rate_hit('x', 1, 60)")
    fails(w.db, psycopg.errors.InsufficientPrivilege, "select * from public.rate_counters")
    w.db.anon()
    fails(w.db, psycopg.errors.InsufficientPrivilege, "select public.rate_hit('x', 1, 60)")
