-- Site-walk photo bucket: crew in the org can store a photo; other orgs cannot.

select plan(8);

select results_eq(
  $$ select file_size_limit, public from storage.buckets where id = 'site-walk-photos' $$,
  $$ values (2097152::bigint, false) $$,
  'site-walk-photos is private and limited to 2 MiB'
);

select ok(
  not has_function_privilege('anon', 'private.site_walk_photo_org(text)', 'execute')
  and has_function_privilege('authenticated', 'private.site_walk_photo_org(text)', 'execute'),
  'site_walk_photo_org is granted to authenticated only'
);

select tests.create_user('walk-owner@example.com', 'Walk Owner') as owner \gset
select tests.create_user('walk-crew@example.com', 'Walk Crew') as crew \gset
select tests.create_user('walk-other@example.com', 'Walk Other') as other \gset
select tests.create_org('Walk Co', 'walk-co', :'owner'::uuid) as org \gset
select tests.create_org('Walk Other', 'walk-other', :'other'::uuid) as other_org \gset
select tests.add_member(:'org'::uuid, :'crew'::uuid, 'crew');

select tests.authenticate_as(:'crew'::uuid, :'org'::uuid, 'crew');

select lives_ok(
  format(
    $$ insert into storage.objects (bucket_id, name) values ('site-walk-photos', %L) $$,
    :'org' || '/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1.jpg'
  ),
  'crew can store a site-walk photo in their org'
);

select throws_ok(
  format(
    $$ insert into storage.objects (bucket_id, name) values ('site-walk-photos', %L) $$,
    :'other_org' || '/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2.jpg'
  ),
  '42501',
  null,
  'crew cannot store a photo under another org'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('site-walk-photos', 'nope.jpg') $$,
  '42501',
  null,
  'a site-walk photo key must be org/file.ext'
);

select is(
  (
    select count(*)::int
    from storage.objects
    where bucket_id = 'site-walk-photos'
      and name = :'org' || '/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1.jpg'
  ),
  1,
  'crew can read their site-walk photo'
);

update storage.objects
set metadata = '{"v":"1"}'::jsonb
where bucket_id = 'site-walk-photos'
  and name = :'org' || '/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1.jpg';

select is(
  (
    select metadata
    from storage.objects
    where bucket_id = 'site-walk-photos'
      and name = :'org' || '/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1.jpg'
  ),
  null,
  'a site-walk photo cannot be overwritten'
);

select tests.authenticate_as(:'other'::uuid, :'other_org'::uuid, 'owner');

select is(
  (
    select count(*)::int
    from storage.objects
    where bucket_id = 'site-walk-photos'
  ),
  0,
  'another org cannot see site-walk photos'
);
