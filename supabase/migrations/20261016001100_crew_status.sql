-- One live status per crew. The office reads it. The crew on that crew writes it.
-- Supabase Realtime publishes the table when the publication exists.

create table if not exists public.crew_status (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  crew_id uuid not null references public.crews(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  visit_id uuid references public.visits(id) on delete set null,
  state text not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint crew_status_state_check check (state in ('en_route', 'on_site', 'break', 'done')),
  constraint crew_status_org_crew_key unique (org_id, crew_id)
);

create index if not exists crew_status_org_id_idx on public.crew_status (org_id);

alter table public.crew_status replica identity full;

alter table public.crew_status enable row level security;
alter table public.crew_status force row level security;

drop policy if exists crew_status_select on public.crew_status;
create policy crew_status_select on public.crew_status
  for select to authenticated
  using (
    (select private.can_read_office_records(org_id))
    or exists (
      select 1 from public.crew_members m
      where m.org_id = crew_status.org_id
        and m.crew_id = crew_status.crew_id
        and m.profile_id = (select auth.uid())
    )
  );

drop policy if exists crew_status_insert on public.crew_status;
create policy crew_status_insert on public.crew_status
  for insert to authenticated
  with check (
    org_id = (select private.current_org_id())
    and (
      (select private.can_dispatch(org_id))
      or exists (
        select 1 from public.crew_members m
        where m.org_id = crew_status.org_id
          and m.crew_id = crew_status.crew_id
          and m.profile_id = (select auth.uid())
      )
    )
  );

drop policy if exists crew_status_update on public.crew_status;
create policy crew_status_update on public.crew_status
  for update to authenticated
  using (
    org_id = (select private.current_org_id())
    and (
      (select private.can_dispatch(org_id))
      or exists (
        select 1 from public.crew_members m
        where m.org_id = crew_status.org_id
          and m.crew_id = crew_status.crew_id
          and m.profile_id = (select auth.uid())
      )
    )
  )
  with check (
    org_id = (select private.current_org_id())
    and (
      (select private.can_dispatch(org_id))
      or exists (
        select 1 from public.crew_members m
        where m.org_id = crew_status.org_id
          and m.crew_id = crew_status.crew_id
          and m.profile_id = (select auth.uid())
      )
    )
  );

revoke all on table public.crew_status from public, anon, authenticated;
grant select, insert, update on table public.crew_status to authenticated;
grant all on table public.crew_status to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'crew_status'
     ) then
    alter publication supabase_realtime add table public.crew_status;
  end if;
end $$;
