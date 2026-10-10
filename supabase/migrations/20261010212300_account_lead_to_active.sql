-- S18: Customer status Lead → Active automatically.
-- Flips on quote acceptance (acceptances insert) or agreement/job creation.
-- Manual override stays in the office UI (Activate / Archive / Unarchive).
-- Inactive (archived) accounts are never auto-activated.

create or replace function private.activate_lead_account(p_account_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_account_id is null then
    return;
  end if;
  update public.accounts
  set status = 'active'::public.account_status
  where id = p_account_id
    and status = 'lead'::public.account_status;
end;
$$;

revoke all on function private.activate_lead_account(uuid) from public, anon, authenticated;
grant execute on function private.activate_lead_account(uuid) to service_role;

create or replace function private.accounts_activate_on_acceptance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
begin
  select q.account_id into v_account_id
  from public.quotes q
  where q.id = new.quote_id;
  perform private.activate_lead_account(v_account_id);
  return new;
end;
$$;

revoke all on function private.accounts_activate_on_acceptance() from public, anon, authenticated;

create trigger acceptances_activate_lead
  after insert on public.acceptances
  for each row execute function private.accounts_activate_on_acceptance();

create or replace function private.accounts_activate_on_agreement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.activate_lead_account(new.account_id);
  return new;
end;
$$;

revoke all on function private.accounts_activate_on_agreement() from public, anon, authenticated;

create trigger agreements_activate_lead
  after insert on public.agreements
  for each row execute function private.accounts_activate_on_agreement();

create or replace function private.accounts_activate_on_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
begin
  if new.agreement_id is not null then
    select a.account_id into v_account_id
    from public.agreements a
    where a.id = new.agreement_id;
  else
    select p.account_id into v_account_id
    from public.properties p
    where p.id = new.property_id;
  end if;
  perform private.activate_lead_account(v_account_id);
  return new;
end;
$$;

revoke all on function private.accounts_activate_on_job() from public, anon, authenticated;

create trigger jobs_activate_lead
  after insert on public.jobs
  for each row execute function private.accounts_activate_on_job();
