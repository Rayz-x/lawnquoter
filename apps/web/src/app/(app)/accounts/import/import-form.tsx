"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field, FieldHint, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { importCustomersCsv, type CustomerImportResult } from "../import-action";

const SAMPLE = "name,phone,email,type,address_line1,city,region,postal_code";

export function ImportCustomersForm() {
  const [csv, setCsv] = useState(SAMPLE);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CustomerImportResult | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex max-w-3xl flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          const imported = await importCustomersCsv(csv);
          if (!imported.ok) {
            setResult(null);
            setError(imported.error);
            return;
          }
          setResult(imported.data);
        });
      }}
    >
      <Field>
        <FieldLabel htmlFor="customer-csv">CSV</FieldLabel>
        <Textarea
          id="customer-csv"
          value={csv}
          rows={12}
          required
          aria-describedby="customer-csv-hint"
          className="w-full"
          onChange={(event) => setCsv(event.target.value)}
          placeholder={SAMPLE}
        />
        <FieldHint id="customer-csv-hint">One customer per row, and a matching phone or address is skipped.</FieldHint>
      </Field>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" disabled={pending} className="min-h-11 w-fit">
        {pending ? "Importing…" : "Import customers"}
      </Button>
      {result ? (
        <div className="flex flex-col gap-3 text-sm" data-testid="customer-import-result">
          <p>{result.created.length} created, {result.skipped.length} skipped as duplicates, {result.issues.length} need a fix.</p>
          <ul className="flex flex-col gap-1">
            {result.created.map((account) => (
              <li key={account.id}>
                Created <Link href={`/accounts/${account.id}`} className="underline">{account.name}</Link>
              </li>
            ))}
            {result.skipped.map((row) => (
              <li key={`skip-${row.line}`}>Line {row.line}: {row.detail}</li>
            ))}
            {result.issues.map((issue) => (
              <li key={`issue-${issue.line}-${issue.message}`}>Line {issue.line}: {issue.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </form>
  );
}
