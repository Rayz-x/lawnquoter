-- Flag a sent quote that was never opened and never answered.

alter table public.quotes add column if not exists gone_quiet_at timestamptz;
