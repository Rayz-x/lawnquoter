"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { proposeEnhancement } from "@/lib/actions/enhancement";

export function EnhancementForm({ agreementId }: { agreementId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await proposeEnhancement({ agreementId, title });
          if (result.ok) {
            toast.success("Enhancement proposal created");
            setTitle("");
            router.push(`/quotes/${result.data.quoteId}`);
          } else toast.error(result.error);
        });
      }}
    >
      <Input aria-label="Enhancement" placeholder="Mulch the beds" value={title} onChange={(event) => setTitle(event.target.value)} required />
      <Button type="submit" variant="outline" disabled={pending}>
        Propose enhancement
      </Button>
    </form>
  );
}
