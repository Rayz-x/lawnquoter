-- An enhancement proposal is a draft quote attached to an agreement.

create table if not exists public.agreement_enhancements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  agreement_id uuid not null references public.agreements(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  title text not null,
  created_at timestamptz not null default now(),
  constraint agreement_enhancements_quote_key unique (quote_id),
  constraint agreement_enhancements_title_len check (length(btrim(title)) between 1 and 120)
);

create index if not exists agreement_enhancements_org_id_idx on public.agreement_enhancements (org_id);
create index if not exists agreement_enhancements_agreement_id_idx on public.agreement_enhancements (agreement_id);

alter table public.agreement_enhancements enable row level security;
alter table public.agreement_enhancements force row level security;

drop policy if exists agreement_enhancements_select on public.agreement_enhancements;
create policy agreement_enhancements_select on public.agreement_enhancements
  for select to authenticated
  using ((select private.can_read_office_records(org_id)));

revoke all on table public.agreement_enhancements from public, anon, authenticated;
grant select on table public.agreement_enhancements to authenticated;
grant all on table public.agreement_enhancements to service_role;

create or replace function public.create_agreement_enhancement(p_agreement uuid, p_title text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_org_id();
  v_agreement public.agreements;
  v_title text := btrim(p_title);
  v_quote uuid;
  v_version uuid;
  v_section uuid;
begin
  if v_org is null or not private.can_write_job_records(v_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_title is null or length(v_title) < 1 or length(v_title) > 120 then
    raise exception 'An enhancement needs a title' using errcode = '22023';
  end if;
  select * into v_agreement from public.agreements where id = p_agreement and org_id = v_org;
  if not found then
    raise exception 'agreement not found' using errcode = 'P0002';
  end if;

  insert into public.quotes (org_id, account_id, property_id, number, title, created_by)
  values (v_org, v_agreement.account_id, v_agreement.property_id, private.next_quote_number(v_org), v_title, auth.uid())
  returning id into v_quote;

  insert into public.quote_versions (org_id, quote_id, version, created_by)
  values (v_org, v_quote, 1, auth.uid())
  returning id into v_version;

  insert into public.quote_sections (org_id, version_id, title, sort)
  values (v_org, v_version, 'Included', 0)
  returning id into v_section;

  insert into public.quote_line_items (org_id, version_id, section_id, name, qty, unit, price, sort)
  values (v_org, v_version, v_section, v_title, 1, 'each', 0, 0);

  insert into public.agreement_enhancements (org_id, agreement_id, quote_id, title)
  values (v_org, v_agreement.id, v_quote, v_title);

  return v_quote;
end;
$$;

revoke all on function public.create_agreement_enhancement(uuid, text) from public, anon;
grant execute on function public.create_agreement_enhancement(uuid, text) to authenticated, service_role;
