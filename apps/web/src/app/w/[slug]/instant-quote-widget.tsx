"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import type { Geometry } from "@lawnquoter/shared";
import { MeasureMap } from "@/components/map/measure-map";
import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  abandonedInstantQuote,
  contactCaptured,
  depositLockCopy,
  emptyInstantQuote,
  instantQuoteStep,
  type InstantQuoteDraft,
  type InstantQuoteOffer,
} from "@/lib/leads/instant-quote";
import {
  chooseLawnSize,
  type InstantQuoteMap,
  type LawnSizeChoice,
} from "@/lib/leads/instant-quote-measure";
import { loadInstantQuoteMap } from "./load-map";
import { revealInstantQuote } from "./reveal-quote";
import { startInstantQuoteDeposit } from "./start-deposit";

function dollars(amount: number) {
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function InstantQuoteSummary({
  offer,
  depositConnected,
  leadId,
  onDeposit,
  depositFailed,
}: {
  offer: InstantQuoteOffer | null;
  depositConnected: boolean;
  leadId?: string | null;
  onDeposit?: () => void;
  depositFailed?: boolean;
}) {
  if (!offer) return null;
  const canPay = depositConnected && Boolean(leadId) && Boolean(onDeposit);
  return (
    <section className="grid gap-2 rounded-lg border p-4">
      <p className="text-2xl font-semibold tracking-tight">
        {dollars(offer.low)} – {dollars(offer.high)}
      </p>
      <p>Stated minimum {dollars(offer.statedMinimum)}</p>
      <p>{offer.confirm}</p>
      {canPay ? (
        <Button type="button" onClick={onDeposit}>
          {depositLockCopy(true)}
        </Button>
      ) : (
        <p>{depositLockCopy(false)}</p>
      )}
      {depositFailed ? <p>We couldn&apos;t start the deposit.</p> : null}
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
  const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return (
    <div className="grid min-w-0 gap-1 text-sm">
      <label htmlFor={id} className="font-medium">{label}</label>
      <Input id={id} className="w-full" value={value} onChange={(event) => onChange(event.target.value)} {...rest} />
    </div>
  );
}

export function InstantQuoteMeasureStep({
  map,
  trace,
  lengthFt,
  widthFt,
  onTrace,
  onLength,
  onWidth,
  onUse,
}: {
  map: InstantQuoteMap;
  trace: Geometry | null;
  lengthFt: string;
  widthFt: string;
  onTrace: (geometry: Geometry) => void;
  onLength: (value: string) => void;
  onWidth: (value: string) => void;
  onUse: (choice: LawnSizeChoice) => void;
}) {
  const choice = chooseLawnSize({
    trace,
    parcel: map.parcel,
    parcelSource: map.parcelSource,
    footprint: map.footprint,
    footprintSource: map.footprintSource,
    location: map.location,
    lengthFt: Number(lengthFt),
    widthFt: Number(widthFt),
  });
  const measured = choice && choice.source !== "rectangle" ? choice : null;
  return (
    <>
      <p className="text-sm text-muted-foreground">Trace your lawn on the map. We start from the lot minus the house.</p>
      <MeasureMap
        className="h-64 w-full overflow-hidden rounded-lg border"
        location={map.location}
        parcel={map.parcel}
        footprint={map.footprint}
        features={
          trace
            ? [{ clientId: "trace", category: "turf_front", source: "traced", geometry: trace, area_sqft: null, length_ft: null }]
            : []
        }
        mode="polygon"
        onDrawn={onTrace}
      />
      {measured ? (
        <>
          <p>
            {measured.source === "trace" ? "Traced lawn" : "Lot minus the house"}: {measured.sqft.toLocaleString("en-US")} sq ft
          </p>
          <Button type="button" onClick={() => onUse(measured)}>
            Use this lawn
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">Enter length and width.</p>
          <TextField label="Length (ft)" inputMode="decimal" value={lengthFt} onChange={onLength} />
          <TextField label="Width (ft)" inputMode="decimal" value={widthFt} onChange={onWidth} />
          <Button type="button" disabled={choice == null} onClick={() => choice && onUse(choice)}>
            Use this size
          </Button>
        </>
      )}
    </>
  );
}

function YesNo({ label, value, onChange }: { label: string; value: boolean | null; onChange: (value: boolean) => void }) {
  return (
    <div className="grid min-w-0 gap-1">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
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
  depositPaid = false,
  turnstileSiteKey = null,
}: {
  slug: string;
  services: string[];
  serviceAreaZips: string[];
  initialUtm: Pick<InstantQuoteDraft, "utmSource" | "utmMedium" | "utmCampaign" | "utmTerm" | "utmContent">;
  depositConnected: boolean;
  depositPaid?: boolean;
  turnstileSiteKey?: string | null;
}) {
  const [draft, setDraft] = useState(() => emptyInstantQuote(initialUtm));
  const [map, setMap] = useState<InstantQuoteMap | null>(null);
  const [trace, setTrace] = useState<Geometry | null>(null);
  const [lengthFt, setLengthFt] = useState("");
  const [widthFt, setWidthFt] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const turnstileRef = useRef<HTMLDivElement>(null);
  const [offer, setOffer] = useState<InstantQuoteOffer | null>(null);
  const [leadId, setLeadId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [depositFailed, setDepositFailed] = useState(false);
  const step = instantQuoteStep(draft, serviceAreaZips);
  const patch = (partial: Partial<InstantQuoteDraft>) => setDraft((current) => ({ ...current, ...partial }));

  useEffect(() => {
    if ((step !== "contact" && step !== "confirm") || !turnstileSiteKey || !turnstileRef.current) return;
    const w = window as Window & {
      turnstile?: { render: (el: HTMLElement, opts: { sitekey: string; callback: (token: string) => void }) => void };
    };
    const render = () => {
      if (!turnstileRef.current || !w.turnstile) return;
      w.turnstile.render(turnstileRef.current, { sitekey: turnstileSiteKey, callback: setTurnstileToken });
    };
    if (w.turnstile) {
      render();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = render;
    document.head.appendChild(script);
  }, [step, turnstileSiteKey]);

  useEffect(() => {
    if (step !== "measure" || map) return;
    let cancelled = false;
    const address = `${draft.address}, ${draft.postalCode}`;
    void loadInstantQuoteMap(address)
      .then((loaded) => {
        if (!cancelled) setMap(loaded);
      })
      .catch(() => {
        if (!cancelled) {
          setMap({ location: null, parcel: null, parcelSource: null, footprint: null, footprintSource: null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [step, map, draft.address, draft.postalCode]);

  useEffect(() => {
    const send = () => {
      if (!abandonedInstantQuote(draft)) return;
      const body = JSON.stringify({ slug, draft });
      navigator.sendBeacon("/api/public/instant-quote/abandon", new Blob([body], { type: "application/json" }));
    };
    window.addEventListener("pagehide", send);
    return () => window.removeEventListener("pagehide", send);
  }, [draft, slug]);

  async function reveal() {
    setPending(true);
    setFailed(false);
    const result = await revealInstantQuote(slug, draft, {
      turnstileToken: turnstileToken || (turnstileSiteKey ? "" : "dev-missing-site-key"),
      honeypot,
    });
    setPending(false);
    if (!result) {
      setFailed(true);
      return;
    }
    setOffer(result);
    setLeadId(result.leadId);
  }

  async function lockDeposit() {
    if (!leadId) return;
    setPending(true);
    setDepositFailed(false);
    const result = await startInstantQuoteDeposit(slug, leadId, draft);
    setPending(false);
    if (!result.ok) {
      setDepositFailed(true);
      return;
    }
    window.location.assign(result.url);
  }

  if (depositPaid) return <p>Deposit received. We&apos;ll confirm within 24 hours.</p>;
  if (step === "outside") return <p>This address is outside our service area, so we can&apos;t price it here.</p>;
  if (offer) {
    return (
      <InstantQuoteSummary
        offer={offer}
        depositConnected={depositConnected}
        leadId={leadId}
        onDeposit={() => void lockDeposit()}
        depositFailed={depositFailed}
      />
    );
  }

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
          <div className="grid min-w-0 gap-1 text-sm">
            <label htmlFor="instant-service" className="font-medium">Service</label>
            <NativeSelect id="instant-service" value={draft.service} onChange={(event) => patch({ service: event.target.value })}>
              <option value="">Choose a service</option>
              {services.map((service) => (
                <option key={service} value={service}>{service}</option>
              ))}
            </NativeSelect>
          </div>
          <YesNo label="Is there a gate?" value={draft.hasGate} onChange={(hasGate) => patch({ hasGate })} />
          <YesNo label="Are there dogs in the yard?" value={draft.hasDogs} onChange={(hasDogs) => patch({ hasDogs })} />
        </>
      ) : null}
      {step === "measure" ? (
        map ? (
          <InstantQuoteMeasureStep
            map={map}
            trace={trace}
            lengthFt={lengthFt}
            widthFt={widthFt}
            onTrace={setTrace}
            onLength={setLengthFt}
            onWidth={setWidthFt}
            onUse={(choice) => patch({ lotSqft: choice.sqft, measurementConfidence: choice.confidence })}
          />
        ) : (
          <p>Looking up the lot…</p>
        )
      ) : null}
      {step === "contact" || step === "confirm" ? (
        <>
          <p className="text-sm text-muted-foreground">Add your name and a phone or email to see the range.</p>
          <TextField label="Name" value={draft.contactName} onChange={(contactName) => patch({ contactName })} />
          <TextField label="Phone" value={draft.phone} onChange={(phone) => patch({ phone })} />
          <TextField label="Email" type="email" value={draft.email} onChange={(email) => patch({ email })} />
          <div className="absolute left-[-10000px] h-px w-px overflow-hidden" aria-hidden="true">
            <label>
              Website
              <input type="text" name="website" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(event) => setHoneypot(event.target.value)} />
            </label>
          </div>
          {turnstileSiteKey ? <div ref={turnstileRef} /> : null}
          <Button type="button" disabled={!contactCaptured(draft) || pending} onClick={() => void reveal()}>
            {pending ? "Saving…" : "See my range"}
          </Button>
          {failed ? <p>We couldn&apos;t save that. Check the name and phone or email.</p> : null}
        </>
      ) : null}
    </div>
  );
}
