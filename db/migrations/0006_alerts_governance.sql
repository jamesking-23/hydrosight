-- requires: postgis
-- 0006: threshold rules, alert lifecycle and governance, notification queue (Phase 4, Module 5).
--
-- Rules enforced in the DATABASE (not only the app):
--  * A threshold rule cannot be ACTIVE without a written rationale, an evidence reference and an
--    approver who is a different person from its drafter. There are no built-in thresholds.
--  * Alerts are created as drafts. The engine can only create internal drafts. Every alert at
--    approved/published needs a human approver; a PUBLIC alert's approver must differ from its
--    drafter (check constraint + guard trigger + function checks).
--  * Lifecycle: draft -> in_review -> approved -> published -> updated | cancelled | expired,
--    transitions validated by trigger; approved content is immutable (changes = new version).
--  * App roles have no direct write access to rules, alerts, events or jobs: only the
--    functions below, which check permissions.
--  * Notifications are queued with per-organisation caps; the default mode is dry_run.

create type public.alert_origin as enum (
  'sensor_threshold', 'model_risk', 'official_warning', 'community_observation', 'human_emergency'
);
create type public.alert_audience as enum ('internal', 'public');
create type public.rule_status as enum ('draft', 'active', 'retired');
create type public.rule_scope as enum ('sensor', 'river', 'catchment', 'location', 'organisation');

create function private.forbid_change() returns trigger
language plpgsql set search_path = ''
as $$ begin raise exception '% is append-only', tg_table_name using errcode = '42501'; end $$;

-- ---------------------------------------------------------------------------------------------
-- Threshold rules
-- ---------------------------------------------------------------------------------------------
create table public.threshold_rules (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id) on delete cascade,
  name            text not null check (length(btrim(name)) between 1 and 120),
  scope           public.rule_scope not null,
  scope_id        uuid,
  sensor_kind     text check (sensor_kind in ('water_level', 'rainfall', 'flow', 'temperature', 'soil_moisture')),
  comparator      text not null check (comparator in ('>=', '<=')),
  threshold_value double precision not null check (threshold_value > '-Infinity' and threshold_value < 'Infinity'),
  level           public.alert_level not null check (level <> 'normal'),
  hysteresis      double precision not null default 0 check (hysteresis >= 0 and hysteresis < 'Infinity'),
  cooldown_s      integer not null default 3600 check (cooldown_s between 0 and 604800),
  rationale       text,
  evidence_ref    text,
  status          public.rule_status not null default 'draft',
  drafted_by      uuid not null,
  approved_by     uuid,
  approved_at     timestamptz,
  retired_by      uuid,
  retired_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check ((scope = 'organisation' and scope_id is null) or (scope <> 'organisation' and scope_id is not null)),
  check (scope = 'sensor' or sensor_kind is not null),
  constraint rule_active_needs_documented_basis check (
    status <> 'active' or (
      length(btrim(coalesce(rationale, ''))) >= 20
      and length(btrim(coalesce(evidence_ref, ''))) >= 3
      and approved_by is not null and approved_at is not null
      and approved_by <> drafted_by
    )
  )
);
create index threshold_rules_org_idx on public.threshold_rules (org_id, status);

create function private.rules_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if old.status <> 'draft' and (
       (new.scope, new.scope_id, new.sensor_kind, new.comparator, new.threshold_value, new.level,
        new.hysteresis, new.cooldown_s, new.rationale, new.evidence_ref, new.org_id, new.drafted_by)
       is distinct from
       (old.scope, old.scope_id, old.sensor_kind, old.comparator, old.threshold_value, old.level,
        old.hysteresis, old.cooldown_s, old.rationale, old.evidence_ref, old.org_id, old.drafted_by)) then
    raise exception 'a rule that left draft is immutable; retire it and draft a new one' using errcode = '55000';
  end if;
  if old.status = 'retired' and new.status <> 'retired' then
    raise exception 'a retired rule cannot be reactivated' using errcode = '55000';
  end if;
  if old.status = 'active' and new.status = 'draft' then
    raise exception 'an active rule cannot return to draft' using errcode = '55000';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger threshold_rules_guard before update on public.threshold_rules
  for each row execute function private.rules_guard();

create table public.rule_states (
  rule_id    uuid not null references public.threshold_rules (id) on delete cascade,
  sensor_id  uuid not null references public.sensors (id) on delete cascade,
  armed      boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (rule_id, sensor_id)
);

create table public.maintenance_windows (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  station_id uuid,
  sensor_id  uuid,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  reason     text not null check (length(btrim(reason)) >= 3),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (station_id is not null or sensor_id is not null),
  foreign key (station_id, org_id) references public.stations (id, org_id) on delete cascade,
  foreign key (sensor_id, org_id) references public.sensors (id, org_id) on delete cascade
);
create index maintenance_windows_org_idx on public.maintenance_windows (org_id, starts_at, ends_at);

-- ---------------------------------------------------------------------------------------------
-- Alerts
-- ---------------------------------------------------------------------------------------------
create table public.alerts (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations (id) on delete cascade,
  origin             public.alert_origin not null,
  audience           public.alert_audience not null default 'internal',
  level              public.alert_level not null check (level <> 'normal'),
  status             public.alert_status not null default 'draft',
  title              text not null check (length(btrim(title)) between 1 and 200),
  hazard             text not null default 'flood' check (length(btrim(hazard)) > 0),
  location_text      text not null check (length(btrim(location_text)) > 0),
  station_id         uuid,
  sensor_id          uuid,
  rule_id            uuid references public.threshold_rules (id) on delete set null,
  trigger_reading_id bigint references public.readings (id) on delete set null,
  expected_timing    text,
  duration_text      text,
  evidence           jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  recommended_action text,
  issuing_authority  text,
  source_attribution text,
  confidence         text not null default 'not_assessed' check (confidence in ('not_assessed', 'low', 'medium', 'high')),
  expires_at         timestamptz,
  review_at          timestamptz,
  drafted_by         uuid,
  approved_by        uuid,
  published_by       uuid,
  cancelled_by       uuid,
  cancel_reason      text,
  drafted_at         timestamptz,
  submitted_at       timestamptz,
  approved_at        timestamptz,
  published_at       timestamptz,
  cancelled_at       timestamptz,
  expired_at         timestamptz,
  supersedes_id      uuid references public.alerts (id),
  version            integer not null default 1,
  dedup_key          text,
  ack_due_at         timestamptz,
  escalation_level   integer not null default 0,
  false_alarm        boolean,
  false_alarm_note   text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  foreign key (station_id, org_id) references public.stations (id, org_id),
  foreign key (sensor_id, org_id) references public.sensors (id, org_id),
  constraint alert_needs_human_approval check (
    status in ('draft', 'in_review', 'cancelled') or approved_by is not null
  ),
  constraint public_alert_approver_differs_from_drafter check (
    audience <> 'public'
    or status in ('draft', 'in_review', 'cancelled')
    or (drafted_by is not null and approved_by is not null and approved_by <> drafted_by)
  ),
  constraint official_alert_needs_attribution check (
    origin <> 'official_warning' or length(btrim(coalesce(source_attribution, ''))) > 0
  )
);
create index alerts_org_status_idx on public.alerts (org_id, status, created_at desc);
create index alerts_dedup_idx on public.alerts (dedup_key, created_at desc) where dedup_key is not null;
create index alerts_station_idx on public.alerts (station_id);

create function private.alerts_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.approved_by is not null or new.published_by is not null then
      raise exception 'alerts are created as drafts' using errcode = '55000';
    end if;
    return new;
  end if;
  if (new.id, new.org_id, new.origin) is distinct from (old.id, old.org_id, old.origin) then
    raise exception 'alert identity is immutable' using errcode = '55000';
  end if;
  if old.status in ('updated', 'cancelled', 'expired') then
    raise exception 'alert is closed (%)', old.status using errcode = '55000';
  end if;
  if new.status <> old.status and (old.status, new.status) not in (
       ('draft', 'in_review'), ('draft', 'cancelled'),
       ('in_review', 'approved'), ('in_review', 'draft'), ('in_review', 'cancelled'),
       ('approved', 'published'), ('approved', 'cancelled'), ('approved', 'expired'),
       ('published', 'updated'), ('published', 'cancelled'), ('published', 'expired')) then
    raise exception 'illegal alert transition % -> %', old.status, new.status using errcode = '55000';
  end if;
  if old.status in ('approved', 'published') and (
       (new.title, new.level, new.audience, new.hazard, new.location_text, new.expected_timing,
        new.duration_text, new.recommended_action, new.issuing_authority, new.confidence,
        new.evidence, new.station_id, new.sensor_id, new.expires_at, new.review_at, new.drafted_by,
        new.approved_by)
       is distinct from
       (old.title, old.level, old.audience, old.hazard, old.location_text, old.expected_timing,
        old.duration_text, old.recommended_action, old.issuing_authority, old.confidence,
        old.evidence, old.station_id, old.sensor_id, old.expires_at, old.review_at, old.drafted_by,
        old.approved_by)) then
    raise exception 'approved content is immutable; issue a new version' using errcode = '55000';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger alerts_guard before insert or update on public.alerts
  for each row execute function private.alerts_guard();

create table public.alert_events (
  id          bigint generated always as identity primary key,
  alert_id    uuid not null,  -- deliberately no FK: history must outlive everything
  org_id      uuid not null,
  event       text not null,
  from_status public.alert_status,
  to_status   public.alert_status,
  actor_id    uuid,
  note        text,
  created_at  timestamptz not null default now()
);
create index alert_events_alert_idx on public.alert_events (alert_id, created_at);
create trigger alert_events_append_only before update or delete on public.alert_events
  for each row execute function private.forbid_change();

create function private.alerts_log() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.alert_events (alert_id, org_id, event, to_status, actor_id, note)
    values (new.id, new.org_id, 'created', new.status, auth.uid(), current_setting('hydrosight.note', true));
  elsif new.status <> old.status then
    insert into public.alert_events (alert_id, org_id, event, from_status, to_status, actor_id, note)
    values (new.id, new.org_id, 'status_changed', old.status, new.status, auth.uid(), current_setting('hydrosight.note', true));
  end if;
  return null;
end $$;
create trigger alerts_log after insert or update on public.alerts
  for each row execute function private.alerts_log();

create table public.alert_acks (
  alert_id  uuid not null references public.alerts (id) on delete cascade,
  org_id    uuid not null,
  user_id   uuid not null,
  acked_at  timestamptz not null default now(),
  primary key (alert_id, user_id)
);

-- ---------------------------------------------------------------------------------------------
-- Notifications (provider-neutral queue; dry_run by default)
-- ---------------------------------------------------------------------------------------------
create table public.notification_settings (
  org_id        uuid primary key references public.organizations (id) on delete cascade,
  mode          text not null default 'dry_run' check (mode in ('dry_run', 'live')),
  daily_cap     integer not null default 200 check (daily_cap >= 0),
  per_alert_cap integer not null default 100 check (per_alert_cap >= 0),
  updated_at    timestamptz not null default now()
);

create table public.subscriptions (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  station_id   uuid not null,
  channel      text not null check (channel in ('sms', 'email', 'web_push')),
  address      text not null check (length(btrim(address)) between 3 and 500),
  locale       text not null default 'en' check (locale in ('en', 'lg', 'sw')),
  consent_text text not null check (length(btrim(consent_text)) >= 5),
  opted_in_at  timestamptz not null default now(),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  foreign key (station_id, org_id) references public.stations (id, org_id) on delete cascade,
  unique (org_id, station_id, channel, address)
);

create table public.notification_jobs (
  id               bigint generated always as identity primary key,
  org_id           uuid not null references public.organizations (id) on delete cascade,
  alert_id         uuid not null references public.alerts (id) on delete cascade,
  subscription_id  uuid not null references public.subscriptions (id) on delete cascade,
  channel          text not null,
  locale           text not null,
  body             text,
  status           text not null default 'queued'
                   check (status in ('queued', 'sent', 'failed', 'dry_run', 'suppressed_cap', 'suppressed_cancelled')),
  attempts         integer not null default 0,
  provider         text,
  provider_receipt text,
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (alert_id, subscription_id)
);
create index notification_jobs_queue_idx on public.notification_jobs (status, id) where status = 'queued';
create index notification_jobs_org_idx on public.notification_jobs (org_id, created_at);

create function private.queue_alert_notifications(p_alert uuid) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  a        public.alerts;
  v_daily  integer;
  v_per    integer;
  v_today  integer;
  v_this   integer := 0;
  v_queued integer := 0;
  s        record;
  v_status text;
begin
  select * into a from public.alerts where id = p_alert;
  if not found or a.audience <> 'public' or a.status <> 'published' or a.station_id is null then
    return 0;
  end if;
  select coalesce(max(daily_cap), 200), coalesce(max(per_alert_cap), 100) into v_daily, v_per
    from public.notification_settings where org_id = a.org_id;
  select count(*) into v_today from public.notification_jobs
   where org_id = a.org_id and created_at > now() - interval '24 hours'
     and status not in ('suppressed_cap', 'suppressed_cancelled');
  for s in select id, channel, locale from public.subscriptions
            where org_id = a.org_id and station_id = a.station_id and active order by id loop
    if v_today + v_queued >= v_daily or v_this >= v_per then
      v_status := 'suppressed_cap';
    else
      v_status := 'queued';
    end if;
    insert into public.notification_jobs (org_id, alert_id, subscription_id, channel, locale, status)
    values (a.org_id, a.id, s.id, s.channel, s.locale, v_status)
    on conflict (alert_id, subscription_id) do nothing;
    if v_status = 'queued' then v_queued := v_queued + 1; v_this := v_this + 1; end if;
  end loop;
  return v_queued;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Audit, RLS, grants
-- ---------------------------------------------------------------------------------------------
create trigger audit_threshold_rules after insert or update or delete on public.threshold_rules
  for each row execute function private.audit_row_change();
create trigger audit_alerts after insert or update or delete on public.alerts
  for each row execute function private.audit_row_change();
create trigger audit_maintenance_windows after insert or update or delete on public.maintenance_windows
  for each row execute function private.audit_row_change();
create trigger audit_subscriptions after insert or update or delete on public.subscriptions
  for each row execute function private.audit_row_change();

alter table public.threshold_rules        enable row level security;
alter table public.rule_states            enable row level security;
alter table public.maintenance_windows    enable row level security;
alter table public.alerts                 enable row level security;
alter table public.alert_events           enable row level security;
alter table public.alert_acks             enable row level security;
alter table public.notification_settings  enable row level security;
alter table public.subscriptions          enable row level security;
alter table public.notification_jobs      enable row level security;

revoke all on public.threshold_rules, public.rule_states, public.maintenance_windows, public.alerts,
  public.alert_events, public.alert_acks, public.notification_settings, public.subscriptions,
  public.notification_jobs from anon, authenticated, service_role;

create function private.can_see_alert(p_org uuid, p_status public.alert_status) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.has_permission(p_org, 'warnings.draft')
      or private.has_permission(p_org, 'warnings.review')
      or private.has_permission(p_org, 'warnings.approve')
      or private.has_permission(p_org, 'warnings.publish')
      or (p_status in ('published', 'updated', 'cancelled', 'expired')
          and private.has_permission(p_org, 'readings.read'))
$$;
revoke all on function private.can_see_alert(uuid, public.alert_status) from public;
grant execute on function private.can_see_alert(uuid, public.alert_status) to authenticated, service_role;

grant select on public.threshold_rules, public.alerts, public.alert_events, public.alert_acks,
  public.notification_jobs, public.notification_settings, public.subscriptions, public.maintenance_windows
  to authenticated;
grant select on public.threshold_rules, public.alerts, public.alert_events, public.alert_acks,
  public.notification_jobs, public.notification_settings, public.subscriptions, public.maintenance_windows,
  public.rule_states to service_role;
grant insert, update, delete on public.notification_jobs to service_role;
grant insert, update on public.notification_settings to service_role;
grant insert, update on public.rule_states to service_role;
grant insert (org_id, station_id, sensor_id, starts_at, ends_at, reason) on public.maintenance_windows to authenticated;
grant delete on public.maintenance_windows to authenticated;
grant insert (org_id, station_id, channel, address, locale, consent_text) on public.subscriptions to authenticated;
grant update (active) on public.subscriptions to authenticated;

create policy rules_select on public.threshold_rules for select to authenticated
  using (private.has_permission(org_id, 'readings.read') or private.has_permission(org_id, 'thresholds.draft'));
create policy alerts_select on public.alerts for select to authenticated
  using (private.can_see_alert(org_id, status));
create policy alert_events_select on public.alert_events for select to authenticated
  using (private.has_permission(org_id, 'warnings.draft') or private.has_permission(org_id, 'warnings.review')
         or private.has_permission(org_id, 'warnings.approve') or private.has_permission(org_id, 'readings.read'));
create policy alert_acks_select on public.alert_acks for select to authenticated
  using (private.has_permission(org_id, 'readings.read') or private.has_permission(org_id, 'warnings.approve'));
create policy notification_jobs_select on public.notification_jobs for select to authenticated
  using (private.has_permission(org_id, 'org.manage'));
create policy notification_settings_select on public.notification_settings for select to authenticated
  using (private.has_permission(org_id, 'org.manage'));
create policy subscriptions_select on public.subscriptions for select to authenticated
  using (private.has_permission(org_id, 'org.manage'));
create policy subscriptions_insert on public.subscriptions for insert to authenticated
  with check (private.has_permission(org_id, 'org.manage'));
create policy subscriptions_update on public.subscriptions for update to authenticated
  using (private.has_permission(org_id, 'org.manage')) with check (private.has_permission(org_id, 'org.manage'));
create policy maintenance_select on public.maintenance_windows for select to authenticated
  using (private.has_permission(org_id, 'sensors.read'));
create policy maintenance_insert on public.maintenance_windows for insert to authenticated
  with check (private.has_permission(org_id, 'devices.manage'));
create policy maintenance_delete on public.maintenance_windows for delete to authenticated
  using (private.has_permission(org_id, 'devices.manage'));

-- Conflicting information: every active alert for a station side by side, official first.
create view public.alerts_active_ranked with (security_invoker = true) as
select a.id, a.org_id, a.station_id, a.location_text, a.origin, a.level, a.audience, a.title, a.status,
       a.published_at, a.expires_at, a.confidence,
       case a.origin when 'official_warning' then 0 when 'human_emergency' then 1 else 2 end as origin_rank,
       count(*) over w as active_count,
       (min(a.level) over w <> max(a.level) over w or min(a.origin) over w <> max(a.origin) over w) as has_conflict
from public.alerts a
where a.status = 'published' and (a.expires_at is null or a.expires_at > now())
window w as (partition by a.org_id, coalesce(a.station_id::text, a.location_text));
revoke all on public.alerts_active_ranked from anon, authenticated, service_role;
grant select on public.alerts_active_ranked to authenticated, service_role;

create view public.alerts_escalation_due with (security_invoker = true) as
select a.id, a.org_id, a.title, a.level, a.ack_due_at, a.escalation_level
from public.alerts a
where a.status = 'published' and a.ack_due_at < now()
  and not exists (select 1 from public.alert_acks k where k.alert_id = a.id);
revoke all on public.alerts_escalation_due from anon, authenticated, service_role;
grant select on public.alerts_escalation_due to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Functions: threshold rules
-- ---------------------------------------------------------------------------------------------
create function public.draft_threshold_rule(
  p_org uuid, p_name text, p_scope public.rule_scope, p_scope_id uuid, p_sensor_kind text,
  p_comparator text, p_value double precision, p_level public.alert_level,
  p_hysteresis double precision, p_cooldown_s integer, p_rationale text, p_evidence_ref text
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if auth.uid() is null or not private.has_permission(p_org, 'thresholds.draft') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_scope = 'sensor' and not exists (select 1 from public.sensors where id = p_scope_id and org_id = p_org) then
    raise exception 'unknown sensor' using errcode = '22023';
  elsif p_scope = 'location' and not exists (select 1 from public.locations where id = p_scope_id and org_id = p_org) then
    raise exception 'unknown location' using errcode = '22023';
  elsif p_scope = 'river' and not exists (select 1 from public.rivers where id = p_scope_id) then
    raise exception 'unknown river' using errcode = '22023';
  elsif p_scope = 'catchment' and not exists (select 1 from public.catchments where id = p_scope_id) then
    raise exception 'unknown catchment' using errcode = '22023';
  end if;
  insert into public.threshold_rules (org_id, name, scope, scope_id, sensor_kind, comparator, threshold_value,
                                      level, hysteresis, cooldown_s, rationale, evidence_ref, drafted_by)
  values (p_org, p_name, p_scope, p_scope_id, p_sensor_kind, p_comparator, p_value, p_level,
          coalesce(p_hysteresis, 0), coalesce(p_cooldown_s, 3600), nullif(btrim(p_rationale), ''),
          nullif(btrim(p_evidence_ref), ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create function public.activate_threshold_rule(p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare r public.threshold_rules;
begin
  select * into r from public.threshold_rules where id = p_id for update;
  if not found or auth.uid() is null or not private.has_permission(r.org_id, 'thresholds.approve') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if r.status <> 'draft' then
    raise exception 'only a draft rule can be activated' using errcode = '55000';
  end if;
  if r.drafted_by = auth.uid() then
    raise exception 'the drafter cannot approve their own rule' using errcode = '42501';
  end if;
  if length(btrim(coalesce(r.rationale, ''))) < 20 or length(btrim(coalesce(r.evidence_ref, ''))) < 3 then
    raise exception 'a rule needs a documented basis: rationale (20+ characters) and an evidence reference'
      using errcode = '22023';
  end if;
  update public.threshold_rules set status = 'active', approved_by = auth.uid(), approved_at = now() where id = p_id;
end $$;

create function public.retire_threshold_rule(p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare r public.threshold_rules;
begin
  select * into r from public.threshold_rules where id = p_id for update;
  if not found or auth.uid() is null
     or not (private.has_permission(r.org_id, 'thresholds.approve')
             or (r.status = 'draft' and r.drafted_by = auth.uid() and private.has_permission(r.org_id, 'thresholds.draft'))) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.threshold_rules set status = 'retired', retired_by = auth.uid(), retired_at = now()
   where id = p_id and status <> 'retired';
end $$;

-- ---------------------------------------------------------------------------------------------
-- Functions: alert lifecycle
-- ---------------------------------------------------------------------------------------------
create function public.create_alert_draft(
  p_org uuid, p_origin public.alert_origin, p_level public.alert_level, p_title text,
  p_location_text text, p_station uuid default null, p_hazard text default 'flood',
  p_expected_timing text default null, p_duration text default null,
  p_recommended_action text default null, p_issuing_authority text default null,
  p_confidence text default 'not_assessed', p_evidence jsonb default '[]'::jsonb,
  p_audience public.alert_audience default 'internal', p_expires_at timestamptz default null,
  p_review_at timestamptz default null, p_source_attribution text default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if auth.uid() is null or not private.has_permission(p_org, 'warnings.draft') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_origin in ('sensor_threshold', 'model_risk') then
    raise exception 'system-originated alerts are created by the engine, not by hand' using errcode = '22023';
  end if;
  insert into public.alerts (org_id, origin, audience, level, title, hazard, location_text, station_id,
                             expected_timing, duration_text, evidence, recommended_action, issuing_authority,
                             source_attribution, confidence, expires_at, review_at, drafted_by, drafted_at)
  values (p_org, p_origin, p_audience, p_level, p_title, coalesce(p_hazard, 'flood'), p_location_text, p_station,
          p_expected_timing, p_duration, coalesce(p_evidence, '[]'::jsonb), p_recommended_action,
          p_issuing_authority, p_source_attribution, coalesce(p_confidence, 'not_assessed'), p_expires_at,
          p_review_at, auth.uid(), now())
  returning id into v_id;
  return v_id;
end $$;

create function public.edit_alert_draft(p_id uuid, p_patch jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
declare a public.alerts; v_bad text;
begin
  select * into a from public.alerts where id = p_id for update;
  if not found or auth.uid() is null or not private.has_permission(a.org_id, 'warnings.draft') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if a.status <> 'draft' then
    raise exception 'only a draft can be edited' using errcode = '55000';
  end if;
  if a.drafted_by is not null and a.drafted_by <> auth.uid() then
    raise exception 'only the drafter can edit this draft' using errcode = '42501';
  end if;
  select string_agg(k, ', ') into v_bad from jsonb_object_keys(p_patch) k
   where k not in ('title', 'level', 'audience', 'hazard', 'location_text', 'expected_timing', 'duration_text',
                   'recommended_action', 'issuing_authority', 'confidence', 'expires_at', 'review_at', 'evidence');
  if v_bad is not null then
    raise exception 'fields cannot be edited: %', v_bad using errcode = '22023';
  end if;
  update public.alerts set
    title = coalesce(p_patch ->> 'title', title),
    level = coalesce((p_patch ->> 'level')::public.alert_level, level),
    audience = coalesce((p_patch ->> 'audience')::public.alert_audience, audience),
    hazard = coalesce(p_patch ->> 'hazard', hazard),
    location_text = coalesce(p_patch ->> 'location_text', location_text),
    expected_timing = coalesce(p_patch ->> 'expected_timing', expected_timing),
    duration_text = coalesce(p_patch ->> 'duration_text', duration_text),
    recommended_action = coalesce(p_patch ->> 'recommended_action', recommended_action),
    issuing_authority = coalesce(p_patch ->> 'issuing_authority', issuing_authority),
    confidence = coalesce(p_patch ->> 'confidence', confidence),
    expires_at = coalesce((p_patch ->> 'expires_at')::timestamptz, expires_at),
    review_at = coalesce((p_patch ->> 'review_at')::timestamptz, review_at),
    evidence = coalesce(p_patch -> 'evidence', evidence),
    drafted_by = auth.uid(),
    drafted_at = coalesce(drafted_at, now())
  where id = p_id;
end $$;

create function public.submit_alert(p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare a public.alerts; v_missing text[] := '{}';
begin
  select * into a from public.alerts where id = p_id for update;
  if not found or auth.uid() is null or not private.has_permission(a.org_id, 'warnings.draft') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if a.status <> 'draft' then
    raise exception 'only a draft can be submitted' using errcode = '55000';
  end if;
  if a.drafted_by is not null and a.drafted_by <> auth.uid() then
    raise exception 'only the drafter can submit this draft' using errcode = '42501';
  end if;
  if length(btrim(coalesce(a.expected_timing, ''))) = 0 then v_missing := v_missing || 'expected_timing'; end if;
  if length(btrim(coalesce(a.duration_text, ''))) = 0 then v_missing := v_missing || 'duration'; end if;
  if length(btrim(coalesce(a.recommended_action, ''))) = 0 then v_missing := v_missing || 'recommended_action'; end if;
  if length(btrim(coalesce(a.issuing_authority, ''))) = 0 then v_missing := v_missing || 'issuing_authority'; end if;
  if jsonb_array_length(a.evidence) = 0 then v_missing := v_missing || 'supporting_evidence'; end if;
  if a.expires_at is null and a.review_at is null then v_missing := v_missing || 'expiry_or_review_time'; end if;
  if a.expires_at is not null and a.expires_at <= now() then v_missing := v_missing || 'expiry_in_future'; end if;
  if cardinality(v_missing) > 0 then
    raise exception 'alert is incomplete: %', array_to_string(v_missing, ', ') using errcode = '22023';
  end if;
  update public.alerts set status = 'in_review', drafted_by = auth.uid(), drafted_at = coalesce(drafted_at, now()),
         submitted_at = now() where id = p_id;
end $$;

create function public.return_alert_to_draft(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare a public.alerts;
begin
  select * into a from public.alerts where id = p_id for update;
  if not found or auth.uid() is null
     or not (private.has_permission(a.org_id, 'warnings.approve') or private.has_permission(a.org_id, 'warnings.review')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  perform set_config('hydrosight.note', p_note, true);
  update public.alerts set status = 'draft', submitted_at = null where id = p_id and status = 'in_review';
  if not found then raise exception 'alert is not in review' using errcode = '55000'; end if;
end $$;

create function public.approve_alert(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare a public.alerts;
begin
  select * into a from public.alerts where id = p_id for update;
  if not found or auth.uid() is null or not private.has_permission(a.org_id, 'warnings.approve') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if a.status <> 'in_review' then
    raise exception 'only an alert in review can be approved' using errcode = '55000';
  end if;
  if a.audience = 'public' and a.drafted_by = auth.uid() then
    raise exception 'the drafter cannot approve their own public warning' using errcode = '42501';
  end if;
  perform set_config('hydrosight.note', p_note, true);
  update public.alerts set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_id;
end $$;

create function public.publish_alert(p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare a public.alerts;
begin
  select * into a from public.alerts where id = p_id for update;
  if not found or auth.uid() is null or not private.has_permission(a.org_id, 'warnings.publish') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if a.status <> 'approved' then
    raise exception 'only an approved alert can be published' using errcode = '55000';
  end if;
  if a.expires_at is not null and a.expires_at <= now() then
    raise exception 'alert has already expired' using errcode = '22023';
  end if;
  if a.supersedes_id is not null then
    update public.alerts set status = 'updated' where id = a.supersedes_id and status = 'published';
  end if;
  update public.alerts set status = 'published', published_by = auth.uid(), published_at = now(),
         ack_due_at = now() + interval '30 minutes' where id = p_id;
  perform private.queue_alert_notifications(p_id);
end $$;

create function public.cancel_alert(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare a public.alerts;
begin
  select * into a from public.alerts where id = p_id for update;
  if not found or auth.uid() is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'a cancellation reason is required' using errcode = '22023';
  end if;
  if a.status in ('draft', 'in_review') then
    if not (private.has_permission(a.org_id, 'warnings.approve')
            or (a.drafted_by = auth.uid() and private.has_permission(a.org_id, 'warnings.draft'))) then
      raise exception 'not authorized' using errcode = '42501';
    end if;
  elsif a.status in ('approved', 'published') then
    if not private.has_permission(a.org_id, 'warnings.publish') then
      raise exception 'not authorized' using errcode = '42501';
    end if;
  else
    raise exception 'alert is already closed' using errcode = '55000';
  end if;
  perform set_config('hydrosight.note', p_reason, true);
  update public.alerts set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(),
         cancel_reason = p_reason where id = p_id;
  update public.notification_jobs set status = 'suppressed_cancelled', updated_at = now()
   where alert_id = p_id and status = 'queued';
end $$;

-- A published alert is changed by issuing a NEW version that goes through review and approval
-- again; publishing it marks the old one `updated`.
create function public.new_alert_version(p_id uuid, p_patch jsonb default '{}'::jsonb) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare a public.alerts; v_new uuid;
begin
  select * into a from public.alerts where id = p_id for update;
  if not found or auth.uid() is null or not private.has_permission(a.org_id, 'warnings.draft') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if a.status <> 'published' then
    raise exception 'only a published alert can be updated' using errcode = '55000';
  end if;
  if exists (select 1 from public.alerts where supersedes_id = p_id and status in ('draft', 'in_review', 'approved')) then
    raise exception 'a newer version is already in progress' using errcode = '55000';
  end if;
  insert into public.alerts (org_id, origin, audience, level, title, hazard, location_text, station_id, sensor_id,
                             rule_id, expected_timing, duration_text, evidence, recommended_action,
                             issuing_authority, source_attribution, confidence, expires_at, review_at,
                             drafted_by, drafted_at, supersedes_id, version)
  values (a.org_id, a.origin, a.audience, a.level, a.title, a.hazard, a.location_text, a.station_id, a.sensor_id,
          a.rule_id, a.expected_timing, a.duration_text, a.evidence, a.recommended_action, a.issuing_authority,
          a.source_attribution, a.confidence, a.expires_at, a.review_at, auth.uid(), now(), a.id, a.version + 1)
  returning id into v_new;
  if p_patch is not null and p_patch <> '{}'::jsonb then
    perform public.edit_alert_draft(v_new, p_patch);
  end if;
  return v_new;
end $$;

create function public.ack_alert(p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare a public.alerts;
begin
  select * into a from public.alerts where id = p_id;
  if not found or auth.uid() is null or not private.can_see_alert(a.org_id, a.status)
     or not (private.has_permission(a.org_id, 'readings.read') or private.has_permission(a.org_id, 'warnings.approve')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if a.status <> 'published' then
    raise exception 'only a published alert can be acknowledged' using errcode = '55000';
  end if;
  insert into public.alert_acks (alert_id, org_id, user_id) values (p_id, a.org_id, auth.uid())
  on conflict do nothing;
end $$;

create function public.tag_false_alarm(p_id uuid, p_flag boolean, p_note text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare a public.alerts;
begin
  select * into a from public.alerts where id = p_id for update;
  if not found or auth.uid() is null
     or not (private.has_permission(a.org_id, 'warnings.approve') or private.has_permission(a.org_id, 'warnings.review')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.alerts set false_alarm = p_flag, false_alarm_note = p_note where id = p_id;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Backend only (service role): engine, expiry, escalation
-- ---------------------------------------------------------------------------------------------
create function public.evaluate_thresholds_for(p_sensors uuid[] default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r         record;
  v_armed   boolean;
  v_breach  boolean;
  v_key     text;
  v_eval    integer := 0;
  v_created integer := 0;
  v_dup     integer := 0;
  v_cool    integer := 0;
  v_maint   integer := 0;
  v_notlive integer := 0;
  v_rearm   integer := 0;
begin
  for r in
    select ru.id as rule_id, ru.org_id, ru.name as rule_name, ru.comparator, ru.threshold_value, ru.level,
           ru.hysteresis, ru.cooldown_s, ru.rationale, ru.evidence_ref,
           s.id as sensor_id, s.station_id, s.kind, s.unit, s.expected_interval_s, st.name as station_name,
           l.id as reading_id, l.observed_at, l.value, l.quality, l.source_type
      from public.threshold_rules ru
      join public.sensors s on s.org_id = ru.org_id
      join public.stations st on st.id = s.station_id and st.org_id = s.org_id
      join lateral (
        select rd.id, rd.observed_at, rd.value, rd.quality, rd.source_type
          from public.readings rd
         where rd.sensor_id = s.id and rd.quality in ('unchecked', 'good')
         order by rd.observed_at desc limit 1
      ) l on true
     where ru.status = 'active'
       and (p_sensors is null or s.id = any (p_sensors))
       and case ru.scope
             when 'sensor' then s.id = ru.scope_id
             when 'river' then st.river_id = ru.scope_id and s.kind = ru.sensor_kind
             when 'catchment' then st.catchment_id = ru.scope_id and s.kind = ru.sensor_kind
             when 'location' then st.location_id = ru.scope_id and s.kind = ru.sensor_kind
             else s.kind = ru.sensor_kind
           end
  loop
    v_eval := v_eval + 1;
    -- a stale or offline sensor never triggers a breach from its last-known value
    if now() - r.observed_at > r.expected_interval_s * 2 * interval '1 second' then
      v_notlive := v_notlive + 1; continue;
    end if;
    if exists (select 1 from public.maintenance_windows w
                where w.org_id = r.org_id and now() >= w.starts_at and now() < w.ends_at
                  and (w.sensor_id = r.sensor_id or w.station_id = r.station_id)) then
      v_maint := v_maint + 1; continue;
    end if;
    insert into public.rule_states (rule_id, sensor_id) values (r.rule_id, r.sensor_id) on conflict do nothing;
    select armed into v_armed from public.rule_states where rule_id = r.rule_id and sensor_id = r.sensor_id;
    v_breach := (r.comparator = '>=' and r.value >= r.threshold_value)
             or (r.comparator = '<=' and r.value <= r.threshold_value);
    if not v_breach then
      if not v_armed and ((r.comparator = '>=' and r.value < r.threshold_value - r.hysteresis)
                       or (r.comparator = '<=' and r.value > r.threshold_value + r.hysteresis)) then
        update public.rule_states set armed = true, updated_at = now()
         where rule_id = r.rule_id and sensor_id = r.sensor_id;
        v_rearm := v_rearm + 1;
      end if;
      continue;
    end if;
    v_key := r.rule_id::text || ':' || r.sensor_id::text;
    if not v_armed or exists (select 1 from public.alerts a where a.dedup_key = v_key
                                 and a.status in ('draft', 'in_review', 'approved', 'published')) then
      update public.rule_states set armed = false, updated_at = now() where rule_id = r.rule_id and sensor_id = r.sensor_id;
      v_dup := v_dup + 1; continue;
    end if;
    if exists (select 1 from public.alerts a where a.dedup_key = v_key
                  and a.created_at > now() - r.cooldown_s * interval '1 second') then
      v_cool := v_cool + 1; continue;
    end if;
    insert into public.alerts (org_id, origin, audience, level, title, location_text, station_id, sensor_id, rule_id,
                               trigger_reading_id, evidence, confidence, dedup_key)
    values (r.org_id, 'sensor_threshold', 'internal', r.level,
            format('%s %s %s %s at %s', initcap(replace(r.kind, '_', ' ')), r.comparator, r.threshold_value, r.unit, r.station_name),
            r.station_name, r.station_id, r.sensor_id, r.rule_id, r.reading_id,
            jsonb_build_array(jsonb_build_object(
              'type', 'reading', 'reading_id', r.reading_id, 'sensor_id', r.sensor_id, 'observed_at', r.observed_at,
              'value', r.value, 'unit', r.unit, 'source_type', r.source_type, 'quality', r.quality,
              'rule_id', r.rule_id, 'rule_name', r.rule_name, 'rule_rationale', r.rationale,
              'rule_evidence_ref', r.evidence_ref)),
            'not_assessed', v_key);
    update public.rule_states set armed = false, updated_at = now() where rule_id = r.rule_id and sensor_id = r.sensor_id;
    v_created := v_created + 1;
  end loop;
  return jsonb_build_object('evaluated', v_eval, 'created', v_created, 'duplicate_suppressed', v_dup,
                            'cooldown_suppressed', v_cool, 'maintenance_suppressed', v_maint,
                            'skipped_not_live', v_notlive, 'rearmed', v_rearm);
end $$;

create function public.expire_alerts() returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_n integer;
begin
  update public.alerts set status = 'expired', expired_at = now()
   where status in ('approved', 'published') and expires_at is not null and expires_at < now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create function public.escalate_alerts() returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_n integer := 0; r record;
begin
  for r in select a.id, a.org_id, a.escalation_level from public.alerts a
            where a.status = 'published' and a.ack_due_at < now()
              and not exists (select 1 from public.alert_acks k where k.alert_id = a.id) loop
    update public.alerts set escalation_level = r.escalation_level + 1, ack_due_at = now() + interval '15 minutes'
     where id = r.id;
    insert into public.alert_events (alert_id, org_id, event, note)
    values (r.id, r.org_id, 'escalated', format('no acknowledgement; escalation level %s', r.escalation_level + 1));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Execute rights
-- ---------------------------------------------------------------------------------------------
revoke all on function
  public.draft_threshold_rule(uuid, text, public.rule_scope, uuid, text, text, double precision, public.alert_level, double precision, integer, text, text),
  public.activate_threshold_rule(uuid), public.retire_threshold_rule(uuid),
  public.create_alert_draft(uuid, public.alert_origin, public.alert_level, text, text, uuid, text, text, text, text, text, text, jsonb, public.alert_audience, timestamptz, timestamptz, text),
  public.edit_alert_draft(uuid, jsonb), public.submit_alert(uuid), public.return_alert_to_draft(uuid, text),
  public.approve_alert(uuid, text), public.publish_alert(uuid), public.cancel_alert(uuid, text),
  public.new_alert_version(uuid, jsonb), public.ack_alert(uuid), public.tag_false_alarm(uuid, boolean, text),
  public.evaluate_thresholds_for(uuid[]), public.expire_alerts(), public.escalate_alerts(),
  private.queue_alert_notifications(uuid)
  from public, anon, authenticated;
grant execute on function
  public.draft_threshold_rule(uuid, text, public.rule_scope, uuid, text, text, double precision, public.alert_level, double precision, integer, text, text),
  public.activate_threshold_rule(uuid), public.retire_threshold_rule(uuid),
  public.create_alert_draft(uuid, public.alert_origin, public.alert_level, text, text, uuid, text, text, text, text, text, text, jsonb, public.alert_audience, timestamptz, timestamptz, text),
  public.edit_alert_draft(uuid, jsonb), public.submit_alert(uuid), public.return_alert_to_draft(uuid, text),
  public.approve_alert(uuid, text), public.publish_alert(uuid), public.cancel_alert(uuid, text),
  public.new_alert_version(uuid, jsonb), public.ack_alert(uuid), public.tag_false_alarm(uuid, boolean, text)
  to authenticated;
grant execute on function public.evaluate_thresholds_for(uuid[]), public.expire_alerts(), public.escalate_alerts()
  to service_role;

-- DOWN (manual): drop views alerts_active_ranked, alerts_escalation_due; drop all functions above;
--   drop tables notification_jobs, subscriptions, notification_settings, alert_acks, alert_events,
--   alerts, maintenance_windows, rule_states, threshold_rules; drop types rule_scope, rule_status,
--   alert_audience, alert_origin; drop functions private.forbid_change, private.can_see_alert, ...
