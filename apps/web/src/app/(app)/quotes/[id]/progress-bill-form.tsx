"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { formatMoney } from "@/lib/money";
import { createProgressInvoice } from "./progress-bill-actions";

export function ProgressBillForm({
  quoteId,
  lines,
}: {
  quoteId: string;
  lines: { id: string; name: string; price: number }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (lines.length === 0) {
    return <p className="text-sm text-muted-foreground">No selected lines to bill.</p>;
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const lineItemIds = form.getAll("line_id").map(String);
        const percent = Number(form.get("percent"));
        startTransition(async () => {
          const result = await createProgressInvoice({ quoteId, lineItemIds, percent });
          if (result.ok) {
            toast.success("Progress invoice drafted");
            router.refresh();
          } else {
            toast.error(result.error);
          }
        });
      }}
    >
      <p className="text-sm text-muted-foreground">
        Pick the lines in this draw. The percent is how far those lines should be billed, and anything already billed is left off.
      </p>
      <ul className="flex flex-col gap-2">
        {lines.map((line) => (
          <li key={line.id}>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="line_id" value={line.id} defaultChecked />
              <span>{line.name}</span>
              <span className="ml-auto tabular-nums text-muted-foreground">{formatMoney(line.price, { cents: true })}</span>
            </label>
          </li>
        ))}
      </ul>
      <Field>
        <FieldLabel htmlFor="progress-percent">Percent complete</FieldLabel>
        <Input id="progress-percent" name="percent" type="number" min={1} max={100} required defaultValue={100} />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? <Spinner /> : null}
        Draft progress invoice
      </Button>
    </form>
  );
}
