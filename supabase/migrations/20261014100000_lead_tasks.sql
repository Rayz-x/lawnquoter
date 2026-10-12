-- Tasks on a lead. Office can read. Sales can write. Crew cannot.

create table if not exists public.lead_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  lead_request_id uuid not null references public.lead_requests(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200),
  due_on date,
  completed_at timestamptz,
  assignee_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.lead_tasks is
  'Follow-up work on a lead. Open tasks have completed_at null.';

create index if not exists lead_tasks_lead_open_idx
  on public.lead_tasks (lead_request_id, due_on)
  where completed_at is null;
create index if not exists lead_tasks_org_idx
  on public.lead_tasks (org_id, lead_request_id);

create or replace function private.lead_tasks_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.assert_same_org('lead_requests', new.lead_request_id::text, new.org_id);
  if new.assignee_id is not null then
    if not exists (
      select 1 from public.memberships m
      where m.org_id = new.org_id and m.user_id = new.assignee_id and m.status = 'active'
    ) then
      raise exception 'assignee must be an active member of the org' using errcode = '23503';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.lead_tasks_before_write() from public, anon, authenticated;

drop trigger if exists lead_tasks_before_write on public.lead_tasks;
create trigger lead_tasks_before_write
  before insert or update of org_id, lead_request_id, assignee_id
  on public.lead_tasks
  for each row execute function private.lead_tasks_before_write();

drop trigger if exists lead_tasks_set_updated_at on public.lead_tasks;
create trigger lead_tasks_set_updated_at
  before update on public.lead_tasks
  for each row execute function private.set_updated_at();

alter table public.lead_tasks enable row level security;
alter table public.lead_tasks force row level security;

drop policy if exists lead_tasks_select on public.lead_tasks;
create policy lead_tasks_select on public.lead_tasks
  for select to authenticated
  using ((select private.can_read_office_records(org_id)));

drop policy if exists lead_tasks_insert on public.lead_tasks;
create policy lead_tasks_insert on public.lead_tasks
  for insert to authenticated
  with check ((select private.can_edit_customers(org_id)));

drop policy if exists lead_tasks_update on public.lead_tasks;
create policy lead_tasks_update on public.lead_tasks
  for update to authenticated
  using ((select private.can_edit_customers(org_id)))
  with check ((select private.can_edit_customers(org_id)));

drop policy if exists lead_tasks_delete on public.lead_tasks;
create policy lead_tasks_delete on public.lead_tasks
  for delete to authenticated
  using ((select private.is_org_admin(org_id)));

revoke all on public.lead_tasks from public, anon;
grant select, insert, update, delete on public.lead_tasks to authenticated;
grant all on public.lead_tasks to service_role;
