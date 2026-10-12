-- Irrigation zone notes from the crew phone.
-- Office can read. The crew on the stop can write. No updates.

create table if not exists public.irrigation_zone_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  visit_id uuid not null references public.visits(id) on delete cascade,
  zone_number integer not null,
  note text not null,
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint irrigation_zone_notes_zone_range check (zone_number between 1 and 64),
  constraint irrigation_zone_notes_note_len check (length(btrim(note)) between 1 and 500)
);

create index if not exists irrigation_zone_notes_org_id_idx on public.irrigation_zone_notes (org_id);
create index if not exists irrigation_zone_notes_visit_id_idx on public.irrigation_zone_notes (visit_id);

alter table public.irrigation_zone_notes enable row level security;
alter table public.irrigation_zone_notes force row level security;

drop policy if exists irrigation_zone_notes_select on public.irrigation_zone_notes;
create policy irrigation_zone_notes_select on public.irrigation_zone_notes
  for select to authenticated
  using (
    (select private.can_read_office_records(org_id))
    or private.crew_can_read_visit(org_id, visit_id)
  );

drop policy if exists irrigation_zone_notes_insert on public.irrigation_zone_notes;
create policy irrigation_zone_notes_insert on public.irrigation_zone_notes
  for insert to authenticated
  with check (
    org_id = (select private.current_org_id())
    and (
      (select private.can_dispatch(org_id))
      or private.crew_can_read_visit(org_id, visit_id)
    )
  );

revoke all on table public.irrigation_zone_notes from public, anon, authenticated;
grant select, insert on table public.irrigation_zone_notes to authenticated;
grant all on table public.irrigation_zone_notes to service_role;
