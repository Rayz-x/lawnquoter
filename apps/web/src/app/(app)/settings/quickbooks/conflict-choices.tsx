"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { resolveQboConflict } from "./actions";

export function QboConflictChoices({ conflictId, canResolve }: { conflictId: string; canResolve: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (!canResolve) return null;
  const choose = (choice: "kept_ours" | "kept_theirs") => {
    startTransition(async () => {
      const result = await resolveQboConflict(conflictId, choice);
      if (result.ok) {
        toast.success(choice === "kept_ours" ? "Kept this company's version" : "Kept QuickBooks");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };
  return (
    <div className="flex gap-2">
      <Button type="button" size="sm" disabled={pending} onClick={() => choose("kept_ours")}>
        Keep ours
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => choose("kept_theirs")}>
        Keep QuickBooks
      </Button>
    </div>
  );
}
