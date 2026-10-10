-- Site checks: pending site verification on ranged quote lines.
--
-- Dusty: merging applies this migration to the hosted database. Do not merge
-- until Dusty has reviewed and approved it.
--
-- Model only. Later PRs create rows on acceptance / customer request, flag
-- lines, and expose UI. This file adds:
--   * enums site_check_status / origin / method
--   * quote_line_items: reasons, verified price, lock, quantity_source
--   * quotes.site_check_status (null until a check row exists)
--   * site_checks table + one-open-per-quote unique index
--   * org settings helpers: site_check_auto_approve (default false),
--     site_check_threshold (default 0.55)
--   * RLS: office via can_read_pricing / can_edit_customers on site_checks.
--     Crews read through site_checks_crew (omits requested_email / request_note).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.site_check_status as enum (
  'requested', 'open', 'scheduled', 'done', 'waived', 'declined', 'cancelled'
);

create type public.site_check_origin as enum ('acceptance', 'customer_request');

create type public.site_check_method as enum ('desk', 'crew_stop', 'visit');

create type public.quantity_source as enum ('measurement', 'manual', 'unknown');

-- ---------------------------------------------------------------------------
-- Quote line + quote columns
-- ---------------------------------------------------------------------------
alter table public.quote_line_items
  add column site_check_reasons text[] not null default '{}',
  add column verified_price numeric,
  add column verified_at timestamptz,
  add column price_locked boolean not null default false,
  add column quantity_source public.quantity_source not null default 'unknown';

comment on column public.quote_line_items.site_check_reasons is
  'Reason codes from the site-check spec (low_confidence, manual, …). Empty means firm.';
comment on column public.quote_line_items.verified_price is
  'Point price locked after site-check resolution. Jobs/invoices prefer this over price.';
comment on column public.quote_line_items.price_locked is
  'When true, re-measure must not change the line price; use verified_price.';
comment on column public.quote_line_items.quantity_source is
  'Whether qty came from a measurement, a manual entry, or is unknown.';

alter table public.quote_line_items
  add constraint quote_line_items_verified_lock_chk check (
    (
      price_locked = false
      and verified_price is null
      and verified_at is null
    )
    or (
      price_locked = true
      and verified_price is not null
      and verified_at is not null
    )
  );

alter table public.quotes
  add column site_check_status public.site_check_status;

comment on column public.quotes.site_check_status is
  'Denormalized status of the open/resolved site check for this quote. Null when none created yet.';

-- ---------------------------------------------------------------------------
-- site_checks
-- ---------------------------------------------------------------------------
create table public.site_checks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete restrict,
  measurement_id uuid references public.measurements(id) on delete set null,
  status public.site_check_status not null default 'open',
  origin public.site_check_origin not null,
  requested_email text,
  request_note text,
  window_start date,
  window_end date,
  decline_reason text,
  resolved_version integer,
  method public.site_check_method not null default 'crew_stop',
  reasons text[] not null default '{}',
  line_ids uuid[] not null default '{}',
  due_on date,
  visit_id uuid references public.visits(id) on delete set null,
  assigned_to uuid references public.profiles(id) on delete set null,
  actuals jsonb,
  photo_paths text[] not null default '{}',
  outcome text,
  completed_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  waive_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_checks_outcome_chk check (
    outcome is null
    or outcome in ('at_or_below_estimate', 'within_range', 'over_range', 'waived')
  ),
  constraint site_checks_window_order_chk check (
    window_end is null
    or window_start is null
    or window_end >= window_start
  ),
  constraint site_checks_request_email_chk check (
    requested_email is null
    or length(btrim(requested_email)) between 3 and 320
  ),
  constraint site_checks_request_note_chk check (
    request_note is null
    or length(btrim(request_note)) between 1 and 2000
  ),
  constraint site_checks_decline_reason_chk check (
    decline_reason is null
    or length(btrim(decline_reason)) between 1 and 2000
  ),
  constraint site_checks_waive_reason_chk check (
    waive_reason is null
    or length(btrim(waive_reason)) between 1 and 2000
  ),
  constraint site_checks_photo_paths_limit_chk check (
    cardinality(photo_paths) <= 16
  ),
  constraint site_checks_line_ids_limit_chk check (
    cardinality(line_ids) <= 64
  ),
  constraint site_checks_customer_request_fields_chk check (
    origin <> 'customer_request'::public.site_check_origin
    or requested_email is not null
  )
);

create index site_checks_org_status_idx
  on public.site_checks (org_id, status, due_on);
create index site_checks_quote_id_idx on public.site_checks (quote_id);
create index site_checks_property_id_idx on public.site_checks (property_id);
create index site_checks_visit_id_idx on public.site_checks (visit_id);
create index site_checks_org_origin_idx on public.site_checks (org_id, origin, created_at desc);

-- One open check per quote (requested / open / scheduled).
create unique index site_checks_one_open_per_quote
  on public.site_checks (quote_id)
  where status in (
    'requested'::public.site_check_status,
    'open'::public.site_check_status,
    'scheduled'::public.site_check_status
  );

create trigger site_checks_set_updated_at
  before update on public.site_checks
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Same-org parents
-- ---------------------------------------------------------------------------
create or replace function private.site_checks_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.assert_same_org('quotes', new.quote_id::text, new.org_id);
  perform private.assert_same_org('properties', new.property_id::text, new.org_id);
  perform private.assert_same_org('measurements', new.measurement_id::text, new.org_id);
  perform private.assert_same_org('visits', new.visit_id::text, new.org_id);
  return new;
end;
$$;

revoke all on function private.site_checks_before_write() from public, anon;
grant execute on function private.site_checks_before_write() to authenticated, service_role;

create trigger site_checks_before_write
  before insert or update of org_id, quote_id, property_id, measurement_id, visit_id
  on public.site_checks
  for each row execute function private.site_checks_before_write();

-- ---------------------------------------------------------------------------
-- Org settings helpers (jsonb keys; absent = defaults below)
--   settings.site_check_auto_approve  boolean  default false
--   settings.site_check_threshold     numeric  default 0.55
-- ---------------------------------------------------------------------------
create or replace function private.site_check_auto_approve(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select (o.settings ->> 'site_check_auto_approve')::boolean
      from public.orgs o
      where o.id = p_org
        and o.settings ? 'site_check_auto_approve'
        and jsonb_typeof(o.settings -> 'site_check_auto_approve') = 'boolean'
    ),
    false
  );
$$;

create or replace function private.site_check_threshold(p_org uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select (o.settings ->> 'site_check_threshold')::numeric
      from public.orgs o
      where o.id = p_org
        and o.settings ? 'site_check_threshold'
        and (o.settings ->> 'site_check_threshold') ~ '^[0-9]+(\.[0-9]+)?$'
    ),
    0.55
  );
$$;

revoke all on function private.site_check_auto_approve(uuid) from public, anon;
revoke all on function private.site_check_threshold(uuid) from public, anon;
grant execute on function private.site_check_auto_approve(uuid) to authenticated, service_role;
grant execute on function private.site_check_threshold(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Crew-safe read surface (no customer request contact fields)
-- ---------------------------------------------------------------------------
-- Office keeps full select on site_checks (including requested_email /
-- request_note). Crews never select the base table; they use this view, which
-- omits those columns and only returns checks on visits they can read.
create view public.site_checks_crew as
select
  sc.id,
  sc.org_id,
  sc.quote_id,
  sc.property_id,
  sc.measurement_id,
  sc.status,
  sc.origin,
  sc.window_start,
  sc.window_end,
  sc.decline_reason,
  sc.resolved_version,
  sc.method,
  sc.reasons,
  sc.line_ids,
  sc.due_on,
  sc.visit_id,
  sc.assigned_to,
  sc.actuals,
  sc.photo_paths,
  sc.outcome,
  sc.completed_by,
  sc.completed_at,
  sc.waive_reason,
  sc.created_at,
  sc.updated_at
from public.site_checks sc
where sc.visit_id is not null
  and private.crew_can_read_visit(sc.org_id, sc.visit_id);

comment on view public.site_checks_crew is
  'Crew/crew_lead site-check rows for their visits. Omits requested_email and request_note.';

revoke all on public.site_checks_crew from public, anon;
grant select on public.site_checks_crew to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.site_checks enable row level security;
alter table public.site_checks force row level security;

create policy site_checks_select on public.site_checks
  for select to authenticated
  using ((select private.can_read_pricing(org_id)));

create policy site_checks_insert on public.site_checks
  for insert to authenticated
  with check ((select private.can_edit_customers(org_id)));

create policy site_checks_update on public.site_checks
  for update to authenticated
  using ((select private.can_edit_customers(org_id)))
  with check ((select private.can_edit_customers(org_id)));

create policy site_checks_delete on public.site_checks
  for delete to authenticated
  using ((select private.is_org_admin(org_id)));

grant select, insert, update, delete on public.site_checks to authenticated;
grant all on public.site_checks to service_role;
