-- L13: lead-photos bucket, office-only reads, crew/anon denied.

select plan(15);

select results_eq(
  $$ select file_size_limit, public from storage.buckets where id = 'lead-photos' $$,
  $$ values (2097152::bigint, false) $$,
  'lead-photos is private and limited to 2 MiB'
);
select ok(
  (
    select allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp']::text[]
      and cardinality(allowed_mime_types) = 3
    from storage.buckets
    where id = 'lead-photos'
  ),
  'lead-photos allows jpeg, png, and webp only'
);

select ok(
  not has_function_privilege('anon', 'private.lead_photo_path_parts(text)', 'execute')
  and has_function_privilege('authenticated', 'private.lead_photo_path_parts(text)', 'execute')
  and has_function_privilege('service_role', 'private.lead_photo_path_parts(text)', 'execute'),
  'lead_photo_path_parts is granted to authenticated and service_role'
);
select ok(
  not has_function_privilege('anon', 'private.can_read_lead_photo(text)', 'execute')
  and has_function_privilege('authenticated', 'private.can_read_lead_photo(text)', 'execute')
  and has_function_privilege('service_role', 'private.can_read_lead_photo(text)', 'execute'),
  'can_read_lead_photo is granted to authenticated and service_role'
);
select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'lead_photos_object_insert'
  ),
  0::bigint,
  'lead photo objects have no insert policy for clients'
);

select tests.create_user('l13-owner@example.com', 'L13 Owner') as owner \gset
select tests.create_user('l13-sales@example.com', 'L13 Sales') as sales \gset
select tests.create_user('l13-crew@example.com', 'L13 Crew') as crew \gset
select tests.create_user('l13-other@example.com', 'L13 Other') as other \gset
select tests.create_org('Lead Photos', 'lead-photos-org', :'owner'::uuid) as org \gset
select tests.create_org('Other Lead Photos', 'lead-photos-other', :'other'::uuid) as org2 \gset
select tests.add_member(:'org'::uuid, :'sales'::uuid, 'sales');
select tests.add_member(:'org'::uuid, :'crew'::uuid, 'crew');

select tests.clear_auth();
-- Seed as the org owner so RLS insert policies allow the row.
select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
insert into public.lead_requests (
  id, org_id, contact_name, phone, address_typed, status
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  :'org'::uuid,
  'Photo Lead',
  '+15125550113',
  '1 Photo Way',
  'new'
);

select format(
  '%s/%s/%s.jpg',
  :'org',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
) as photo_path \gset

select tests.clear_auth();
insert into storage.objects (bucket_id, name)
values ('lead-photos', :'photo_path');

select tests.authenticate_as(:'sales'::uuid, :'org'::uuid, 'sales');
select is(
  (
    select count(*)::int
    from storage.objects
    where bucket_id = 'lead-photos'
      and name = :'photo_path'
  ),
  1,
  'office sales can read lead photo objects'
);

select tests.authenticate_as(:'crew'::uuid, :'org'::uuid, 'crew');
select is(
  (
    select count(*)::int
    from storage.objects
    where bucket_id = 'lead-photos'
      and name = :'photo_path'
  ),
  0,
  'crew cannot read lead photo objects'
);
select throws_ok(
  format(
    $$ insert into storage.objects (bucket_id, name) values ('lead-photos', %L) $$,
    :'org' || '/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cccccccc-cccc-4ccc-8ccc-cccccccccccc.jpg'
  ),
  '42501',
  null,
  'crew cannot insert lead photo objects'
);

select tests.authenticate_anon();
select is(
  (
    select count(*)::int
    from storage.objects
    where bucket_id = 'lead-photos'
      and name = :'photo_path'
  ),
  0,
  'anon cannot read lead photo objects'
);
select throws_ok(
  format(
    $$ insert into storage.objects (bucket_id, name) values ('lead-photos', %L) $$,
    :'org' || '/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/dddddddd-dddd-4ddd-8ddd-dddddddddddd.jpg'
  ),
  '42501',
  null,
  'anon cannot insert lead photo objects'
);

select tests.authenticate_as(:'other'::uuid, :'org2'::uuid, 'owner');
select is(
  (
    select count(*)::int
    from storage.objects
    where bucket_id = 'lead-photos'
      and name = :'photo_path'
  ),
  0,
  'another org cannot read lead photo objects'
);

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select is(
  (
    select count(*)::int
    from storage.objects
    where bucket_id = 'lead-photos'
      and name = :'photo_path'
  ),
  1,
  'owner can read lead photo objects'
);
select throws_ok(
  format(
    $$ insert into storage.objects (bucket_id, name) values ('lead-photos', %L) $$,
    :'org' || '/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.jpg'
  ),
  '42501',
  null,
  'authenticated clients cannot insert lead photo objects'
);

select ok(
  private.can_read_lead_photo(:'photo_path'),
  'can_read_lead_photo is true for office on a valid path'
);

select tests.authenticate_as(:'crew'::uuid, :'org'::uuid, 'crew');
select ok(
  not private.can_read_lead_photo(:'photo_path'),
  'can_read_lead_photo is false for crew'
);

select * from finish();
