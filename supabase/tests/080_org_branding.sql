select plan(46);

select has_column('public', 'orgs', 'logo_dark_path', 'logo_dark_path exists');
select has_column('public', 'orgs', 'logo_raster_path', 'logo_raster_path exists');
select has_column('public', 'orgs', 'logo_width', 'logo_width exists');
select has_column('public', 'orgs', 'logo_height', 'logo_height exists');
select has_column('public', 'orgs', 'logo_shows_name', 'logo_shows_name exists');
select has_column('public', 'orgs', 'logo_needs_chip', 'logo_needs_chip exists');
select has_column('public', 'orgs', 'heading_font', 'heading_font exists');
select has_column('public', 'orgs', 'branding_updated_at', 'branding_updated_at exists');
select col_not_null('public', 'orgs', 'heading_font', 'heading_font is required');
select col_not_null('public', 'orgs', 'logo_needs_chip', 'logo_needs_chip is required');

select results_eq(
  $$ select file_size_limit, public from storage.buckets where id = 'org-branding' $$,
  $$ values (2097152::bigint, true) $$,
  'org-branding is public and limited to 2 MB'
);
select ok(
  (select allowed_mime_types @> array['image/svg+xml', 'image/png', 'image/jpeg']::text[]
   from storage.buckets where id = 'org-branding'),
  'org-branding allows svg, png, and jpeg'
);
select is(
  (
    select pg_get_userbyid(c.relowner)::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects'
  ),
  'supabase_storage_admin',
  'storage.objects stays owned by supabase_storage_admin'
);
select ok(
  (
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects'
  ),
  'storage.objects already has row level security'
);

select tests.create_user('brand-owner@example.com', 'Brand Owner') as owner \gset
select tests.create_user('brand-admin@example.com', 'Brand Admin') as admin \gset
select tests.create_user('brand-sales@example.com', 'Brand Sales') as sales \gset
select tests.create_user('brand-other@example.com', 'Other Owner') as other \gset
select tests.create_org('Branded', 'branded', :'owner'::uuid) as org \gset
select tests.create_org('Other Co', 'other-co', :'other'::uuid) as org2 \gset
select tests.add_member(:'org'::uuid, :'admin'::uuid, 'admin');
select tests.add_member(:'org'::uuid, :'sales'::uuid, 'sales');

select tests.clear_auth();
select throws_ok(
  format($$ update public.orgs set heading_font = 'comic' where id = %L::uuid $$, :'org'),
  '23514',
  null,
  'heading_font only allows classic, clean, or sturdy'
);

select tests.authenticate_as(:'admin'::uuid, :'org'::uuid, 'admin');
select lives_ok(
  format(
    $$ insert into storage.objects (bucket_id, name) values ('org-branding', %L) $$,
    :'org' || '/logo-light-abc.png'
  ),
  'an admin can upload under their org prefix'
);

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
select lives_ok(
  format(
    $$ insert into storage.objects (bucket_id, name) values ('org-branding', %L) $$,
    :'org' || '/logo-dark-abc.png'
  ),
  'an owner can upload under their org prefix'
);

select tests.authenticate_anon();
select is(
  (select count(*)::int from storage.objects where bucket_id = 'org-branding' and name = :'org' || '/logo-light-abc.png'),
  0,
  'anonymous clients cannot list org branding objects'
);
select throws_ok(
  format(
    $$ insert into storage.objects (bucket_id, name) values ('org-branding', %L) $$,
    :'org' || '/anon.png'
  ),
  '42501',
  null,
  'anonymous clients cannot upload branding'
);

select tests.authenticate_as(:'admin'::uuid, :'org'::uuid, 'admin');
select lives_ok(
  format(
    $$ update storage.objects set metadata = '{"v":1}'::jsonb where bucket_id = 'org-branding' and name = %L $$,
    :'org' || '/logo-light-abc.png'
  ),
  'an admin can update branding under their org prefix'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('org-branding', 'logo.png') $$,
  '42501',
  null,
  'a root branding path is denied'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('org-branding', 'not-a-uuid/logo.png') $$,
  '42501',
  null,
  'a non-uuid branding prefix is denied'
);
select tests.authenticate_as(:'sales'::uuid, :'org'::uuid, 'sales');
update storage.objects
set metadata = '{"v":2}'::jsonb
where bucket_id = 'org-branding' and name = :'org' || '/logo-light-abc.png';
select tests.clear_auth();
select is(
  (select metadata->>'v' from storage.objects where bucket_id = 'org-branding' and name = :'org' || '/logo-light-abc.png'),
  '1',
  'a member cannot update branding'
);

select tests.authenticate_as(:'sales'::uuid, :'org'::uuid, 'sales');
select throws_ok(
  format(
    $$ insert into storage.objects (bucket_id, name) values ('org-branding', %L) $$,
    :'org' || '/logo-member.png'
  ),
  '42501',
  null,
  'a member cannot upload branding'
);
delete from storage.objects
where bucket_id = 'org-branding' and name = :'org' || '/logo-light-abc.png';
select tests.clear_auth();
select is(
  (select count(*)::int from storage.objects where bucket_id = 'org-branding' and name = :'org' || '/logo-light-abc.png'),
  1,
  'a member cannot delete branding'
);

select tests.authenticate_as(:'other'::uuid, :'org2'::uuid, 'owner');
select throws_ok(
  format(
    $$ insert into storage.objects (bucket_id, name) values ('org-branding', %L) $$,
    :'org' || '/logo-stolen.png'
  ),
  '42501',
  null,
  'another org cannot write into this org prefix'
);
select lives_ok(
  format(
    $$ insert into storage.objects (bucket_id, name) values ('org-branding', %L) $$,
    :'org2' || '/logo-light-own.png'
  ),
  'an owner can upload under their own prefix'
);

select tests.authenticate_as(:'admin'::uuid, :'org'::uuid, 'admin');
select lives_ok(
  format(
    $$ delete from storage.objects where bucket_id = 'org-branding' and name = %L $$,
    :'org' || '/logo-light-abc.png'
  ),
  'an admin can delete branding under their org prefix'
);
select tests.clear_auth();
select is(
  (select count(*)::int from storage.objects where bucket_id = 'org-branding' and name = :'org' || '/logo-light-abc.png'),
  0,
  'an admin delete removes the branding object'
);

select tests.authenticate_as(:'owner'::uuid, :'org'::uuid, 'owner');
insert into public.accounts (org_id, name) values (:'org'::uuid, 'Pat') returning id as acct \gset
select public.quote_create(:'acct'::uuid, null, 'Spring mow') as qid \gset
select public.quote_current_version(:'qid'::uuid) as vid \gset
select tests.clear_auth();
select private.sha256_hex(private.quote_document_body(:'vid'::uuid)::text) as dochash \gset
update public.orgs set
  brand_color = '#C62828',
  logo_path = :'org' || '/logo-light-abc.png',
  logo_dark_path = :'org' || '/logo-dark-abc.png',
  logo_raster_path = :'org' || '/logo-raster-abc.png',
  logo_width = 480,
  logo_height = 160,
  logo_shows_name = true,
  logo_needs_chip = true,
  heading_font = 'sturdy',
  website = 'https://branded.example',
  address_line1 = '1 Main St',
  city = 'Austin',
  region = 'TX',
  postal_code = '78702'
where id = :'org'::uuid;
select is(
  private.sha256_hex(private.quote_document_body(:'vid'::uuid)::text),
  :'dochash',
  'branding changes do not change the quote document body'
);
update public.quotes set status = 'sent' where id = :'qid'::uuid;
select public_token as tok from public.quotes where id = :'qid'::uuid \gset

select tests.authenticate_anon();
select is(public.quote_public(:'tok'::uuid) #>> '{org,logo_url}', :'org' || '/logo-light-abc.png', 'quote_public returns the logo path');
select is(public.quote_public(:'tok'::uuid) #>> '{org,logo_dark_url}', :'org' || '/logo-dark-abc.png', 'quote_public returns the dark logo');
select is(public.quote_public(:'tok'::uuid) #>> '{org,logo_raster_url}', :'org' || '/logo-raster-abc.png', 'quote_public returns the PDF raster');
select is((public.quote_public(:'tok'::uuid) #>> '{org,logo_width}')::int, 480, 'quote_public returns logo width');
select is(public.quote_public(:'tok'::uuid) #>> '{org,logo_shows_name}', 'true', 'quote_public returns logo_shows_name');
select is(public.quote_public(:'tok'::uuid) #>> '{org,logo_needs_chip}', 'true', 'quote_public returns logo_needs_chip');
select is(public.quote_public(:'tok'::uuid) #>> '{org,heading_font}', 'sturdy', 'quote_public returns heading_font');
select is(public.quote_public(:'tok'::uuid) #>> '{org,website}', 'https://branded.example', 'quote_public returns the website');
select is(public.quote_public(:'tok'::uuid) #>> '{org,address_line1}', '1 Main St', 'quote_public returns the address');
select is(public.quote_public(:'tok'::uuid) #>> '{org,brand_color}', '#C62828', 'quote_public still returns brand_color');
select is(
  (
    select count(*)::int
    from jsonb_object_keys(public.quote_public(:'tok'::uuid) -> 'org') as k(key)
    where k.key not in (
      'name', 'phone', 'email', 'website', 'brand_color',
      'logo_url', 'logo_dark_url', 'logo_raster_url',
      'logo_width', 'logo_height', 'logo_shows_name', 'logo_needs_chip', 'heading_font',
      'address_line1', 'address_line2', 'city', 'region', 'postal_code', 'country'
    )
  ),
  0,
  'quote_public returns no unexpected org keys'
);

select tests.clear_auth();
select throws_ok(
  format($$ update public.orgs set logo_path = 'https://evil.test/a.png' where id = %L::uuid $$, :'org'),
  '23514',
  null,
  'logo_path rejects an absolute URL'
);
select throws_ok(
  format($$ update public.orgs set logo_dark_path = 'logo.png' where id = %L::uuid $$, :'org'),
  '23514',
  null,
  'logo_dark_path rejects a root path'
);
select throws_ok(
  format($$ update public.orgs set logo_raster_path = 'not-a-uuid/logo.png' where id = %L::uuid $$, :'org'),
  '23514',
  null,
  'logo_raster_path rejects a non-uuid prefix'
);
select throws_ok(
  format(
    $$ update public.orgs set logo_path = %L where id = %L::uuid $$,
    '00000000-0000-4000-8000-000000000099/logo.png',
    :'org'
  ),
  '23514',
  null,
  'logo_path must start with this org id'
);
select lives_ok(
  format(
    $$ update public.orgs set logo_path = null, logo_dark_path = null, logo_raster_path = null where id = %L::uuid $$,
    :'org'
  ),
  'logo paths may be null'
);

select * from finish();
