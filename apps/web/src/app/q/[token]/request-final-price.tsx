"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { PublicSiteCheck } from "@/lib/quotes/public-quote";
import {
  SITE_CHECK_REQUESTED_BADGE,
  SITE_CHECK_REQUESTED_PENDING,
  SITE_CHECK_REQUEST_CALL_US,
  SITE_CHECK_REQUEST_CTA,
  SITE_CHECK_REQUEST_DECLINED,
  SITE_CHECK_REQUEST_HINT,
  siteCheckRequestWindowCopy,
} from "@/lib/quotes/site-check";
import { cancelFinalPriceRequest, requestFinalPrice } from "./actions";

const AFTER_REQUEST_STEPS = [
  "We check the work on site.",
  "We email and text you the firm price.",
  "You accept that price then — nothing owed until you do.",
];

export function RequestFinalPrice({
  token,
  selectedIds,
  rangedLineNames,
  phone,
  siteCheck,
  canRequest,
  accountCapReached,
  hasSelectedRanged,
}: {
  token: string;
  selectedIds: string[];
  rangedLineNames: string[];
  phone: string | null | undefined;
  siteCheck: PublicSiteCheck | null | undefined;
  canRequest: boolean;
  accountCapReached: boolean;
  hasSelectedRanged: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const status = siteCheck?.status ?? null;
  const openRequest = status === "requested" || status === "scheduled" || status === "open";
  const declined = status === "declined";
  const windowCopy = siteCheckRequestWindowCopy(siteCheck?.window_start, siteCheck?.window_end);

  if (declined) {
    return (
      <section
        className="mt-4 rounded-xl bg-warning/10 p-4 text-sm ring-1 ring-warning/30"
        aria-label="Final price request declined"
      >
        <p className="font-medium text-warning">{SITE_CHECK_REQUEST_DECLINED}</p>
        {siteCheck?.decline_reason ? (
          <p className="mt-1 text-muted-foreground">{siteCheck.decline_reason}</p>
        ) : null}
        {phone ? (
          <p className="mt-2">
            <a className="text-[var(--brand-text)] underline" href={`tel:${phone}`}>
              {phone}
            </a>
          </p>
        ) : null}
      </section>
    );
  }

  if (openRequest) {
    return (
      <section
        className="mt-4 rounded-xl bg-success/10 p-4 text-sm ring-1 ring-success/30"
        aria-label="Final price requested"
      >
        {status === "requested" || !windowCopy ? (
          <p className="font-medium text-success">{SITE_CHECK_REQUESTED_PENDING}</p>
        ) : (
          <>
            <p className="font-medium text-success">{SITE_CHECK_REQUESTED_BADGE}</p>
            <p className="mt-1">{windowCopy}</p>
          </>
        )}
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-muted-foreground">
          {AFTER_REQUEST_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        {siteCheck?.requested_at ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Requested {new Date(siteCheck.requested_at).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
          </p>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await cancelFinalPriceRequest(token);
              if (!result.ok) {
                toast.error(result.error);
                return;
              }
              toast.success("Request cancelled");
              router.refresh();
            })
          }
        >
          {pending ? <Spinner data-icon="inline-start" /> : null}
          Cancel request
        </Button>
      </section>
    );
  }

  if (!hasSelectedRanged) return null;

  if (accountCapReached) {
    return (
      <section className="mt-4 text-sm">
        {phone ? (
          <Button size="lg" variant="outline" render={<a href={`tel:${phone}`} />}>
            {SITE_CHECK_REQUEST_CALL_US}
          </Button>
        ) : (
          <p className="text-muted-foreground">{SITE_CHECK_REQUEST_CALL_US}</p>
        )}
      </section>
    );
  }

  if (!canRequest) return null;

  if (!open) {
    return (
      <section className="mt-4">
        <Button type="button" size="lg" variant="outline" onClick={() => setOpen(true)}>
          {SITE_CHECK_REQUEST_CTA}
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">{SITE_CHECK_REQUEST_HINT}</p>
      </section>
    );
  }

  return (
    <form
      className="mt-4 flex flex-col gap-3 rounded-xl border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const fd = new FormData(event.currentTarget);
        startTransition(async () => {
          const result = await requestFinalPrice(token, fd);
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success(SITE_CHECK_REQUESTED_PENDING);
          setOpen(false);
          router.refresh();
        });
      }}
    >
      {selectedIds.map((id) => (
        <input key={id} type="hidden" name="selected" value={id} />
      ))}
      <h2 className="font-medium">{SITE_CHECK_REQUEST_CTA}</h2>
      <p className="text-sm text-muted-foreground">{SITE_CHECK_REQUEST_HINT}</p>
      {rangedLineNames.length > 0 ? (
        <p className="text-sm">
          We&apos;ll measure:{" "}
          <span className="font-medium">{rangedLineNames.join(", ")}</span>
        </p>
      ) : null}
      <Field>
        <FieldLabel htmlFor="request_email">Email</FieldLabel>
        <Input id="request_email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Field>
        <FieldLabel htmlFor="request_note">Note (optional)</FieldLabel>
        <Textarea
          id="request_note"
          name="note"
          rows={3}
          maxLength={2000}
          placeholder="e.g. side gate is locked on Mondays"
        />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {SITE_CHECK_REQUEST_CTA}
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
