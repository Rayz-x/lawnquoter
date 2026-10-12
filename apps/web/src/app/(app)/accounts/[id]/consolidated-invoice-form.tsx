"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { createConsolidatedInvoice } from "./consolidated-invoice-actions";

export function ConsolidatedInvoiceForm({ accountId, canEdit }: { accountId: string; canEdit: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (!canEdit) {
    return <p className="text-sm text-muted-foreground">Consolidated invoicing is on for this account.</p>;
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        startTransition(async () => {
          const result = await createConsolidatedInvoice({
            accountId,
            periodStart: String(form.get("period_start") ?? ""),
            periodEnd: String(form.get("period_end") ?? ""),
          });
          if (result.ok) {
            toast.success("Consolidated invoice drafted");
            router.refresh();
          } else {
            toast.error(result.error);
          }
        });
      }}
    >
      <p className="text-sm text-muted-foreground">
        Completed visits for this account and its child sites go on one invoice. Each line names the site.
      </p>
      <Field>
        <FieldLabel htmlFor="consol-start">From</FieldLabel>
        <Input id="consol-start" name="period_start" type="date" required className="w-full" />
      </Field>
      <Field>
        <FieldLabel htmlFor="consol-end">Through</FieldLabel>
        <Input id="consol-end" name="period_end" type="date" required className="w-full" />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? <Spinner /> : null}
        Draft consolidated invoice
      </Button>
    </form>
  );
}
