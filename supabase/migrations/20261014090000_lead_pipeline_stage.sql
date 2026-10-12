-- Stage clock for pipeline rotting. Auto-advance on quote status is a later migration.

alter table public.lead_requests
  add column if not exists stage_entered_at timestamptz;

update public.lead_requests
set stage_entered_at = case
  when status = 'contacted'::public.lead_request_status then coalesce(first_contacted_at, updated_at, created_at)
  else coalesce(updated_at, created_at)
end
where stage_entered_at is null;

alter table public.lead_requests
  alter column stage_entered_at set default now();

alter table public.lead_requests
  alter column stage_entered_at set not null;

comment on column public.lead_requests.stage_entered_at is
  'When the lead entered its current status. Rotting is measured from this clock.';

create or replace function private.lead_requests_stamp_stage()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.stage_entered_at := coalesce(new.stage_entered_at, now());
  elsif new.status is distinct from old.status then
    new.stage_entered_at := now();
  end if;
  return new;
end;
$$;

revoke all on function private.lead_requests_stamp_stage() from public, anon, authenticated;

drop trigger if exists lead_requests_stamp_stage on public.lead_requests;
create trigger lead_requests_stamp_stage
  before insert or update of status on public.lead_requests
  for each row execute function private.lead_requests_stamp_stage();
