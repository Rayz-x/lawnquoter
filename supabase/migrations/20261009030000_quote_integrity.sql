-- Bind public acceptance to the proposal the customer saw, keep child rows in
-- the same org as their parents, and stop accepted quotes from being rewritten.

-- ---------------------------------------------------------------------------
-- Same-org parent checks
-- ---------------------------------------------------------------------------
create or replace function private.assert_same_org(p_table text, p_id text, p_org uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ok boolean;
begin
  if p_id is null or p_id = '' then
    return;
  end if;
  if p_table not in (
    'accounts', 'properties', 'measurements', 'quotes', 'quote_versions',
    'quote_sections', 'services', 'price_lists'
  ) then
    raise exception 'unsupported parent table %', p_table using errcode = '0A000';
  end if;

  execute format(
    'select exists (select 1 from public.%I where id = $1::uuid and org_id = $2)',
    p_table
  ) into ok using p_id, p_org;

  if not coalesce(ok, false) then
    raise exception '% must belong to the same org', p_table using errcode = '23503';
  end if;
end;
$$;

revoke all on function private.assert_same_org(text, text, uuid) from public;
grant execute on function private.assert_same_org(text, text, uuid) to authenticated, service_role;

create or replace function private.child_org_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.assert_same_org(tg_argv[0], to_jsonb(new) ->> tg_argv[1], new.org_id);
  return new;
end;
$$;

create trigger contacts_same_org
  before insert or update of org_id, account_id on public.contacts
  for each row execute function private.child_org_guard('accounts', 'account_id');

create trigger measurements_same_org
  before insert or update of org_id, property_id on public.measurements
  for each row execute function private.child_org_guard('properties', 'property_id');

create trigger measurement_features_same_org
  before insert or update of org_id, measurement_id on public.measurement_features
  for each row execute function private.child_org_guard('measurements', 'measurement_id');

create trigger activities_account_org
  before insert or update of org_id, account_id on public.activities
  for each row execute function private.child_org_guard('accounts', 'account_id');

create trigger activities_property_org
  before insert or update of org_id, property_id on public.activities
  for each row execute function private.child_org_guard('properties', 'property_id');

create trigger pricing_rules_list_org
  before insert or update of org_id, price_list_id on public.pricing_rules
  for each row execute function private.child_org_guard('price_lists', 'price_list_id');

create trigger pricing_rules_service_org
  before insert or update of org_id, service_id on public.pricing_rules
  for each row execute function private.child_org_guard('services', 'service_id');

create trigger quote_versions_same_org
  before insert or update of org_id, quote_id on public.quote_versions
  for each row execute function private.child_org_guard('quotes', 'quote_id');

create trigger quote_sections_same_org
  before insert or update of org_id, version_id on public.quote_sections
  for each row execute function private.child_org_guard('quote_versions', 'version_id');

create trigger quote_line_items_version_org
  before insert or update of org_id, version_id on public.quote_line_items
  for each row execute function private.child_org_guard('quote_versions', 'version_id');

create trigger quote_line_items_section_org
  before insert or update of org_id, section_id on public.quote_line_items
  for each row execute function private.child_org_guard('quote_sections', 'section_id');

create trigger quote_line_items_service_org
  before insert or update of org_id, service_id on public.quote_line_items
  for each row execute function private.child_org_guard('services', 'service_id');

create trigger acceptances_same_org
  before insert or update of org_id, quote_id on public.acceptances
  for each row execute function private.child_org_guard('quotes', 'quote_id');

create trigger audit_events_same_org
  before insert or update of org_id, quote_id on public.audit_events
  for each row execute function private.child_org_guard('quotes', 'quote_id');

create trigger payment_intents_quote_org
  before insert or update of org_id, quote_id on public.payment_intents
  for each row execute function private.child_org_guard('quotes', 'quote_id');

create trigger payment_intents_account_org
  before insert or update of org_id, account_id on public.payment_intents
  for each row execute function private.child_org_guard('accounts', 'account_id');

-- ---------------------------------------------------------------------------
-- Quotes: property must belong to the account, accepted is final, frozen
-- versions cannot be rewritten.
-- ---------------------------------------------------------------------------
create or replace function private.quotes_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.status = 'accepted' and new.status is distinct from 'accepted' then
      raise exception 'accepted quotes are final' using errcode = '55000';
    end if;

    if exists (
      select 1
      from public.quote_versions v
      where v.quote_id = old.id
        and v.version = old.current_version
        and v.frozen
    ) then
      if new.title is distinct from old.title
         or new.intro is distinct from old.intro
         or new.notes_customer is distinct from old.notes_customer
         or new.expires_at is distinct from old.expires_at
         or new.deposit_amount is distinct from old.deposit_amount
         or new.account_id is distinct from old.account_id
         or new.property_id is distinct from old.property_id
      then
        raise exception 'this quote version is frozen' using errcode = '55000';
      end if;
    end if;
  end if;

  perform private.assert_same_org('accounts', new.account_id::text, new.org_id);
  if new.property_id is not null then
    if not exists (
      select 1
      from public.properties p
      where p.id = new.property_id
        and p.org_id = new.org_id
        and p.account_id = new.account_id
    ) then
      raise exception 'property must belong to the quote account' using errcode = '23503';
    end if;
  end if;
  return new;
end;
$$;

create trigger quotes_before_write
  before insert or update on public.quotes
  for each row execute function private.quotes_before_write();

create or replace function private.quote_versions_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.frozen and (
    not new.frozen or new.document_hash is distinct from old.document_hash
  ) then
    raise exception 'cannot alter a frozen quote version' using errcode = '55000';
  end if;
  return new;
end;
$$;

-- document_hash is added below; the trigger references it, so create the
-- column first and replace the function after. The function above is created
-- once the column exists (see alter below). Placeholder avoided by ordering:
alter table public.quote_versions
  add column if not exists document_hash text;

create trigger quote_versions_before_write
  before update on public.quote_versions
  for each row execute function private.quote_versions_before_write();

create or replace function private.reject_frozen_quote_child()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_version uuid;
  v_frozen boolean;
begin
  v_version := case when tg_op = 'DELETE' then old.version_id else new.version_id end;
  select frozen into v_frozen from public.quote_versions where id = v_version;
  if v_frozen then
    raise exception 'this quote version is frozen' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger quote_sections_frozen
  before insert or update or delete on public.quote_sections
  for each row execute function private.reject_frozen_quote_child();

create trigger quote_line_items_frozen
  before insert or update or delete on public.quote_line_items
  for each row execute function private.reject_frozen_quote_child();

-- ---------------------------------------------------------------------------
-- Acceptance snapshot
-- ---------------------------------------------------------------------------
alter table public.acceptances
  add column if not exists selections jsonb not null default '[]'::jsonb,
  add column if not exists accepted_total numeric;

delete from public.acceptances a
where a.id not in (
  select distinct on (quote_id) id
  from public.acceptances
  order by quote_id, accepted_at asc, id asc
);

create unique index if not exists acceptances_one_per_quote on public.acceptances (quote_id);

-- Owner membership cannot be disabled or reassigned from the team screen.
create or replace function private.memberships_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_claims text := current_setting('request.jwt.claims', true);
begin
  if tg_op = 'INSERT' and new.role = 'owner' then
    if exists (
      select 1 from public.memberships m
      where m.org_id = new.org_id and m.role = 'owner' and m.id is distinct from new.id
    ) then
      raise exception 'this workspace already has an owner' using errcode = '42501';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if old.role = 'owner' and (new.role is distinct from 'owner' or new.status is distinct from old.status) then
      raise exception 'the owner membership cannot be changed here' using errcode = '42501';
    end if;
    if new.role = 'owner' and old.role is distinct from 'owner' then
      raise exception 'transfer ownership is not supported yet' using errcode = '42501';
    end if;
    if coalesce(v_claims, '') <> '' then
      if new.user_id = auth.uid()
         and new.status = 'disabled'
         and old.status is distinct from 'disabled' then
        raise exception 'you cannot disable your own access' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger memberships_guard
  before insert or update on public.memberships
  for each row execute function private.memberships_guard();

-- ---------------------------------------------------------------------------
-- Canonical offer + selection
-- ---------------------------------------------------------------------------
create or replace function private.quote_document_body(p_version uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'quote_id', q.id,
    'version', v.version,
    'title', q.title,
    'intro', q.intro,
    'notes_customer', q.notes_customer,
    'expires_at', q.expires_at,
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', i.id,
          'name', i.name,
          'description', i.description,
          'state', i.state,
          'option_group', i.option_group,
          'option_tier', i.option_tier,
          'qty', i.qty,
          'unit', i.unit,
          'price', i.price,
          'hours', i.hours,
          'cost', i.cost,
          'range_low', i.range_low,
          'range_high', i.range_high
        )
        order by i.id
      )
      from public.quote_line_items i
      where i.version_id = p_version
    ), '[]'::jsonb)
  )
  from public.quote_versions v
  join public.quotes q on q.id = v.quote_id
  where v.id = p_version;
$$;

revoke all on function private.quote_document_body(uuid) from public;

create or replace function private.resolve_quote_selection(p_version uuid, p_selected uuid[])
returns table(item_id uuid, price numeric, hours numeric, cost numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_group text;
  v_count integer;
begin
  if p_selected is null then
    return query
    with items as (
      select * from public.quote_line_items where version_id = p_version
    ),
    grouped as (
      select distinct on (option_group) id
      from items
      where option_group is not null
      order by option_group, selected desc, sort, id
    )
    select i.id, i.price, i.hours, i.cost
    from items i
    where (i.option_group is null and (i.state = 'included' or i.selected))
       or i.id in (select grouped.id from grouped);
    return;
  end if;

  if exists (
    select 1
    from unnest(p_selected) as picked(id)
    where not exists (
      select 1 from public.quote_line_items i
      where i.version_id = p_version and i.id = picked.id
    )
  ) then
    raise exception 'unknown line item' using errcode = '22023';
  end if;

  for v_group in
    select distinct i.option_group
    from public.quote_line_items i
    where i.version_id = p_version and i.option_group is not null
  loop
    select count(*) into v_count
    from public.quote_line_items i
    where i.version_id = p_version
      and i.option_group = v_group
      and i.id = any(p_selected);
    if v_count <> 1 then
      raise exception 'choose exactly one option in %', v_group using errcode = '22023';
    end if;
  end loop;

  return query
  select i.id, i.price, i.hours, i.cost
  from public.quote_line_items i
  where i.version_id = p_version
    and (
      (i.option_group is null and i.state = 'included')
      or i.id = any(p_selected)
    );
end;
$$;

revoke all on function private.resolve_quote_selection(uuid, uuid[]) from public;

create or replace function private.append_quote_audit(
  p_org uuid,
  p_quote uuid,
  p_kind text,
  p_payload jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev text;
  v_hash text;
begin
  select hash into v_prev
  from public.audit_events
  where quote_id = p_quote
  order by occurred_at desc, id desc
  limit 1;

  v_hash := private.sha256_hex(coalesce(v_prev, '') || '|' || p_kind || '|' || p_payload::text);
  insert into public.audit_events (org_id, quote_id, kind, payload, prev_hash, hash)
  values (p_org, p_quote, p_kind, p_payload, v_prev, v_hash);
  return v_hash;
end;
$$;

revoke all on function private.append_quote_audit(uuid, uuid, text, jsonb) from public;

create or replace function private.freeze_quote_version(p_version uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_frozen boolean;
  v_hash text;
  v_body jsonb;
begin
  select frozen, document_hash into v_frozen, v_hash
  from public.quote_versions
  where id = p_version
  for update;

  v_body := private.quote_document_body(p_version);
  if v_body is null then
    raise exception 'quote version not found' using errcode = 'P0002';
  end if;

  if v_frozen then
    if v_hash is distinct from private.sha256_hex(v_body::text) then
      raise exception 'proposal changed' using errcode = '40001';
    end if;
    return v_hash;
  end if;

  v_hash := private.sha256_hex(v_body::text);
  update public.quote_versions
  set frozen = true, document_hash = v_hash
  where id = p_version;
  return v_hash;
end;
$$;

revoke all on function private.freeze_quote_version(uuid) from public;

-- ---------------------------------------------------------------------------
-- quote_create: lock the number sequence and require a same-account property
-- ---------------------------------------------------------------------------
create or replace function public.quote_create(
  p_account uuid,
  p_property uuid default null,
  p_title text default 'Service quote'
)
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
  if v_org is null or v_org is distinct from private.current_org_id() then
    raise exception 'account not found' using errcode = 'P0002';
  end if;
  if not private.can_edit_customers(v_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_property is not null and not exists (
    select 1 from public.properties p
    where p.id = p_property and p.org_id = v_org and p.account_id = p_account
  ) then
    raise exception 'property must belong to the quote account' using errcode = '23503';
  end if;

  perform pg_advisory_xact_lock(hashtext('lawnquoter.quote_number'), hashtext(v_org::text));

  insert into public.quotes (org_id, account_id, property_id, number, title, created_by)
  values (
    v_org,
    p_account,
    p_property,
    private.next_quote_number(v_org),
    coalesce(nullif(p_title, ''), 'Service quote'),
    auth.uid()
  )
  returning id into v_id;

  insert into public.quote_versions (org_id, quote_id, version, created_by)
  values (v_org, v_id, 1, auth.uid())
  returning id into v_vid;

  insert into public.quote_sections (org_id, version_id, title, sort)
  values (v_org, v_vid, 'Included', 0);

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Send freezes the current version. Revise copies it forward.
-- ---------------------------------------------------------------------------
create or replace function public.quote_send(p_quote uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
  v public.quote_versions;
  v_was_frozen boolean;
begin
  select * into q from public.quotes where id = p_quote for update;
  if not found then
    raise exception 'quote not found' using errcode = 'P0002';
  end if;
  if auth.uid() is null or not private.can_edit_customers(q.org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if q.status = 'accepted' then
    raise exception 'accepted quotes are final' using errcode = '55000';
  end if;
  if q.status = 'declined' then
    raise exception 'revise a declined quote before sending it again' using errcode = '55000';
  end if;
  if q.expires_at is not null and q.expires_at < current_date and q.status in ('draft', 'changed', 'expired') then
    raise exception 'extend the expiry date before sending' using errcode = '22023';
  end if;

  select * into v
  from public.quote_versions
  where quote_id = q.id and version = q.current_version
  for update;
  v_was_frozen := v.frozen;

  perform private.freeze_quote_version(v.id);
  if not v_was_frozen then
    perform private.append_quote_audit(
      q.org_id,
      q.id,
      'quote.sent',
      jsonb_build_object('version', q.current_version)
    );
  end if;

  if q.status in ('draft', 'changed', 'expired') then
    update public.quotes
    set status = 'sent', sent_at = coalesce(sent_at, now())
    where id = q.id;
  end if;

  return q.public_token;
end;
$$;

grant execute on function public.quote_send(uuid) to authenticated;

create or replace function public.quote_revise(p_quote uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
  v public.quote_versions;
  s record;
  i record;
  v_new uuid;
  v_section uuid;
  v_map jsonb := '{}'::jsonb;
begin
  select * into q from public.quotes where id = p_quote for update;
  if not found then
    raise exception 'quote not found' using errcode = 'P0002';
  end if;
  if auth.uid() is null or not private.can_edit_customers(q.org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if q.status = 'accepted' then
    raise exception 'accepted quotes are final' using errcode = '55000';
  end if;

  select * into v
  from public.quote_versions
  where quote_id = q.id and version = q.current_version;

  if q.status = 'draft' or not v.frozen then
    if q.status <> 'draft' then
      update public.quotes set status = 'changed' where id = q.id;
    end if;
    return v.id;
  end if;

  insert into public.quote_versions (org_id, quote_id, version, created_by)
  values (q.org_id, q.id, q.current_version + 1, auth.uid())
  returning id into v_new;

  for s in
    select * from public.quote_sections where version_id = v.id order by sort, id
  loop
    insert into public.quote_sections (org_id, version_id, title, sort)
    values (q.org_id, v_new, s.title, s.sort)
    returning id into v_section;
    v_map := v_map || jsonb_build_object(s.id::text, v_section);
  end loop;

  for i in
    select * from public.quote_line_items where version_id = v.id order by sort, id
  loop
    insert into public.quote_line_items (
      org_id, version_id, section_id, service_id, name, description, state,
      option_group, option_tier, qty, unit, price, hours, cost, range_low, range_high,
      photo_url, notes_customer, notes_crew, selected, sort
    ) values (
      q.org_id,
      v_new,
      case when i.section_id is null then null else (v_map ->> i.section_id::text)::uuid end,
      i.service_id,
      i.name,
      i.description,
      i.state,
      i.option_group,
      i.option_tier,
      i.qty,
      i.unit,
      i.price,
      i.hours,
      i.cost,
      i.range_low,
      i.range_high,
      i.photo_url,
      i.notes_customer,
      i.notes_crew,
      i.selected,
      i.sort
    );
  end loop;

  update public.quotes
  set current_version = q.current_version + 1, status = 'changed'
  where id = q.id;

  perform private.append_quote_audit(
    q.org_id,
    q.id,
    'quote.revised',
    jsonb_build_object('version', q.current_version + 1)
  );

  return v_new;
end;
$$;

grant execute on function public.quote_revise(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Public read: hide drafts and in-progress revisions, honor expiry.
-- ---------------------------------------------------------------------------
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
  select * into q from public.quotes where public_token = p_token for update;
  if not found or q.status in ('draft', 'changed') then
    return null;
  end if;

  if q.expires_at is not null
     and q.expires_at < current_date
     and q.status not in ('accepted', 'declined', 'expired') then
    update public.quotes set status = 'expired' where id = q.id;
    q.status := 'expired';
  end if;

  select * into v from public.quote_versions where quote_id = q.id and version = q.current_version;
  select * into o from public.orgs where id = q.org_id;

  if q.status = 'sent' then
    update public.quotes
    set status = 'viewed', viewed_at = coalesce(viewed_at, now())
    where id = q.id;
    q.status := 'viewed';
  end if;

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

-- ---------------------------------------------------------------------------
-- Accept / decline
-- ---------------------------------------------------------------------------
drop function if exists public.quote_accept(uuid, text, text, boolean, text);

create or replace function public.quote_accept(
  p_token uuid,
  p_signer_name text,
  p_signer_email text default null,
  p_disclosure boolean default false,
  p_user_agent text default null,
  p_ip text default null,
  p_selected uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
  v public.quote_versions;
  v_offer_hash text;
  v_hash text;
  v_event_hash text;
  v_ip inet;
  v_ids jsonb;
  v_total numeric;
begin
  if coalesce(p_disclosure, false) is not true then
    raise exception 'ESIGN disclosure must be accepted' using errcode = '22023';
  end if;
  if p_signer_name is null or length(trim(p_signer_name)) < 2 then
    raise exception 'signer name required' using errcode = '22023';
  end if;

  begin
    if p_ip is not null and btrim(p_ip) <> '' then
      v_ip := btrim(p_ip)::inet;
    end if;
  exception
    when invalid_text_representation then
      v_ip := null;
  end;

  select * into q from public.quotes where public_token = p_token for update;
  if not found or q.status in ('draft', 'changed', 'declined') then
    raise exception 'quote not available' using errcode = 'P0002';
  end if;
  if q.expires_at is not null and q.expires_at < current_date and q.status <> 'accepted' then
    update public.quotes set status = 'expired' where id = q.id and status is distinct from 'accepted';
    raise exception 'quote not available' using errcode = 'P0002';
  end if;
  if q.status = 'expired' then
    raise exception 'quote not available' using errcode = 'P0002';
  end if;
  if q.status = 'accepted' then
    select document_hash into v_hash from public.acceptances where quote_id = q.id;
    return jsonb_build_object('already', true, 'quote_id', q.id, 'document_hash', v_hash);
  end if;

  select * into v
  from public.quote_versions
  where quote_id = q.id and version = q.current_version
  for update;

  v_offer_hash := private.freeze_quote_version(v.id);

  select coalesce(jsonb_agg(item_id order by item_id), '[]'::jsonb), coalesce(sum(price), 0)
    into v_ids, v_total
  from private.resolve_quote_selection(v.id, p_selected);

  v_hash := private.sha256_hex(v_offer_hash || ':' || v_ids::text);

  insert into public.acceptances (
    org_id, quote_id, version, method, signer_name, signer_email,
    document_hash, disclosure_accepted, ip, user_agent, selections, accepted_total
  ) values (
    q.org_id, q.id, q.current_version, 'click', trim(p_signer_name), nullif(btrim(coalesce(p_signer_email, '')), ''),
    v_hash, true, v_ip, p_user_agent, v_ids, v_total
  );

  v_event_hash := private.append_quote_audit(
    q.org_id,
    q.id,
    'quote.accepted',
    jsonb_build_object(
      'signer', trim(p_signer_name),
      'email', nullif(btrim(coalesce(p_signer_email, '')), ''),
      'version', q.current_version,
      'document_hash', v_hash,
      'selections', v_ids,
      'accepted_total', v_total,
      'ip', v_ip::text
    )
  );

  update public.quotes set status = 'accepted' where id = q.id;

  return jsonb_build_object(
    'ok', true,
    'document_hash', v_hash,
    'event_hash', v_event_hash,
    'accepted_total', v_total
  );
exception
  when unique_violation then
    select document_hash into v_hash from public.acceptances where quote_id = q.id;
    return jsonb_build_object('already', true, 'quote_id', q.id, 'document_hash', v_hash);
end;
$$;

grant execute on function public.quote_accept(uuid, text, text, boolean, text, text, uuid[]) to anon, authenticated;

create or replace function public.quote_decline(p_token uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
begin
  select * into q from public.quotes where public_token = p_token for update;
  if not found or q.status in ('draft', 'changed', 'accepted') then
    raise exception 'quote not available' using errcode = 'P0002';
  end if;
  if q.expires_at is not null and q.expires_at < current_date and q.status <> 'declined' then
    update public.quotes set status = 'expired' where id = q.id and status is distinct from 'declined';
    raise exception 'quote not available' using errcode = 'P0002';
  end if;
  if q.status = 'expired' then
    raise exception 'quote not available' using errcode = 'P0002';
  end if;
  if q.status = 'declined' then
    return;
  end if;

  update public.quotes set status = 'declined' where id = q.id;
  perform private.append_quote_audit(
    q.org_id,
    q.id,
    'quote.declined',
    jsonb_build_object('reason', nullif(btrim(coalesce(p_reason, '')), ''))
  );
end;
$$;
