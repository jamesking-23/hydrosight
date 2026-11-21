-- requires: postgis
-- 0008: community intelligence (Phase 5): flood reports from the community, privacy-preserving
-- photo storage, duplicate grouping, moderation, alert confirm/dispute.
--
-- Safety rules enforced HERE, not in the app:
--  * A community report is always source_type 'community' and starts 'unvalidated'. Nobody can
--    submit a different status or source. Only a moderator (community.moderate) can validate, with
--    an evidence reference, and never their own report. Moderation history is append-only.
--  * Anonymous reports store no user id. No IP address or device string is stored at all.
--  * Consent is recorded (version + time) on every report.
--  * Photos must have no EXIF block (the API strips it; the database refuses it if one remains).
--  * Duplicates are grouped by proximity and time, never silently dropped.
--  * Alert confirm/dispute is feedback only: it never changes an alert's status.
-- Duplicate distance (200 m) and window (60 min), and the rate caps, are UNVERIFIED defaults.

alter table public.organizations
  add column community_reports_open boolean not null default false;
-- Demo organisation only (synthetic data): open so the flow can be shown end to end.
update public.organizations set community_reports_open = true where is_demo;

create table public.community_reports (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations (id) on delete cascade,
  client_id         uuid not null,                       -- made on the device: a retry never duplicates
  reporter_user_id  uuid references auth.users (id) on delete set null,
  anonymous         boolean not null,
  kind              text not null check (kind in
                      ('flooding', 'water_level', 'blocked_drainage', 'damaged_infrastructure',
                       'dangerous_road', 'other')),
  description       text check (description is null or length(description) <= 1000),
  water_depth_cm    numeric check (water_depth_cm is null or water_depth_cm between 0 and 1000),
  location          extensions.geometry(Point, 4326) not null,
  location_accuracy_m numeric check (location_accuracy_m is null or location_accuracy_m between 0 and 100000),
  observed_at       timestamptz not null,
  created_at        timestamptz not null default now(),
  source_type       public.source_type not null default 'community' check (source_type = 'community'),
  status            text not null default 'unvalidated' check (status in ('unvalidated', 'validated', 'rejected')),
  duplicate_of      uuid references public.community_reports (id) on delete set null,
  consent_version   text not null check (length(btrim(consent_version)) between 1 and 60),
  consent_at        timestamptz not null default now(),
  moderated_by      uuid,
  moderated_at      timestamptz,
  moderation_note   text,
  evidence_ref      text,
  unique (org_id, client_id),
  check (not anonymous or reporter_user_id is null),
  check (status <> 'validated' or (moderated_by is not null and length(btrim(coalesce(evidence_ref, ''))) >= 3))
);
create index community_reports_org_idx on public.community_reports (org_id, status, observed_at desc);
create index community_reports_geom_gix on public.community_reports using gist (location);
create index community_reports_dup_idx on public.community_reports (duplicate_of) where duplicate_of is not null;

create table public.report_photos (
  report_id     uuid primary key references public.community_reports (id) on delete cascade,
  org_id        uuid not null,
  content_type  text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes    integer not null check (size_bytes between 1 and 1048576),
  sha256        text not null,
  data          bytea not null
);

create table public.report_moderation_events (
  id          bigint generated always as identity primary key,
  report_id   uuid not null,
  org_id      uuid not null,
  action      text not null check (action in ('validate', 'reject', 'reopen')),
  actor_id    uuid not null,
  note        text not null check (length(btrim(note)) >= 3),
  evidence_ref text,
  created_at  timestamptz not null default now()
);
create index report_moderation_events_idx on public.report_moderation_events (report_id, created_at);
create trigger report_moderation_events_append_only before update or delete on public.report_moderation_events
  for each row execute function private.forbid_change();

-- Only the moderation fields may change, and only through the moderation function.
create function private.community_reports_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if (new.id, new.org_id, new.client_id, new.reporter_user_id, new.anonymous, new.kind, new.description,
      new.water_depth_cm, extensions.st_asewkb(new.location), new.location_accuracy_m, new.observed_at, new.created_at,
      new.source_type, new.consent_version, new.consent_at)
     is distinct from
     (old.id, old.org_id, old.client_id, old.reporter_user_id, old.anonymous, old.kind, old.description,
      old.water_depth_cm, extensions.st_asewkb(old.location), old.location_accuracy_m, old.observed_at, old.created_at,
      old.source_type, old.consent_version, old.consent_at) then
    raise exception 'a submitted report cannot be edited; only moderation fields change' using errcode = '55000';
  end if;
  return new;
end $$;
create trigger community_reports_guard before update on public.community_reports
  for each row execute function private.community_reports_guard();

create table public.alert_feedback (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,
  alert_id   uuid not null references public.alerts (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  stance     text not null check (stance in ('confirm', 'dispute')),
  note       text check (note is null or length(note) <= 500),
  created_at timestamptz not null default now(),
  unique (alert_id, user_id)
);

alter table public.community_reports        enable row level security;
alter table public.report_photos            enable row level security;
alter table public.report_moderation_events enable row level security;
alter table public.alert_feedback           enable row level security;
revoke all on public.community_reports, public.report_photos, public.report_moderation_events,
  public.alert_feedback from anon, authenticated, service_role;
grant select on public.community_reports, public.report_photos, public.report_moderation_events,
  public.alert_feedback to authenticated, service_role;

create policy community_reports_select on public.community_reports for select to authenticated
  using (private.has_permission(org_id, 'community.moderate') or private.has_permission(org_id, 'reports.read')
         or reporter_user_id = (select auth.uid()));
create policy report_photos_select on public.report_photos for select to authenticated
  using (private.has_permission(org_id, 'community.moderate'));
create policy report_moderation_events_select on public.report_moderation_events for select to authenticated
  using (private.has_permission(org_id, 'community.moderate') or private.has_permission(org_id, 'reports.read'));
create policy alert_feedback_select on public.alert_feedback for select to authenticated
  using (user_id = (select auth.uid()) or private.has_permission(org_id, 'warnings.draft')
         or private.has_permission(org_id, 'warnings.review') or private.has_permission(org_id, 'warnings.approve'));

-- ---------------------------------------------------------------------------------------------
-- Submitting
-- ---------------------------------------------------------------------------------------------
create function private.insert_community_report(
  p_org uuid, p_user uuid, p_anonymous boolean, p_client_id uuid, p_kind text, p_description text,
  p_depth_cm numeric, p_lon double precision, p_lat double precision, p_accuracy_m numeric,
  p_observed_at timestamptz, p_consent_version text, p_photo bytea, p_photo_type text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_id    uuid;
  v_loc   extensions.geometry;
  v_root  uuid;
  v_rows  integer;
  v_recent integer;
  v_cap    integer := case when p_user is null then 120 else 30 end;
begin
  if not exists (select 1 from public.organizations where id = p_org and community_reports_open) then
    raise exception 'this organisation is not accepting community reports' using errcode = '42501';
  end if;
  if p_client_id is null or p_kind is null or p_observed_at is null or p_lon is null or p_lat is null then
    raise exception 'client_id, kind, observed_at and location are required' using errcode = '22023';
  end if;
  if p_lon not between -180 and 180 or p_lat not between -90 and 90 then
    raise exception 'location is outside the valid range' using errcode = '22023';
  end if;
  if p_observed_at > now() + interval '5 minutes' then
    raise exception 'observed_at is in the future' using errcode = '22023';
  end if;
  if p_observed_at < now() - interval '14 days' then
    raise exception 'observed_at is more than 14 days old' using errcode = '22023';
  end if;
  if p_consent_version is null or btrim(p_consent_version) = '' then
    raise exception 'consent is required to submit a report' using errcode = '22023';
  end if;
  if p_photo is not null then
    if p_photo_type is null or p_photo_type not in ('image/jpeg', 'image/png', 'image/webp') then
      raise exception 'photo must be jpeg, png or webp' using errcode = '22023';
    end if;
    if length(p_photo) > 1048576 then
      raise exception 'photo is larger than 1 MB' using errcode = '22023';
    end if;
    -- Defence in depth: the API strips metadata. Refuse any file that still carries an EXIF block.
    if position('\x45786966'::bytea in substring(p_photo from 1 for 65536)) > 0 then
      raise exception 'photo still contains EXIF metadata; it must be stripped before upload' using errcode = '22023';
    end if;
  end if;

  -- Idempotent: the same client_id returns the report already stored.
  select id into v_id from public.community_reports where org_id = p_org and client_id = p_client_id;
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'status', 'already_received');
  end if;

  -- Brake on floods of reports (spam or a runaway client). UNVERIFIED defaults.
  select count(*) into v_recent from public.community_reports
   where org_id = p_org and created_at > now() - interval '1 hour'
     and (case when p_user is null then reporter_user_id is null else reporter_user_id = p_user end);
  if v_recent >= v_cap then
    raise exception 'too many reports received; try again later' using errcode = '54000';
  end if;

  v_loc := extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326);

  -- Same kind, within 200 m and 60 minutes of an existing report: group under the earliest one.
  select r.id into v_root from public.community_reports r
   where r.org_id = p_org and r.kind = p_kind and r.status <> 'rejected' and r.duplicate_of is null
     and r.observed_at between p_observed_at - interval '60 minutes' and p_observed_at + interval '60 minutes'
     and extensions.st_dwithin(r.location::extensions.geography, v_loc::extensions.geography, 200)
   order by r.observed_at, r.created_at limit 1;

  insert into public.community_reports (org_id, client_id, reporter_user_id, anonymous, kind, description,
      water_depth_cm, location, location_accuracy_m, observed_at, consent_version, duplicate_of)
  values (p_org, p_client_id, case when p_anonymous then null else p_user end, p_anonymous or p_user is null,
      p_kind, nullif(btrim(p_description), ''), p_depth_cm, v_loc, p_accuracy_m, p_observed_at,
      btrim(p_consent_version), v_root)
  on conflict (org_id, client_id) do nothing
  returning id into v_id;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    select id into v_id from public.community_reports where org_id = p_org and client_id = p_client_id;
    return jsonb_build_object('id', v_id, 'status', 'already_received');
  end if;

  if p_photo is not null then
    insert into public.report_photos (report_id, org_id, content_type, size_bytes, sha256, data)
    values (v_id, p_org, p_photo_type, length(p_photo), encode(sha256(p_photo), 'hex'), p_photo);
  end if;
  return jsonb_build_object('id', v_id, 'status', 'received', 'grouped_with', v_root);
end $$;
revoke all on function private.insert_community_report(uuid, uuid, boolean, uuid, text, text, numeric,
  double precision, double precision, numeric, timestamptz, text, bytea, text) from public, anon, authenticated, service_role;

-- Signed-in member (optionally reporting anonymously: then no user id is stored).
create function public.submit_community_report(
  p_org uuid, p_client_id uuid, p_kind text, p_description text, p_depth_cm numeric,
  p_lon double precision, p_lat double precision, p_accuracy_m numeric, p_observed_at timestamptz,
  p_consent_version text, p_anonymous boolean default false, p_photo bytea default null,
  p_photo_type text default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not private.has_permission(p_org, 'org.read') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return private.insert_community_report(p_org, auth.uid(), coalesce(p_anonymous, false), p_client_id, p_kind,
    p_description, p_depth_cm, p_lon, p_lat, p_accuracy_m, p_observed_at, p_consent_version, p_photo, p_photo_type);
end $$;

-- Public (no account): only the API's service role can call this. Always anonymous.
create function public.submit_public_community_report(
  p_org uuid, p_client_id uuid, p_kind text, p_description text, p_depth_cm numeric,
  p_lon double precision, p_lat double precision, p_accuracy_m numeric, p_observed_at timestamptz,
  p_consent_version text, p_photo bytea default null, p_photo_type text default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  return private.insert_community_report(p_org, null, true, p_client_id, p_kind, p_description, p_depth_cm,
    p_lon, p_lat, p_accuracy_m, p_observed_at, p_consent_version, p_photo, p_photo_type);
end $$;

-- A signed-in reporter can withdraw their own report (not once a moderator has validated it).
create function public.withdraw_community_report(p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare r public.community_reports;
begin
  select * into r from public.community_reports where id = p_id for update;
  if not found or auth.uid() is null or r.reporter_user_id is distinct from auth.uid() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if r.status = 'validated' then
    raise exception 'a validated report cannot be withdrawn here; ask the organisation to remove it'
      using errcode = '55000';
  end if;
  delete from public.community_reports where id = p_id;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Moderation
-- ---------------------------------------------------------------------------------------------
create function public.moderate_community_report(p_id uuid, p_action text, p_note text, p_evidence_ref text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare r public.community_reports; v_new text;
begin
  select * into r from public.community_reports where id = p_id for update;
  if not found or auth.uid() is null or not private.has_permission(r.org_id, 'community.moderate') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_note is null or length(btrim(p_note)) < 3 then
    raise exception 'a moderation note is required' using errcode = '22023';
  end if;
  if p_action = 'validate' then
    if p_evidence_ref is null or length(btrim(p_evidence_ref)) < 3 then
      raise exception 'validating a report needs an evidence reference' using errcode = '22023';
    end if;
    if r.reporter_user_id = auth.uid() then
      raise exception 'you cannot validate your own report' using errcode = '42501';
    end if;
    if r.status <> 'unvalidated' then
      raise exception 'only an unvalidated report can be validated (reopen it first)' using errcode = '55000';
    end if;
    v_new := 'validated';
  elsif p_action = 'reject' then
    if r.status = 'rejected' then raise exception 'already rejected' using errcode = '55000'; end if;
    v_new := 'rejected';
  elsif p_action = 'reopen' then
    if r.status = 'unvalidated' then raise exception 'already unvalidated' using errcode = '55000'; end if;
    v_new := 'unvalidated';
  else
    raise exception 'unknown action' using errcode = '22023';
  end if;
  update public.community_reports
     set status = v_new, moderated_by = auth.uid(), moderated_at = now(), moderation_note = btrim(p_note),
         evidence_ref = case when v_new = 'validated' then btrim(p_evidence_ref) else null end
   where id = p_id;
  insert into public.report_moderation_events (report_id, org_id, action, actor_id, note, evidence_ref)
  values (p_id, r.org_id, p_action, auth.uid(), btrim(p_note), nullif(btrim(coalesce(p_evidence_ref, '')), ''));
end $$;

-- Moderator queue: reports with their group size, oldest unvalidated first.
create function public.community_moderation_queue(p_org uuid, p_status text default 'unvalidated')
returns table (id uuid, kind text, description text, water_depth_cm numeric, lon double precision,
               lat double precision, observed_at timestamptz, created_at timestamptz, status text,
               anonymous boolean, has_photo boolean, duplicate_of uuid, group_size integer)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not private.has_permission(p_org, 'community.moderate') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
    select r.id, r.kind, r.description, r.water_depth_cm, extensions.st_x(r.location), extensions.st_y(r.location),
           r.observed_at, r.created_at, r.status, r.anonymous,
           exists (select 1 from public.report_photos ph where ph.report_id = r.id),
           r.duplicate_of,
           1 + (select count(*)::integer from public.community_reports d where d.duplicate_of = coalesce(r.duplicate_of, r.id)
                 and d.id <> r.id) + case when r.duplicate_of is null then 0 else 0 end
      from public.community_reports r
     where r.org_id = p_org and r.status = p_status
     order by r.created_at;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Map: unvalidated reports are shown, clearly labelled, with simple trust SIGNALS (not a score).
-- ---------------------------------------------------------------------------------------------
create function public.community_reports_on_map(p_org uuid, p_hours integer default 72)
returns table (id uuid, kind text, lon double precision, lat double precision, water_depth_cm numeric,
               observed_at timestamptz, status text, source_type public.source_type,
               corroborations integer, has_photo boolean, trust_signals jsonb)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not (private.has_permission(p_org, 'org.read') or private.is_demo_org(p_org)) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
    select r.id, r.kind, extensions.st_x(r.location), extensions.st_y(r.location), r.water_depth_cm,
           r.observed_at, r.status, r.source_type,
           (select count(*)::integer from public.community_reports d where d.duplicate_of = r.id and d.status <> 'rejected'),
           exists (select 1 from public.report_photos ph where ph.report_id = r.id),
           jsonb_build_object(
             'signed_in', not r.anonymous,
             'has_photo', exists (select 1 from public.report_photos ph where ph.report_id = r.id),
             'location_accuracy_m', r.location_accuracy_m,
             'corroborating_reports', (select count(*) from public.community_reports d
                                        where d.duplicate_of = r.id and d.status <> 'rejected'),
             'reporter_validated_reports', case when r.anonymous then null else
               (select count(*) from public.community_reports o where o.reporter_user_id = r.reporter_user_id
                   and o.status = 'validated') end)
      from public.community_reports r
     where r.org_id = p_org and r.status <> 'rejected' and r.duplicate_of is null
       and r.observed_at > now() - make_interval(hours => greatest(1, least(coalesce(p_hours, 72), 720)))
     order by r.observed_at desc;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Confirm / dispute a published public alert. Feedback only; never changes the alert.
-- ---------------------------------------------------------------------------------------------
create function public.give_alert_feedback(p_alert uuid, p_stance text, p_note text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare a public.alerts;
begin
  select * into a from public.alerts where id = p_alert;
  if not found or auth.uid() is null or a.audience <> 'public' or a.status not in ('published', 'updated')
     or not private.has_permission(a.org_id, 'org.read') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_stance not in ('confirm', 'dispute') then
    raise exception 'stance must be confirm or dispute' using errcode = '22023';
  end if;
  insert into public.alert_feedback (org_id, alert_id, user_id, stance, note)
  values (a.org_id, p_alert, auth.uid(), p_stance, nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (alert_id, user_id) do update set stance = excluded.stance, note = excluded.note, created_at = now();
end $$;

create function public.alert_feedback_summary(p_alert uuid)
returns table (confirms integer, disputes integer)
language plpgsql stable security definer set search_path = ''
as $$
declare a public.alerts;
begin
  select * into a from public.alerts where id = p_alert;
  if not found or auth.uid() is null or not private.has_permission(a.org_id, 'org.read') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query select count(*) filter (where stance = 'confirm')::integer,
                      count(*) filter (where stance = 'dispute')::integer
                 from public.alert_feedback where alert_id = p_alert;
end $$;

create function public.set_community_reports_open(p_org uuid, p_open boolean) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not private.has_permission(p_org, 'org.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.organizations set community_reports_open = coalesce(p_open, false) where id = p_org;
end $$;

revoke all on function
  public.submit_community_report(uuid, uuid, text, text, numeric, double precision, double precision, numeric,
    timestamptz, text, boolean, bytea, text),
  public.submit_public_community_report(uuid, uuid, text, text, numeric, double precision, double precision,
    numeric, timestamptz, text, bytea, text),
  public.withdraw_community_report(uuid),
  public.moderate_community_report(uuid, text, text, text),
  public.community_moderation_queue(uuid, text),
  public.community_reports_on_map(uuid, integer),
  public.give_alert_feedback(uuid, text, text),
  public.alert_feedback_summary(uuid),
  public.set_community_reports_open(uuid, boolean)
  from public, anon, authenticated;
grant execute on function
  public.submit_community_report(uuid, uuid, text, text, numeric, double precision, double precision, numeric,
    timestamptz, text, boolean, bytea, text),
  public.withdraw_community_report(uuid),
  public.moderate_community_report(uuid, text, text, text),
  public.community_moderation_queue(uuid, text),
  public.community_reports_on_map(uuid, integer),
  public.give_alert_feedback(uuid, text, text),
  public.alert_feedback_summary(uuid),
  public.set_community_reports_open(uuid, boolean)
  to authenticated;
grant execute on function
  public.submit_public_community_report(uuid, uuid, text, text, numeric, double precision, double precision,
    numeric, timestamptz, text, bytea, text)
  to service_role;

-- ---------------------------------------------------------------------------------------------
-- Community resources: safe locations and emergency information. Nothing ships by default; an
-- organisation adds its own. Wrong information here can send people to the wrong place, so
-- publishing needs an evidence reference and a second person (creator and publisher differ).
-- ---------------------------------------------------------------------------------------------
create table public.community_resources (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  kind         text not null check (kind in ('safe_location', 'emergency_contact', 'emergency_info')),
  title        text not null check (length(btrim(title)) between 1 and 120),
  body         text check (body is null or length(body) <= 1000),
  phone        text check (phone is null or length(phone) <= 30),
  location     extensions.geometry(Point, 4326),
  created_by   uuid not null,
  created_at   timestamptz not null default now(),
  published    boolean not null default false,
  published_by uuid,
  published_at timestamptz,
  evidence_ref text,
  check (not published or (published_by is not null and published_by <> created_by
                           and length(btrim(coalesce(evidence_ref, ''))) >= 3))
);
create index community_resources_org_idx on public.community_resources (org_id, published);
alter table public.community_resources enable row level security;
revoke all on public.community_resources from anon, authenticated, service_role;
grant select on public.community_resources to authenticated, service_role;
create policy community_resources_select on public.community_resources for select to authenticated
  using (private.has_permission(org_id, 'community.moderate') or private.has_permission(org_id, 'org.manage')
         or (published and private.has_permission(org_id, 'org.read')));

create function public.add_community_resource(p_org uuid, p_kind text, p_title text, p_body text,
  p_phone text, p_lon double precision, p_lat double precision) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if auth.uid() is null or not private.has_permission(p_org, 'community.moderate') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if (p_lon is null) <> (p_lat is null) or p_lon not between -180 and 180 or p_lat not between -90 and 90 then
    raise exception 'location must give both longitude and latitude within range' using errcode = '22023';
  end if;
  insert into public.community_resources (org_id, kind, title, body, phone, location, created_by)
  values (p_org, p_kind, p_title, nullif(btrim(coalesce(p_body, '')), ''), nullif(btrim(coalesce(p_phone, '')), ''),
          case when p_lon is null then null else extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326) end,
          auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create function public.publish_community_resource(p_id uuid, p_evidence_ref text) returns void
language plpgsql security definer set search_path = ''
as $$
declare r public.community_resources;
begin
  select * into r from public.community_resources where id = p_id for update;
  if not found or auth.uid() is null or not private.has_permission(r.org_id, 'community.moderate') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if r.created_by = auth.uid() then
    raise exception 'a different person must publish this (creator and publisher must differ)' using errcode = '42501';
  end if;
  if p_evidence_ref is null or length(btrim(p_evidence_ref)) < 3 then
    raise exception 'publishing needs an evidence reference (how was this checked?)' using errcode = '22023';
  end if;
  update public.community_resources
     set published = true, published_by = auth.uid(), published_at = now(), evidence_ref = btrim(p_evidence_ref)
   where id = p_id;
end $$;

create function public.unpublish_community_resource(p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare r public.community_resources;
begin
  select * into r from public.community_resources where id = p_id for update;
  if not found or auth.uid() is null or not private.has_permission(r.org_id, 'community.moderate') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.community_resources set published = false, published_by = null, published_at = null where id = p_id;
end $$;

revoke all on function public.add_community_resource(uuid, text, text, text, text, double precision, double precision),
  public.publish_community_resource(uuid, text), public.unpublish_community_resource(uuid)
  from public, anon, authenticated;
grant execute on function public.add_community_resource(uuid, text, text, text, text, double precision, double precision),
  public.publish_community_resource(uuid, text), public.unpublish_community_resource(uuid) to authenticated;

-- DOWN (manual): drop functions above, tables alert_feedback, community_resources, report_moderation_events, report_photos,
--   community_reports, function private.community_reports_guard, private.insert_community_report;
--   alter table organizations drop column community_reports_open.
