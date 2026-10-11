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
    'account_statement_public',
    'change_order_accept',
    'change_order_public',
    'invoice_public',
    'quote_accept',
    'quote_decline',
    'quote_public',
    'quote_record_view',
    'site_check_cancel_request',
    'site_check_request'
  ]::text[],
  'anon can execute only the public quote, invoice, and statement security definer RPCs'
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
    'account_statement_public',
    'add_crew_member',
    'agreement_installment_balance',
    'assign_visit',
    'cancel_visit',
    'change_order_accept',
    'change_order_public',
    'claim_lead_for_today',
    'configure_seasonal_installments',
    'convert_accepted_quote',
    'convert_lead_request',
    'create_credit_note',
    'create_crew',
    'create_installment_invoice',
    'create_invoices_batch',
    'create_org',
    'create_org_invite',
    'crew_ack_day_pack',
    'crew_day_pack',
    'crew_pin_is_set',
    'crew_sync',
    'end_agreement',
    'enhancement_same_day_is_active',
    'ensure_account_statement_link',
    'generate_agreement_visits',
    'hold_agreement_visits',
    'hold_visit_for_billing',
    'invoice_balance_cents',
    'invoice_public',
    'issue_invoice',
    'job_seasonal_warn_state',
    'my_crews',
    'office_approve_same_day_extra',
    'office_approve_visit_time_correction',
    'office_attention_tray',
    'office_billing_review_queue',
    'office_clear_phone_revoke',
    'office_correct_visit_times',
    'office_rain_day_push',
    'office_reschedule_visit',
    'office_resolve_billing_hold',
    'office_revoke_phone',
    'org_payments_ready',
    'pause_agreement',
    'publish_route',
    'quote_accept',
    'quote_decline',
    'quote_public',
    'quote_record_view',
    'quote_revise',
    'quote_send',
    'record_office_payment',
    'reorder_route_visits',
    'resume_agreement',
    'revoke_org_invite',
    'set_active_org',
    'set_agreement_season_price',
    'set_crew_lead',
    'set_crew_pin',
    'set_lead_for_today',
    'site_check_approve',
    'site_check_cancel_request',
    'site_check_decline',
    'site_check_request',
    'skip_visit',
    'true_up_installment_agreement',
    'update_agreement_schedule',
    'update_agreement_season',
    'update_org_season',
    'verify_crew_pin',
    'void_invoice'
  ]::text[],
  'anon or authenticated can execute only the intended public security definers'
);

select * from finish();
