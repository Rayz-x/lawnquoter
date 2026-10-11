-- S19: set quote expires_at on send (org settings.quote_expiry_days, default 30).
-- Accept stays blocked when expires_at < current_date (existing quote_accept checks).
-- Expired / past-due drafts no longer require a manual extend; send refreshes the window.

create or replace function public.quote_send(p_quote uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
  v public.quote_versions;
  v_was_frozen boolean;
  v_days integer;
  v_expires date;
begin
  select * into q from public.quotes where id = p_quote for update;
  if not found then
    raise exception 'quote not found' using errcode = 'P0002';
  end if;
  if auth.uid() is null or not private.can_edit_customers(q.org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if q.status = 'accepted' then
    raise exception 'accepted quotes are final' using errcode = '55000';
  end if;
  if q.status = 'declined' then
    raise exception 'revise a declined quote before sending it again' using errcode = '55000';
  end if;
  if q.status = 'expired' then
    raise exception 'revise an expired quote before sending it again' using errcode = '55000';
  end if;

  select *
  into v
  from public.quote_versions
  where quote_id = q.id and version = q.current_version
  for update;
  v_was_frozen := v.frozen;

  -- expires_at is locked once the current version is frozen, so set it first.
  select case
    when (o.settings ->> 'quote_expiry_days') ~ '^\d+$'
         and (o.settings ->> 'quote_expiry_days')::integer in (14, 30, 60, 90)
      then (o.settings ->> 'quote_expiry_days')::integer
    else 30
  end
  into v_days
  from public.orgs o
  where o.id = q.org_id;

  v_expires := (current_date + v_days)::date;

  if q.status in ('draft', 'changed') then
    update public.quotes
    set expires_at = v_expires
    where id = q.id;
  end if;

  perform private.freeze_quote_version(v.id);
  if not v_was_frozen then
    perform private.append_quote_audit(
      q.org_id,
      q.id,
      'quote.sent',
      jsonb_build_object('version', q.current_version)
    );
  end if;

  if q.status in ('draft', 'changed') then
    update public.quotes
    set status = 'sent', sent_at = coalesce(sent_at, now())
    where id = q.id;
  end if;

  return q.public_token;
end;
$$;

revoke all on function public.quote_send(uuid) from public;
grant execute on function public.quote_send(uuid) to authenticated;
