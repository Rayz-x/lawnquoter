-- Texting and tracking numbers choose which company receives a webhook.
-- Table-level update rights would still let an owner write the columns, so a
-- trigger refuses the change unless it comes from the service role. The server
-- sets them only after Twilio confirms the number is assigned to that company.

create or replace function private.org_routing_number_lock()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.sms_number is not distinct from old.sms_number
     and new.call_tracking_number is not distinct from old.call_tracking_number then
    return new;
  end if;
  if tg_op = 'INSERT' and new.sms_number is null and new.call_tracking_number is null then
    return new;
  end if;
  if current_user = 'service_role' or coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  raise exception 'routing number is server-owned' using errcode = '42501';
end;
$$;

revoke all on function private.org_routing_number_lock() from public, anon;
grant execute on function private.org_routing_number_lock() to authenticated, service_role;

drop trigger if exists orgs_routing_number_lock on public.orgs;
create trigger orgs_routing_number_lock
  before insert or update of sms_number, call_tracking_number on public.orgs
  for each row execute function private.org_routing_number_lock();
