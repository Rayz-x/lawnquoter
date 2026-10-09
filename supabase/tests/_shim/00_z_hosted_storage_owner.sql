-- Hosted Supabase rejects ALTER TABLE on storage.objects with "must be owner".
-- This shim does not change storage ownership and does not grant reserved roles.
-- A superuser session gets that error from the event trigger below. A role that
-- does not own the table gets the same error from Postgres itself.

create schema if not exists test_harness;

-- authenticated does not own storage.objects. The test session can already
-- become that role, so this does not grant a role or change table ownership.
create or replace function test_harness.alter_storage_objects_as_non_owner()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'authenticated', true);
  execute 'alter table storage.objects enable row level security';
end;
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
