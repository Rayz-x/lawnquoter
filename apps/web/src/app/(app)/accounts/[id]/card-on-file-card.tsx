import { SectionCard } from "@/components/entry";
import { cardOnFileBlockedReason, cardOnFileLabel } from "@/lib/billing/card-on-file";

export type CardOnFileRow = {
  id: string;
  brand: string | null;
  last4: string | null;
  kind: "card" | "us_bank_account";
  isDefault: boolean;
};

export function CardOnFileCard({
  stripeKey,
  connectReady,
  methods,
}: {
  stripeKey: boolean;
  connectReady: boolean;
  methods: CardOnFileRow[];
}) {
  const blocked = cardOnFileBlockedReason({ stripeKey, connectReady });
  return (
    <SectionCard title="Card on file" heading="h2" description="Cards and bank accounts saved for this customer.">
      <div className="flex flex-col gap-3">
        {blocked ? <p className="text-sm text-muted-foreground">{blocked}</p> : null}
        {methods.length === 0 ? (
          <p className="text-sm text-muted-foreground">No card on file yet.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {methods.map((method) => (
              <li key={method.id}>
                {cardOnFileLabel(method)}
                {method.isDefault ? " · Default" : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}
