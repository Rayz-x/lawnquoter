-- One price-increase rule per company, and one-click renewal proposals.

create table if not exists public.renewal_rules (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  increase_percent numeric not null,
  window_days integer not null,
  updated_at timestamptz not null default now(),
  constraint renewal_rules_percent_check check (increase_percent between 0 and 100),
  constraint renewal_rules_window_check check (window_days between 1 and 365)
);

create table if not exists public.renewal_proposals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  agreement_id uuid not null references public.agreements(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  prior_cents bigint not null,
  proposed_cents bigint not null,
  created_at timestamptz not null default now(),
  constraint renewal_proposals_quote_key unique (quote_id),
  constraint renewal_proposals_cents_check check (prior_cents > 0 and proposed_cents > 0)
);

create index if not exists renewal_proposals_org_id_idx on public.renewal_proposals (org_id);
create index if not exists renewal_proposals_agreement_id_idx on public.renewal_proposals (agreement_id);

alter table public.renewal_rules enable row level security;
alter table public.renewal_rules force row level security;
alter table public.renewal_proposals enable row level security;
alter table public.renewal_proposals force row level security;

drop policy if exists renewal_rules_select on public.renewal_rules;
create policy renewal_rules_select on public.renewal_rules
  for select to authenticated
  using ((select private.can_read_office_records(org_id)));

drop policy if exists renewal_proposals_select on public.renewal_proposals;
create policy renewal_proposals_select on public.renewal_proposals
  for select to authenticated
  using ((select private.can_read_office_records(org_id)));

revoke all on table public.renewal_rules from public, anon, authenticated;
revoke all on table public.renewal_proposals from public, anon, authenticated;
grant select on table public.renewal_rules to authenticated;
grant select on table public.renewal_proposals to authenticated;
grant all on table public.renewal_rules to service_role;
grant all on table public.renewal_proposals to service_role;

create or replace function public.set_renewal_rule(p_percent numeric, p_window_days integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_org_id();
begin
  if v_org is null or not private.can_write_job_records(v_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_percent is null or p_percent < 0 or p_percent > 100 or p_window_days is null or p_window_days < 1 or p_window_days > 365 then
    raise exception 'Percent has to be 0 to 100, and the window 1 to 365 days' using errcode = '22023';
  end if;
  insert into public.renewal_rules (org_id, increase_percent, window_days)
  values (v_org, p_percent, p_window_days)
  on conflict (org_id) do update
    set increase_percent = excluded.increase_percent,
        window_days = excluded.window_days,
        updated_at = now();
end;
$$;

revoke all on function public.set_renewal_rule(numeric, integer) from public, anon;
grant execute on function public.set_renewal_rule(numeric, integer) to authenticated, service_role;

create or replace function public.propose_agreement_renewal(p_agreement uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_org_id();
  v_agreement public.agreements;
  v_percent numeric;
  v_prior bigint;
  v_proposed bigint;
  v_quote uuid;
  v_version uuid;
  v_section uuid;
begin
  if v_org is null or not private.can_write_job_records(v_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_agreement from public.agreements where id = p_agreement and org_id = v_org;
  if not found then
    raise exception 'agreement not found' using errcode = 'P0002';
  end if;
  select increase_percent into v_percent from public.renewal_rules where org_id = v_org;
  if v_percent is null then
    raise exception 'Save a price increase first' using errcode = '22023';
  end if;
  select season_price_cents into v_prior
  from public.agreement_price_terms
  where agreement_id = v_agreement.id
  order by effective_from desc
  limit 1;
  if v_prior is null then
    raise exception 'This agreement has no season price' using errcode = '22023';
  end if;
  v_proposed := round(v_prior * (100 + v_percent) / 100)::bigint;

  insert into public.quotes (org_id, account_id, property_id, number, title, created_by)
  values (
    v_org,
    v_agreement.account_id,
    v_agreement.property_id,
    private.next_quote_number(v_org),
    'Renewal',
    auth.uid()
  )
  returning id into v_quote;

  insert into public.quote_versions (org_id, quote_id, version, created_by)
  values (v_org, v_quote, 1, auth.uid())
  returning id into v_version;

  insert into public.quote_sections (org_id, version_id, title, sort)
  values (v_org, v_version, 'Included', 0)
  returning id into v_section;

  insert into public.quote_line_items (org_id, version_id, section_id, name, qty, unit, price, sort)
  values (v_org, v_version, v_section, 'Renewal', 1, 'season', v_proposed / 100.0, 0);

  insert into public.renewal_proposals (org_id, agreement_id, quote_id, prior_cents, proposed_cents)
  values (v_org, v_agreement.id, v_quote, v_prior, v_proposed);

  return v_quote;
end;
$$;

revoke all on function public.propose_agreement_renewal(uuid) from public, anon;
grant execute on function public.propose_agreement_renewal(uuid) to authenticated, service_role;
