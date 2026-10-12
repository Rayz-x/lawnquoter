-- Customer portal magic links and service requests.
-- The public page checks the token in trusted server code. No anon RPC.

create table public.portal_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  email text not null check (length(btrim(email)) between 3 and 200),
  token uuid not null default gen_random_uuid() unique,
  expires_at timestamptz not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create table public.portal_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  portal_link_id uuid not null references public.portal_links(id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index portal_links_org_account_idx on public.portal_links (org_id, account_id, created_at desc);
create index portal_requests_link_idx on public.portal_requests (portal_link_id, created_at desc);

create or replace function private.portal_same_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'portal_links' then
    if not exists (select 1 from public.accounts a where a.id = new.account_id and a.org_id = new.org_id) then
      raise exception 'account must belong to the same org' using errcode = '23503';
    end if;
  elsif tg_table_name = 'portal_requests' then
    if not exists (
      select 1 from public.portal_links l
      where l.id = new.portal_link_id and l.org_id = new.org_id
    ) then
      raise exception 'portal link must belong to the same org' using errcode = '23503';
    end if;
    if not exists (select 1 from public.accounts a where a.id = new.account_id and a.org_id = new.org_id) then
      raise exception 'account must belong to the same org' using errcode = '23503';
    end if;
    if new.property_id is not null and not exists (
      select 1 from public.properties r where r.id = new.property_id and r.org_id = new.org_id
    ) then
      raise exception 'property must belong to the same org' using errcode = '23503';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.portal_same_org() from public, anon;
grant execute on function private.portal_same_org() to authenticated, service_role;

drop trigger if exists portal_links_same_org on public.portal_links;
create trigger portal_links_same_org before insert or update on public.portal_links
  for each row execute function private.portal_same_org();
drop trigger if exists portal_requests_same_org on public.portal_requests;
create trigger portal_requests_same_org before insert or update on public.portal_requests
  for each row execute function private.portal_same_org();

alter table public.portal_links enable row level security;
alter table public.portal_links force row level security;
alter table public.portal_requests enable row level security;
alter table public.portal_requests force row level security;

create policy portal_links_select on public.portal_links for select to authenticated
  using ((select private.can_read_office_records(org_id)));
create policy portal_links_write on public.portal_links for all to authenticated
  using ((select private.can_edit_customers(org_id)))
  with check ((select private.can_edit_customers(org_id)));

create policy portal_requests_select on public.portal_requests for select to authenticated
  using ((select private.can_read_office_records(org_id)));
create policy portal_requests_write on public.portal_requests for all to authenticated
  using ((select private.can_edit_customers(org_id)))
  with check ((select private.can_edit_customers(org_id)));

revoke all on public.portal_links from public, anon;
revoke all on public.portal_requests from public, anon;
grant select, insert, update, delete on public.portal_links to authenticated;
grant select, insert, update, delete on public.portal_requests to authenticated;
grant all on public.portal_links to service_role;
grant all on public.portal_requests to service_role;
