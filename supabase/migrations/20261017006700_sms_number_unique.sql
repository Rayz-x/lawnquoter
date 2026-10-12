-- One company owns a texting number. A second company cannot claim it.

drop index if exists public.orgs_sms_number_idx;

create unique index if not exists orgs_sms_number_uidx
  on public.orgs (sms_number)
  where sms_number is not null;
