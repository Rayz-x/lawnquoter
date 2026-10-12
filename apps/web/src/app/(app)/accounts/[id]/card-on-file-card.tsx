"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { SectionCard } from "@/components/entry";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cardOnFileBlockedReason, cardOnFileLabel } from "@/lib/billing/card-on-file";
import { startCardOnFile } from "./card-on-file-actions";

export type CardOnFileRow = {
  id: string;
  brand: string | null;
  last4: string | null;
  kind: "card" | "us_bank_account";
  isDefault: boolean;
};

export function CardOnFileCard({
  accountId,
  stripeKey,
  connectReady,
  methods,
  notice,
}: {
  accountId: string;
  stripeKey: boolean;
  connectReady: boolean;
  methods: CardOnFileRow[];
  notice: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const blocked = cardOnFileBlockedReason({ stripeKey, connectReady });
  const add = () => {
    startTransition(async () => {
      const result = await startCardOnFile(accountId);
      if (!result.ok) return void toast.error(result.error);
      window.location.href = result.data.url;
    });
  };
  return (
    <SectionCard title="Card on file" heading="h2" description="Cards and bank accounts saved for this customer.">
      <div className="flex flex-col gap-3">
        {notice ? <p className="text-sm">{notice}</p> : null}
        {blocked ? <p className="text-sm text-muted-foreground">{blocked}</p> : null}
        {methods.length === 0 ? <p className="text-sm text-muted-foreground">No card on file yet.</p> : (
          <ul className="flex flex-col gap-1 text-sm">
            {methods.map((method) => (
              <li key={method.id}>
                {cardOnFileLabel(method)}
                {method.isDefault ? " · Default" : ""}
              </li>
            ))}
          </ul>
        )}
        {blocked ? null : (
          <Button type="button" className="w-fit" disabled={pending} onClick={add}>
            {pending ? <Spinner /> : null}
            Add card
          </Button>
        )}
      </div>
    </SectionCard>
  );
}
