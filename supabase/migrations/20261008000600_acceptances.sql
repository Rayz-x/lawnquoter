-- ESIGN click-to-accept, hash-chained audit events, and payment intents.

create type public.acceptance_method as enum ('click', 'signwell', 'wet');
create type public.payment_kind as enum ('deposit', 'balance', 'invoice', 'ach_verify');
create type public.payment_status as enum ('requires_action', 'processing', 'succeeded', 'failed', 'canceled', 'refunded');

create table public.acceptances (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  version integer not null,
  method public.acceptance_method not null default 'click',
  signer_name text not null,
  signer_email text,
  document_hash text not null,
  disclosure_accepted boolean not null default true,
  ip inet,
  user_agent text,
  signwell_envelope_id text,
  accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index acceptances_quote_idx on public.acceptances (quote_id, accepted_at desc);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  quote_id uuid references public.quotes(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  prev_hash text,
  hash text not null,
  occurred_at timestamptz not null default now()
);

create index audit_events_quote_idx on public.audit_events (quote_id, occurred_at);

create table public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  quote_id uuid references public.quotes(id) on delete set null,
  account_id uuid references public.accounts(id) on delete set null,
  kind public.payment_kind not null default 'deposit',
  status public.payment_status not null default 'requires_action',
  amount numeric not null check (amount >= 0),
  currency text not null default 'usd',
  stripe_payment_intent_id text,
  stripe_customer_id text,
  receipt_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger payment_intents_set_updated_at
  before update on public.payment_intents
  for each row execute function private.set_updated_at();

create or replace function private.sha256_hex(p text)
returns text
language sql
immutable
set search_path to extensions, public, pg_catalog
as $$
  select encode(digest(convert_to(p, 'UTF8'), 'sha256'::text), 'hex');
$$;

-- Public accept: token + signer identity + ESIGN disclosure. Hash-chains the event.
create or replace function public.quote_accept(
  p_token uuid,
  p_signer_name text,
  p_signer_email text default null,
  p_disclosure boolean default false,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
  v_hash text;
  v_prev text;
  v_event_hash text;
  v_ip inet;
begin
  if coalesce(p_disclosure, false) is not true then
    raise exception 'ESIGN disclosure must be accepted' using errcode = '22023';
  end if;
  if p_signer_name is null or length(trim(p_signer_name)) < 2 then
    raise exception 'signer name required' using errcode = '22023';
  end if;

  select * into q from public.quotes where public_token = p_token;
  if not found or q.status in ('draft', 'declined', 'expired') then
    raise exception 'quote not available' using errcode = 'P0002';
  end if;
  if q.status = 'accepted' then
    return jsonb_build_object('already', true, 'quote_id', q.id);
  end if;

  v_hash := private.sha256_hex(
    q.id::text || ':' || q.current_version::text || ':' || q.title || ':' || q.updated_at::text
  );

  insert into public.acceptances (
    org_id, quote_id, version, method, signer_name, signer_email,
    document_hash, disclosure_accepted, user_agent
  ) values (
    q.org_id, q.id, q.current_version, 'click', trim(p_signer_name), nullif(p_signer_email, ''),
    v_hash, true, p_user_agent
  );

  select hash into v_prev from public.audit_events where quote_id = q.id order by occurred_at desc limit 1;
  v_event_hash := private.sha256_hex(coalesce(v_prev, '') || v_hash || trim(p_signer_name) || now()::text);

  insert into public.audit_events (org_id, quote_id, kind, payload, prev_hash, hash)
  values (
    q.org_id, q.id, 'quote.accepted',
    jsonb_build_object('signer', trim(p_signer_name), 'email', p_signer_email, 'version', q.current_version, 'document_hash', v_hash),
    v_prev, v_event_hash
  );

  update public.quotes set status = 'accepted', updated_at = now() where id = q.id;

  return jsonb_build_object('ok', true, 'document_hash', v_hash, 'event_hash', v_event_hash);
end;
$$;
grant execute on function public.quote_accept(uuid, text, text, boolean, text) to anon, authenticated;

create or replace function public.quote_decline(p_token uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
begin
  select * into q from public.quotes where public_token = p_token;
  if not found or q.status in ('draft', 'accepted', 'expired') then
    raise exception 'quote not available' using errcode = 'P0002';
  end if;
  update public.quotes set status = 'declined' where id = q.id;
  insert into public.audit_events (org_id, quote_id, kind, payload, hash)
  values (q.org_id, q.id, 'quote.declined', jsonb_build_object('reason', p_reason), private.sha256_hex(q.id::text || coalesce(p_reason, '')));
end;
$$;
grant execute on function public.quote_decline(uuid, text) to anon, authenticated;

alter table public.acceptances enable row level security;
alter table public.acceptances force row level security;
alter table public.audit_events enable row level security;
alter table public.audit_events force row level security;
alter table public.payment_intents enable row level security;
alter table public.payment_intents force row level security;

create policy acceptances_select on public.acceptances for select to authenticated
  using ((select private.is_org_member(org_id)));
create policy audit_events_select on public.audit_events for select to authenticated
  using ((select private.is_org_member(org_id)));
create policy payment_intents_select on public.payment_intents for select to authenticated
  using ((select private.is_org_member(org_id)));
create policy payment_intents_write on public.payment_intents for all to authenticated
  using ((select private.can_edit_customers(org_id)))
  with check ((select private.can_edit_customers(org_id)));

grant select on public.acceptances, public.audit_events to authenticated;
grant select, insert, update on public.payment_intents to authenticated;
grant all on public.acceptances, public.audit_events, public.payment_intents to service_role;
