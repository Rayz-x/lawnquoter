"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { levelInstallmentCents } from "@/lib/billing/level-billing";
import { formatMoney } from "@/lib/money";
import { configureLevelBilling } from "./level-billing-actions";

function dollarsToCents(value: string): number {
  const dollars = Number(value);
  if (!Number.isFinite(dollars)) return 0;
  return Math.round(dollars * 100);
}

function money(cents: number): string {
  return formatMoney(cents / 100, { cents: true });
}

export function LevelBillingForm({
  agreementId,
  billingMonths,
  seasonPriceCents,
  canEdit,
}: {
  agreementId: string;
  billingMonths: number | null;
  seasonPriceCents: number | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [price, setPrice] = useState(seasonPriceCents != null ? (seasonPriceCents / 100).toFixed(2) : "1200");
  const [months, setMonths] = useState(String(billingMonths ?? 12));
  const monthCount = Number(months);
  const cents = dollarsToCents(price);
  const first = levelInstallmentCents(cents, monthCount, 1);
  const last = levelInstallmentCents(cents, monthCount, monthCount);

  if (!canEdit) {
    return (
      <p className="text-sm text-muted-foreground">
        {billingMonths
          ? `Level billing over ${billingMonths} months${seasonPriceCents != null ? ` at ${money(seasonPriceCents)} for the season` : ""}.`
          : "Not on level billing."}
      </p>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await configureLevelBilling({
            agreementId,
            seasonPriceCents: cents,
            billingMonths: monthCount,
          });
          if (result.ok) {
            toast.success("Level billing saved");
            router.refresh();
          } else {
            toast.error(result.error);
          }
        });
      }}
    >
      <p className="text-sm text-muted-foreground">
        The season price is split into the same amount each month. Saving writes a draft for each month. The last month picks up leftover cents.
      </p>
      {first > 0 ? (
        <p className="text-sm">
          First month {money(first)}. Last month {money(last)}.
        </p>
      ) : null}
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="level-price">Season price</FieldLabel>
          <Input
            id="level-price"
            type="number"
            min="0.01"
            step="0.01"
            required
            value={price}
            onChange={(event) => setPrice(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="level-months">Months</FieldLabel>
          <Input
            id="level-months"
            type="number"
            min={1}
            max={24}
            required
            value={months}
            onChange={(event) => setMonths(event.target.value)}
          />
        </Field>
      </FieldGroup>
      <Button type="submit" disabled={pending}>
        {pending ? <Spinner /> : null}
        Save level billing
      </Button>
    </form>
  );
}
