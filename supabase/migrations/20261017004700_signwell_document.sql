-- Commercial contracts can remember the SignWell document. Acceptance still uses the existing signwell method.

alter table public.quotes
  add column if not exists signwell_document_id text;
