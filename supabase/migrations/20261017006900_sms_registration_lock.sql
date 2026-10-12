-- The carrier status and Twilio ids are the lock against a second brand.
-- An owner can still edit the business draft. Only service_role can move the lock.

revoke update on table public.org_sms_registrations from authenticated;
grant update (legal_name, ein, website, contact_email, sample_message)
  on table public.org_sms_registrations to authenticated;
