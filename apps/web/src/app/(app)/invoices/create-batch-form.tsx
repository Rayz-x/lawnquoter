"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
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
      className="flex flex-wrap items-end gap-2"
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
      <label className="grid gap-1 text-xs">
        <span className="text-muted-foreground">From</span>
        <Input type="date" name="period_start" defaultValue={defaultStart} required className="w-auto" />
      </label>
      <label className="grid gap-1 text-xs">
        <span className="text-muted-foreground">To</span>
        <Input type="date" name="period_end" defaultValue={defaultEnd} required className="w-auto" />
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create invoices"}
      </Button>
      {error ? <p className="basis-full text-sm text-destructive">{error}</p> : null}
      {message ? <p className="basis-full text-sm text-muted-foreground">{message}</p> : null}
    </form>
  );
}
