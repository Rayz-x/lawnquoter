"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldHint, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { LEAD_SOURCES } from "@/lib/leads/lead-source";
import {
  buildHostedIntakeBody,
  formatExpectedReply,
  submitHostedQuoteRequest,
  utmFromSearchParams,
} from "@/lib/leads/public-form-payload";

export type RequestQuoteFormProps = {
  slug: string;
  orgName: string;
  services: string[];
  consentText: string;
  responseTargetMinutes: number;
  turnstileSiteKey: string | null;
};

export function RequestQuoteForm({
  slug,
  orgName,
  services,
  consentText,
  responseTargetMinutes,
  turnstileSiteKey,
}: RequestQuoteFormProps) {
  const startedAt = useRef<number | null>(null);
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [contactName, setContactName] = useState("");
  const [addressTyped, setAddressTyped] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [preferredContact, setPreferredContact] = useState<"phone" | "email" | "either" | "">("");
  const [isBusiness, setIsBusiness] = useState(false);
  const [smsConsent, setSmsConsent] = useState(false);
  const [heardAbout, setHeardAbout] = useState("");
  const [heardAboutOther, setHeardAboutOther] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const turnstileRef = useRef<HTMLDivElement>(null);

  function markFormStarted() {
    if (startedAt.current == null) startedAt.current = Date.now();
  }

  useEffect(() => {
    if (!turnstileSiteKey || !turnstileRef.current) return;
    const w = window as Window & {
      turnstile?: {
        render: (
          el: HTMLElement,
          opts: { sitekey: string; callback: (token: string) => void },
        ) => void;
      };
    };
    const mount = () => {
      if (!turnstileRef.current || !w.turnstile) return;
      w.turnstile.render(turnstileRef.current, {
        sitekey: turnstileSiteKey,
        callback: (token) => setTurnstileToken(token),
      });
    };
    if (w.turnstile) {
      mount();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = mount;
    document.head.appendChild(script);
  }, [turnstileSiteKey]);

  function toggleService(service: string) {
    setSelectedServices((prev) =>
      prev.includes(service) ? prev.filter((item) => item !== service) : [...prev, service],
    );
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    markFormStarted();
    const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    const utm = utmFromSearchParams(params);
    const body = buildHostedIntakeBody({
      slug,
      contactName,
      addressTyped,
      phone,
      email,
      services: selectedServices,
      note,
      preferredContact,
      isBusiness,
      smsConsent,
      heardAbout,
      heardAboutOther,
      turnstileToken: turnstileToken || (turnstileSiteKey ? "" : "dev-missing-site-key"),
      honeypot,
      formStartedAtMs: startedAt.current ?? Date.now(),
      ...utm,
      referrer: typeof document !== "undefined" ? document.referrer || null : null,
      landingPage: typeof window !== "undefined" ? window.location.href : null,
    });

    startTransition(async () => {
      const result = await submitHostedQuoteRequest(body);
      if (!result.ok) {
        setError("Something went wrong. Please try again.");
        return;
      }
      setDone(true);
    });
  }

  if (done) {
    return (
      <div data-testid="quote-request-confirmation" className="grid gap-3">
        <h2 className="text-2xl font-semibold tracking-tight">Request received</h2>
        <p className="text-muted-foreground">
          Thanks — {orgName} got your request. {formatExpectedReply(responseTargetMinutes)}
        </p>
      </div>
    );
  }

  return (
    <form
      data-testid="quote-request-form"
      data-phone-width
      className="mx-auto grid w-full max-w-md gap-4"
      onSubmit={onSubmit}
      noValidate
    >
      <Field>
        <FieldLabel htmlFor="address">Service address</FieldLabel>
        <Input
          id="address"
          name="address"
          autoComplete="street-address"
          value={addressTyped}
          placeholder="Street, city, ZIP"
          aria-describedby="request-address-hint"
          className="h-12 w-full"
          required
          onChange={(event) => {
            markFormStarted();
            const next = event.target.value;
            setAddressTyped(next);
          }}
        />
        <FieldHint id="request-address-hint">The lawn you want us to look at.</FieldHint>
      </Field>

      <Field>
        <FieldLabel>Services</FieldLabel>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Services" aria-describedby="request-services-hint">
          {services.map((service) => {
            const on = selectedServices.includes(service);
            return (
              <Button
                key={service}
                type="button"
                variant={on ? "default" : "outline"}
                aria-pressed={on}
                className="h-11"
                onClick={() => toggleService(service)}
              >
                {service}
              </Button>
            );
          })}
        </div>
        <FieldHint id="request-services-hint">The work you want done.</FieldHint>
      </Field>

      <Field>
        <FieldLabel htmlFor="note">Note (optional)</FieldLabel>
        <Textarea id="note" name="note" aria-describedby="request-note-hint" className="w-full" value={note} onChange={(event) => setNote(event.target.value)} rows={3} />
        <FieldHint id="request-note-hint">Anything else we should know before we visit.</FieldHint>
      </Field>

      <Field>
        <FieldLabel htmlFor="contact_name">Your name</FieldLabel>
        <Input
          id="contact_name"
          name="contact_name"
          autoComplete="name"
          aria-describedby="request-name-hint"
          className="h-12 w-full"
          required
          value={contactName}
          onChange={(event) => setContactName(event.target.value)}
        />
        <FieldHint id="request-name-hint">The name we use when we reply.</FieldHint>
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="phone">Phone</FieldLabel>
          <Input
            id="phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            aria-describedby="request-phone-hint"
            className="h-12 w-full"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
          <FieldHint id="request-phone-hint">A number we can call or text.</FieldHint>
        </Field>
        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            aria-describedby="request-email-hint"
            className="h-12 w-full"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <FieldHint id="request-email-hint">Where we email the reply.</FieldHint>
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor="preferred_contact">Preferred contact</FieldLabel>
        <NativeSelect
          id="preferred_contact"
          aria-describedby="request-contact-hint"
          name="preferred_contact"
          value={preferredContact}
          onChange={(event) =>
            setPreferredContact(event.target.value as "phone" | "email" | "either" | "")
          }
        >
          <option value="">No preference</option>
          <option value="phone">Phone</option>
          <option value="email">Email</option>
          <option value="either">Either</option>
        </NativeSelect>
        <FieldHint id="request-contact-hint">How you want us to reply.</FieldHint>
      </Field>

      <div className="flex min-w-0 flex-col gap-1">
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="is_business"
          className="mt-1"
          aria-describedby="request-business-hint"
          checked={isBusiness}
          onChange={(event) => setIsBusiness(event.target.checked)}
        />
        This is for a business or HOA
      </label>
      <FieldHint id="request-business-hint">Marks this request as a business or HOA.</FieldHint>
      </div>

      <Field>
        <FieldLabel htmlFor="heard_about">How did you hear about us?</FieldLabel>
        <NativeSelect
          id="heard_about"
          aria-describedby="request-heard-hint"
          name="heard_about"
          value={heardAbout}
          onChange={(event) => {
            const next = event.target.value;
            setHeardAbout(next);
            if (next !== "Other") setHeardAboutOther("");
          }}
        >
          <option value="">Choose one</option>
          {LEAD_SOURCES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </NativeSelect>
        <FieldHint id="request-heard-hint">How you found us.</FieldHint>
        {heardAbout === "Other" ? (
          <>
          <Input
            className="mt-2 h-12 w-full"
            name="heard_about_other"
            aria-label="Other source details"
            aria-describedby="request-heard-other-hint"
            value={heardAboutOther}
            onChange={(event) => setHeardAboutOther(event.target.value)}
          />
          <FieldHint id="request-heard-other-hint">The source name when it is not in the list.</FieldHint>
          </>
        ) : null}
      </Field>

      <label className="flex items-start gap-2 text-sm leading-snug" data-testid="sms-consent">
        <input
          type="checkbox"
          name="sms_consent"
          className="mt-1"
          aria-describedby="request-sms-hint"
          checked={smsConsent}
          onChange={(event) => setSmsConsent(event.target.checked)}
        />
        <span>{consentText}</span>
      </label>
      <FieldHint id="request-sms-hint">Lets us text you about this request.</FieldHint>

      <p className="text-sm text-muted-foreground">
        <a href="#privacy-notice" className="underline underline-offset-2">
          Privacy notice
        </a>
      </p>

      <div
        className="absolute left-[-10000px] h-px w-px overflow-hidden"
        aria-hidden="true"
      >
        <label>
          Website
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(event) => setHoneypot(event.target.value)}
          />
        </label>
      </div>

      {turnstileSiteKey ? (
        <div ref={turnstileRef} data-testid="turnstile" />
      ) : (
        <input type="hidden" name="turnstileToken" value={turnstileToken} readOnly />
      )}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Button type="submit" className="h-12 w-full" disabled={pending}>
        {pending ? "Sending…" : "Request a quote"}
      </Button>
    </form>
  );
}
