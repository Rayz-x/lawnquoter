-- L02 (#117): accounts.lead_source picklist + lead_source_other for Other / migrated free text.

create or replace function private.map_lead_source(p_raw text)
returns table (lead_source text, lead_source_other text)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_norm text;
begin
  if p_raw is null or btrim(p_raw) = '' then
    lead_source := null;
    lead_source_other := null;
    return next;
    return;
  end if;

  v_norm := lower(btrim(p_raw));
  v_norm := regexp_replace(v_norm, '[-_]+', ' ', 'g');
  v_norm := regexp_replace(v_norm, '\s+', ' ', 'g');

  case v_norm
    when 'google' then
      lead_source := 'Google';
      lead_source_other := null;
    when 'referral' then
      lead_source := 'Referral';
      lead_source_other := null;
    when 'door hanger' then
      lead_source := 'Door hanger';
      lead_source_other := null;
    when 'yard sign' then
      lead_source := 'Yard sign';
      lead_source_other := null;
    when 'repeat' then
      lead_source := 'Repeat';
      lead_source_other := null;
    when 'website form' then
      lead_source := 'Website form';
      lead_source_other := null;
    when 'other' then
      lead_source := 'Other';
      lead_source_other := null;
    else
      lead_source := 'Other';
      lead_source_other := btrim(p_raw);
  end case;

  return next;
end;
$$;

revoke all on function private.map_lead_source(text) from public;
grant execute on function private.map_lead_source(text) to authenticated, service_role;

alter table public.accounts
  add column if not exists lead_source_other text;

-- Map legacy free-text values before tightening the check.
update public.accounts as a
set
  lead_source = m.new_source,
  lead_source_other = m.new_other
from (
  select
    acct.id,
    mapped.lead_source as new_source,
    mapped.lead_source_other as new_other
  from public.accounts as acct
  cross join lateral private.map_lead_source(acct.lead_source) as mapped
) as m
where a.id = m.id;

alter table public.accounts
  drop constraint if exists accounts_lead_source_check;

alter table public.accounts
  add constraint accounts_lead_source_check
  check (
    lead_source is null
    or lead_source in (
      'Google',
      'Referral',
      'Door hanger',
      'Yard sign',
      'Repeat',
      'Website form',
      'Other'
    )
  );

create or replace function private.accounts_lead_source_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := coalesce(auth.role(), '');
  v_other text;
begin
  if new.lead_source is not null then
    new.lead_source := btrim(new.lead_source);
    if new.lead_source = '' then
      new.lead_source := null;
    end if;
  end if;

  if new.lead_source = 'Website form'
     and v_role = 'authenticated'
     and (tg_op = 'INSERT' or old.lead_source is distinct from 'Website form') then
    raise exception 'Website form lead source can only be set by the system'
      using errcode = 'check_violation';
  end if;

  if new.lead_source = 'Other' then
    v_other := nullif(btrim(coalesce(new.lead_source_other, '')), '');
    if v_other is null then
      raise exception 'Other lead source requires details'
        using errcode = 'check_violation';
    end if;
    new.lead_source_other := v_other;
  else
    new.lead_source_other := null;
  end if;

  return new;
end;
$$;

revoke all on function private.accounts_lead_source_before_write() from public;
grant execute on function private.accounts_lead_source_before_write() to authenticated, service_role;

drop trigger if exists accounts_lead_source_before_write on public.accounts;
create trigger accounts_lead_source_before_write
  before insert or update of lead_source, lead_source_other
  on public.accounts
  for each row
  execute function private.accounts_lead_source_before_write();
