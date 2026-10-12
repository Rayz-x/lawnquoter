-- Enum values only. The next migration is the first file that may use them.
alter type public.agreement_billing_mode add value if not exists 'level';
alter type public.invoice_source add value if not exists 'level';
