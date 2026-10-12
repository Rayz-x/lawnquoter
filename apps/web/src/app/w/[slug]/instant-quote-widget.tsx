"use client";

import { useState, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  contactCaptured,
  depositLockCopy,
  emptyInstantQuote,
  instantQuoteStep,
  lawnSqftFromSides,
  type InstantQuoteDraft,
  type InstantQuoteOffer,
} from "@/lib/leads/instant-quote";
import { revealInstantQuote } from "./reveal-quote";

function dollars(amount: number) {
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function InstantQuoteSummary({
  offer,
  depositConnected,
}: {
  offer: InstantQuoteOffer | null;
  depositConnected: boolean;
}) {
  if (!offer) return null;
  return (
    <section className="grid gap-2 rounded-lg border p-4">
      <p className="text-2xl font-semibold tracking-tight">
        {dollars(offer.low)} – {dollars(offer.high)}
      </p>
      <p>Stated minimum {dollars(offer.statedMinimum)}</p>
      <p>{offer.confirm}</p>
      <p>{depositLockCopy(depositConnected)}</p>
    </section>
  );
}

function TextField({
  label,
  value,
  onChange,
  ...rest
}: { label: string; value: string; onChange: (value: string) => void } & Pick<
  ComponentProps<typeof Input>,
  "inputMode" | "type"
>) {
  return (
    <label className="grid gap-1 text-sm font-medium">
      {label}
      <Input value={value} onChange={(event) => onChange(event.target.value)} {...rest} />
    </label>
  );
}

function YesNo({ label, value, onChange }: { label: string; value: boolean | null; onChange: (value: boolean) => void }) {
  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex gap-2">
        {([true, false] as const).map((choice) => (
          <Button key={String(choice)} type="button" variant={value === choice ? "default" : "outline"} onClick={() => onChange(choice)}>
            {choice ? "Yes" : "No"}
          </Button>
        ))}
      </div>
    </div>
  );
}

export function InstantQuoteWidget({
  slug,
  services,
  serviceAreaZips,
  initialUtm,
  depositConnected,
}: {
  slug: string;
  services: string[];
  serviceAreaZips: string[];
  initialUtm: Pick<InstantQuoteDraft, "utmSource" | "utmMedium" | "utmCampaign" | "utmTerm" | "utmContent">;
  depositConnected: boolean;
}) {
  const [draft, setDraft] = useState(() => emptyInstantQuote(initialUtm));
  const [lengthFt, setLengthFt] = useState("");
  const [widthFt, setWidthFt] = useState("");
  const [offer, setOffer] = useState<InstantQuoteOffer | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const step = instantQuoteStep(draft, serviceAreaZips);
  const patch = (partial: Partial<InstantQuoteDraft>) => setDraft((current) => ({ ...current, ...partial }));

  async function reveal() {
    setPending(true);
    setFailed(false);
    const result = await revealInstantQuote(slug, draft);
    setPending(false);
    if (!result) {
      setFailed(true);
      return;
    }
    setOffer(result);
  }

  if (step === "outside") return <p>This address is outside our service area, so we can&apos;t price it here.</p>;
  if (offer) return <InstantQuoteSummary offer={offer} depositConnected={depositConnected} />;

  return (
    <div className="grid gap-3">
      {step === "address" ? (
        <>
          <TextField label="Address" value={draft.address} onChange={(address) => patch({ address })} />
          <TextField label="ZIP code" inputMode="numeric" value={draft.postalCode} onChange={(postalCode) => patch({ postalCode })} />
        </>
      ) : null}
      {step === "qualify" ? (
        <>
          <label className="grid gap-1 text-sm font-medium">
            Service
            <NativeSelect value={draft.service} onChange={(event) => patch({ service: event.target.value })}>
              <option value="">Choose a service</option>
              {services.map((service) => (
                <option key={service} value={service}>{service}</option>
              ))}
            </NativeSelect>
          </label>
          <YesNo label="Is there a gate?" value={draft.hasGate} onChange={(hasGate) => patch({ hasGate })} />
          <YesNo label="Are there dogs in the yard?" value={draft.hasDogs} onChange={(hasDogs) => patch({ hasDogs })} />
        </>
      ) : null}
      {step === "measure" ? (
        <>
          <p className="text-sm text-muted-foreground">Trace the lawn as a rectangle, in feet.</p>
          <TextField label="Length (ft)" inputMode="decimal" value={lengthFt} onChange={setLengthFt} />
          <TextField label="Width (ft)" inputMode="decimal" value={widthFt} onChange={setWidthFt} />
          <Button type="button" onClick={() => patch({ lotSqft: lawnSqftFromSides(Number(lengthFt), Number(widthFt)) })}>
            Use this size
          </Button>
        </>
      ) : null}
      {step === "contact" || step === "confirm" ? (
        <>
          <p className="text-sm text-muted-foreground">Add your name and a phone or email to see the range.</p>
          <TextField label="Name" value={draft.contactName} onChange={(contactName) => patch({ contactName })} />
          <TextField label="Phone" value={draft.phone} onChange={(phone) => patch({ phone })} />
          <TextField label="Email" type="email" value={draft.email} onChange={(email) => patch({ email })} />
          <Button type="button" disabled={!contactCaptured(draft) || pending} onClick={() => void reveal()}>
            {pending ? "Saving…" : "See my range"}
          </Button>
          {failed ? <p>We couldn&apos;t save that. Check the name and phone or email.</p> : null}
        </>
      ) : null}
    </div>
  );
}
