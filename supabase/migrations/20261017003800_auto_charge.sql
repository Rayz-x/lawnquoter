-- Opt an account into charging the default card after each visit invoice.

alter table public.accounts
  add column if not exists auto_charge boolean not null default false;
