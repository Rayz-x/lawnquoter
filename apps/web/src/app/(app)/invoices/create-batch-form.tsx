"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { FieldHint } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createInvoicesBatch } from "@/lib/actions/invoices";

export function CreateBatchForm({
  defaultStart,
  defaultEnd,
}: {
  defaultStart: string;
  defaultEnd: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <form
      className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        const fd = new FormData(event.currentTarget);
        const start = String(fd.get("period_start") ?? "");
        const end = String(fd.get("period_end") ?? "");
        setError(null);
        setMessage(null);
        startTransition(async () => {
          const result = await createInvoicesBatch(start, end);
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setMessage(
            result.data.visitCount === 0
              ? "No new billable visits in that period."
              : `Drafted ${result.data.invoiceCount} invoice${result.data.invoiceCount === 1 ? "" : "s"} from ${result.data.visitCount} visit${result.data.visitCount === 1 ? "" : "s"}.`,
          );
          router.refresh();
        });
      }}
    >
      <div className="flex min-w-0 flex-col gap-1 text-sm">
        <label htmlFor="batch-start">From</label>
        <Input id="batch-start" type="date" name="period_start" aria-describedby="batch-start-hint" defaultValue={defaultStart} required className="w-full" />
        <FieldHint id="batch-start-hint">The first day of visits to put on these invoices.</FieldHint>
      </div>
      <div className="flex min-w-0 flex-col gap-1 text-sm">
        <label htmlFor="batch-end">To</label>
        <Input id="batch-end" type="date" name="period_end" aria-describedby="batch-end-hint" defaultValue={defaultEnd} required className="w-full" />
        <FieldHint id="batch-end-hint">The last day of visits to put on these invoices.</FieldHint>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create invoices"}
      </Button>
      {error ? <p className="text-sm text-destructive sm:col-span-3">{error}</p> : null}
      {message ? <p className="text-sm text-muted-foreground sm:col-span-3">{message}</p> : null}
    </form>
  );
}
