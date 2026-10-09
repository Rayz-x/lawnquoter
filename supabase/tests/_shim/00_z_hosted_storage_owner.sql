-- Match hosted Supabase: storage.objects and storage.buckets are owned by
-- supabase_storage_admin, and row level security is already enabled. The
-- migration role must not ALTER those tables. Creating policies is separate
-- (supautils.policy_grants on the hosted image; superuser locally).
--
-- An event trigger also rejects ALTER TABLE on those relations, including for
-- a superuser, so a vanilla Postgres run still fails the hosted "must be
-- owner" bug.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'supabase_storage_admin') then
    create role supabase_storage_admin nologin noinherit;
  end if;
end
$$;

-- The table owner runs foreign-key checks. After ownership moves off postgres,
-- that role still needs to see the storage schema.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    grant usage on schema storage to supabase_storage_admin;
  end if;
end
$$;

do $$
declare
  objects_owner text;
  buckets_owner text;
begin
  select pg_get_userbyid(c.relowner)::text into objects_owner
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'storage' and c.relname = 'objects';

  select pg_get_userbyid(c.relowner)::text into buckets_owner
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'storage' and c.relname = 'buckets';

  if objects_owner is null or buckets_owner is null then
    return;
  end if;

  if objects_owner = current_user then
    execute 'alter table storage.objects enable row level security';
    execute 'alter table storage.objects force row level security';
    execute 'alter table storage.objects owner to supabase_storage_admin';
  end if;
  if buckets_owner = current_user then
    execute 'alter table storage.buckets enable row level security';
    execute 'alter table storage.buckets force row level security';
    execute 'alter table storage.buckets owner to supabase_storage_admin';
  end if;

  execute 'grant usage on schema storage to postgres';
  execute 'grant all on storage.buckets, storage.objects to postgres';
end
$$;

create schema if not exists test_harness;

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

drop event trigger if exists forbid_managed_storage_alter;
create event trigger forbid_managed_storage_alter
  on ddl_command_end
  when tag in ('ALTER TABLE')
  execute function test_harness.forbid_managed_storage_alter();
