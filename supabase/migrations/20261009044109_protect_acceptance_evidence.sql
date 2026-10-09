-- Accepted quotes are signed evidence. Block deleting them, and stop a quote
-- delete from cascading into acceptances or quote audit events.
--
-- Draft and sent quotes have no acceptance, so they can still be deleted.
-- A sent quote's operational audit rows are not a signature. This trigger
-- removes those rows itself. ON DELETE NO ACTION is what keeps a cascade
-- from doing it, including for an accepted quote if this guard is skipped.

create or replace function private.quotes_block_accepted_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'accepted' then
    raise exception 'accepted quotes cannot be deleted' using errcode = '55000';
  end if;

  -- Authenticated admins have no DELETE grant on audit_events, and that table
  -- forces row level security. Running as the function owner removes only the
  -- operational rows for a quote that was never accepted.
  delete from public.audit_events where quote_id = old.id;
  return old;
end;
$$;

revoke all on function private.quotes_block_accepted_delete() from public;

create trigger quotes_block_accepted_delete
  before delete on public.quotes
  for each row execute function private.quotes_block_accepted_delete();

alter table public.acceptances
  drop constraint acceptances_quote_id_fkey;

alter table public.acceptances
  add constraint acceptances_quote_id_fkey
  foreign key (quote_id) references public.quotes (id) on delete no action;

alter table public.audit_events
  drop constraint audit_events_quote_id_fkey;

alter table public.audit_events
  add constraint audit_events_quote_id_fkey
  foreign key (quote_id) references public.quotes (id) on delete no action;
