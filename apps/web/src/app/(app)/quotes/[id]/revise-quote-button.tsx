"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { reviseQuote } from "../actions";

export function ReviseQuoteButton({ quoteId }: { quoteId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await reviseQuote(quoteId);
          if (result.ok) {
            toast.success("Revision started. Send it again when the changes are ready.");
            router.refresh();
          } else toast.error(result.error);
        })
      }
    >
      {pending ? <Spinner data-icon="inline-start" /> : null}
      Revise
    </Button>
  );
}
