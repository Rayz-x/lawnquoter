"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { textDocument } from "@/lib/messaging/text-document";

export function TextDocumentButton({ purpose, id, label }: { purpose: "quote" | "invoice"; id: string; label: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await textDocument({ purpose, id });
          if (result.ok) toast.success("Text sent");
          else toast.error(result.error);
        })
      }
    >
      {pending ? <Spinner data-icon="inline-start" /> : null}
      {label}
    </Button>
  );
}
