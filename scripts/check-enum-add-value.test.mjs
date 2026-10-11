import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { migrationViolations, unsafeEnumValueUses } from "./check-enum-add-value.mjs";

const migrationsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../supabase/migrations",
);

test("flags an enum label added and used in the same migration file", () => {
  const sql = `
    alter type public.invoice_source add value if not exists 'installment';
    alter type public.invoice_source add value if not exists 'true_up';
    create unique index invoices_agreement_installment_period_key
      on public.invoices (org_id, agreement_id, billing_period)
      where source = 'installment';
    -- plpgsql is still a use: the hosted runner executes the file in one transaction
    create function public.note_true_up() returns void language plpgsql as $fn$
    begin
      perform 1 from public.invoices where source in ('installment', 'true_up');
    end;
    $fn$;
  `;

  assert.deepEqual(unsafeEnumValueUses(sql), [
    { typeName: "public.invoice_source", label: "installment" },
    { typeName: "public.invoice_source", label: "true_up" },
  ]);
});

test("allows adding enum labels when the same file does not use them", () => {
  const sql = `
    alter type public.invoice_source add value if not exists 'installment';
    alter type public.invoice_source add value if not exists 'true_up';
  `;

  assert.deepEqual(unsafeEnumValueUses(sql), []);
});

test("allows using labels that this file did not add", () => {
  const sql = `
    create unique index invoices_agreement_installment_period_key
      on public.invoices (org_id, agreement_id, billing_period)
      where source = 'installment';
  `;

  assert.deepEqual(unsafeEnumValueUses(sql), []);
});

test("allows values introduced by create type in the same file", () => {
  const sql = `
    create type public.agreement_billing_mode as enum ('per_visit', 'seasonal_installment');
    alter table public.agreements
      add constraint agreements_seasonal_fields check (
        billing_mode = 'seasonal_installment'
      );
  `;

  assert.deepEqual(unsafeEnumValueUses(sql), []);
});

test("does not treat a before/after neighbor as a newly added label", () => {
  const sql = `
    alter type public.invoice_source add value 'installment' before 'manual';
    select 'manual';
  `;

  assert.deepEqual(unsafeEnumValueUses(sql), []);
});

test("ignores the label inside a longer literal or a comment", () => {
  const sql = `
    alter type public.invoice_source add value if not exists 'installment';
    -- comment mentions 'installment' but is not a use
    select 'Seasonal installment %s';
  `;

  assert.deepEqual(unsafeEnumValueUses(sql), []);
});

test("shipped migrations do not add an enum value and use it in the same file", () => {
  assert.deepEqual(migrationViolations(migrationsDir), []);
});
