"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { syncQuickBooksLedger } from "./actions";

export function QboSyncButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const result = await syncQuickBooksLedger();
          if (result.ok && result.data) {
            const conflicts = result.data.conflicts > 0 ? ` ${result.data.conflicts} conflicts to review.` : "";
            toast.success(`Pushed ${result.data.pushed} and pulled ${result.data.pulled}.${conflicts}`);
            router.refresh();
          } else if (!result.ok) {
            toast.error(result.error);
          }
        });
      }}
    >
      Sync invoices and payments
    </Button>
  );
}
