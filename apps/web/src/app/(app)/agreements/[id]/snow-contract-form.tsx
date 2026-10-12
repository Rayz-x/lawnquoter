"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChipGroup } from "@/components/entry";
import { HelpTip } from "@/components/help/help-tip";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { saveSnowContract } from "@/lib/actions/snow-contract";
import { isSnowContract, type SnowContract } from "@/lib/agreements/snow-contract";

const OPTIONS = [
  { value: "per_push", label: "Per push" },
  { value: "per_inch", label: "Per inch" },
  { value: "seasonal_flat", label: "Seasonal" },
] as const;

export function SnowContractForm({
  agreementId,
  contract,
  triggerDepthIn,
  price,
}: {
  agreementId: string;
  contract: string | null;
  triggerDepthIn: number | null;
  price: number | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<SnowContract>(isSnowContract(contract ?? "") ? (contract as SnowContract) : "per_push");
  const [trigger, setTrigger] = useState(triggerDepthIn != null ? String(triggerDepthIn) : "2");
  const [amount, setAmount] = useState(price != null ? String(price) : "");
  const [upTo, setUpTo] = useState("2");
  const [tierPrice, setTierPrice] = useState("");

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const triggerDepth = Number(trigger);
        const openPrice = Number(amount);
        if (!Number.isFinite(triggerDepth) || triggerDepth < 0) {
          toast.error("Trigger depth is required");
          return;
        }
        if (!Number.isFinite(openPrice) || openPrice < 0) {
          toast.error("Price is required");
          return;
        }
        const tiers =
          kind === "per_inch"
            ? [
                ...(tierPrice.trim() !== "" ? [{ upTo: Number(upTo), price: Number(tierPrice) }] : []),
                { upTo: null, price: openPrice },
              ]
            : undefined;
        startTransition(async () => {
          const result = await saveSnowContract({
            agreementId,
            contract: kind,
            triggerDepthIn: triggerDepth,
            price: openPrice,
            tiers,
          });
          if (result.ok) {
            toast.success("Snow contract saved");
            router.refresh();
          } else {
            toast.error(result.error);
          }
        });
      }}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <ChipGroup label="Snow contract" options={OPTIONS} value={kind} onValueChange={(value) => {
          if (isSnowContract(value)) setKind(value);
        }} />
      </div>
      <Field>
        <FieldLabel htmlFor="snow-trigger" className="inline-flex items-center gap-1">
          Trigger depth (inches)
          <HelpTip
            label="Help for snow depth"
            text="Snow at or above this depth schedules a visit. Per push is one price each visit. Per inch uses tiers. Seasonal is one price for the winter."
            href="/help/agreements#snow-contract"
          />
        </FieldLabel>
        <Input id="snow-trigger" inputMode="decimal" value={trigger} onChange={(event) => setTrigger(event.target.value)} required />
      </Field>
      <Field>
        <FieldLabel htmlFor="snow-price">{kind === "per_inch" ? "Price above the tier" : "Price"}</FieldLabel>
        <Input id="snow-price" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required />
      </Field>
      {kind === "per_inch" ? (
        <div className="grid grid-cols-2 gap-2">
          <Field>
            <FieldLabel htmlFor="snow-up-to">Up to (inches)</FieldLabel>
            <Input id="snow-up-to" inputMode="decimal" value={upTo} onChange={(event) => setUpTo(event.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="snow-tier">Tier price</FieldLabel>
            <Input id="snow-tier" inputMode="decimal" value={tierPrice} onChange={(event) => setTierPrice(event.target.value)} />
          </Field>
        </div>
      ) : null}
      <span className="flex min-w-0 flex-col gap-1">
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          Save snow contract
        </Button>
      </span>
    </form>
  );
}
