-- A texting number and a call-tracking number are one claim.
-- Another company cannot reuse either value for either purpose.
-- The same company may use one number for both.

create or replace function private.org_phone_claims_unique()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.sms_number is not null and exists (
    select 1
    from public.orgs o
    where o.id is distinct from new.id
      and (o.sms_number = new.sms_number or o.call_tracking_number = new.sms_number)
  ) then
    raise exception 'texting number already claimed' using errcode = '23505';
  end if;
  if new.call_tracking_number is not null and exists (
    select 1
    from public.orgs o
    where o.id is distinct from new.id
      and (o.call_tracking_number = new.call_tracking_number or o.sms_number = new.call_tracking_number)
  ) then
    raise exception 'tracking number already claimed' using errcode = '23505';
  end if;
  return new;
end;
$$;

revoke all on function private.org_phone_claims_unique() from public, anon;
grant execute on function private.org_phone_claims_unique() to authenticated, service_role;

drop trigger if exists orgs_phone_claims_unique on public.orgs;
create trigger orgs_phone_claims_unique
  before insert or update of sms_number, call_tracking_number on public.orgs
  for each row execute function private.org_phone_claims_unique();
