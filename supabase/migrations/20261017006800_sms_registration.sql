-- A2P 10DLC draft and submission status. One row per company. Admins write. Office can read.

create table if not exists public.org_sms_registrations (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  legal_name text,
  ein text,
  website text,
  contact_email text,
  sample_message text,
  brand_status text not null default 'draft',
  campaign_status text not null default 'draft',
  brand_sid text,
  campaign_sid text,
  messaging_service_sid text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint org_sms_registrations_brand_status_chk check (brand_status in ('draft', 'pending', 'approved', 'failed')),
  constraint org_sms_registrations_campaign_status_chk check (campaign_status in ('draft', 'pending', 'approved', 'failed')),
  constraint org_sms_registrations_ein_chk check (ein is null or ein ~ '^[0-9]{9}$'),
  constraint org_sms_registrations_sample_chk check (sample_message is null or char_length(btrim(sample_message)) between 1 and 320)
);

drop trigger if exists org_sms_registrations_set_updated_at on public.org_sms_registrations;
create trigger org_sms_registrations_set_updated_at
  before update on public.org_sms_registrations
  for each row execute function private.set_updated_at();

alter table public.org_sms_registrations enable row level security;
alter table public.org_sms_registrations force row level security;

drop policy if exists org_sms_registrations_select on public.org_sms_registrations;
create policy org_sms_registrations_select on public.org_sms_registrations
  for select to authenticated
  using ((select private.has_org_role(org_id, array['owner', 'admin', 'sales', 'dispatcher', 'read_only']::public.org_role[])));

drop policy if exists org_sms_registrations_insert on public.org_sms_registrations;
create policy org_sms_registrations_insert on public.org_sms_registrations
  for insert to authenticated
  with check ((select private.has_org_role(org_id, array['owner', 'admin']::public.org_role[])));

drop policy if exists org_sms_registrations_update on public.org_sms_registrations;
create policy org_sms_registrations_update on public.org_sms_registrations
  for update to authenticated
  using ((select private.has_org_role(org_id, array['owner', 'admin']::public.org_role[])))
  with check ((select private.has_org_role(org_id, array['owner', 'admin']::public.org_role[])));

revoke all on table public.org_sms_registrations from public, anon, authenticated;
grant select, insert, update on table public.org_sms_registrations to authenticated;
grant all on table public.org_sms_registrations to service_role;
