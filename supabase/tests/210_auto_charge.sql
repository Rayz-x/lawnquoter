select plan(4);

select has_column('public', 'accounts', 'auto_charge', 'accounts.auto_charge exists');

select tests.create_user('auto-owner@example.com', 'Auto Owner') as owner \gset
select tests.create_user('auto-crew@example.com', 'Auto Crew') as crew \gset
select tests.create_user('auto-other@example.com', 'Auto Other') as other \gset
select tests.create_org('Auto Co', 'auto-co', :'owner'::uuid) as org \gset
select tests.create_org('Auto Other Co', 'auto-other-co', :'other'::uuid) as other_org \gset
select tests.add_member(:'org'::uuid, :'crew'::uuid, 'crew');

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
insert into public.accounts (org_id, name) values (:'org'::uuid, 'Maple Street')
returning id as account \gset

select is(
  (select auto_charge from public.accounts where id = :'account'::uuid),
  false,
  'auto-charge starts off'
);

update public.accounts set auto_charge = true where id = :'account'::uuid;
select is(
  (select auto_charge from public.accounts where id = :'account'::uuid),
  true,
  'owner can turn auto-charge on'
);

select tests.authenticate_as(:'crew'::uuid, :'org'::uuid, 'crew');
update public.accounts set auto_charge = false where id = :'account'::uuid;

select tests.authenticate_as(:'other'::uuid, :'other_org'::uuid, 'owner');
update public.accounts set auto_charge = false where id = :'account'::uuid;

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select is(
  (select auto_charge from public.accounts where id = :'account'::uuid),
  true,
  'crew and another company cannot change auto-charge'
);

select * from finish();
