"""HS-COM-001..010: community reports, privacy, duplicate grouping, moderation, map, alert feedback.
Needs PostGIS (CI); skipped locally with a reason."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import psycopg
from conftest import World
from helpers import fails
from test_alerts import _add_user, _flow_to, _human_alert
from test_stations import _station

NoPerm = psycopg.errors.InsufficientPrivilege
BadInput = psycopg.errors.InvalidParameterValue
BadState = psycopg.errors.ObjectNotInPrerequisiteState
TooMany = psycopg.errors.ProgramLimitExceeded

LON, LAT = 32.58, 0.31
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xd9"
JPEG_WITH_EXIF = b"\xff\xd8\xff\xe1\x00\x20Exif\x00\x00MM\x00*GPS\xff\xd9"
CONSENT = "community-report-2026-11"


def _iso(delta: timedelta = timedelta()) -> str:
    return (datetime.now(UTC) + delta).isoformat()


def _open(w: World) -> None:
    w.db.su()
    w.db.run(
        "update public.organizations set community_reports_open = true where id = %s", (w.org_a,)
    )


def _leader(w: World) -> None:
    _add_user(w, "leo", "community_leader")
    _add_user(w, "mia", "community_leader")


def _ids(res: dict[str, Any]) -> dict[str, Any]:
    """jsonb returns ids as text; tests compare them with uuid columns."""
    return {k: (uuid.UUID(v) if k in ("id", "grouped_with") and v else v) for k, v in res.items()}


def _submit(w: World, who: str | None = "dave", *, kind: str = "flooding", dlat: float = 0.0,
            observed: timedelta = timedelta(minutes=-5), anonymous: bool = False,
            photo: bytes | None = None, consent: str | None = CONSENT,
            client_id: Any = None, org: Any = None) -> dict[str, Any]:  # fmt: skip
    """who=None means the public endpoint (service role, no account)."""
    cid = client_id or uuid.uuid4()
    org = org or w.org_a
    ptype = "image/jpeg" if photo is not None else None
    if who is None:
        w.db.service()
        return _ids(
            w.db.one(
                "select public.submit_public_community_report(%s, %s, %s, 'water in the road', 40, %s, %s, 15,"
                " %s::timestamptz, %s, %s::bytea, %s)",
                (org, cid, kind, LON, LAT + dlat, _iso(observed), consent, photo, ptype),
            )
        )
    w.as_(who)
    return _ids(
        w.db.one(
            "select public.submit_community_report(%s, %s, %s, 'water in the road', 40, %s, %s, 15,"
            " %s::timestamptz, %s, %s, %s::bytea, %s)",
            (org, cid, kind, LON, LAT + dlat, _iso(observed), consent, anonymous, photo, ptype),
        )
    )


def _row(w: World, rid: Any) -> tuple[Any, ...]:
    w.db.su()
    return w.db.q(
        "select status, source_type::text, reporter_user_id, anonymous, duplicate_of, consent_version"
        " from public.community_reports where id = %s",
        (rid,),
    )[0]


def _moderate(w: World, who: str, rid: Any, action: str, note: str = "checked with the village chair",
              evidence: str | None = "call log 2026-11-21") -> None:  # fmt: skip
    w.as_(who)
    w.db.q("select public.moderate_community_report(%s, %s, %s, %s)", (rid, action, note, evidence))


def test_org_must_open_community_reports(geo_world: World) -> None:
    w = geo_world
    w.as_("dave")
    fails(
        w.db,
        NoPerm,
        "select public.submit_community_report(%s, %s, 'flooding', null, null, 32.5, 0.3, null,"
        " now(), %s, false, null, null)",
        (w.org_a, uuid.uuid4(), CONSENT),
    )
    w.as_("dave")
    fails(w.db, NoPerm, "select public.set_community_reports_open(%s, true)", (w.org_a,))
    w.as_("alice")
    w.db.q("select public.set_community_reports_open(%s, true)", (w.org_a,))
    assert _submit(w)["status"] == "received"


def test_signed_in_report_is_community_and_unvalidated(geo_world: World) -> None:
    w = geo_world
    _open(w)
    res = _submit(w, "dave")
    status, source, reporter, anonymous, dup, consent = _row(w, res["id"])
    assert (status, source, anonymous, dup, consent) == (
        "unvalidated",
        "community",
        False,
        None,
        CONSENT,
    )
    assert reporter == w.users["dave"]


def test_anonymous_choice_stores_no_user_id(geo_world: World) -> None:
    w = geo_world
    _open(w)
    _, _, reporter, anonymous, _, _ = _row(w, _submit(w, "dave", anonymous=True)["id"])
    assert reporter is None and anonymous is True


def test_public_endpoint_is_service_only_and_anonymous(geo_world: World) -> None:
    w = geo_world
    _open(w)
    res = _submit(w, None)
    _, _, reporter, anonymous, _, _ = _row(w, res["id"])
    assert reporter is None and anonymous is True
    for role in ("anon", "as_dave"):
        if role == "anon":
            w.db.anon()
        else:
            w.as_("dave")
        fails(
            w.db,
            NoPerm,
            "select public.submit_public_community_report(%s, %s, 'flooding', null, null, 32.5, 0.3, null,"
            " now(), %s, null, null)",
            (w.org_a, uuid.uuid4(), CONSENT),
        )


def test_submitter_cannot_set_status_or_write_directly(geo_world: World) -> None:
    w = geo_world
    _open(w)
    w.as_("dave")
    fails(
        w.db,
        NoPerm,
        "insert into public.community_reports (org_id, client_id, anonymous, kind, location, observed_at,"
        " consent_version, status) values (%s, %s, false, 'flooding',"
        " extensions.st_setsrid(extensions.st_makepoint(32.5, 0.3), 4326), now(), 'v', 'validated')",
        (w.org_a, uuid.uuid4()),
    )
    rid = _submit(w, "dave")["id"]
    w.as_("dave")
    fails(
        w.db,
        NoPerm,
        "update public.community_reports set status = 'validated' where id = %s",
        (rid,),
    )


def test_submitted_content_cannot_be_edited_even_by_the_owner_role(geo_world: World) -> None:
    w = geo_world
    _open(w)
    rid = _submit(w)["id"]
    w.db.su()
    fails(
        w.db,
        BadState,
        "update public.community_reports set description = 'changed' where id = %s",
        (rid,),
    )
    fails(
        w.db, BadState, "update public.community_reports set kind = 'other' where id = %s", (rid,)
    )


def test_same_client_id_is_idempotent(geo_world: World) -> None:
    w = geo_world
    _open(w)
    cid = uuid.uuid4()
    first = _submit(w, client_id=cid)
    again = _submit(w, client_id=cid)
    assert again["status"] == "already_received" and again["id"] == first["id"]
    w.db.su()
    assert w.db.one("select count(*) from public.community_reports") == 1


def test_consent_is_required_and_recorded(geo_world: World) -> None:
    w = geo_world
    _open(w)
    w.as_("dave")
    fails(
        w.db,
        BadInput,
        "select public.submit_community_report(%s, %s, 'flooding', null, null, 32.5, 0.3, null, now(), %s,"
        " false, null, null)",
        (w.org_a, uuid.uuid4(), "  "),
    )
    rid = _submit(w)["id"]
    w.db.su()
    assert (
        w.db.one("select consent_at from public.community_reports where id = %s", (rid,))
        is not None
    )


def test_time_and_location_are_validated(geo_world: World) -> None:
    w = geo_world
    _open(w)
    for delta in (timedelta(hours=1), timedelta(days=-15)):
        w.as_("dave")
        fails(
            w.db,
            BadInput,
            "select public.submit_community_report(%s, %s, 'flooding', null, null, 32.5, 0.3, null,"
            " %s::timestamptz, %s, false, null, null)",
            (w.org_a, uuid.uuid4(), _iso(delta), CONSENT),
        )
    w.as_("dave")
    fails(
        w.db,
        BadInput,
        "select public.submit_community_report(%s, %s, 'flooding', null, null, 200, 0.3, null, now(), %s,"
        " false, null, null)",
        (w.org_a, uuid.uuid4(), CONSENT),
    )
    # an old report from a phone that was offline for days is accepted
    assert _submit(w, observed=timedelta(days=-3))["status"] == "received"


def test_offline_report_keeps_its_observed_time(geo_world: World) -> None:
    w = geo_world
    _open(w)
    rid = _submit(w, observed=timedelta(hours=-30))["id"]
    w.db.su()
    age = w.db.one(
        "select extract(epoch from now() - observed_at) from public.community_reports where id = %s",
        (rid,),
    )
    assert age > 29 * 3600


def test_nearby_same_kind_reports_are_grouped_not_dropped(geo_world: World) -> None:
    w = geo_world
    _open(w)
    first = _submit(w, "dave")
    near = _submit(
        w, None, dlat=0.001, observed=timedelta(minutes=-20)
    )  # about 110 m, 15 min apart
    far = _submit(w, None, dlat=0.003)  # about 330 m
    other_kind = _submit(w, None, kind="blocked_drainage")
    later = _submit(w, None, observed=timedelta(hours=-3))
    assert _row(w, near["id"])[4] == first["id"]
    assert near["grouped_with"] == first["id"]
    assert _row(w, far["id"])[4] is None
    assert _row(w, other_kind["id"])[4] is None
    assert _row(w, later["id"])[4] is None
    w.db.su()
    assert w.db.one("select count(*) from public.community_reports") == 5


def test_photo_is_stored_and_visible_to_moderators_only(geo_world: World) -> None:
    w = geo_world
    _open(w)
    _leader(w)
    rid = _submit(w, photo=JPEG)["id"]
    w.as_("leo")
    assert w.db.one("select count(*) from public.report_photos where report_id = %s", (rid,)) == 1
    w.as_("dave")
    assert w.db.one("select count(*) from public.report_photos") == 0
    w.as_("carol")
    assert w.db.one("select count(*) from public.report_photos") == 0


def test_photo_with_exif_or_wrong_type_or_too_big_is_refused(geo_world: World) -> None:
    w = geo_world
    _open(w)
    w.as_("dave")
    sql = (
        "select public.submit_community_report(%s, %s, 'flooding', null, null, 32.5, 0.3, null, now(), %s,"
        " false, %s::bytea, %s)"
    )
    fails(w.db, BadInput, sql, (w.org_a, uuid.uuid4(), CONSENT, JPEG_WITH_EXIF, "image/jpeg"))
    fails(w.db, BadInput, sql, (w.org_a, uuid.uuid4(), CONSENT, JPEG, "application/pdf"))
    fails(
        w.db, BadInput, sql, (w.org_a, uuid.uuid4(), CONSENT, JPEG + b"0" * 1_048_577, "image/jpeg")
    )


def test_rate_cap_for_anonymous_reports(geo_world: World) -> None:
    w = geo_world
    _open(w)
    w.db.su()
    w.db.run(
        "insert into public.community_reports (org_id, client_id, anonymous, kind, location, observed_at, consent_version)"
        " select %s, gen_random_uuid(), true, 'other',"
        " extensions.st_setsrid(extensions.st_makepoint(30 + i * 0.01, 1), 4326), now(), 'v'"
        " from generate_series(1, 120) i",
        (w.org_a,),
    )
    w.db.service()
    fails(
        w.db,
        TooMany,
        "select public.submit_public_community_report(%s, %s, 'flooding', null, null, 32.5, 0.3, null, now(),"
        " %s, null, null)",
        (w.org_a, uuid.uuid4(), CONSENT),
    )


def test_only_moderators_validate_with_evidence_and_not_their_own(geo_world: World) -> None:
    w = geo_world
    _open(w)
    _leader(w)
    rid = _submit(w, "dave")["id"]
    for who in ("dave", "carol", "eve", "alice"):  # none hold community.moderate
        w.as_(who)
        fails(
            w.db,
            NoPerm,
            "select public.moderate_community_report(%s, 'validate', 'looks right', 'ref-1')",
            (rid,),
        )
    w.as_("leo")
    fails(
        w.db,
        BadInput,
        "select public.moderate_community_report(%s, 'validate', 'looks right', null)",
        (rid,),
    )
    fails(
        w.db,
        BadInput,
        "select public.moderate_community_report(%s, 'validate', 'ok', 'ab')",
        (rid,),
    )
    fails(
        w.db,
        BadInput,
        "select public.moderate_community_report(%s, 'validate', '', 'ref-1')",
        (rid,),
    )
    assert _row(w, rid)[0] == "unvalidated"
    _moderate(w, "leo", rid, "validate")
    status, source, *_ = _row(w, rid)
    assert (status, source) == (
        "validated",
        "community",
    )  # still labelled community, never measured


def test_moderator_cannot_validate_own_report(geo_world: World) -> None:
    w = geo_world
    _open(w)
    _leader(w)
    rid = _submit(w, "leo")["id"]
    w.as_("leo")
    fails(
        w.db,
        NoPerm,
        "select public.moderate_community_report(%s, 'validate', 'mine is fine', 'ref-1')",
        (rid,),
    )
    _moderate(w, "mia", rid, "validate")
    assert _row(w, rid)[0] == "validated"


def test_moderation_history_is_append_only_and_reopen_works(geo_world: World) -> None:
    w = geo_world
    _open(w)
    _leader(w)
    rid = _submit(w, "dave")["id"]
    _moderate(w, "leo", rid, "validate")
    _moderate(w, "mia", rid, "reopen", "new information came in", None)
    _moderate(w, "mia", rid, "reject", "could not be confirmed", None)
    w.db.su()
    assert [
        r[0]
        for r in w.db.q(
            "select action from public.report_moderation_events where report_id = %s order by id",
            (rid,),
        )
    ] == ["validate", "reopen", "reject"]
    fails(w.db, NoPerm, "update public.report_moderation_events set note = 'x'")
    fails(w.db, NoPerm, "delete from public.report_moderation_events")
    assert _row(w, rid)[0] == "rejected"


def test_validated_report_needs_evidence_at_the_table_level(geo_world: World) -> None:
    w = geo_world
    _open(w)
    rid = _submit(w, "dave")["id"]
    w.db.su()
    fails(
        w.db,
        psycopg.errors.CheckViolation,
        "update public.community_reports set status = 'validated' where id = %s",
        (rid,),
    )


def test_tenant_isolation(geo_world: World) -> None:
    w = geo_world
    _open(w)
    _leader(w)
    rid = _submit(w, "dave", photo=JPEG)["id"]
    w.as_("bob")
    assert w.db.one("select count(*) from public.community_reports") == 0
    assert w.db.one("select count(*) from public.report_photos") == 0
    fails(
        w.db,
        NoPerm,
        "select public.moderate_community_report(%s, 'reject', 'not yours', null)",
        (rid,),
    )
    fails(w.db, NoPerm, "select * from public.community_moderation_queue(%s)", (w.org_a,))
    fails(w.db, NoPerm, "select * from public.community_reports_on_map(%s)", (w.org_a,))
    # a member of another organisation cannot file into this one
    w.as_("bob")
    fails(
        w.db,
        NoPerm,
        "select public.submit_community_report(%s, %s, 'flooding', null, null, 32.5, 0.3, null, now(), %s,"
        " false, null, null)",
        (w.org_a, uuid.uuid4(), CONSENT),
    )


def test_reporters_see_only_their_own_reports(geo_world: World) -> None:
    w = geo_world
    _open(w)
    _add_user(w, "ned", "community_member")
    _submit(w, "dave")
    _submit(w, "ned", dlat=0.05)
    w.as_("dave")
    assert w.db.one("select count(*) from public.community_reports") == 1
    w.as_("carol")  # hydrologist holds reports.read
    assert w.db.one("select count(*) from public.community_reports") == 2


def test_map_shows_unvalidated_reports_labelled_community(geo_world: World) -> None:
    w = geo_world
    _open(w)
    _leader(w)
    first = _submit(w, "dave", photo=JPEG)
    _submit(w, None, dlat=0.001, observed=timedelta(minutes=-10))  # grouped under first
    gone = _submit(w, None, kind="dangerous_road", dlat=0.02)
    _moderate(w, "leo", gone["id"], "reject", "photo shows a different place", None)
    w.as_("dave")
    rows = w.db.q(
        "select id, status, source_type::text, corroborations, has_photo, trust_signals"
        " from public.community_reports_on_map(%s)",
        (w.org_a,),
    )
    assert len(rows) == 1  # rejected hidden, duplicate folded into the first
    rid, status, source, corroborations, has_photo, signals = rows[0]
    assert (rid, status, source, corroborations, has_photo) == (
        first["id"],
        "unvalidated",
        "community",
        1,
        True,
    )
    assert signals["signed_in"] is True and signals["corroborating_reports"] == 1
    assert signals["reporter_validated_reports"] == 0


def test_map_hides_old_reports(geo_world: World) -> None:
    w = geo_world
    _open(w)
    _submit(w, observed=timedelta(hours=-100))
    w.as_("dave")
    assert w.db.q("select * from public.community_reports_on_map(%s)", (w.org_a,)) == []
    assert len(w.db.q("select * from public.community_reports_on_map(%s, 200)", (w.org_a,))) == 1


def test_moderation_queue_groups_duplicates(geo_world: World) -> None:
    w = geo_world
    _open(w)
    _leader(w)
    first = _submit(w, "dave")
    _submit(w, None, dlat=0.001)
    w.as_("leo")
    rows = w.db.q(
        "select id, group_size, duplicate_of from public.community_moderation_queue(%s)", (w.org_a,)
    )
    assert len(rows) == 2 and all(r[1] == 2 for r in rows)
    assert {r[2] for r in rows} == {None, first["id"]}
    w.as_("dave")
    fails(w.db, NoPerm, "select * from public.community_moderation_queue(%s)", (w.org_a,))


def test_reporter_can_withdraw_unvalidated_report_only(geo_world: World) -> None:
    w = geo_world
    _open(w)
    _leader(w)
    mine = _submit(w, "dave")["id"]
    other = _submit(w, "leo", dlat=0.5)["id"]
    w.as_("dave")
    fails(w.db, NoPerm, "select public.withdraw_community_report(%s)", (other,))
    w.db.q("select public.withdraw_community_report(%s)", (mine,))
    w.db.su()
    assert w.db.one("select count(*) from public.community_reports where id = %s", (mine,)) == 0
    _moderate(w, "mia", other, "validate")
    w.as_("leo")
    fails(w.db, BadState, "select public.withdraw_community_report(%s)", (other,))


def _published_public_alert(w: World) -> Any:
    w.as_("alice")
    st = _station(w, w.org_a, "C-1")
    alert = _human_alert(w, "carol", st)
    _flow_to(w, alert, "published")
    return alert


def test_alert_feedback_confirm_and_dispute_never_change_the_alert(geo_world: World) -> None:
    w = geo_world
    alert = _published_public_alert(w)
    w.as_("dave")
    w.db.q("select public.give_alert_feedback(%s, 'confirm', 'water is rising here')", (alert,))
    _add_user(w, "ned", "community_member")
    w.as_("ned")
    w.db.q("select public.give_alert_feedback(%s, 'dispute', null)", (alert,))
    assert w.db.q("select confirms, disputes from public.alert_feedback_summary(%s)", (alert,)) == [
        (1, 1)
    ]
    w.as_("dave")  # changing your mind replaces your answer, it does not add a vote
    w.db.q("select public.give_alert_feedback(%s, 'dispute', null)", (alert,))
    assert w.db.q("select confirms, disputes from public.alert_feedback_summary(%s)", (alert,)) == [
        (0, 2)
    ]
    w.db.su()
    assert w.db.one("select status::text from public.alerts where id = %s", (alert,)) == "published"
    w.as_("dave")
    fails(w.db, BadInput, "select public.give_alert_feedback(%s, 'maybe', null)", (alert,))


def test_alert_feedback_only_on_published_public_alerts_in_own_org(geo_world: World) -> None:
    w = geo_world
    w.as_("alice")
    st = _station(w, w.org_a, "C-2")
    internal = _human_alert(w, "carol", st, audience="internal")
    draft = _human_alert(w, "carol", st)
    w.as_("dave")
    fails(w.db, NoPerm, "select public.give_alert_feedback(%s, 'confirm', null)", (internal,))
    fails(w.db, NoPerm, "select public.give_alert_feedback(%s, 'confirm', null)", (draft,))
    published = _published_public_alert(w)
    w.as_("bob")
    fails(w.db, NoPerm, "select public.give_alert_feedback(%s, 'confirm', null)", (published,))
    w.db.anon()
    fails(w.db, NoPerm, "select public.give_alert_feedback(%s, 'confirm', null)", (published,))


def test_feedback_rows_are_visible_to_the_owner_and_warning_staff_only(geo_world: World) -> None:
    w = geo_world
    alert = _published_public_alert(w)
    w.as_("dave")
    w.db.q("select public.give_alert_feedback(%s, 'confirm', 'seen it')", (alert,))
    _add_user(w, "ned", "community_member")
    w.as_("ned")
    assert w.db.one("select count(*) from public.alert_feedback") == 0
    w.as_("dave")
    assert w.db.one("select count(*) from public.alert_feedback") == 1
    w.as_("carol")
    assert w.db.one("select count(*) from public.alert_feedback") == 1


def _resource(w: World, who: str = "leo") -> Any:
    w.as_(who)
    return w.db.one(
        "select public.add_community_resource(%s, 'safe_location', 'Parish hall', 'Open 24h', '+256700000000',"
        " 32.58, 0.31)",
        (w.org_a,),
    )


def test_resources_publish_needs_a_second_person_and_evidence(geo_world: World) -> None:
    w = geo_world
    _leader(w)
    rid = _resource(w, "leo")
    w.as_("leo")
    fails(
        w.db,
        NoPerm,
        "select public.publish_community_resource(%s, 'site visit 2026-11-21')",
        (rid,),
    )
    w.as_("mia")
    fails(w.db, BadInput, "select public.publish_community_resource(%s, null)", (rid,))
    w.db.q("select public.publish_community_resource(%s, 'site visit 2026-11-21')", (rid,))
    w.as_("dave")
    assert w.db.one("select count(*) from public.community_resources") == 1
    w.as_("mia")
    w.db.q("select public.unpublish_community_resource(%s)", (rid,))
    w.as_("dave")
    assert w.db.one("select count(*) from public.community_resources") == 0


def test_resources_are_moderator_managed_and_tenant_isolated(geo_world: World) -> None:
    w = geo_world
    _leader(w)
    w.as_("dave")
    fails(
        w.db,
        NoPerm,
        "select public.add_community_resource(%s, 'safe_location', 'Hall', null, null, null, null)",
        (w.org_a,),
    )
    rid = _resource(w, "leo")
    w.as_("bob")
    assert w.db.one("select count(*) from public.community_resources") == 0
    fails(w.db, NoPerm, "select public.publish_community_resource(%s, 'looked at it')", (rid,))
    w.as_("dave")  # an unpublished resource is invisible to ordinary members
    assert w.db.one("select count(*) from public.community_resources") == 0
