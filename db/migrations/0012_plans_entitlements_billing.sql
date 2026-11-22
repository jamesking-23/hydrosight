-- requires: postgis
-- 0012: public-site intake, plans, entitlements, usage and invoices (Phase 9).
--
--  * No prices, plan names or limits are invented here. Plans are created by the platform owner,
--    start unpublished, and carry a price only if the owner enters one with a written basis.
--  * An organisation with NO plan assignment is "unmanaged": nothing is gated (pilots, demos,
--    existing organisations). An assigned plan that is suspended, ended or past its end date blocks
--    creating new stations, sensors, users and assets, and never deletes or hides existing data.
--  * Limits: a missing limit row means 0 (nothing allowed); a NULL value means explicitly unlimited.
--  * Invoices are typed in by the platform owner. HydroSight calculates no prices or tax. An issued
--    invoice cannot change; "paid" needs a payment reference. No payment provider is connected.
--  * Platform roles gain access to: demo requests, plans, plan assignments and invoices only.

insert into public.permissions (key, description, privileged) values
  ('billing.read', 'View the organisation plan, usage and issued invoices', false);
insert into public.role_permissions (role_key, permission_key) values
  ('org_admin', 'billing.read'), ('enterprise_customer', 'billing.read');

create function private.is_platform_member() returns boolean
language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.platform_memberships
     where user_id = auth.uid() and role_key in ('super_admin', 'platform_admin'));
$$;

-- ---------------------------------------------------------------------------------------------
-- Plans
-- ---------------------------------------------------------------------------------------------
create table public.plans (
  key              text primary key check (key ~ '^[a-z][a-z0-9_]{1,29}$'),
  name             text not null check (length(btrim(name)) between 1 and 60),
  description      text not null default '',
  published        boolean not null default false,
  sort_order       integer not null default 100,
  price_amount     numeric(18, 2) check (price_amount >= 0),
  price_currency   text check (price_currency ~ '^[A-Z]{3}$'),
  price_interval   text check (price_interval in ('month', 'year')),
  price_basis      text check (length(btrim(price_basis)) >= 10),
  created_at       timestamptz not null default now(),
  check ((price_amount is null) = (price_currency is null)
         and (price_amount is null) = (price_interval is null)
         and (price_amount is null) = (price_basis is null))
);
create table public.plan_limits (
  plan_key  text not null references public.plans (key) on delete cascade,
  limit_key text not null check (limit_key in ('locations', 'sensors', 'users')),
  value     integer check (value >= 0),   -- NULL = unlimited, stated on purpose
  primary key (plan_key, limit_key)
);
create table public.plan_features (
  plan_key    text not null references public.plans (key) on delete cascade,
  feature_key text not null check (feature_key in
    ('map', 'monitoring', 'alerts', 'forecasts', 'analytics', 'assets', 'assistant', 'community', 'api_access')),
  primary key (plan_key, feature_key)
);
create table public.org_plans (
  org_id     uuid primary key references public.organizations (id) on delete cascade,
  plan_key   text not null references public.plans (key),
  status     text not null check (status in ('trial', 'active', 'suspended', 'ended')),
  starts_at  timestamptz not null default now(),
  ends_at    timestamptz,
  note       text,
  set_by     uuid,
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

-- ---------------------------------------------------------------------------------------------
-- Demo requests (public intake). No IP address or device data is stored.
-- ---------------------------------------------------------------------------------------------
create table public.demo_requests (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (length(btrim(name)) between 2 and 120),
  email           text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 254),
  organisation    text not null check (length(btrim(organisation)) between 2 and 160),
  role_title      text check (length(role_title) <= 120),
  country         text check (length(country) <= 80),
  interest        text check (length(interest) <= 200),
  message         text check (length(message) <= 2000),
  consent_version text not null,
  status          text not null default 'new' check (status in ('new', 'contacted', 'qualified', 'closed')),
  notes           text,
  handled_by      uuid,
  handled_at      timestamptz,
  created_at      timestamptz not null default now()
);
create index demo_requests_created_idx on public.demo_requests (created_at desc);
create index demo_requests_email_idx on public.demo_requests (lower(email), created_at desc);

-- ---------------------------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------------------------
create sequence public.invoice_number_seq;
create table public.invoices (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations (id) on delete restrict,
  number            text unique,
  status            text not null default 'draft' check (status in ('draft', 'issued', 'paid', 'void')),
  period_start      date not null,
  period_end        date not null,
  currency          text not null check (currency ~ '^[A-Z]{3}$'),
  lines             jsonb not null check (jsonb_typeof(lines) = 'array'),
  subtotal          numeric(18, 2) not null check (subtotal >= 0),
  tax_amount        numeric(18, 2) not null default 0 check (tax_amount >= 0),
  tax_label         text,
  total             numeric(18, 2) not null check (total >= 0),
  notes             text,
  issued_at         timestamptz,
  due_at            date,
  paid_at           timestamptz,
  payment_method    text,
  payment_reference text,
  void_reason       text,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  check (period_end >= period_start),
  check (total = subtotal + tax_amount),
  check (status = 'draft' or (number is not null and issued_at is not null and jsonb_array_length(lines) > 0)),
  check (status <> 'paid' or (paid_at is not null and length(btrim(coalesce(payment_reference, ''))) >= 3
                              and length(btrim(coalesce(payment_method, ''))) >= 2)),
  check (status <> 'void' or length(btrim(coalesce(void_reason, ''))) >= 5)
);
create index invoices_org_idx on public.invoices (org_id, created_at desc);

create function private.invoice_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'invoices cannot be deleted; void them instead' using errcode = '42501';
  end if;
  if old.status <> 'draft' then
    if (new.org_id, new.number, new.period_start, new.period_end, new.currency, new.lines, new.subtotal,
        new.tax_amount, new.tax_label, new.total, new.issued_at, new.created_by)
       is distinct from
       (old.org_id, old.number, old.period_start, old.period_end, old.currency, old.lines, old.subtotal,
        old.tax_amount, old.tax_label, old.total, old.issued_at, old.created_by) then
      raise exception 'an issued invoice cannot be changed' using errcode = '42501';
    end if;
    if old.status in ('paid', 'void') and new.status <> old.status then
      raise exception 'a % invoice cannot change status', old.status using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger invoices_guard before update or delete on public.invoices
  for each row execute function private.invoice_guard();

create trigger audit_plans after insert or update or delete on public.plans
  for each row execute function private.audit_row_change();
create trigger audit_org_plans after insert or update or delete on public.org_plans
  for each row execute function private.audit_row_change();
create trigger audit_invoices after insert or update or delete on public.invoices
  for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------------------------
alter table public.plans          enable row level security;
alter table public.plan_limits    enable row level security;
alter table public.plan_features  enable row level security;
alter table public.org_plans      enable row level security;
alter table public.demo_requests  enable row level security;
alter table public.invoices       enable row level security;
revoke all on public.plans, public.plan_limits, public.plan_features, public.org_plans,
              public.demo_requests, public.invoices from anon, authenticated, service_role;
grant select on public.plans, public.plan_limits, public.plan_features to anon, authenticated;
grant select on public.org_plans, public.demo_requests, public.invoices to authenticated;
grant select on public.plans, public.plan_limits, public.plan_features, public.org_plans,
                public.demo_requests, public.invoices to service_role;

-- anon has no access to the private schema, so the public (anon) policies never call a private function.
create policy plans_select_anon on public.plans for select to anon using (published);
create policy plans_select on public.plans for select to authenticated
  using (published or private.is_platform_member());
create policy plan_limits_select_anon on public.plan_limits for select to anon
  using (exists (select 1 from public.plans p where p.key = plan_key and p.published));
create policy plan_limits_select on public.plan_limits for select to authenticated
  using (exists (select 1 from public.plans p where p.key = plan_key and (p.published or private.is_platform_member())));
create policy plan_features_select_anon on public.plan_features for select to anon
  using (exists (select 1 from public.plans p where p.key = plan_key and p.published));
create policy plan_features_select on public.plan_features for select to authenticated
  using (exists (select 1 from public.plans p where p.key = plan_key and (p.published or private.is_platform_member())));
create policy org_plans_select on public.org_plans for select to authenticated
  using (private.has_permission(org_id, 'billing.read') or private.is_platform_member());
create policy demo_requests_select on public.demo_requests for select to authenticated
  using (private.is_platform_member());
create policy invoices_select on public.invoices for select to authenticated
  using (private.is_platform_member() or (status <> 'draft' and private.has_permission(org_id, 'billing.read')));

-- ---------------------------------------------------------------------------------------------
-- Public intake
-- ---------------------------------------------------------------------------------------------
create function public.submit_demo_request(
  p_name text, p_email text, p_organisation text, p_role_title text, p_country text,
  p_interest text, p_message text, p_consent boolean, p_consent_version text
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if p_consent is not true then
    raise exception 'consent to be contacted is required' using errcode = '22023';
  end if;
  -- The same address asking again within a day is the same request: no duplicate, no new row.
  select id into v_id from public.demo_requests
   where lower(email) = lower(btrim(p_email)) and created_at > now() - interval '1 day' limit 1;
  if v_id is not null then
    return v_id;
  end if;
  -- A blunt overall cap against floods; there is no per-visitor tracking (no IP is stored).
  if (select count(*) from public.demo_requests where created_at > now() - interval '1 hour') >= 30 then
    raise exception 'too many requests, try again later' using errcode = '54000';
  end if;
  insert into public.demo_requests (name, email, organisation, role_title, country, interest, message, consent_version)
  values (btrim(p_name), btrim(p_email), btrim(p_organisation), nullif(btrim(p_role_title), ''),
          nullif(btrim(p_country), ''), nullif(btrim(p_interest), ''), nullif(btrim(p_message), ''), p_consent_version)
  returning id into v_id;
  return v_id;
end $$;

create function public.update_demo_request(p_id uuid, p_status text, p_notes text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_platform_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.demo_requests
     set status = p_status, notes = p_notes, handled_by = auth.uid(), handled_at = now()
   where id = p_id;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Plans and assignment (platform owner only)
-- ---------------------------------------------------------------------------------------------
create function public.save_plan(
  p_key text, p_name text, p_description text, p_published boolean, p_sort integer,
  p_limits jsonb, p_features text[],
  p_price_amount numeric default null, p_price_currency text default null,
  p_price_interval text default null, p_price_basis text default null
) returns void
language plpgsql security definer set search_path = ''
as $$
declare k text; v jsonb;
begin
  if not private.is_platform_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.plans (key, name, description, published, sort_order, price_amount, price_currency, price_interval, price_basis)
  values (p_key, p_name, coalesce(p_description, ''), p_published, p_sort, p_price_amount,
          upper(p_price_currency), p_price_interval, p_price_basis)
  on conflict (key) do update set name = excluded.name, description = excluded.description,
     published = excluded.published, sort_order = excluded.sort_order, price_amount = excluded.price_amount,
     price_currency = excluded.price_currency, price_interval = excluded.price_interval,
     price_basis = excluded.price_basis;
  delete from public.plan_limits where plan_key = p_key;
  for k, v in select * from jsonb_each(coalesce(p_limits, '{}'::jsonb)) loop
    insert into public.plan_limits (plan_key, limit_key, value)
    values (p_key, k, case when jsonb_typeof(v) = 'null' then null else (v #>> '{}')::integer end);
  end loop;
  delete from public.plan_features where plan_key = p_key;
  insert into public.plan_features (plan_key, feature_key)
  select p_key, f from unnest(coalesce(p_features, '{}'::text[])) f;
end $$;

create function public.assign_plan(p_org uuid, p_plan text, p_status text, p_ends_at timestamptz, p_note text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_platform_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.org_plans (org_id, plan_key, status, ends_at, note, set_by)
  values (p_org, p_plan, p_status, p_ends_at, p_note, auth.uid())
  on conflict (org_id) do update set plan_key = excluded.plan_key, status = excluded.status,
     ends_at = excluded.ends_at, note = excluded.note, set_by = auth.uid(), updated_at = now();
end $$;

-- ---------------------------------------------------------------------------------------------
-- Entitlements
-- ---------------------------------------------------------------------------------------------
-- Is the assignment currently in force? (No assignment = unmanaged = not gated.)
create function private.org_plan_in_force(p_org uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select status in ('trial', 'active') and starts_at <= now() and (ends_at is null or ends_at > now())
                     from public.org_plans where org_id = p_org), true);
$$;

create function private.org_feature_allowed(p_org uuid, p_feature text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select case
    when not exists (select 1 from public.org_plans where org_id = p_org) then true
    when not private.org_plan_in_force(p_org) then false
    else exists (select 1 from public.org_plans o join public.plan_features f on f.plan_key = o.plan_key
                  where o.org_id = p_org and f.feature_key = p_feature)
  end;
$$;

create function private.org_usage_count(p_org uuid, p_key text) returns integer
language sql stable security definer set search_path = ''
as $$
  select case p_key
    when 'locations' then (select count(*)::int from public.stations where org_id = p_org)
    when 'sensors'   then (select count(*)::int from public.sensors where org_id = p_org)
    when 'users'     then (select count(distinct user_id)::int from public.memberships where org_id = p_org and status = 'active')
  end;
$$;

-- Raises when creating one more of `p_key` would break the plan.
create function private.enforce_limit(p_org uuid, p_key text) returns void
language plpgsql security definer set search_path = ''
as $$
declare lim integer; has_row boolean;
begin
  if not exists (select 1 from public.org_plans where org_id = p_org) then
    return;
  end if;
  if not private.org_plan_in_force(p_org) then
    raise exception 'the organisation plan is not active: cannot add %', p_key using errcode = '53400';
  end if;
  select true, l.value into has_row, lim
    from public.org_plans o join public.plan_limits l on l.plan_key = o.plan_key and l.limit_key = p_key
   where o.org_id = p_org;
  if not coalesce(has_row, false) then
    lim := 0;
  end if;
  if lim is not null and private.org_usage_count(p_org, p_key) >= lim then
    raise exception 'plan limit reached for %: % allowed', p_key, lim using errcode = '53400';
  end if;
end $$;

create function private.limit_stations() returns trigger language plpgsql set search_path = ''
as $$ begin perform private.enforce_limit(new.org_id, 'locations'); return new; end $$;
create function private.limit_sensors() returns trigger language plpgsql set search_path = ''
as $$ begin perform private.enforce_limit(new.org_id, 'sensors'); return new; end $$;
create function private.limit_users() returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'active' and not exists (
       select 1 from public.memberships where org_id = new.org_id and user_id = new.user_id and status = 'active') then
    perform private.enforce_limit(new.org_id, 'users');
  end if;
  return new;
end $$;
create function private.gate_assets() returns trigger language plpgsql set search_path = ''
as $$
begin
  if not private.org_feature_allowed(new.org_id, 'assets') then
    raise exception 'feature not included in the organisation plan: assets' using errcode = '53400';
  end if;
  return new;
end $$;

create trigger stations_plan_limit before insert on public.stations for each row execute function private.limit_stations();
create trigger sensors_plan_limit  before insert on public.sensors  for each row execute function private.limit_sensors();
create trigger memberships_plan_limit before insert on public.memberships for each row execute function private.limit_users();
create trigger assets_plan_gate before insert on public.assets for each row execute function private.gate_assets();

-- The assistant switch (0011) also respects the plan.
create or replace function public.assistant_begin(p_org uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare l public.assistant_limits; used bigint; day_start timestamptz;
begin
  if auth.uid() is null or not private.has_permission(p_org, 'assistant.use') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not private.org_feature_allowed(p_org, 'assistant') then
    return jsonb_build_object('allowed', false, 'reason', 'not_in_plan');
  end if;
  select * into l from public.assistant_limits where org_id = p_org;
  if not found or not l.enabled then
    return jsonb_build_object('allowed', false, 'reason', 'not_enabled');
  end if;
  day_start := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  select coalesce(sum(tokens_in + tokens_out), 0) into used
    from public.assistant_turns where org_id = p_org and created_at >= day_start;
  if used >= l.daily_token_cap then
    return jsonb_build_object('allowed', false, 'reason', 'daily_cap_reached',
                              'used_today', used, 'daily_token_cap', l.daily_token_cap);
  end if;
  return jsonb_build_object('allowed', true, 'used_today', used, 'daily_token_cap', l.daily_token_cap,
                            'remaining_tokens', l.daily_token_cap - used,
                            'max_tokens_per_turn', least(l.max_tokens_per_turn, (l.daily_token_cap - used)::integer));
end $$;

-- What the web app asks: the plan, what is allowed, and live usage. Visible to members of the organisation.
create function public.entitlements(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare o public.org_plans; pl public.plans; feats jsonb; lims jsonb := '{}'::jsonb; k text; lim integer; has_row boolean;
begin
  if auth.uid() is null or not (
       private.is_platform_member()
       or exists (select 1 from public.memberships where org_id = p_org and user_id = auth.uid() and status = 'active')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into o from public.org_plans where org_id = p_org;
  if not found then
    return jsonb_build_object('managed', false, 'in_force', true,
      'note', 'No plan is assigned to this organisation, so nothing is limited.',
      'usage', jsonb_build_object('locations', private.org_usage_count(p_org, 'locations'),
        'sensors', private.org_usage_count(p_org, 'sensors'), 'users', private.org_usage_count(p_org, 'users')));
  end if;
  select * into pl from public.plans where key = o.plan_key;
  select coalesce(jsonb_agg(feature_key order by feature_key), '[]'::jsonb) into feats
    from public.plan_features where plan_key = o.plan_key;
  foreach k in array array['locations', 'sensors', 'users'] loop
    select true, l.value into has_row, lim from public.plan_limits l where l.plan_key = o.plan_key and l.limit_key = k;
    lims := lims || jsonb_build_object(k, jsonb_build_object(
      'limit', case when coalesce(has_row, false) then lim else 0 end,
      'unlimited', coalesce(has_row, false) and lim is null,
      'used', private.org_usage_count(p_org, k)));
  end loop;
  return jsonb_build_object('managed', true, 'plan_key', o.plan_key, 'plan_name', pl.name, 'status', o.status,
    'starts_at', o.starts_at, 'ends_at', o.ends_at, 'in_force', private.org_plan_in_force(p_org),
    'features', feats, 'limits', lims);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Invoices (platform owner only; amounts are typed in, never calculated)
-- ---------------------------------------------------------------------------------------------
create function public.create_invoice_draft(
  p_org uuid, p_period_start date, p_period_end date, p_currency text, p_lines jsonb,
  p_tax_amount numeric, p_tax_label text, p_due date, p_notes text
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid; v_sub numeric(18, 2); ln jsonb;
begin
  if not private.is_platform_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'an invoice needs at least one line' using errcode = '22023';
  end if;
  v_sub := 0;
  for ln in select * from jsonb_array_elements(p_lines) loop
    if coalesce(btrim(ln ->> 'description'), '') = '' or (ln ->> 'amount') is null or (ln ->> 'amount')::numeric < 0 then
      raise exception 'each line needs a description and a non-negative amount' using errcode = '22023';
    end if;
    v_sub := v_sub + (ln ->> 'amount')::numeric;
  end loop;
  insert into public.invoices (org_id, period_start, period_end, currency, lines, subtotal, tax_amount, tax_label,
                               total, due_at, notes, created_by)
  values (p_org, p_period_start, p_period_end, upper(p_currency), p_lines, v_sub, coalesce(p_tax_amount, 0),
          p_tax_label, v_sub + coalesce(p_tax_amount, 0), p_due, p_notes, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create function public.issue_invoice(p_id uuid) returns text
language plpgsql security definer set search_path = ''
as $$
declare v_num text;
begin
  if not private.is_platform_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_num := 'HS-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.invoice_number_seq')::text, 6, '0');
  update public.invoices set status = 'issued', number = v_num, issued_at = now()
   where id = p_id and status = 'draft';
  if not found then
    raise exception 'only a draft invoice can be issued' using errcode = '22023';
  end if;
  return v_num;
end $$;

create function public.mark_invoice_paid(p_id uuid, p_method text, p_reference text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_platform_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.invoices set status = 'paid', paid_at = now(), payment_method = p_method, payment_reference = p_reference
   where id = p_id and status = 'issued';
  if not found then
    raise exception 'only an issued invoice can be marked paid' using errcode = '22023';
  end if;
end $$;

create function public.void_invoice(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_platform_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.invoices set status = 'void', void_reason = p_reason
   where id = p_id and status in ('draft', 'issued');
  if not found then
    raise exception 'only a draft or issued invoice can be voided' using errcode = '22023';
  end if;
end $$;

revoke all on function public.submit_demo_request(text, text, text, text, text, text, text, boolean, text),
  public.update_demo_request(uuid, text, text),
  public.save_plan(text, text, text, boolean, integer, jsonb, text[], numeric, text, text, text),
  public.assign_plan(uuid, text, text, timestamptz, text),
  public.entitlements(uuid),
  public.create_invoice_draft(uuid, date, date, text, jsonb, numeric, text, date, text),
  public.issue_invoice(uuid), public.mark_invoice_paid(uuid, text, text), public.void_invoice(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_demo_request(text, text, text, text, text, text, text, boolean, text) to anon, authenticated;
grant execute on function public.update_demo_request(uuid, text, text),
  public.save_plan(text, text, text, boolean, integer, jsonb, text[], numeric, text, text, text),
  public.assign_plan(uuid, text, text, timestamptz, text),
  public.entitlements(uuid),
  public.create_invoice_draft(uuid, date, date, text, jsonb, numeric, text, date, text),
  public.issue_invoice(uuid), public.mark_invoice_paid(uuid, text, text), public.void_invoice(uuid, text)
  to authenticated;
-- assistant_begin keeps its 0011 grants (create or replace preserves them).

-- DOWN:
--   drop trigger assets_plan_gate on public.assets; drop trigger memberships_plan_limit on public.memberships;
--   drop trigger sensors_plan_limit on public.sensors; drop trigger stations_plan_limit on public.stations;
--   (restore assistant_begin from 0011), drop the functions above, then
--   drop table public.invoices, public.demo_requests, public.org_plans, public.plan_features, public.plan_limits, public.plans;
--   drop sequence public.invoice_number_seq;
