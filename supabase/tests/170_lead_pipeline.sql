-- Pipeline stage clock, and office-only visibility of leads.

select plan(7);

select tests.create_user('pipe-owner@example.com', 'Pipe Owner') as owner1 \gset
select tests.create_user('pipe-crew@example.com', 'Pipe Crew') as crew1 \gset
select tests.create_user('pipe-sales@example.com', 'Pipe Sales') as sales1 \gset
select tests.create_user('pipe-owner2@example.com', 'Pipe Owner Two') as owner2 \gset
select tests.create_org('Pipe One', 'pipe-one', :'owner1'::uuid) as org1 \gset
select tests.create_org('Pipe Two', 'pipe-two', :'owner2'::uuid) as org2 \gset
select tests.add_member(:'org1'::uuid, :'crew1'::uuid, 'crew');
select tests.add_member(:'org1'::uuid, :'sales1'::uuid, 'sales');

select tests.authenticate_as(:'owner1'::uuid, :'org1'::uuid, 'owner');

insert into public.lead_requests (
  org_id, contact_name, phone, address_typed, status
) values (
  :'org1'::uuid, 'Ada New', '+15551110001', '1 Oak St', 'new'
) returning id as lead_new \gset

select ok(
  (select stage_entered_at is not null from public.lead_requests where id = :'lead_new'::uuid),
  'a new lead stamps stage_entered_at'
);

update public.lead_requests
set stage_entered_at = '2020-01-01T00:00:00Z'
where id = :'lead_new'::uuid;
update public.lead_requests set note = 'still new' where id = :'lead_new'::uuid;

select is(
  (select stage_entered_at from public.lead_requests where id = :'lead_new'::uuid),
  '2020-01-01T00:00:00Z'::timestamptz,
  'editing a note does not restart the stage clock'
);

select tests.authenticate_as(:'sales1'::uuid, :'org1'::uuid, 'sales');
select lives_ok(
  format(
    $$ update public.lead_requests
       set status = 'contacted', first_contacted_at = now()
       where id = %L $$,
    :'lead_new'
  ),
  'sales can move a lead to the next stage'
);

select tests.clear_auth();
select ok(
  (select stage_entered_at > '2020-01-02'::timestamptz from public.lead_requests where id = :'lead_new'::uuid),
  'changing status restarts the stage clock'
);

select tests.authenticate_as(:'owner2'::uuid, :'org2'::uuid, 'owner');
select is(
  (select count(*) from public.lead_requests),
  0::bigint,
  'another org cannot see these leads'
);

select tests.authenticate_as(:'crew1'::uuid, :'org1'::uuid, 'crew');
select is(
  (select count(*) from public.lead_requests),
  0::bigint,
  'crew cannot see pipeline leads'
);
update public.lead_requests set note = 'crew' where id = :'lead_new'::uuid;
select tests.clear_auth();
select is(
  (select note from public.lead_requests where id = :'lead_new'::uuid),
  'still new',
  'crew cannot update a lead'
);

select * from finish();
