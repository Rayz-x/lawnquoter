-- S16: crew upsell has no price; office same-day extra approval expires end of day.

select plan(16);

select ok(
  not has_function_privilege('anon', 'public.office_approve_same_day_extra(uuid)', 'execute'),
  'anon has no execute on office_approve_same_day_extra'
);
select ok(
  has_function_privilege('authenticated', 'public.office_approve_same_day_extra(uuid)', 'execute'),
  'authenticated can execute office_approve_same_day_extra'
);
select ok(
  has_function_privilege('authenticated', 'public.enhancement_same_day_is_active(uuid)', 'execute'),
  'authenticated can execute enhancement_same_day_is_active'
);

select tests.create_user('s16-owner@example.com', 'S16 Owner') as owner \gset
select tests.create_user('s16-dispatch@example.com', 'S16 Dispatch') as dispatcher \gset
select tests.create_user('s16-lead@example.com', 'S16 Lead') as lead \gset
select tests.create_user('s16-crew@example.com', 'S16 Crew') as crew_user \gset
select tests.create_org('S16 Co', 's16-co', :'owner'::uuid) as org \gset
select tests.add_member(:'org'::uuid, :'dispatcher'::uuid, 'dispatcher');
select tests.add_member(:'org'::uuid, :'lead'::uuid, 'crew_lead');
select tests.add_member(:'org'::uuid, :'crew_user'::uuid, 'crew');
update public.orgs set timezone = 'America/Chicago' where id = :'org'::uuid;
select private.org_local_today(:'org'::uuid) as today \gset

insert into public.accounts (org_id, name, phone, email, billing_email, billing_address_line1)
values (:'org'::uuid, 'S16 Account', '555-0160', 's16@example.com', 'bill@example.com', '1 Bill St')
returning id as acct \gset
insert into public.properties (org_id, account_id, address_line1, city, region, postal_code)
values (:'org'::uuid, :'acct'::uuid, '160 Upsell Ln', 'Springfield', 'IL', '62701')
returning id as prop \gset
insert into public.crews (org_id, name, active)
values (:'org'::uuid, 'North', true)
returning id as crew_id \gset
insert into public.crew_members (org_id, crew_id, profile_id)
values (:'org'::uuid, :'crew_id'::uuid, :'lead'::uuid),
       (:'org'::uuid, :'crew_id'::uuid, :'crew_user'::uuid);
update public.crews set default_lead_id = :'lead'::uuid where id = :'crew_id'::uuid;
insert into public.jobs (org_id, property_id, title, status)
values (:'org'::uuid, :'prop'::uuid, 'Mulch visit', 'scheduled')
returning id as job_id \gset
insert into public.routes (org_id, crew_id, date, status, published_at, revision)
values (:'org'::uuid, :'crew_id'::uuid, :'today'::date, 'published', now(), 1)
returning id as route_id \gset
insert into public.visits (
  org_id, job_id, property_id, route_id, sort, occurrence_date, scheduled_date, status, crew_size
) values (
  :'org'::uuid, :'job_id'::uuid, :'prop'::uuid, :'route_id'::uuid, 0, :'today'::date, :'today'::date, 'scheduled', 1
) returning id as visit_id \gset

select gen_random_uuid() as client_price \gset
select gen_random_uuid() as client_ok \gset

select tests.authenticate_as(:'lead'::uuid, :'org'::uuid, 'crew_lead');
select public.crew_sync(jsonb_build_array(jsonb_build_object(
  'client_id', :'client_price',
  'kind', 'enhancement_create',
  'visit_id', :'visit_id',
  'payload', jsonb_build_object('tag', 'mulch', 'note', 'beds', 'price', 120)
))) as sync_price \gset
select is((:'sync_price')::jsonb->'results'->0->>'status', 'error', 'sync rejects an upsell payload with a price');
select is(
  (:'sync_price')::jsonb->'results'->0->>'message',
  'crew payloads cannot include money',
  'priced upsell names the money error'
);
select is(
  (select count(*) from public.enhancement_requests where client_id = :'client_price'::uuid),
  0::bigint,
  'a priced upsell is not stored'
);

select public.crew_sync(jsonb_build_array(jsonb_build_object(
  'client_id', :'client_ok',
  'kind', 'enhancement_create',
  'visit_id', :'visit_id',
  'payload', jsonb_build_object('tag', 'mulch', 'note', 'front beds', 'photo_ids', '[]'::jsonb)
))) as sync_ok \gset
select is((:'sync_ok')::jsonb->'results'->0->>'status', 'applied', 'an upsell request without a price is filed');
select is(
  (select tag::text from public.enhancement_requests where client_id = :'client_ok'::uuid),
  'mulch',
  'filed upsell keeps its tag'
);
select is(
  (select note from public.enhancement_requests where client_id = :'client_ok'::uuid),
  'front beds',
  'filed upsell keeps its note'
);
select ok(
  not exists (
    select 1
    from public.enhancement_requests e
    where e.client_id = :'client_ok'::uuid
      and e.same_day_approved_until is not null
  ),
  'a new upsell is not same-day approved until the office acts'
);
select tests.clear_auth();

select (select id from public.enhancement_requests where client_id = :'client_ok'::uuid) as enh_id \gset

select tests.authenticate_as(:'crew_user'::uuid, :'org'::uuid, 'crew');
select throws_ok(
  format('select public.office_approve_same_day_extra(%L::uuid)', :'enh_id'),
  '42501',
  null,
  'crew cannot approve a same-day extra'
);
select tests.clear_auth();

select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select public.office_approve_same_day_extra(:'enh_id'::uuid) as approved \gset
select is((:'approved')::jsonb->>'id', :'enh_id', 'approve returns the enhancement id');
select is(
  ((:'approved')::jsonb->>'same_day_approved_until')::timestamptz,
  private.org_local_day_end(:'org'::uuid, :'today'::date),
  'approval expires at the end of the org-local day'
);
select ok(
  public.enhancement_same_day_is_active(:'enh_id'::uuid),
  'approval is active before end of day'
);
select is(
  (
    select i ->> 'enhancement_id'
    from jsonb_array_elements(public.office_attention_tray(:'today'::date) -> 'flags') i
    where i ->> 'id' = :'visit_id'
  ),
  :'enh_id',
  'attention tray exposes the enhancement id for same-day approve'
);
select tests.clear_auth();

-- Simulate clock past end of day without freezing Postgres time.
update public.enhancement_requests
set same_day_approved_until = now() - interval '1 second'
where id = :'enh_id'::uuid;

select tests.authenticate_as(:'dispatcher'::uuid, :'org'::uuid, 'dispatcher');
select ok(
  not public.enhancement_same_day_is_active(:'enh_id'::uuid),
  'approval expires after end of day'
);
select tests.clear_auth();

select * from finish();
