-- L02: lead_source picklist mapping, Other details, Website form system-only.

select plan(14);

select tests.create_user('owner@leadsrc.example', 'Lead Owner') as owner \gset
select tests.create_org('Lead Src Co', 'lead-src', :'owner'::uuid) as org \gset

-- Mapping function (what the migration used on legacy free text) -----------------
select is(
  (select lead_source from private.map_lead_source('  google ')),
  'Google',
  'maps google (case/trim) to Google'
);
select is(
  (select lead_source_other from private.map_lead_source('  google ')),
  null,
  'clears other for a known value'
);
select is(
  (select lead_source from private.map_lead_source('door-hanger')),
  'Door hanger',
  'near-match door-hanger → Door hanger'
);
select is(
  (select lead_source from private.map_lead_source('Website Form')),
  'Website form',
  'maps Website Form to Website form'
);
select is(
  (select lead_source from private.map_lead_source('Other')),
  'Other',
  'existing Other stays Other'
);
select is(
  (select lead_source_other from private.map_lead_source('Other')),
  null,
  'existing Other has no free text'
);
select is(
  (select lead_source from private.map_lead_source('Nextdoor ad')),
  'Other',
  'unmatched free text becomes Other'
);
select is(
  (select lead_source_other from private.map_lead_source('Nextdoor ad')),
  'Nextdoor ad',
  'unmatched free text preserved in lead_source_other'
);
select is(
  (select lead_source from private.map_lead_source(null)),
  null,
  'null stays null'
);

-- Authenticated write rules ----------------------------------------------------
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');

select lives_ok(
  format(
    $$ insert into public.accounts (org_id, name, lead_source, lead_source_other)
       values (%L, 'Known', 'Referral', null) $$,
    :'org'
  ),
  'owner can set a picklist value'
);

select throws_ok(
  format(
    $$ insert into public.accounts (org_id, name, lead_source, lead_source_other)
       values (%L, 'Needs detail', 'Other', null) $$,
    :'org'
  ),
  '23514',
  'Other lead source requires details',
  'Other without text is rejected'
);

select lives_ok(
  format(
    $$ insert into public.accounts (org_id, name, lead_source, lead_source_other)
       values (%L, 'Other ok', 'Other', '  Flyer  ') $$,
    :'org'
  ),
  'Other with text is accepted'
);

select is(
  (select lead_source_other from public.accounts where name = 'Other ok'),
  'Flyer',
  'Other free text is trimmed'
);

select throws_ok(
  format(
    $$ insert into public.accounts (org_id, name, lead_source)
       values (%L, 'Web', 'Website form') $$,
    :'org'
  ),
  '23514',
  'Website form lead source can only be set by the system',
  'authenticated cannot set Website form'
);

select * from finish();
