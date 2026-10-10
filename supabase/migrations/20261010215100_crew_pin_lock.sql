-- S10: crew idle PIN (one phone per truck). Hash is never selectable by clients;
-- set/verify go through SECURITY DEFINER RPCs. Offline unlock caches the same
-- sha256(user_id:pin) digest in localStorage after a successful set.
-- Dusty must OK applying this migration to hosted Supabase.

create table public.crew_pins (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  pin_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger crew_pins_set_updated_at
  before update on public.crew_pins
  for each row execute function private.set_updated_at();

alter table public.crew_pins enable row level security;
alter table public.crew_pins force row level security;

-- No policies: FORCE RLS hides every row from authenticated clients.
-- Hashes are only readable through verify_crew_pin / crew_pin_is_set.
revoke all on table public.crew_pins from public, anon, authenticated;
grant select on table public.crew_pins to authenticated;
grant all on table public.crew_pins to service_role;

create or replace function public.set_crew_pin(p_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_pin text := btrim(coalesce(p_pin, ''));
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if v_pin !~ '^\d{4,6}$' then
    raise exception 'PIN must be 4 to 6 digits' using errcode = '22023';
  end if;
  insert into public.crew_pins (user_id, pin_hash)
  values (v_uid, private.sha256_hex(v_uid::text || ':' || v_pin))
  on conflict (user_id) do update
    set pin_hash = excluded.pin_hash,
        updated_at = pg_catalog.now();
end;
$$;

create or replace function public.verify_crew_pin(p_pin text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_pin text := btrim(coalesce(p_pin, ''));
  v_hash text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if v_pin !~ '^\d{4,6}$' then
    return false;
  end if;
  select pin_hash into v_hash from public.crew_pins where user_id = v_uid;
  if v_hash is null then
    return false;
  end if;
  return v_hash = private.sha256_hex(v_uid::text || ':' || v_pin);
end;
$$;

create or replace function public.crew_pin_is_set()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.crew_pins where user_id = auth.uid()
  );
$$;

revoke all on function public.set_crew_pin(text) from public, anon;
revoke all on function public.verify_crew_pin(text) from public, anon;
revoke all on function public.crew_pin_is_set() from public, anon;
grant execute on function public.set_crew_pin(text) to authenticated, service_role;
grant execute on function public.verify_crew_pin(text) to authenticated, service_role;
grant execute on function public.crew_pin_is_set() to authenticated, service_role;
