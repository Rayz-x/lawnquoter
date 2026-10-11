"use client";

import { useState, useTransition } from "react";

/**
 * Mount on the I05 public invoice page (`/i/[token]`).
 * Starts Stripe Checkout (card + ACH) on the company's connected account.
 */
export function InvoicePayButton({
  token,
  disabled,
  label = "Pay invoice",
}: {
  token: string;
  disabled?: boolean;
  label?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={disabled || pending}
        className="inline-flex items-center justify-center rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              const response = await fetch(`/api/i/${encodeURIComponent(token)}/checkout`, {
                method: "POST",
              });
              const body = (await response.json().catch(() => ({}))) as {
                url?: string;
                error?: string;
              };
              if (!response.ok || !body.url) {
                setError(body.error ?? "Could not start payment.");
                return;
              }
              window.location.assign(body.url);
            } catch {
              setError("Could not start payment.");
            }
          });
        }}
      >
        {pending ? "Starting…" : label}
      </button>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
