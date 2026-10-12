-- public.create_org marks a brand-new company as mid-setup.
-- tests.create_org stays a fixture helper and does not set the step.

select plan(2);

select tests.create_user('founder@example.com', 'Founder') as founder \gset
select tests.authenticate_as(:'founder'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'owner');
select public.create_org('Fresh Lawn', 'fresh-lawn', 'America/Chicago') as new_org \gset
select tests.clear_auth();

select is(
  (select settings ->> 'onboarding_step' from public.orgs where id = :'new_org'::uuid),
  'branding',
  'a new company resumes at branding'
);

select is(
  (select role::text from public.memberships where org_id = :'new_org'::uuid and user_id = :'founder'::uuid),
  'owner',
  'the founder is the owner'
);
