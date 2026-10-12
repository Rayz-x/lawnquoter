-- A linked lead follows the quote: sent → quoted, accepted → won. Lost stays lost.

select plan(5);

select tests.create_user('adv-owner@example.com', 'Advance Owner') as owner1 \gset
select tests.create_user('adv-crew@example.com', 'Advance Crew') as crew1 \gset
select tests.create_org('Advance', 'advance', :'owner1'::uuid) as org1 \gset
select tests.add_member(:'org1'::uuid, :'crew1'::uuid, 'crew');
select tests.authenticate_as(:'owner1'::uuid, :'org1'::uuid, 'owner');

insert into public.accounts (org_id, name) values (:'org1'::uuid, 'Ada') returning id as acct \gset
select public.quote_create(:'acct'::uuid, null, 'Ada quote') as qid \gset
select public.quote_current_version(:'qid'::uuid) as vid \gset
insert into public.quote_line_items (org_id, version_id, name, state, price)
values (:'org1'::uuid, :'vid'::uuid, 'Mow', 'included', 80);

insert into public.lead_requests (
  org_id, contact_name, phone, address_typed, status, quote_id
) values (
  :'org1'::uuid, 'Quoted Pat', '+15551110002', '2 Oak St', 'new', :'qid'::uuid
) returning id as lead_quote \gset

select public.quote_send(:'qid'::uuid) as tok \gset
select is(
  (select status::text from public.lead_requests where id = :'lead_quote'::uuid),
  'quoted',
  'sending a quote moves the linked lead to quoted'
);

select public.quote_accept(:'tok'::uuid, 'Quoted Pat', 'pat@example.com', true, 'ua', null, '{}'::uuid[]) as accepted \gset
select is(
  (select status::text from public.lead_requests where id = :'lead_quote'::uuid),
  'won',
  'accepting a quote moves the linked lead to won'
);

insert into public.accounts (org_id, name) values (:'org1'::uuid, 'Lost Lou') returning id as acct2 \gset
select public.quote_create(:'acct2'::uuid, null, 'Lost quote') as qid2 \gset
select public.quote_current_version(:'qid2'::uuid) as vid2 \gset
insert into public.quote_line_items (org_id, version_id, name, state, price)
values (:'org1'::uuid, :'vid2'::uuid, 'Mow', 'included', 40);
insert into public.lead_requests (
  org_id, contact_name, phone, address_typed, status, lost_reason, quote_id
) values (
  :'org1'::uuid, 'Lost Lou', '+15551110003', '3 Oak St', 'lost', 'price', :'qid2'::uuid
) returning id as lead_lost \gset
select public.quote_send(:'qid2'::uuid) as tok2 \gset
select is(
  (select status::text from public.lead_requests where id = :'lead_lost'::uuid),
  'lost',
  'a lost lead stays lost when its quote is sent'
);

insert into public.accounts (org_id, name) values (:'org1'::uuid, 'Spam Sam') returning id as acct3 \gset
select public.quote_create(:'acct3'::uuid, null, 'Spam quote') as qid3 \gset
select public.quote_current_version(:'qid3'::uuid) as vid3 \gset
insert into public.quote_line_items (org_id, version_id, name, state, price)
values (:'org1'::uuid, :'vid3'::uuid, 'Mow', 'included', 10);
insert into public.lead_requests (
  org_id, contact_name, phone, address_typed, status, quote_id
) values (
  :'org1'::uuid, 'Spam Sam', '+15551110004', '4 Oak St', 'spam', :'qid3'::uuid
) returning id as lead_spam \gset
select public.quote_send(:'qid3'::uuid) as tok3 \gset
select is(
  (select status::text from public.lead_requests where id = :'lead_spam'::uuid),
  'spam',
  'a spam lead stays spam when its quote is sent'
);

select tests.authenticate_as(:'crew1'::uuid, :'org1'::uuid, 'crew');
select is(
  (select count(*) from public.lead_requests),
  0::bigint,
  'crew still cannot see leads after a quote moves them'
);

select * from finish();
