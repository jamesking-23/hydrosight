-- requires: postgis  (builds on 0009, whose data_origin type and models.* permissions it uses)
-- 0015: saved comparisons between a Flood Scenario and a documented real flood (ADR-013).
--
-- Rules enforced here, not only in the app:
--  * A record is a comparison, never a model result: source_type is always 'synthetic'.
--  * Records on the built-in demo terrain cannot be saved (terrain_is_demo must be false).
--  * Everything starts `unvalidated`. Only a holder of models.promote who is not the recorder
--    can mark a record validated, with an evidence link, and only when the event itself was
--    confirmed as real by a holder of models.promote. Records are immutable apart from that.
--  * Permissions reuse models.read / models.manage / models.promote. No new permission, no
--    default threshold, no score: the comparison JSON holds counts and differences only.
create table public.scenario_validations (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations (id) on delete cascade,
  event_name         text not null check (length(btrim(event_name)) between 1 and 160),
  event_date         date not null,
  evidence_ref       text not null check (length(btrim(evidence_ref)) >= 4),
  data_origin        public.data_origin not null default 'real_unconfirmed'
                       check (data_origin in ('real_unconfirmed', 'real_confirmed')),
  confirmed_by       uuid,
  terrain_name       text not null check (length(btrim(terrain_name)) >= 1),
  terrain_source     text not null check (length(btrim(terrain_source)) >= 3),
  terrain_licence    text not null check (length(btrim(terrain_licence)) >= 3),
  terrain_is_demo    boolean not null check (terrain_is_demo = false),
  inputs             jsonb not null check (jsonb_typeof(inputs) = 'object' and inputs <> '{}'::jsonb),
  wet_threshold_m    numeric not null check (wet_threshold_m > 0),
  points             jsonb not null check (jsonb_typeof(points) = 'array' and jsonb_array_length(points) between 1 and 500),
  comparison         jsonb not null check (jsonb_typeof(comparison) = 'object'),
  source_type        public.source_type not null default 'synthetic' check (source_type = 'synthetic'),
  status             public.service_status not null default 'unvalidated',
  promoted_by        uuid,
  promoted_at        timestamptz,
  evidence_url       text,
  recorded_by        uuid not null,
  created_at         timestamptz not null default now(),
  check (data_origin <> 'real_confirmed' or confirmed_by is not null),
  check (status = 'unvalidated'
         or (promoted_by is not null and promoted_at is not null
             and length(btrim(coalesce(evidence_url, ''))) >= 3
             and data_origin = 'real_confirmed')),
  check (status in ('unvalidated', 'validated'))
);
create index scenario_validations_org_idx on public.scenario_validations (org_id, created_at desc);

create function private.scenario_validations_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'scenario validation records are never deleted' using errcode = '55000';
  end if;
  if to_jsonb(new) - 'status' - 'promoted_by' - 'promoted_at' - 'evidence_url'
     is distinct from to_jsonb(old) - 'status' - 'promoted_by' - 'promoted_at' - 'evidence_url' then
    raise exception 'a saved comparison cannot be edited; save a new one' using errcode = '55000';
  end if;
  if (new.status, new.promoted_by, new.promoted_at, new.evidence_url)
     is distinct from (old.status, old.promoted_by, old.promoted_at, old.evidence_url)
     and coalesce(current_setting('hydrosight.promoting', true), '') <> 'on' then
    raise exception 'status changes only through promote_scenario_validation' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger scenario_validations_guard before update or delete on public.scenario_validations
  for each row execute function private.scenario_validations_guard();
create trigger audit_scenario_validations after insert or update or delete on public.scenario_validations
  for each row execute function private.audit_row_change();

alter table public.scenario_validations enable row level security;
revoke all on public.scenario_validations from anon, authenticated, service_role;
grant select on public.scenario_validations to authenticated, service_role;
create policy scenario_validations_select on public.scenario_validations for select to authenticated
  using (private.has_permission(org_id, 'models.read') or private.is_demo_org(org_id));

create function public.record_scenario_validation(
  p_org uuid, p_event_name text, p_event_date date, p_evidence_ref text,
  p_terrain_name text, p_terrain_source text, p_terrain_licence text, p_terrain_is_demo boolean,
  p_inputs jsonb, p_wet_threshold_m numeric, p_points jsonb, p_comparison jsonb,
  p_data_origin public.data_origin default 'real_unconfirmed'
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
  insert into public.scenario_validations (org_id, event_name, event_date, evidence_ref, data_origin, confirmed_by,
      terrain_name, terrain_source, terrain_licence, terrain_is_demo, inputs, wet_threshold_m, points,
      comparison, recorded_by)
  values (p_org, p_event_name, p_event_date, p_evidence_ref, p_data_origin, v_confirmer,
      p_terrain_name, p_terrain_source, p_terrain_licence, p_terrain_is_demo, p_inputs, p_wet_threshold_m,
      p_points, p_comparison, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create function public.promote_scenario_validation(p_id uuid, p_status public.service_status, p_evidence_url text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare r public.scenario_validations;
begin
  select * into r from public.scenario_validations where id = p_id for update;
  if not found or auth.uid() is null or not private.has_permission(r.org_id, 'models.promote') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if r.recorded_by is not distinct from auth.uid() then
    raise exception 'the person who saved a comparison cannot promote it' using errcode = '42501';
  end if;
  if p_status not in ('unvalidated', 'validated') then
    raise exception 'a comparison can only be unvalidated or validated' using errcode = '22023';
  end if;
  if p_status = 'unvalidated' then
    perform set_config('hydrosight.promoting', 'on', true);
    update public.scenario_validations
       set status = 'unvalidated', promoted_by = null, promoted_at = null, evidence_url = null
     where id = p_id;
    return;
  end if;
  if p_evidence_url is null or length(btrim(p_evidence_url)) < 3 then
    raise exception 'promotion needs an evidence link' using errcode = '22023';
  end if;
  if r.data_origin <> 'real_confirmed' then
    raise exception 'a comparison on an unconfirmed event cannot be promoted' using errcode = '55000';
  end if;
  perform set_config('hydrosight.promoting', 'on', true);
  update public.scenario_validations
     set status = 'validated', promoted_by = auth.uid(), promoted_at = now(), evidence_url = btrim(p_evidence_url)
   where id = p_id;
end $$;

revoke all on function public.record_scenario_validation(uuid, text, date, text, text, text, text, boolean, jsonb, numeric, jsonb, jsonb, public.data_origin),
                       public.promote_scenario_validation(uuid, public.service_status, text)
  from public, anon, service_role;
grant execute on function public.record_scenario_validation(uuid, text, date, text, text, text, text, boolean, jsonb, numeric, jsonb, jsonb, public.data_origin),
                          public.promote_scenario_validation(uuid, public.service_status, text)
  to authenticated;

-- DOWN:
--   drop function public.promote_scenario_validation, public.record_scenario_validation;
--   drop table public.scenario_validations; drop function private.scenario_validations_guard;
