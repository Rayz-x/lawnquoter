-- Quote follow-up runs and the call task they leave for a rep.

create table if not exists public.automations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  purpose text not null,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automations_purpose_chk check (purpose in ('follow_up')),
  unique (org_id, purpose)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete cascade,
  quote_id uuid references public.quotes(id) on delete cascade,
  kind text not null default 'call',
  status text not null default 'open',
  title text not null,
  due_on date,
  created_at timestamptz not null default now(),
  constraint tasks_kind_chk check (kind in ('call')),
  constraint tasks_status_chk check (status in ('open', 'done')),
  constraint tasks_title_chk check (char_length(btrim(title)) between 1 and 160)
);

create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  steps_sent integer not null default 0,
  status text not null default 'active',
  stop_reason text,
  task_id uuid references public.tasks(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_runs_status_chk check (status in ('active', 'stopped', 'completed')),
  constraint automation_runs_steps_chk check (steps_sent >= 0),
  unique (quote_id)
);

drop trigger if exists automations_set_updated_at on public.automations;
create trigger automations_set_updated_at before update on public.automations
  for each row execute function private.set_updated_at();
drop trigger if exists automation_runs_set_updated_at on public.automation_runs;
create trigger automation_runs_set_updated_at before update on public.automation_runs
  for each row execute function private.set_updated_at();

alter table public.automations enable row level security;
alter table public.automations force row level security;
alter table public.automation_runs enable row level security;
alter table public.automation_runs force row level security;
alter table public.tasks enable row level security;
alter table public.tasks force row level security;

drop policy if exists automations_select on public.automations;
create policy automations_select on public.automations for select to authenticated
  using ((select private.has_org_role(org_id, array['owner', 'admin', 'sales', 'dispatcher', 'read_only']::public.org_role[])));
drop policy if exists automations_write on public.automations;
create policy automations_write on public.automations for all to authenticated
  using ((select private.has_org_role(org_id, array['owner', 'admin']::public.org_role[])))
  with check ((select private.has_org_role(org_id, array['owner', 'admin']::public.org_role[])));

drop policy if exists automation_runs_select on public.automation_runs;
create policy automation_runs_select on public.automation_runs for select to authenticated
  using ((select private.has_org_role(org_id, array['owner', 'admin', 'sales', 'dispatcher', 'read_only']::public.org_role[])));

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using ((select private.has_org_role(org_id, array['owner', 'admin', 'sales', 'dispatcher', 'read_only']::public.org_role[])));
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using ((select private.has_org_role(org_id, array['owner', 'admin', 'sales', 'dispatcher']::public.org_role[])))
  with check ((select private.has_org_role(org_id, array['owner', 'admin', 'sales', 'dispatcher']::public.org_role[])));

revoke all on table public.automations from public, anon, authenticated;
revoke all on table public.automation_runs from public, anon, authenticated;
revoke all on table public.tasks from public, anon, authenticated;
grant select, insert, update, delete on table public.automations to authenticated;
grant select on table public.automation_runs to authenticated;
grant select, update on table public.tasks to authenticated;
grant all on table public.automations, public.automation_runs, public.tasks to service_role;
