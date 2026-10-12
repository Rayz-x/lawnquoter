"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MoneyBlurInput } from "@/components/entry";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldHint, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { updateQuoteTerms } from "../actions";

export function QuoteTermsForm({
  quoteId,
  depositAmount,
  expiresAt,
  editable,
}: {
  quoteId: string;
  depositAmount: number | null;
  expiresAt: string | null;
  editable: boolean;
}) {
  const router = useRouter();
  const [expiry, setExpiry] = useState(expiresAt ?? "");
  const [pending, startTransition] = useTransition();

  async function saveDeposit(amount: number) {
    const fd = new FormData();
    fd.set("deposit_amount", String(amount));
    const result = await updateQuoteTerms(quoteId, fd);
    if (result.ok) router.refresh();
    return result;
  }

  function saveExpiry(next: string) {
    if (!editable) return;
    if (next === (expiresAt ?? "")) return;
    const fd = new FormData();
    fd.set("expires_at", next);
    startTransition(async () => {
      const result = await updateQuoteTerms(quoteId, fd);
      if (!result.ok) {
        toast.error(result.error);
        setExpiry(expiresAt ?? "");
        return;
      }
      setExpiry(next);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Terms</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Field>
          <FieldLabel htmlFor="quote-deposit">Deposit</FieldLabel>
          {editable ? (
            <MoneyBlurInput
              ariaLabel="Deposit"
              value={depositAmount ?? 0}
              className="font-heading tabular-nums"
              onCommit={saveDeposit}
            />
          ) : (
            <p id="quote-deposit" className="font-heading text-sm tabular-nums">
              {depositAmount == null ? "—" : `$${depositAmount.toFixed(2)}`}
            </p>
          )}
          <FieldHint id="quote-deposit-hint">The amount collected before the work starts.</FieldHint>
        </Field>
        <Field>
          <FieldLabel htmlFor="quote-expires">Expires</FieldLabel>
          <Input
            id="quote-expires"
            aria-describedby="quote-expires-hint"
            type="date"
            value={expiry}
            disabled={!editable || pending}
            onChange={(event) => setExpiry(event.target.value)}
            onBlur={(event) => saveExpiry(event.target.value)}
          />
          <FieldHint id="quote-expires-hint">The last day the customer can accept this price.</FieldHint>
        </Field>
      </CardContent>
    </Card>
  );
}
