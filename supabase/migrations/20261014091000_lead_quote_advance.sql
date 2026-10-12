-- Sending or accepting a quote moves the linked lead.
-- Rules match advanceLeadStage: sent/viewed → quoted, accepted → won.
-- Lost, spam, and won leads stay put. A declined quote does not mark the lead lost.

create or replace function private.advance_lead_on_quote_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'UPDATE' or new.status is not distinct from old.status then
    return new;
  end if;

  if new.status in ('sent'::public.quote_status, 'viewed'::public.quote_status) then
    update public.lead_requests
    set status = 'quoted'::public.lead_request_status
    where quote_id = new.id
      and org_id = new.org_id
      and status in (
        'new'::public.lead_request_status,
        'contacted'::public.lead_request_status
      );
  elsif new.status = 'accepted'::public.quote_status then
    update public.lead_requests
    set status = 'won'::public.lead_request_status
    where quote_id = new.id
      and org_id = new.org_id
      and status in (
        'new'::public.lead_request_status,
        'contacted'::public.lead_request_status,
        'quoted'::public.lead_request_status
      );
  end if;

  return new;
end;
$$;

revoke all on function private.advance_lead_on_quote_status() from public, anon, authenticated;

drop trigger if exists quotes_advance_lead on public.quotes;
create trigger quotes_advance_lead
  after update of status on public.quotes
  for each row execute function private.advance_lead_on_quote_status();
