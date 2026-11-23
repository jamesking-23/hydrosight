-- requires: postgis
-- 0013: lets platform staff pick an organisation by name when assigning plans or raising invoices.
-- Returns only id, name and creation time (no members, no data). Platform roles still have no other
-- access to organisation data.
create function public.platform_orgs() returns table (id uuid, name text, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_platform_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query select o.id, o.name, o.created_at from public.organizations o order by o.name;
end $$;
revoke all on function public.platform_orgs() from public, anon, authenticated, service_role;
grant execute on function public.platform_orgs() to authenticated;
-- DOWN: drop function public.platform_orgs();
