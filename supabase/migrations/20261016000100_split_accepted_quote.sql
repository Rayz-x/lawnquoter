-- Split an accepted quote into multiple unscheduled jobs.
-- Each accepted line can land on at most one job.

create table if not exists public.job_quote_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  quote_line_item_id uuid not null references public.quote_line_items(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (quote_line_item_id)
);

create index if not exists job_quote_lines_org_job_idx on public.job_quote_lines (org_id, job_id);

create or replace function private.job_quote_lines_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_quote uuid;
  v_org uuid;
begin
  select * into v_job from public.jobs where id = new.job_id;
  if not found or v_job.org_id is distinct from new.org_id then
    raise exception 'job must belong to the same org' using errcode = '23503';
  end if;
  select v.quote_id, li.org_id into v_quote, v_org
  from public.quote_line_items li
  join public.quote_versions v on v.id = li.version_id
  where li.id = new.quote_line_item_id;
  if v_org is distinct from new.org_id then
    raise exception 'line must belong to the same org' using errcode = '23503';
  end if;
  if v_job.quote_id is distinct from v_quote then
    raise exception 'line must belong to the job quote' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists job_quote_lines_check on public.job_quote_lines;
create trigger job_quote_lines_check
  before insert or update on public.job_quote_lines
  for each row execute function private.job_quote_lines_check();

create or replace function public.split_accepted_quote(p_quote uuid, p_groups jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
  v_version_id uuid;
  g jsonb;
  v_title text;
  v_line uuid;
  v_job uuid;
  v_seen uuid[] := '{}';
  v_jobs uuid[] := '{}';
  v_element jsonb;
begin
  select * into q from public.quotes where id = p_quote for update;
  if not found or q.org_id is distinct from private.current_org_id() then
    raise exception 'quote not found' using errcode = 'P0002';
  end if;
  if not private.can_write_job_records(q.org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if q.status is distinct from 'accepted' then
    raise exception 'only an accepted quote can be split' using errcode = '22023';
  end if;
  if q.property_id is null then
    raise exception 'quote needs a property' using errcode = '22023';
  end if;
  if exists (select 1 from public.jobs j where j.quote_id = q.id and j.org_id = q.org_id)
     or exists (select 1 from public.agreements a where a.quote_id = q.id and a.org_id = q.org_id) then
    raise exception 'quote is already a job' using errcode = '22023';
  end if;
  if jsonb_typeof(p_groups) is distinct from 'array' or jsonb_array_length(p_groups) < 2 then
    raise exception 'split a quote into at least two jobs' using errcode = '22023';
  end if;

  select v.id into v_version_id
  from public.acceptances a
  join public.quote_versions v on v.quote_id = a.quote_id and v.version = a.version
  where a.quote_id = q.id;
  if v_version_id is null then
    raise exception 'accepted quote has no acceptance' using errcode = 'P0002';
  end if;

  for g in select value from jsonb_array_elements(p_groups)
  loop
    v_title := left(btrim(g->>'title'), 200);
    if v_title is null or length(v_title) < 1 then
      raise exception 'each job needs a title' using errcode = '22023';
    end if;
    if jsonb_typeof(g->'line_ids') is distinct from 'array' or jsonb_array_length(g->'line_ids') < 1 then
      raise exception 'each job needs a line' using errcode = '22023';
    end if;

    insert into public.jobs (org_id, property_id, quote_id, title, status)
    values (q.org_id, q.property_id, q.id, v_title, 'unscheduled')
    returning id into v_job;
    v_jobs := v_jobs || v_job;

    for v_element in select value from jsonb_array_elements(g->'line_ids')
    loop
      v_line := (v_element #>> '{}')::uuid;
      if v_line = any (v_seen) then
        raise exception 'a line can only be on one job' using errcode = '22023';
      end if;
      if not exists (
        select 1 from public.quote_line_items li
        where li.id = v_line and li.version_id = v_version_id and li.org_id = q.org_id
      ) then
        raise exception 'line is not on this quote' using errcode = '22023';
      end if;
      insert into public.job_quote_lines (org_id, job_id, quote_line_item_id)
      values (q.org_id, v_job, v_line);
      v_seen := v_seen || v_line;
    end loop;
  end loop;

  return (
    select coalesce(jsonb_agg(jsonb_build_object('job_id', j.id, 'title', j.title) order by j.created_at, j.id), '[]'::jsonb)
    from public.jobs j
    where j.id = any (v_jobs)
  );
end;
$$;

revoke all on function public.split_accepted_quote(uuid, jsonb) from public, anon;
grant execute on function public.split_accepted_quote(uuid, jsonb) to authenticated, service_role;

alter table public.job_quote_lines enable row level security;
alter table public.job_quote_lines force row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'job_quote_lines' and policyname = 'job_quote_lines_select'
  ) then
    create policy job_quote_lines_select on public.job_quote_lines
      for select to authenticated
      using ((select private.can_read_office_records(org_id)));
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'job_quote_lines' and policyname = 'job_quote_lines_write'
  ) then
    create policy job_quote_lines_write on public.job_quote_lines
      for all to authenticated
      using ((select private.can_write_job_records(org_id)))
      with check ((select private.can_write_job_records(org_id)));
  end if;
end $$;

grant select, insert, update, delete on public.job_quote_lines to authenticated;
grant all on public.job_quote_lines to service_role;
