-- Hosted Supabase owns storage.objects as supabase_storage_admin. The CI
-- image will not let us SET ROLE to that reserved role, so when we still own
-- the table we hand it to storage_table_owner and then drop that membership.
-- ALTER TABLE then fails with "must be owner". Policy DDL stays allowed for a
-- superuser, or for postgres via supautils.policy_grants.
--
-- A superuser can still alter any table, so the event trigger below rejects
-- ALTER TABLE on these relations for that session too.

create schema if not exists test_harness;

do $$
declare
  objects_owner text;
  buckets_owner text;
  super boolean;
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    return;
  end if;
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'storage' and c.relname = 'objects') then
    return;
  end if;

  select rolsuper into super from pg_roles where rolname = current_user;

  select pg_get_userbyid(c.relowner)::text into objects_owner
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'storage' and c.relname = 'objects';

  select pg_get_userbyid(c.relowner)::text into buckets_owner
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'storage' and c.relname = 'buckets';

  if objects_owner = current_user then
    execute 'alter table storage.objects enable row level security';
    execute 'alter table storage.objects force row level security';
  end if;
  if buckets_owner = current_user then
    execute 'alter table storage.buckets enable row level security';
    execute 'alter table storage.buckets force row level security';
  end if;

  -- Keep the privileges the migration needs before we give up ownership.
  -- Skip tables we do not own; the image already granted those.
  if objects_owner = current_user or buckets_owner = current_user then
    execute 'grant usage on schema storage to postgres';
  end if;
  if objects_owner = current_user then
    execute 'grant all on storage.objects to postgres';
  end if;
  if buckets_owner = current_user then
    execute 'grant all on storage.buckets to postgres';
  end if;

  if objects_owner is distinct from current_user and buckets_owner is distinct from current_user then
    return;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'storage_table_owner') then
    create role storage_table_owner nologin noinherit;
  end if;
  -- The new owner must be allowed to create objects in the schema, or
  -- ALTER OWNER is rejected with permission denied for schema storage.
  grant usage, create on schema storage to storage_table_owner;

  if not super then
    grant storage_table_owner to current_user with inherit false, set true;
  end if;

  if objects_owner = current_user then
    alter table storage.objects owner to storage_table_owner;
  end if;
  if buckets_owner = current_user then
    alter table storage.buckets owner to storage_table_owner;
  end if;

  if not super then
    revoke storage_table_owner from current_user;
  end if;
end
$$;

create or replace function test_harness.forbid_managed_storage_alter()
returns event_trigger
language plpgsql
as $$
declare
  cmd record;
begin
  for cmd in
    select object_identity
    from pg_event_trigger_ddl_commands()
    where command_tag = 'ALTER TABLE'
  loop
    if replace(cmd.object_identity, '"', '') in ('storage.objects', 'storage.buckets') then
      raise exception 'must be owner of table %', split_part(replace(cmd.object_identity, '"', ''), '.', 2)
        using errcode = '42501';
    end if;
  end loop;
end;
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = current_user and rolsuper) then
    drop event trigger if exists forbid_managed_storage_alter;
    create event trigger forbid_managed_storage_alter
      on ddl_command_end
      when tag in ('ALTER TABLE')
      execute function test_harness.forbid_managed_storage_alter();
  end if;
end
$$;
