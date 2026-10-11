-- L01: lead_requests / lead_activities schema, defaults, and RLS.
-- Anon and crew see nothing. read_only selects; sales writes.

select plan(27);

select has_table('public', 'lead_requests', 'lead_requests exists');
select has_table('public', 'lead_activities', 'lead_activities exists');
select has_type('public', 'lead_request_status', 'lead_request_status enum exists');
select has_type('public', 'lead_lost_reason', 'lead_lost_reason enum exists');

select tests.create_user('o1@example.com', 'Owner One') as owner1 \gset
select tests.create_user('s1@example.com', 'Sales One') as sales1 \gset
select tests.create_user('r1@example.com', 'Read Only') as read1 \gset
select tests.create_user('c1@example.com', 'Crew One') as crew1 \gset
select tests.create_user('o2@example.com', 'Owner Two') as owner2 \gset
select tests.create_org('One', 'one', :'owner1'::uuid) as org1 \gset
select tests.create_org('Two', 'two', :'owner2'::uuid) as org2 \gset
select tests.add_member(:'org1'::uuid, :'sales1'::uuid, 'sales');
select tests.add_member(:'org1'::uuid, :'read1'::uuid, 'read_only');
select tests.add_member(:'org1'::uuid, :'crew1'::uuid, 'crew');

-- Defaults when settings keys are absent
select is(
  private.lead_response_target_minutes(:'org1'::uuid),
  60,
  'response target defaults to 60 minutes (1 business hour)'
);
select is(
  private.lead_default_assignee(:'org1'::uuid),
  :'owner1'::uuid,
  'default assignee is the org owner'
);
select is(
  private.lead_service_area_zips(:'org1'::uuid),
  '{}'::text[],
  'service-area ZIPs default empty'
);
select is(
  private.lead_spam_retention_days(:'org1'::uuid),
  30,
  'spam retention defaults to 30 days'
);
select is(
  private.lead_unconverted_retention_days(:'org1'::uuid),
  365,
  'unconverted retention defaults to 365 days'
);
select is(
  private.lead_form_services(:'org1'::uuid),
  '{}'::text[],
  'form services default empty'
);
select is(
  private.lead_consent_text_version(:'org1'::uuid),
  'v1',
  'consent text version defaults to v1'
);
select ok(
  length(private.lead_consent_text(:'org1'::uuid)) > 20,
  'consent text has a built-in default'
);
select is(
  private.lead_form_slug(:'org1'::uuid),
  null,
  'form slug defaults null until enabled'
);

-- Owner seeds a lead
select tests.authenticate_as(:'owner1'::uuid, :'org1'::uuid, 'owner');

insert into public.lead_requests (
  org_id, contact_name, phone, email, address_typed, status
) values (
  :'org1'::uuid, 'Pat Lead', '+15551234567', 'pat@example.com',
  '100 Maple St, Springfield, IL 62704', 'new'
) returning id as lead1 \gset

select ok(:'lead1'::uuid is not null, 'owner can insert a lead request');

insert into public.lead_activities (
  org_id, lead_request_id, kind, summary, actor_id
) values (
  :'org1'::uuid, :'lead1'::uuid, 'created', 'Lead created', :'owner1'::uuid
);

-- Anon cannot read or insert (no table privileges; not merely RLS empty)
select tests.authenticate_anon();
select throws_ok(
  $$ select count(*) from public.lead_requests $$,
  '42501',
  null,
  'anon cannot read lead_requests'
);
select throws_ok(
  format(
    $$ insert into public.lead_requests (
         org_id, contact_name, phone, address_typed
       ) values (%L, 'Anon', '+15550001111', '1 Main') $$,
    :'org1'
  ),
  '42501',
  null,
  'anon cannot insert lead_requests'
);

-- Crew reads zero rows and cannot write
select tests.authenticate_as(:'crew1'::uuid, :'org1'::uuid, 'crew');
select is(
  (select count(*) from public.lead_requests),
  0::bigint,
  'crew role reads zero lead rows'
);
select is(
  (select count(*) from public.lead_activities),
  0::bigint,
  'crew role reads zero lead activities'
);
select throws_ok(
  format(
    $$ insert into public.lead_requests (
         org_id, contact_name, phone, address_typed
       ) values (%L, 'Crew', '+15550002222', '2 Main') $$,
    :'org1'
  ),
  '42501',
  null,
  'crew cannot insert lead_requests'
);

-- read_only select ok, update is a silent no-op, insert denied
select tests.authenticate_as(:'read1'::uuid, :'org1'::uuid, 'read_only');
select is(
  (select count(*) from public.lead_requests where id = :'lead1'::uuid),
  1::bigint,
  'read_only can select lead_requests'
);
update public.lead_requests set note = 'nope' where id = :'lead1'::uuid;
select tests.clear_auth();
select is(
  (select note from public.lead_requests where id = :'lead1'::uuid),
  null,
  'read_only update of lead_requests is a silent no-op'
);
select tests.authenticate_as(:'read1'::uuid, :'org1'::uuid, 'read_only');
select throws_ok(
  format(
    $$ insert into public.lead_activities (
         org_id, lead_request_id, kind, summary
       ) values (%L, %L, 'note', 'nope') $$,
    :'org1', :'lead1'
  ),
  '42501',
  null,
  'read_only cannot insert lead_activities'
);

-- Sales can write
select tests.authenticate_as(:'sales1'::uuid, :'org1'::uuid, 'sales');
select lives_ok(
  format(
    $$ update public.lead_requests
       set status = 'contacted', first_contacted_at = now(), note = 'Called'
       where id = %L $$,
    :'lead1'
  ),
  'sales can update lead_requests'
);
select lives_ok(
  format(
    $$ insert into public.lead_activities (
         org_id, lead_request_id, kind, summary, actor_id
       ) values (%L, %L, 'contact_logged', 'Called', %L) $$,
    :'org1', :'lead1', :'sales1'
  ),
  'sales can insert lead_activities'
);

-- Append-only: no UPDATE grant for authenticated; trigger blocks superuser writes
select throws_ok(
  format(
    $$ update public.lead_activities set summary = 'changed'
       where lead_request_id = %L $$,
    :'lead1'
  ),
  '42501',
  null,
  'authenticated cannot update lead_activities'
);
select tests.clear_auth();
select throws_ok(
  format(
    $$ update public.lead_activities set summary = 'changed'
       where lead_request_id = %L $$,
    :'lead1'
  ),
  'P0001',
  null,
  'lead_activities trigger rejects updates'
);

-- Cross-org denied
select tests.authenticate_as(:'owner2'::uuid, :'org2'::uuid, 'owner');
select is(
  (select count(*) from public.lead_requests where id = :'lead1'::uuid),
  0::bigint,
  'other org cannot read lead_requests'
);

select tests.clear_auth();
select finish();
