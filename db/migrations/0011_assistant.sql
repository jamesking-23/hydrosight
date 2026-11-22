-- requires: postgis
-- 0011: grounded AI assistant (Phase 8): per-organisation switch and token cap, and an
-- append-only log of every prompt and tool call.
--
--  * The assistant is OFF for every organisation until an organisation admin turns it on AND
--    sets a daily token cap. There is no default cap and no default switch-on.
--  * Caps are in tokens, not money: HydroSight does not assume any provider price.
--  * The assistant reads data through the signed-in person's own session, so row-level security
--    and role permissions apply unchanged. Nothing here grants the assistant new read access.
--  * The log is append-only. It stores the question, the structured answer, every tool call and
--    token counts. It stores no secrets and no model API key.

insert into public.permissions (key, description, privileged) values
  ('assistant.use',    'Ask the data assistant questions (read-only)', false),
  ('assistant.manage', 'Switch the assistant on or off and set its token cap', false);
insert into public.role_permissions (role_key, permission_key) values
  ('org_admin', 'assistant.use'), ('org_admin', 'assistant.manage'),
  ('government_authority', 'assistant.use'),
  ('hydrologist', 'assistant.use'),
  ('meteorologist', 'assistant.use'),
  ('emergency_response_officer', 'assistant.use'),
  ('enterprise_customer', 'assistant.use');

create table public.assistant_limits (
  org_id              uuid primary key references public.organizations (id) on delete cascade,
  enabled             boolean not null default false,
  daily_token_cap     integer not null check (daily_token_cap between 1000 and 5000000),
  max_tokens_per_turn integer not null default 4000 check (max_tokens_per_turn between 500 and 16000),
  updated_by          uuid,
  updated_at          timestamptz not null default now()
);

create table public.assistant_turns (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations (id) on delete cascade,
  user_id        uuid not null,
  question       text not null check (length(question) between 1 and 2000),
  status         text not null check (status in ('answered', 'refused', 'capped', 'not_configured', 'error')),
  refusal_reason text,
  answer         jsonb,
  tool_calls     jsonb not null default '[]'::jsonb,
  tokens_in      integer not null default 0 check (tokens_in >= 0),
  tokens_out     integer not null default 0 check (tokens_out >= 0),
  provider       text,
  model          text,
  flags          jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index assistant_turns_org_day_idx on public.assistant_turns (org_id, created_at desc);

create trigger assistant_turns_immutable before update or delete on public.assistant_turns
  for each row execute function private.forbid_change();
create trigger audit_assistant_limits after insert or update or delete on public.assistant_limits
  for each row execute function private.audit_row_change();

alter table public.assistant_limits enable row level security;
alter table public.assistant_turns  enable row level security;
revoke all on public.assistant_limits, public.assistant_turns from anon, authenticated, service_role;
grant select on public.assistant_limits, public.assistant_turns to authenticated, service_role;

create policy assistant_limits_select on public.assistant_limits for select to authenticated
  using (private.has_permission(org_id, 'assistant.manage') or private.has_permission(org_id, 'assistant.use'));
create policy assistant_turns_select on public.assistant_turns for select to authenticated
  using (private.has_permission(org_id, 'assistant.manage')
         or (user_id = auth.uid() and private.has_permission(org_id, 'assistant.use')));

create function public.set_assistant_limit(
  p_org uuid, p_enabled boolean, p_daily_token_cap integer, p_max_tokens_per_turn integer default 4000
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not private.has_permission(p_org, 'assistant.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.assistant_limits (org_id, enabled, daily_token_cap, max_tokens_per_turn, updated_by)
  values (p_org, p_enabled, p_daily_token_cap, p_max_tokens_per_turn, auth.uid())
  on conflict (org_id) do update
    set enabled = excluded.enabled, daily_token_cap = excluded.daily_token_cap,
        max_tokens_per_turn = excluded.max_tokens_per_turn, updated_by = auth.uid(), updated_at = now();
end $$;

-- Asked before every question. Never raises for "off" or "capped": it says why, so the turn can be logged.
create function public.assistant_begin(p_org uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare l public.assistant_limits; used bigint; day_start timestamptz;
begin
  if auth.uid() is null or not private.has_permission(p_org, 'assistant.use') then
    raise exception 'not authorized' using errcode = '42501';
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

create function public.log_assistant_turn(
  p_org uuid, p_question text, p_status text, p_refusal_reason text, p_answer jsonb, p_tool_calls jsonb,
  p_tokens_in integer, p_tokens_out integer, p_provider text, p_model text, p_flags jsonb
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if auth.uid() is null or not private.has_permission(p_org, 'assistant.use') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.assistant_turns (org_id, user_id, question, status, refusal_reason, answer, tool_calls,
      tokens_in, tokens_out, provider, model, flags)
  values (p_org, auth.uid(), left(p_question, 2000), p_status, p_refusal_reason, p_answer,
      coalesce(p_tool_calls, '[]'::jsonb), greatest(coalesce(p_tokens_in, 0), 0),
      greatest(coalesce(p_tokens_out, 0), 0), p_provider, p_model, coalesce(p_flags, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.set_assistant_limit(uuid, boolean, integer, integer),
                       public.assistant_begin(uuid),
                       public.log_assistant_turn(uuid, text, text, text, jsonb, jsonb, integer, integer, text, text, jsonb)
  from public, anon, service_role;
grant execute on function public.set_assistant_limit(uuid, boolean, integer, integer),
                          public.assistant_begin(uuid),
                          public.log_assistant_turn(uuid, text, text, text, jsonb, jsonb, integer, integer, text, text, jsonb)
  to authenticated;

-- DOWN:
--   drop function public.log_assistant_turn, public.assistant_begin, public.set_assistant_limit;
--   drop table public.assistant_turns, public.assistant_limits;
--   delete from public.role_permissions where permission_key in ('assistant.use','assistant.manage');
--   delete from public.permissions where key in ('assistant.use','assistant.manage');
