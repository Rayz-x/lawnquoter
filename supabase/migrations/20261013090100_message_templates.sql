-- Email and SMS wording. Office can read. Sales can edit. Crew cannot.

create table if not exists public.message_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  channel text not null,
  purpose text not null,
  subject text,
  body text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint message_templates_name_chk check (char_length(btrim(name)) between 1 and 80),
  constraint message_templates_channel_chk check (channel in ('email', 'sms')),
  constraint message_templates_purpose_chk check (purpose in (
    'quote', 'invoice', 'on_my_way', 'reminder', 'follow_up', 'abandoned', 'general'
  )),
  constraint message_templates_body_chk check (char_length(btrim(body)) between 1 and 1600),
  constraint message_templates_subject_chk check (
    (channel = 'email' and subject is not null and char_length(btrim(subject)) between 1 and 200)
    or (channel = 'sms' and subject is null)
  )
);

create index if not exists message_templates_org_purpose_idx
  on public.message_templates (org_id, purpose, channel);
create unique index if not exists message_templates_one_default
  on public.message_templates (org_id, channel, purpose) where is_default;

drop trigger if exists message_templates_set_updated_at on public.message_templates;
create trigger message_templates_set_updated_at
  before update on public.message_templates
  for each row execute function private.set_updated_at();

alter table public.message_templates enable row level security;
alter table public.message_templates force row level security;

drop policy if exists message_templates_select on public.message_templates;
create policy message_templates_select on public.message_templates
  for select to authenticated
  using ((select private.has_org_role(org_id, array['owner', 'admin', 'sales', 'dispatcher', 'read_only']::public.org_role[])));

drop policy if exists message_templates_insert on public.message_templates;
create policy message_templates_insert on public.message_templates
  for insert to authenticated
  with check ((select private.has_org_role(org_id, array['owner', 'admin', 'sales']::public.org_role[])));

drop policy if exists message_templates_update on public.message_templates;
create policy message_templates_update on public.message_templates
  for update to authenticated
  using ((select private.has_org_role(org_id, array['owner', 'admin', 'sales']::public.org_role[])))
  with check ((select private.has_org_role(org_id, array['owner', 'admin', 'sales']::public.org_role[])));

drop policy if exists message_templates_delete on public.message_templates;
create policy message_templates_delete on public.message_templates
  for delete to authenticated
  using ((select private.has_org_role(org_id, array['owner', 'admin', 'sales']::public.org_role[])));

revoke all on table public.message_templates from public, anon, authenticated;
grant select, insert, update, delete on table public.message_templates to authenticated;
grant all on table public.message_templates to service_role;
