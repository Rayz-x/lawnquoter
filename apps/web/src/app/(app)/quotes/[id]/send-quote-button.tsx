"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { sendQuote } from "../actions";

export function SendQuoteButton({ quoteId, status }: { quoteId: string; token?: string; status: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await sendQuote(quoteId);
          if (r.ok) {
            toast.success("Proposal link ready");
            await navigator.clipboard.writeText(r.data.url).catch(() => undefined);
          } else toast.error(r.error);
        })
      }
    >
      {pending ? <Spinner data-icon="inline-start" /> : null}
      {status === "draft" ? "Send proposal" : "Copy proposal link"}
    </Button>
  );
}
