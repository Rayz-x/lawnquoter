-- Quotes, versioned line items, templates, and a public proposal RPC.

create type public.quote_status as enum ('draft', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'changed');
create type public.item_state as enum ('included', 'recommended', 'optional');
create type public.option_tier as enum ('none', 'good', 'better', 'best');

create table public.quote_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  service_kind public.service_kind,
  intro text,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete restrict,
  property_id uuid references public.properties(id) on delete set null,
  template_id uuid references public.quote_templates(id) on delete set null,
  number integer not null,
  title text not null default 'Service quote',
  status public.quote_status not null default 'draft',
  public_token uuid not null default gen_random_uuid(),
  current_version integer not null default 1,
  expires_at date,
  sent_at timestamptz,
  viewed_at timestamptz,
  deposit_amount numeric,
  intro text,
  notes_customer text,
  notes_internal text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, number),
  unique (public_token)
);

create index quotes_org_status_idx on public.quotes (org_id, status, created_at desc);
create index quotes_account_idx on public.quotes (account_id);

create table public.quote_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  version integer not null,
  frozen boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (quote_id, version)
);

create table public.quote_sections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  version_id uuid not null references public.quote_versions(id) on delete cascade,
  title text not null default 'Work',
  sort integer not null default 0
);

create table public.quote_line_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  version_id uuid not null references public.quote_versions(id) on delete cascade,
  section_id uuid references public.quote_sections(id) on delete set null,
  service_id uuid references public.services(id) on delete set null,
  name text not null,
  description text,
  state public.item_state not null default 'included',
  option_group text,
  option_tier public.option_tier not null default 'none',
  qty numeric not null default 1,
  unit text not null default 'each',
  price numeric not null default 0,
  hours numeric not null default 0,
  cost numeric not null default 0,
  range_low numeric,
  range_high numeric,
  photo_url text,
  notes_customer text,
  notes_crew text,
  selected boolean not null default true,
  sort integer not null default 0
);

create index quote_line_items_version_idx on public.quote_line_items (version_id, sort);

create trigger quote_templates_set_updated_at
  before update on public.quote_templates
  for each row execute function private.set_updated_at();
create trigger quotes_set_updated_at
  before update on public.quotes
  for each row execute function private.set_updated_at();

create or replace function private.next_quote_number(p_org uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(max(number), 0) + 1 from public.quotes where org_id = p_org;
$$;

create or replace function public.quote_create(p_account uuid, p_property uuid default null, p_title text default 'Service quote')
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid;
  v_id uuid;
  v_vid uuid;
begin
  select org_id into v_org from public.accounts where id = p_account;
  if v_org is null then
    raise exception 'account not found' using errcode = 'P0002';
  end if;
  if not private.can_edit_customers(v_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  insert into public.quotes (org_id, account_id, property_id, number, title, created_by)
  values (v_org, p_account, p_property, private.next_quote_number(v_org), coalesce(nullif(p_title, ''), 'Service quote'), auth.uid())
  returning id into v_id;

  insert into public.quote_versions (org_id, quote_id, version, created_by)
  values (v_org, v_id, 1, auth.uid())
  returning id into v_vid;

  insert into public.quote_sections (org_id, version_id, title, sort)
  values (v_org, v_vid, 'Included', 0);

  return v_id;
end;
$$;
grant execute on function public.quote_create(uuid, uuid, text) to authenticated;

create or replace function public.quote_current_version(p_quote uuid)
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select v.id
  from public.quotes q
  join public.quote_versions v on v.quote_id = q.id and v.version = q.current_version
  where q.id = p_quote;
$$;
grant execute on function public.quote_current_version(uuid) to authenticated;

-- Public proposal payload. SECURITY DEFINER, token is the only key.
create or replace function public.quote_public(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
  v public.quote_versions;
  o public.orgs;
begin
  select * into q from public.quotes where public_token = p_token;
  if not found then
    return null;
  end if;
  if q.status in ('draft') then
    return null;
  end if;
  select * into v from public.quote_versions where quote_id = q.id and version = q.current_version;
  select * into o from public.orgs where id = q.org_id;

  update public.quotes set status = 'viewed', viewed_at = coalesce(viewed_at, now())
  where id = q.id and status = 'sent';

  return jsonb_build_object(
    'title', q.title,
    'number', q.number,
    'intro', q.intro,
    'notes_customer', q.notes_customer,
    'expires_at', q.expires_at,
    'status', q.status,
    'org', jsonb_build_object('name', o.name, 'phone', o.phone, 'email', o.email, 'brand_color', o.brand_color),
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'sort', s.sort) order by s.sort)
      from public.quote_sections s where s.version_id = v.id
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'section_id', i.section_id, 'name', i.name, 'description', i.description,
        'state', i.state, 'option_group', i.option_group, 'option_tier', i.option_tier,
        'qty', i.qty, 'unit', i.unit, 'price', i.price, 'range_low', i.range_low, 'range_high', i.range_high,
        'photo_url', i.photo_url, 'notes_customer', i.notes_customer, 'selected', i.selected, 'sort', i.sort
      ) order by i.sort)
      from public.quote_line_items i where i.version_id = v.id
    ), '[]'::jsonb)
  );
end;
$$;
grant execute on function public.quote_public(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.quote_templates enable row level security;
alter table public.quote_templates force row level security;
alter table public.quotes enable row level security;
alter table public.quotes force row level security;
alter table public.quote_versions enable row level security;
alter table public.quote_versions force row level security;
alter table public.quote_sections enable row level security;
alter table public.quote_sections force row level security;
alter table public.quote_line_items enable row level security;
alter table public.quote_line_items force row level security;

create policy quote_templates_select on public.quote_templates for select to authenticated
  using ((select private.is_org_member(org_id)));
create policy quote_templates_write on public.quote_templates for all to authenticated
  using ((select private.can_edit_customers(org_id)))
  with check ((select private.can_edit_customers(org_id)));

create policy quotes_select on public.quotes for select to authenticated
  using ((select private.is_org_member(org_id)));
create policy quotes_insert on public.quotes for insert to authenticated
  with check ((select private.can_edit_customers(org_id)));
create policy quotes_update on public.quotes for update to authenticated
  using ((select private.can_edit_customers(org_id)))
  with check ((select private.can_edit_customers(org_id)));
create policy quotes_delete on public.quotes for delete to authenticated
  using ((select private.is_org_admin(org_id)));

create policy quote_versions_select on public.quote_versions for select to authenticated
  using ((select private.is_org_member(org_id)));
create policy quote_versions_write on public.quote_versions for all to authenticated
  using ((select private.can_edit_customers(org_id)))
  with check ((select private.can_edit_customers(org_id)));

create policy quote_sections_select on public.quote_sections for select to authenticated
  using ((select private.is_org_member(org_id)));
create policy quote_sections_write on public.quote_sections for all to authenticated
  using ((select private.can_edit_customers(org_id)))
  with check ((select private.can_edit_customers(org_id)));

create policy quote_line_items_select on public.quote_line_items for select to authenticated
  using ((select private.is_org_member(org_id)));
create policy quote_line_items_write on public.quote_line_items for all to authenticated
  using ((select private.can_edit_customers(org_id)))
  with check ((select private.can_edit_customers(org_id)));

grant select, insert, update, delete on public.quote_templates, public.quotes, public.quote_versions,
  public.quote_sections, public.quote_line_items to authenticated;
grant all on public.quote_templates, public.quotes, public.quote_versions,
  public.quote_sections, public.quote_line_items to service_role;
