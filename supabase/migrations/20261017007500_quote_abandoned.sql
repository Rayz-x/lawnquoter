-- A viewed quote that was not accepted or declined.

alter table public.quotes add column if not exists abandoned_at timestamptz;
