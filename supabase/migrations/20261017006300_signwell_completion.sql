-- A completed SignWell document accepts the commercial quote.
-- The webhook calls this as service_role. The office cannot.
-- The document id column also lands in a later migration; create it here so this file still applies.

alter table public.quotes
  add column if not exists signwell_document_id text;

create unique index if not exists quotes_signwell_document_id_key
  on public.quotes (signwell_document_id)
  where signwell_document_id is not null;

create or replace function public.record_signwell_completion(
  p_document_id text,
  p_signer_name text,
  p_signer_email text
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
  v_ids jsonb;
  v_total numeric;
  v_nte numeric;
  v_has_ranges boolean;
  v_clause text;
  v_email text;
  v_disclosure text;
  v_accepted_at timestamptz;
begin
  if p_document_id is null or length(btrim(p_document_id)) = 0 then
    raise exception 'quote not available' using errcode = 'P0002';
  end if;
  if p_signer_name is null or length(btrim(p_signer_name)) < 2 then
    raise exception 'signer name required' using errcode = '22023';
  end if;
  v_email := nullif(btrim(coalesce(p_signer_email, '')), '');
  if v_email is null
     or length(v_email) > 320
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'signer email required' using errcode = '22023';
  end if;

  select * into q
  from public.quotes
  where signwell_document_id = btrim(p_document_id)
  for update;
  if not found then
    raise exception 'quote not available' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.accounts a
    where a.id = q.account_id and a.type = 'commercial'::public.account_type
  ) then
    raise exception 'SignWell is for commercial contracts' using errcode = '22023';
  end if;
  if q.status in ('draft', 'changed', 'declined') then
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

  select
    coalesce(jsonb_agg(s.item_id order by s.item_id), '[]'::jsonb),
    coalesce(sum(s.price), 0),
    coalesce(sum(
      case
        when i.range_low is not null and i.range_high is not null then i.range_high
        else s.price
      end
    ), 0),
    coalesce(bool_or(i.range_low is not null and i.range_high is not null), false)
  into v_ids, v_total, v_nte, v_has_ranges
  from private.resolve_quote_selection(v.id, null) s
  join public.quote_line_items i on i.id = s.item_id;

  v_clause := case when v_has_ranges then private.not_to_exceed_clause(v_nte) else null end;
  v_disclosure := private.esign_disclosure_version();
  v_hash := private.acceptance_document_hash(
    v_offer_hash, v_ids, v_nte, v_has_ranges, v_clause, v_disclosure
  );
  v_accepted_at := now();

  insert into public.acceptances (
    org_id, quote_id, version, method, signer_name, signer_email,
    document_hash, disclosure_accepted, disclosure_version, selections,
    accepted_total, accepted_not_to_exceed, has_ranges, not_to_exceed_clause,
    accepted_at, signwell_envelope_id
  ) values (
    q.org_id, q.id, q.current_version, 'signwell', btrim(p_signer_name), v_email,
    v_hash, true, v_disclosure, v_ids,
    v_total, v_nte, v_has_ranges, v_clause,
    v_accepted_at, btrim(p_document_id)
  );

  v_event_hash := private.append_quote_audit(
    q.org_id,
    q.id,
    'quote.accepted',
    jsonb_build_object(
      'method', 'signwell',
      'signer', btrim(p_signer_name),
      'email', v_email,
      'version', q.current_version,
      'document_hash', v_hash,
      'signwell_envelope_id', btrim(p_document_id),
      'selections', v_ids,
      'accepted_total', v_total,
      'accepted_not_to_exceed', v_nte,
      'has_ranges', v_has_ranges,
      'not_to_exceed_clause', v_clause,
      'disclosure_version', v_disclosure
    )
  );

  perform private.site_check_ensure_on_acceptance(q.org_id, q.id, q.property_id, v_ids);

  update public.quotes set status = 'accepted' where id = q.id;

  return jsonb_build_object(
    'ok', true,
    'quote_id', q.id,
    'document_hash', v_hash,
    'event_hash', v_event_hash,
    'signwell_envelope_id', btrim(p_document_id)
  );
exception
  when unique_violation then
    select document_hash into v_hash from public.acceptances where quote_id = q.id;
    return jsonb_build_object('already', true, 'quote_id', q.id, 'document_hash', v_hash);
end;
$$;

revoke all on function public.record_signwell_completion(text, text, text) from public, anon, authenticated;
grant execute on function public.record_signwell_completion(text, text, text) to service_role;
