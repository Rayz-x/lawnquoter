-- Enum value only. The next migration is the first file that may use it.
alter type public.invoice_source add value if not exists 'late_fee';
