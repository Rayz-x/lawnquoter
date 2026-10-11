-- I07: ACH in-flight payments use ledger_payment_status = processing.
-- Separate file: ADD VALUE cannot be used in the same transaction as the new label (55P04).

alter type public.ledger_payment_status add value if not exists 'processing';
