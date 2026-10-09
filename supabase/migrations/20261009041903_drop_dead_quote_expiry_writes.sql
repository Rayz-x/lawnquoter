-- The expiry writes in quote_accept and quote_decline ran immediately before
-- raise. That exception aborts the function's transaction, so the status
-- change never persisted. Opening the proposal (quote_public) still records
-- expiry. These replacements keep the rejection and drop the dead writes.

create or replace function public.quote_accept(
  p_token uuid,
  p_signer_name text,
  p_signer_email text default null,
  p_disclosure boolean default false,
  p_user_agent text default null,
  p_ip text default null,
  p_selected uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
  v public.quote_versions;
  v_offer_hash text;
  v_hash text;
  v_event_hash text;
  v_ip inet;
  v_ids jsonb;
  v_total numeric;
begin
  if coalesce(p_disclosure, false) is not true then
    raise exception 'ESIGN disclosure must be accepted' using errcode = '22023';
  end if;
  if p_signer_name is null or length(trim(p_signer_name)) < 2 then
    raise exception 'signer name required' using errcode = '22023';
  end if;

  begin
    if p_ip is not null and btrim(p_ip) <> '' then
      v_ip := btrim(p_ip)::inet;
    end if;
  exception
    when invalid_text_representation then
      v_ip := null;
  end;

  select * into q from public.quotes where public_token = p_token for update;
  if not found or q.status in ('draft', 'changed', 'declined') then
    raise exception 'quote not available' using errcode = 'P0002';
  end if;
  if q.expires_at is not null and q.expires_at < current_date and q.status <> 'accepted' then
    raise exception 'quote not available' using errcode = 'P0002';
  end if;
  if q.status = 'expired' then
    raise exception 'quote not available' using errcode = 'P0002';
  end if;
  if q.status = 'accepted' then
    select document_hash into v_hash from public.acceptances where quote_id = q.id;
    return jsonb_build_object('already', true, 'quote_id', q.id, 'document_hash', v_hash);
  end if;

  select * into v
  from public.quote_versions
  where quote_id = q.id and version = q.current_version
  for update;

  v_offer_hash := private.freeze_quote_version(v.id);

  select coalesce(jsonb_agg(item_id order by item_id), '[]'::jsonb), coalesce(sum(price), 0)
    into v_ids, v_total
  from private.resolve_quote_selection(v.id, p_selected);

  v_hash := private.sha256_hex(v_offer_hash || ':' || v_ids::text);

  insert into public.acceptances (
    org_id, quote_id, version, method, signer_name, signer_email,
    document_hash, disclosure_accepted, ip, user_agent, selections, accepted_total
  ) values (
    q.org_id, q.id, q.current_version, 'click', trim(p_signer_name), nullif(btrim(coalesce(p_signer_email, '')), ''),
    v_hash, true, v_ip, p_user_agent, v_ids, v_total
  );

  v_event_hash := private.append_quote_audit(
    q.org_id,
    q.id,
    'quote.accepted',
    jsonb_build_object(
      'signer', trim(p_signer_name),
      'email', nullif(btrim(coalesce(p_signer_email, '')), ''),
      'version', q.current_version,
      'document_hash', v_hash,
      'selections', v_ids,
      'accepted_total', v_total,
      'ip', v_ip::text
    )
  );

  update public.quotes set status = 'accepted' where id = q.id;

  return jsonb_build_object(
    'ok', true,
    'document_hash', v_hash,
    'event_hash', v_event_hash,
    'accepted_total', v_total
  );
exception
  when unique_violation then
    select document_hash into v_hash from public.acceptances where quote_id = q.id;
    return jsonb_build_object('already', true, 'quote_id', q.id, 'document_hash', v_hash);
end;
$$;

grant execute on function public.quote_accept(uuid, text, text, boolean, text, text, uuid[]) to anon, authenticated;

create or replace function public.quote_decline(p_token uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
begin
  select * into q from public.quotes where public_token = p_token for update;
  if not found or q.status in ('draft', 'changed', 'accepted') then
    raise exception 'quote not available' using errcode = 'P0002';
  end if;
  if q.expires_at is not null and q.expires_at < current_date and q.status <> 'declined' then
    raise exception 'quote not available' using errcode = 'P0002';
  end if;
  if q.status = 'expired' then
    raise exception 'quote not available' using errcode = 'P0002';
  end if;
  if q.status = 'declined' then
    return;
  end if;

  update public.quotes set status = 'declined' where id = q.id;
  perform private.append_quote_audit(
    q.org_id,
    q.id,
    'quote.declined',
    jsonb_build_object('reason', nullif(btrim(coalesce(p_reason, '')), ''))
  );
end;
$$;
