-- requires: postgis
-- 0009: prediction engine and validation harness (Phase 6).
--
-- Design rules enforced here (not just in application code):
--  * A prediction is a forecast, never a measurement: source_type is 'forecast', or
--    'synthetic' when any input was synthetic. Each prediction carries a non-empty input
--    snapshot, its model version and its horizon. Predictions and backtest results are
--    immutable once written.
--  * Only flood_occurrence and stage are predicted. Extent, depth and impact need a calibrated
--    hydraulic model that does not exist yet, so the database refuses those targets.
--  * Everything starts `unvalidated`. Only a human holding models.promote, who is not the
--    model's registrant, can promote, with an evidence link. Synthetic or unconfirmed data can
--    never lead to `validated`. The engine and app roles have no promotion path.
--  * A machine-learned model can be registered only on data a human with models.promote has
--    confirmed as real (never synthetic).
--  * A backtest must state the event threshold it scored against and why. There is no default.
--  * Synthetic evaluation data is flagged on the run and can never be promoted on.

insert into public.permissions (key, description, privileged) values
  ('models.read',    'View models, predictions and backtests', false),
  ('models.manage',  'Register model versions and record flood events', false),
  ('models.promote', 'Confirm real data and promote model versions with evidence', true);
insert into public.role_permissions (role_key, permission_key) values
  ('org_admin', 'models.read'), ('org_admin', 'models.manage'), ('org_admin', 'models.promote'),
  ('government_authority', 'models.read'), ('government_authority', 'models.promote'),
  ('hydrologist', 'models.read'), ('hydrologist', 'models.manage'),
  ('meteorologist', 'models.read'), ('meteorologist', 'models.manage');

create type public.data_origin as enum ('synthetic', 'real_unconfirmed', 'real_confirmed');

create table public.model_versions (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations (id) on delete cascade,
  name                  text not null check (length(btrim(name)) between 1 and 80),
  version               text not null check (length(btrim(version)) between 1 and 40),
  kind                  text not null check (kind in ('baseline', 'ml', 'hybrid', 'external')),
  target                text not null check (target in ('flood_occurrence', 'stage')),
  description           text,
  code_ref              text,
  training_data_ref     jsonb,
  data_origin           public.data_origin not null default 'synthetic',
  real_data_confirmed_by uuid,
  real_data_evidence    text,
  status                public.service_status not null default 'unvalidated',
  promoted_by           uuid,
  promoted_at           timestamptz,
  evidence_url          text,
  created_by            uuid,
  created_at            timestamptz not null default now(),
  unique (org_id, name, version),
  unique (id, org_id),
  -- Learned models only on data a human confirmed as real.
  check (kind not in ('ml', 'hybrid')
         or (data_origin = 'real_confirmed' and real_data_confirmed_by is not null
             and length(btrim(coalesce(real_data_evidence, ''))) >= 3)),
  check (data_origin <> 'real_confirmed'
         or (real_data_confirmed_by is not null and length(btrim(coalesce(real_data_evidence, ''))) >= 3)),
  -- Leaving `unvalidated` needs a human and evidence, and real confirmed data.
  check (status = 'unvalidated'
         or (promoted_by is not null and promoted_at is not null
             and length(btrim(coalesce(evidence_url, ''))) >= 3
             and data_origin = 'real_confirmed'))
);
create index model_versions_org_idx on public.model_versions (org_id);

create table public.flood_events (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  station_id    uuid not null,
  started_at    timestamptz not null,
  ended_at      timestamptz,
  peak_value    double precision,
  peak_unit     text,
  description   text,
  evidence_ref  text not null check (length(btrim(evidence_ref)) >= 3),
  data_origin   public.data_origin not null default 'real_unconfirmed',
  confirmed_by  uuid,
  source_type   public.source_type not null,
  recorded_by   uuid,
  created_at    timestamptz not null default now(),
  foreign key (station_id, org_id) references public.stations (id, org_id) on delete cascade,
  check (ended_at is null or ended_at >= started_at),
  check ((peak_value is null) = (peak_unit is null)),
  check ((data_origin = 'synthetic') = (source_type = 'synthetic')),
  check (data_origin <> 'real_confirmed' or confirmed_by is not null)
);
create index flood_events_station_idx on public.flood_events (station_id, started_at);

create table public.predictions (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null,
  station_id       uuid not null,
  model_version_id uuid not null,
  target           text not null check (target in ('flood_occurrence', 'stage')),
  issued_at        timestamptz not null,
  valid_from       timestamptz not null,
  valid_to         timestamptz not null,
  horizon_hours    integer not null check (horizon_hours between 1 and 720),
  probability      double precision check (probability between 0 and 1),
  p10              double precision,
  p50              double precision,
  p90              double precision,
  unit             text,
  source_type      public.source_type not null default 'forecast'
                   check (source_type in ('forecast', 'synthetic')),
  input_snapshot   jsonb not null check (jsonb_typeof(input_snapshot) = 'object' and input_snapshot <> '{}'::jsonb),
  status           public.service_status not null default 'unvalidated' check (status = 'unvalidated'),
  created_at       timestamptz not null default now(),
  foreign key (station_id, org_id) references public.stations (id, org_id) on delete cascade,
  foreign key (model_version_id, org_id) references public.model_versions (id, org_id) on delete restrict,
  check (valid_to > valid_from and valid_from >= issued_at),
  check (target <> 'flood_occurrence' or probability is not null),
  check (target <> 'stage' or (p10 is not null and p50 is not null and p90 is not null
                                and p10 <= p50 and p50 <= p90 and unit is not null))
);
create index predictions_station_valid_idx on public.predictions (station_id, valid_to desc);
create index predictions_model_idx on public.predictions (model_version_id);

create table public.backtest_runs (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null,
  model_version_id   uuid not null,
  station_id         uuid not null,
  evaluation_origin  public.data_origin not null,
  train_end          timestamptz,
  holdout_start      timestamptz not null,
  holdout_end        timestamptz not null,
  horizon_hours      integer not null check (horizon_hours between 1 and 720),
  event_threshold    double precision not null,
  event_threshold_unit text not null check (length(btrim(event_threshold_unit)) > 0),
  event_basis        text not null check (length(btrim(event_basis)) >= 20),
  n_forecasts        integer not null check (n_forecasts >= 0),
  hits               integer not null check (hits >= 0),
  misses             integer not null check (misses >= 0),
  false_alarms       integer not null check (false_alarms >= 0),
  correct_negatives  integer not null check (correct_negatives >= 0),
  pod                double precision check (pod between 0 and 1),
  far                double precision check (far between 0 and 1),
  csi                double precision check (csi between 0 and 1),
  brier              double precision check (brier between 0 and 1),
  median_lead_time_s double precision check (median_lead_time_s >= 0),
  reliability        jsonb,
  extreme_events     jsonb,
  is_synthetic       boolean not null,
  notes              text,
  run_by             text not null check (length(btrim(run_by)) > 0),
  created_at         timestamptz not null default now(),
  foreign key (station_id, org_id) references public.stations (id, org_id) on delete cascade,
  foreign key (model_version_id, org_id) references public.model_versions (id, org_id) on delete restrict,
  check (holdout_end > holdout_start),
  check (train_end is null or train_end <= holdout_start),
  check (hits + misses + false_alarms + correct_negatives = n_forecasts),
  check (is_synthetic = (evaluation_origin = 'synthetic'))
);
create index backtest_runs_model_idx on public.backtest_runs (model_version_id, created_at desc);

-- Immutability: predictions and backtest runs are never edited or deleted.
create function private.forbid_change() returns trigger
language plpgsql set search_path = ''
as $$ begin raise exception '% rows are immutable', tg_table_name using errcode = '55000'; end $$;
create trigger predictions_immutable before update or delete on public.predictions
  for each row execute function private.forbid_change();
create trigger backtest_runs_immutable before update or delete on public.backtest_runs
  for each row execute function private.forbid_change();

-- model_versions: only promote_model_version() may change status fields; the rest never changes.
create function private.model_versions_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'model versions are never deleted' using errcode = '55000';
  end if;
  if (new.id, new.org_id, new.name, new.version, new.kind, new.target, new.data_origin,
      new.real_data_confirmed_by, new.real_data_evidence, new.training_data_ref::text, new.created_by)
     is distinct from
     (old.id, old.org_id, old.name, old.version, old.kind, old.target, old.data_origin,
      old.real_data_confirmed_by, old.real_data_evidence, old.training_data_ref::text, old.created_by) then
    raise exception 'a registered model version cannot be edited; register a new version'
      using errcode = '55000';
  end if;
  if (new.status, new.promoted_by, new.promoted_at, new.evidence_url)
     is distinct from (old.status, old.promoted_by, old.promoted_at, old.evidence_url)
     and coalesce(current_setting('hydrosight.promoting', true), '') <> 'on' then
    raise exception 'status changes only through promote_model_version' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger model_versions_guard before update or delete on public.model_versions
  for each row execute function private.model_versions_guard();

create trigger audit_model_versions after insert or update or delete on public.model_versions
  for each row execute function private.audit_row_change();
create trigger audit_flood_events after insert or update or delete on public.flood_events
  for each row execute function private.audit_row_change();
create trigger audit_backtest_runs after insert on public.backtest_runs
  for each row execute function private.audit_row_change();

alter table public.model_versions enable row level security;
alter table public.flood_events   enable row level security;
alter table public.predictions    enable row level security;
alter table public.backtest_runs  enable row level security;
revoke all on public.model_versions, public.flood_events, public.predictions, public.backtest_runs
  from anon, authenticated, service_role;
grant select on public.model_versions, public.flood_events, public.predictions, public.backtest_runs
  to authenticated, service_role;
-- The prediction engine (service role) may append predictions and backtest results, nothing else.
grant insert on public.predictions, public.backtest_runs to service_role;

create policy model_versions_select on public.model_versions for select to authenticated
  using (private.has_permission(org_id, 'models.read') or private.is_demo_org(org_id));
create policy flood_events_select on public.flood_events for select to authenticated
  using (private.has_permission(org_id, 'models.read') or private.is_demo_org(org_id));
create policy predictions_select on public.predictions for select to authenticated
  using (private.has_permission(org_id, 'readings.read') or private.is_demo_org(org_id));
create policy backtest_runs_select on public.backtest_runs for select to authenticated
  using (private.has_permission(org_id, 'models.read') or private.is_demo_org(org_id));

-- Register a model version. Claiming real data needs models.promote (a human authority act).
create function public.register_model_version(
  p_org uuid, p_name text, p_version text, p_kind text, p_target text,
  p_description text default null, p_code_ref text default null,
  p_training_data_ref jsonb default null,
  p_data_origin public.data_origin default 'synthetic', p_real_data_evidence text default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid; v_confirmer uuid;
begin
  if auth.uid() is null or not private.has_permission(p_org, 'models.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_data_origin = 'real_confirmed' then
    if not private.has_permission(p_org, 'models.promote') then
      raise exception 'only a holder of models.promote can confirm data as real' using errcode = '42501';
    end if;
    v_confirmer := auth.uid();
  end if;
  insert into public.model_versions (org_id, name, version, kind, target, description, code_ref,
      training_data_ref, data_origin, real_data_confirmed_by, real_data_evidence, created_by)
  values (p_org, p_name, p_version, p_kind, p_target, p_description, p_code_ref,
      p_training_data_ref, p_data_origin, v_confirmer, p_real_data_evidence, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Promote (or demote) a model version. Never by its registrant, always with evidence.
create function public.promote_model_version(p_id uuid, p_status public.service_status, p_evidence_url text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare m public.model_versions;
begin
  select * into m from public.model_versions where id = p_id for update;
  if not found or auth.uid() is null or not private.has_permission(m.org_id, 'models.promote') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if m.created_by is not distinct from auth.uid() then
    raise exception 'the person who registered a model cannot promote it' using errcode = '42501';
  end if;
  if p_status = 'unvalidated' then
    perform set_config('hydrosight.promoting', 'on', true);
    update public.model_versions
       set status = 'unvalidated', promoted_by = null, promoted_at = null, evidence_url = null
     where id = p_id;
    return;
  end if;
  if p_evidence_url is null or length(btrim(p_evidence_url)) < 3 then
    raise exception 'promotion needs an evidence link' using errcode = '22023';
  end if;
  if m.data_origin <> 'real_confirmed' then
    raise exception 'a model on synthetic or unconfirmed data cannot be promoted' using errcode = '55000';
  end if;
  if not exists (
    select 1 from public.backtest_runs b
    where b.model_version_id = p_id and not b.is_synthetic and b.evaluation_origin = 'real_confirmed'
  ) then
    raise exception 'promotion needs at least one backtest on confirmed real data' using errcode = '55000';
  end if;
  if p_status = 'operational' and m.status <> 'validated' then
    raise exception 'a model must be validated before it can be operational' using errcode = '55000';
  end if;
  perform set_config('hydrosight.promoting', 'on', true);
  update public.model_versions
     set status = p_status, promoted_by = auth.uid(), promoted_at = now(), evidence_url = btrim(p_evidence_url)
   where id = p_id;
end $$;

-- Record an observed flood event (ground truth for backtests). 'real_confirmed' needs models.promote.
create function public.record_flood_event(
  p_org uuid, p_station uuid, p_started_at timestamptz, p_ended_at timestamptz,
  p_peak_value double precision, p_peak_unit text, p_description text, p_evidence_ref text,
  p_data_origin public.data_origin default 'real_unconfirmed', p_source_type public.source_type default 'measured'
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid; v_confirmer uuid;
begin
  if auth.uid() is null or not private.has_permission(p_org, 'models.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_data_origin = 'real_confirmed' then
    if not private.has_permission(p_org, 'models.promote') then
      raise exception 'only a holder of models.promote can confirm an event as real' using errcode = '42501';
    end if;
    v_confirmer := auth.uid();
  end if;
  insert into public.flood_events (org_id, station_id, started_at, ended_at, peak_value, peak_unit,
      description, evidence_ref, data_origin, confirmed_by, source_type, recorded_by)
  values (p_org, p_station, p_started_at, p_ended_at, p_peak_value, p_peak_unit,
      p_description, p_evidence_ref, p_data_origin, v_confirmer, p_source_type, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.register_model_version(uuid, text, text, text, text, text, text, jsonb, public.data_origin, text),
                       public.promote_model_version(uuid, public.service_status, text),
                       public.record_flood_event(uuid, uuid, timestamptz, timestamptz, double precision, text, text, text, public.data_origin, public.source_type)
  from public, anon, service_role;
grant execute on function public.register_model_version(uuid, text, text, text, text, text, text, jsonb, public.data_origin, text),
                          public.promote_model_version(uuid, public.service_status, text),
                          public.record_flood_event(uuid, uuid, timestamptz, timestamptz, double precision, text, text, text, public.data_origin, public.source_type)
  to authenticated;

-- DOWN:
--   drop function public.record_flood_event, public.promote_model_version, public.register_model_version;
--   drop table public.backtest_runs, public.predictions, public.flood_events, public.model_versions;
--   drop function private.model_versions_guard, private.forbid_change;
--   drop type public.data_origin;
--   delete from public.role_permissions where permission_key in ('models.read','models.manage','models.promote');
--   delete from public.permissions where key in ('models.read','models.manage','models.promote');
