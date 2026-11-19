-- 0002_identity_tenancy_rbac_audit.sql
-- Phase 1: identity, tenancy, RBAC (roles/permissions as data), invitations, API keys,
-- append-only audit log. Row-level security on EVERY table (rule 7).
--
-- Design notes
--  * Authentication itself is Supabase Auth (auth.users). This migration only reads
--    auth.uid() / auth.jwt().
--  * Permissions are checked inside the database (private.has_permission), so isolation does
--    not depend on application code. Roles flagged requires_mfa only grant anything when the
--    session is MFA-verified (JWT claim aal = 'aal2').
--  * Secrets (invitation tokens, API keys) are stored only as SHA-256 hashes; the plaintext is
--    returned once by the creating function and never stored.
--  * The role -> permission matrix below is a DRAFT for owner / domain-expert review.
--  * Platform roles (super_admin, platform_admin) have NO row access through RLS in Phase 1.
--    They act only through the service role (backend), whose use is audited by triggers.
--  * Not reversible by a single statement; see DOWN at the bottom (manual, destructive).

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Small helpers (no pgcrypto dependency: built-in sha256() and gen_random_uuid())
-- ---------------------------------------------------------------------------------------------
create function private.hash_secret(p_secret text) returns text
language sql immutable set search_path = ''
as $$ select encode(sha256(convert_to(p_secret, 'UTF8')), 'hex') $$;

create function private.random_token() returns text
language sql volatile set search_path = ''
as $$ select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') $$;

revoke all on function private.hash_secret(text), private.random_token() from public;

-- ---------------------------------------------------------------------------------------------
-- Reference data: permissions, roles, role_permissions (global, read-only to app roles)
-- ---------------------------------------------------------------------------------------------
create table public.permissions (
  key         text primary key,
  description text not null,
  privileged  boolean not null default false  -- privileged => only usable in an MFA session
);

create table public.roles (
  key          text primary key,
  label        text not null,
  scope        text not null check (scope in ('platform', 'org', 'public')),
  requires_mfa boolean not null default false,
  description  text not null default '',
  unique (key, scope)
);

create table public.role_permissions (
  role_key       text not null references public.roles (key) on delete cascade,
  permission_key text not null references public.permissions (key) on delete cascade,
  primary key (role_key, permission_key)
);

insert into public.permissions (key, description, privileged) values
  ('org.read',            'View the organisation',                                  false),
  ('org.manage',          'Edit organisation settings',                             true),
  ('members.read',        'View members of the organisation',                       false),
  ('members.manage',      'Change member roles / suspend / remove members',         true),
  ('invitations.manage',  'Invite, list and revoke invitations',                    true),
  ('apikeys.manage',      'Create, list and revoke API keys',                       true),
  ('audit.read',          'Read the audit log',                                     true),
  ('devices.manage',      'Register, rotate credentials of, and maintain devices',  true),
  ('sensors.read',        'View stations and sensors',                              false),
  ('readings.read',       'View readings',                                          false),
  ('reports.read',        'View reports',                                           false),
  ('thresholds.draft',    'Draft warning-threshold rules',                          false),
  ('thresholds.approve',  'Approve warning-threshold rules',                        true),
  ('warnings.draft',      'Draft warnings',                                         false),
  ('warnings.review',     'Review drafted warnings',                                false),
  ('warnings.approve',    'Approve warnings (human authority)',                     true),
  ('warnings.publish',    'Publish warnings (human authority)',                     true),
  ('community.moderate',  'Moderate community reports',                             false);

insert into public.roles (key, label, scope, requires_mfa, description) values
  ('super_admin',               'Super administrator',        'platform', true,  'Platform owner. Acts via service role only in Phase 1.'),
  ('platform_admin',            'Platform administrator',     'platform', true,  'Platform operations. Acts via service role only in Phase 1.'),
  ('org_admin',                 'Organisation administrator', 'org',      true,  'Administers one organisation.'),
  ('government_authority',      'Government authority',       'org',      true,  'Approves and publishes warnings.'),
  ('hydrologist',               'Hydrologist',                'org',      false, 'Analyses data, drafts warnings and thresholds.'),
  ('meteorologist',             'Meteorologist',              'org',      false, 'Analyses data, drafts warnings and thresholds.'),
  ('emergency_response_officer','Emergency response officer', 'org',      false, 'Reviews warnings; cannot approve or publish (draft matrix).'),
  ('field_technician',          'Field technician',           'org',      true,  'Installs and maintains devices.'),
  ('sensor_operator',           'Sensor operator',            'org',      false, 'Read-only operational view (draft matrix).'),
  ('enterprise_customer',       'Enterprise customer',        'org',      false, 'Customer view of data and reports.'),
  ('community_leader',          'Community leader',           'org',      false, 'Moderates community reports.'),
  ('community_member',          'Community member',           'org',      false, 'Basic membership.'),
  ('public_visitor',            'Public visitor',             'public',   false, 'Anonymous/public side; never an organisation member.');

insert into public.role_permissions (role_key, permission_key) values
  ('org_admin','org.read'),('org_admin','org.manage'),('org_admin','members.read'),
  ('org_admin','members.manage'),('org_admin','invitations.manage'),('org_admin','apikeys.manage'),
  ('org_admin','audit.read'),('org_admin','devices.manage'),('org_admin','sensors.read'),
  ('org_admin','readings.read'),('org_admin','reports.read'),('org_admin','thresholds.draft'),
  ('government_authority','org.read'),('government_authority','members.read'),
  ('government_authority','sensors.read'),('government_authority','readings.read'),
  ('government_authority','reports.read'),('government_authority','warnings.draft'),
  ('government_authority','warnings.review'),('government_authority','warnings.approve'),
  ('government_authority','warnings.publish'),('government_authority','thresholds.approve'),
  ('government_authority','audit.read'),
  ('hydrologist','org.read'),('hydrologist','sensors.read'),('hydrologist','readings.read'),
  ('hydrologist','reports.read'),('hydrologist','warnings.draft'),('hydrologist','thresholds.draft'),
  ('meteorologist','org.read'),('meteorologist','sensors.read'),('meteorologist','readings.read'),
  ('meteorologist','reports.read'),('meteorologist','warnings.draft'),('meteorologist','thresholds.draft'),
  ('emergency_response_officer','org.read'),('emergency_response_officer','sensors.read'),
  ('emergency_response_officer','readings.read'),('emergency_response_officer','reports.read'),
  ('emergency_response_officer','warnings.draft'),('emergency_response_officer','warnings.review'),
  ('field_technician','org.read'),('field_technician','sensors.read'),
  ('field_technician','readings.read'),('field_technician','devices.manage'),
  ('sensor_operator','org.read'),('sensor_operator','sensors.read'),('sensor_operator','readings.read'),
  ('enterprise_customer','org.read'),('enterprise_customer','sensors.read'),
  ('enterprise_customer','readings.read'),('enterprise_customer','reports.read'),
  ('community_leader','org.read'),('community_leader','readings.read'),
  ('community_leader','community.moderate'),
  ('community_member','org.read');

-- Invariant: any role holding a privileged permission must require MFA. Enforced now and on
-- every later change to roles / role_permissions.
create function private.enforce_mfa_for_privileged() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.role_permissions rp
    join public.permissions p on p.key = rp.permission_key
    join public.roles r on r.key = rp.role_key
    where p.privileged and not r.requires_mfa
  ) then
    raise exception 'a role holding a privileged permission must have requires_mfa = true'
      using errcode = '23514';
  end if;
  return null;
end $$;

create trigger role_permissions_mfa_invariant
  after insert or update on public.role_permissions
  for each statement execute function private.enforce_mfa_for_privileged();
create trigger roles_mfa_invariant
  after update on public.roles
  for each statement execute function private.enforce_mfa_for_privileged();
create trigger permissions_mfa_invariant
  after update on public.permissions
  for each statement execute function private.enforce_mfa_for_privileged();

do $$
begin
  perform 1 from public.role_permissions limit 1;  -- seeded above, trigger did not fire on the seed
  if exists (
    select 1
    from public.role_permissions rp
    join public.permissions p on p.key = rp.permission_key
    join public.roles r on r.key = rp.role_key
    where p.privileged and not r.requires_mfa
  ) then
    raise exception 'seed violates the MFA invariant';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Tenancy: organisations, profiles, memberships, platform memberships
-- ---------------------------------------------------------------------------------------------
create table public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) between 2 and 120),
  slug       text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  display_name text check (display_name is null or length(display_name) <= 120),
  created_at   timestamptz not null default now()
);

create table public.memberships (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role_key   text not null,
  scope      text not null default 'org' check (scope = 'org'),
  status     text not null default 'active' check (status in ('active', 'suspended')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, user_id, role_key),
  foreign key (role_key, scope) references public.roles (key, scope)  -- org-scope roles only
);
create index memberships_user_idx on public.memberships (user_id);
create index memberships_org_idx on public.memberships (org_id);

create table public.platform_memberships (
  user_id  uuid not null references auth.users (id) on delete cascade,
  role_key text not null,
  scope    text not null default 'platform' check (scope = 'platform'),
  created_at timestamptz not null default now(),
  primary key (user_id, role_key),
  foreign key (role_key, scope) references public.roles (key, scope)
);

-- ---------------------------------------------------------------------------------------------
-- Permission check used by every policy. SECURITY DEFINER so it can read memberships without
-- recursing into memberships' own RLS.
-- ---------------------------------------------------------------------------------------------
create function private.has_permission(p_org uuid, p_perm text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.roles r on r.key = m.role_key
    join public.role_permissions rp on rp.role_key = r.key
    where m.org_id = p_org
      and m.user_id = auth.uid()
      and m.status = 'active'
      and rp.permission_key = p_perm
      and (not r.requires_mfa or coalesce(auth.jwt() ->> 'aal', '') = 'aal2')
  )
$$;

create function private.can_read_profile(p_target uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_target = auth.uid()
      or exists (
        select 1 from public.memberships t
        where t.user_id = p_target and t.status = 'active'
          and private.has_permission(t.org_id, 'members.read')
      )
$$;

revoke all on function private.has_permission(uuid, text), private.can_read_profile(uuid) from public;
grant execute on function private.has_permission(uuid, text), private.can_read_profile(uuid)
  to authenticated, service_role;

-- Never leave an organisation without an active org_admin.
create function private.guard_last_org_admin() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.role_key = 'org_admin' and old.status = 'active'
     and (tg_op = 'DELETE' or new.role_key <> 'org_admin' or new.status <> 'active')
     and exists (select 1 from public.organizations o where o.id = old.org_id)  -- not an org cascade
     and not exists (
       select 1 from public.memberships m
       where m.org_id = old.org_id and m.role_key = 'org_admin'
         and m.status = 'active' and m.id <> old.id
     )
  then
    raise exception 'cannot remove or demote the last active org_admin of an organisation'
      using errcode = '23514';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger memberships_last_admin_guard
  before update or delete on public.memberships
  for each row execute function private.guard_last_org_admin();

-- Profiles are maintained from auth.users.
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (user_id, email)
  values (new.id, lower(coalesce(new.email, '')))
  on conflict (user_id) do nothing;
  return new;
end $$;

create function private.sync_profile_email() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.profiles set email = lower(coalesce(new.email, '')) where user_id = new.id;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function private.sync_profile_email();

insert into public.profiles (user_id, email)
select id, lower(coalesce(email, '')) from auth.users
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------------------------
-- Invitations and API keys (secrets stored only as hashes)
-- ---------------------------------------------------------------------------------------------
create table public.invitations (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  email       text not null check (email = lower(btrim(email)) and position('@' in email) > 1),
  role_key    text not null,
  scope       text not null default 'org' check (scope = 'org'),
  token_hash  text not null unique,
  invited_by  uuid references auth.users (id) on delete set null,
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now(),
  foreign key (role_key, scope) references public.roles (key, scope),
  check (expires_at > created_at)
);
create index invitations_org_idx on public.invitations (org_id);

create table public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 80),
  key_prefix   text not null,
  key_hash     text not null unique,
  scopes       text[] not null check (cardinality(scopes) > 0),
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz,
  revoked_at   timestamptz,
  last_used_at timestamptz
);
create index api_keys_org_idx on public.api_keys (org_id);

-- ---------------------------------------------------------------------------------------------
-- Append-only audit log
-- ---------------------------------------------------------------------------------------------
create table public.audit_log (
  id            bigint generated always as identity primary key,
  org_id        uuid,  -- deliberately NOT a foreign key: audit rows must outlive the organisation
  actor_user_id uuid,
  actor_db_role text not null,
  action        text not null,
  entity_type   text not null,
  entity_id     text,
  details       jsonb not null default '{}'::jsonb,
  occurred_at   timestamptz not null default now()
);
create index audit_log_org_time_idx on public.audit_log (org_id, occurred_at desc);

create function private.audit_log_immutable() returns trigger
language plpgsql set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only' using errcode = '42501';
end $$;

create trigger audit_log_no_update_delete
  before update or delete on public.audit_log
  for each row execute function private.audit_log_immutable();
create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function private.audit_log_immutable();

create function private.audit_row_change() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_old    jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) - 'key_hash' - 'token_hash' end;
  v_new    jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) - 'key_hash' - 'token_hash' end;
  v_row    jsonb := coalesce(v_new, v_old);
  v_org    uuid;
  v_entity text;
begin
  v_org := case tg_table_name
             when 'organizations' then (v_row ->> 'id')::uuid
             else nullif(v_row ->> 'org_id', '')::uuid
           end;
  v_entity := coalesce(v_row ->> 'id', concat_ws(':', v_row ->> 'user_id', v_row ->> 'role_key', v_row ->> 'permission_key'));
  insert into public.audit_log (org_id, actor_user_id, actor_db_role, action, entity_type, entity_id, details)
  values (
    v_org,
    auth.uid(),
    coalesce(nullif(current_setting('role', true), 'none'), session_user::text),
    lower(tg_op),
    tg_table_name,
    v_entity,
    jsonb_build_object('old', v_old, 'new', v_new)
  );
  return null;
end $$;

create trigger audit_organizations after insert or update or delete on public.organizations
  for each row execute function private.audit_row_change();
create trigger audit_memberships after insert or update or delete on public.memberships
  for each row execute function private.audit_row_change();
create trigger audit_platform_memberships after insert or update or delete on public.platform_memberships
  for each row execute function private.audit_row_change();
create trigger audit_invitations after insert or update or delete on public.invitations
  for each row execute function private.audit_row_change();
create trigger audit_api_keys_ins_del after insert or delete on public.api_keys
  for each row execute function private.audit_row_change();
-- last_used_at is deliberately excluded so verifying a key does not flood the log
create trigger audit_api_keys_upd after update of name, scopes, expires_at, revoked_at on public.api_keys
  for each row execute function private.audit_row_change();
create trigger audit_role_permissions after insert or update or delete on public.role_permissions
  for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------------------------------------
-- Row-level security + least-privilege grants (Supabase grants broad defaults; we remove them)
-- ---------------------------------------------------------------------------------------------
alter table public.permissions          enable row level security;
alter table public.roles                enable row level security;
alter table public.role_permissions     enable row level security;
alter table public.organizations        enable row level security;
alter table public.profiles             enable row level security;
alter table public.memberships          enable row level security;
alter table public.platform_memberships enable row level security;
alter table public.invitations          enable row level security;
alter table public.api_keys             enable row level security;
alter table public.audit_log            enable row level security;

revoke all on public.permissions, public.roles, public.role_permissions, public.organizations,
  public.profiles, public.memberships, public.platform_memberships, public.invitations,
  public.api_keys, public.audit_log from anon, authenticated, service_role;

-- reference data: readable by signed-in users, writable only by migrations
grant select on public.permissions, public.roles, public.role_permissions to authenticated, service_role;
create policy permissions_read      on public.permissions      for select to authenticated using (true);
create policy roles_read            on public.roles            for select to authenticated using (true);
create policy role_permissions_read on public.role_permissions for select to authenticated using (true);

-- organisations
grant select on public.organizations to authenticated, service_role;
grant update (name) on public.organizations to authenticated;
create policy organizations_select on public.organizations for select to authenticated
  using (private.has_permission(id, 'org.read'));
create policy organizations_update on public.organizations for update to authenticated
  using (private.has_permission(id, 'org.manage'))
  with check (private.has_permission(id, 'org.manage'));

-- profiles
grant select on public.profiles to authenticated, service_role;
grant update (display_name) on public.profiles to authenticated;
create policy profiles_select on public.profiles for select to authenticated
  using (private.can_read_profile(user_id));
create policy profiles_update_own on public.profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- memberships: created only by accepting an invitation; admins may change role/status or remove
grant select, delete on public.memberships to authenticated;
grant update (role_key, status) on public.memberships to authenticated;
grant select on public.memberships to service_role;
create policy memberships_select on public.memberships for select to authenticated
  using (user_id = (select auth.uid()) or private.has_permission(org_id, 'members.read'));
create policy memberships_update on public.memberships for update to authenticated
  using (private.has_permission(org_id, 'members.manage'))
  with check (private.has_permission(org_id, 'members.manage'));
create policy memberships_delete on public.memberships for delete to authenticated
  using (private.has_permission(org_id, 'members.manage'));

-- platform memberships: no policies and no grants => service role / migrations only
grant select on public.platform_memberships to service_role;

-- invitations: token_hash is never selectable by app roles; writes only via functions
grant select (id, org_id, email, role_key, scope, invited_by, expires_at, accepted_at,
              accepted_by, revoked_at, created_at) on public.invitations to authenticated;
create policy invitations_select on public.invitations for select to authenticated
  using (private.has_permission(org_id, 'invitations.manage'));

-- api keys: key_hash is never selectable by app roles; writes only via functions
grant select (id, org_id, name, key_prefix, scopes, created_by, created_at, expires_at,
              revoked_at, last_used_at) on public.api_keys to authenticated;
create policy api_keys_select on public.api_keys for select to authenticated
  using (private.has_permission(org_id, 'apikeys.manage'));

-- audit log: read-only for permitted users; rows are written only by triggers
grant select on public.audit_log to authenticated, service_role;
create policy audit_log_select on public.audit_log for select to authenticated
  using (org_id is not null and private.has_permission(org_id, 'audit.read'));

-- ---------------------------------------------------------------------------------------------
-- Functions: the only way to create invitations / API keys
-- ---------------------------------------------------------------------------------------------
create function public.create_invitation(
  p_org uuid, p_email text, p_role text, p_ttl interval default interval '7 days'
) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_token text;
begin
  if auth.uid() is null or not private.has_permission(p_org, 'invitations.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_ttl <= interval '0' or p_ttl > interval '30 days' then
    raise exception 'invitation lifetime must be between 0 and 30 days' using errcode = '22023';
  end if;
  v_token := 'hsi_' || private.random_token();
  insert into public.invitations (org_id, email, role_key, token_hash, invited_by, expires_at)
  values (p_org, lower(btrim(p_email)), p_role, private.hash_secret(v_token), auth.uid(), now() + p_ttl);
  return v_token;  -- shown once; only the hash is stored
end $$;

create function public.accept_invitation(p_token text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_inv    public.invitations%rowtype;
  v_member uuid;
  v_email  text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into v_inv from public.invitations
   where token_hash = private.hash_secret(p_token) for update;
  -- one generic error for every failure reason (no oracle for attackers)
  if not found or v_inv.accepted_at is not null or v_inv.revoked_at is not null
     or v_inv.expires_at <= now() or v_inv.email <> v_email then
    raise exception 'invalid invitation' using errcode = '22023';
  end if;
  insert into public.memberships (org_id, user_id, role_key, created_by)
  values (v_inv.org_id, auth.uid(), v_inv.role_key, v_inv.invited_by)
  on conflict (org_id, user_id, role_key) do nothing;
  select id into v_member from public.memberships
   where org_id = v_inv.org_id and user_id = auth.uid() and role_key = v_inv.role_key;
  update public.invitations set accepted_at = now(), accepted_by = auth.uid() where id = v_inv.id;
  return v_member;
end $$;

create function public.revoke_invitation(p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.invitations where id = p_id;
  if v_org is null or auth.uid() is null or not private.has_permission(v_org, 'invitations.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.invitations set revoked_at = now() where id = p_id and revoked_at is null and accepted_at is null;
end $$;

create function public.create_api_key(
  p_org uuid, p_name text, p_scopes text[], p_expires timestamptz default null
) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_scope  text;
  v_prefix text;
  v_key    text;
begin
  if auth.uid() is null or not private.has_permission(p_org, 'apikeys.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_scopes is null or cardinality(p_scopes) = 0 then
    raise exception 'at least one scope is required' using errcode = '22023';
  end if;
  foreach v_scope in array p_scopes loop
    -- API keys can never carry privileged (approve/publish/manage/audit) powers: rule 5
    if not exists (select 1 from public.permissions where key = v_scope and not privileged) then
      raise exception 'invalid or privileged scope: %', v_scope using errcode = '22023';
    end if;
    -- and can never exceed what the creating user may do
    if not private.has_permission(p_org, v_scope) then
      raise exception 'scope exceeds creator permissions: %', v_scope using errcode = '42501';
    end if;
  end loop;
  if p_expires is not null and p_expires <= now() then
    raise exception 'expiry must be in the future' using errcode = '22023';
  end if;
  v_prefix := substr(private.random_token(), 1, 8);
  v_key := 'hsk_' || v_prefix || '_' || private.random_token();
  insert into public.api_keys (org_id, name, key_prefix, key_hash, scopes, created_by, expires_at)
  values (p_org, btrim(p_name), v_prefix, private.hash_secret(v_key), p_scopes, auth.uid(), p_expires);
  return v_key;  -- shown once; only the hash is stored
end $$;

create function public.revoke_api_key(p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.api_keys where id = p_id;
  if v_org is null or auth.uid() is null or not private.has_permission(v_org, 'apikeys.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.api_keys set revoked_at = now() where id = p_id and revoked_at is null;
end $$;

-- Backend only (service role): look up a presented key, record last use.
create function public.verify_api_key(p_key text)
returns table (key_id uuid, key_org_id uuid, key_scopes text[])
language plpgsql security definer set search_path = ''
as $$
begin
  return query
  update public.api_keys k set last_used_at = now()
   where k.key_hash = private.hash_secret(p_key)
     and k.revoked_at is null
     and (k.expires_at is null or k.expires_at > now())
  returning k.id, k.org_id, k.scopes;
end $$;

-- Backend only (service role): create an organisation and an invitation for its first admin.
create function public.admin_create_organization(p_name text, p_slug text, p_admin_email text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_org   uuid;
  v_token text := 'hsi_' || private.random_token();
begin
  insert into public.organizations (name, slug) values (btrim(p_name), p_slug) returning id into v_org;
  insert into public.invitations (org_id, email, role_key, token_hash, expires_at)
  values (v_org, lower(btrim(p_admin_email)), 'org_admin', private.hash_secret(v_token), now() + interval '14 days');
  return v_token;
end $$;

revoke all on function
  public.create_invitation(uuid, text, text, interval),
  public.accept_invitation(text),
  public.revoke_invitation(uuid),
  public.create_api_key(uuid, text, text[], timestamptz),
  public.revoke_api_key(uuid),
  public.verify_api_key(text),
  public.admin_create_organization(text, text, text)
from public, anon, authenticated, service_role;

grant execute on function
  public.create_invitation(uuid, text, text, interval),
  public.accept_invitation(text),
  public.revoke_invitation(uuid),
  public.create_api_key(uuid, text, text[], timestamptz),
  public.revoke_api_key(uuid)
to authenticated;

grant execute on function
  public.verify_api_key(text),
  public.admin_create_organization(text, text, text)
to service_role;

-- DOWN (manual, destructive):
--   drop function public.admin_create_organization, public.verify_api_key, public.revoke_api_key,
--     public.create_api_key, public.revoke_invitation, public.accept_invitation, public.create_invitation;
--   drop table public.audit_log, public.api_keys, public.invitations, public.platform_memberships,
--     public.memberships, public.profiles, public.organizations, public.role_permissions,
--     public.roles, public.permissions;
--   drop trigger on_auth_user_created on auth.users;
--   drop trigger on_auth_user_email_changed on auth.users;
--   drop schema private cascade;
