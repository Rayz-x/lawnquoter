select plan(3);

-- rls_auto_enable exists only on hosted Supabase. When it is present,
-- anon, authenticated, and PUBLIC cannot execute it.
select case
  when to_regprocedure('public.rls_auto_enable()') is null then
    ok(true, 'rls_auto_enable is absent from this database')
  else
    ok(
      not has_function_privilege('anon', 'public.rls_auto_enable()', 'execute')
      and not has_function_privilege('authenticated', 'public.rls_auto_enable()', 'execute')
      and not has_function_privilege('public', 'public.rls_auto_enable()', 'execute'),
      'anon, authenticated, and PUBLIC cannot execute rls_auto_enable'
    )
end;

select is(
  (
    select coalesce(array_agg(p.proname::text order by p.proname), '{}')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.prosecdef
      and has_function_privilege('anon', p.oid, 'execute')
  ),
  array[
    'quote_accept',
    'quote_decline',
    'quote_public',
    'quote_record_view',
    'site_check_cancel_request',
    'site_check_request'
  ]::text[],
  'anon can execute only the public quote security definer RPCs'
);

select is(
  (
    select coalesce(array_agg(p.proname::text order by p.proname), '{}')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.prosecdef
      and (
        has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute')
      )
  ),
  array[
    'accept_org_invite',
    'add_crew_member',
    'assign_visit',
    'cancel_visit',
    'claim_lead_for_today',
    'convert_accepted_quote',
    'convert_lead_request',
    'create_crew',
    'create_org',
    'create_org_invite',
    'crew_ack_day_pack',
    'crew_day_pack',
    'crew_sync',
    'generate_agreement_visits',
    'issue_invoice',
    'my_crews',
    'office_attention_tray',
    'office_rain_day_push',
    'office_reschedule_visit',
    'org_payments_ready',
    'publish_route',
    'quote_accept',
    'quote_decline',
    'quote_public',
    'quote_record_view',
    'quote_revise',
    'quote_send',
    'reorder_route_visits',
    'revoke_org_invite',
    'set_active_org',
    'set_crew_lead',
    'set_lead_for_today',
    'site_check_approve',
    'site_check_cancel_request',
    'site_check_decline',
    'site_check_request',
    'skip_visit',
    'update_agreement_schedule'
  ]::text[],
  'anon or authenticated can execute only the intended public security definers'
);

select * from finish();
