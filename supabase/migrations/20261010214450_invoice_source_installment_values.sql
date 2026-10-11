-- Commit invoice_source labels before 20261010214500 uses them.
-- Postgres rejects use of a label added by ALTER TYPE ... ADD VALUE in the
-- same transaction (SQLSTATE 55P04). The hosted runner applies each migration
-- file in one transaction, so these labels have to land in an earlier file.

alter type public.invoice_source add value if not exists 'installment';
alter type public.invoice_source add value if not exists 'true_up';
