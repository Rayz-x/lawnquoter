"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/money";
import { commitMoneyOnBlur } from "@/lib/quotes/money-commit";
import { showSavedMoneyToast } from "@/lib/quotes/show-saved-money-toast";

export function MoneyBlurInput({
  value,
  ariaLabel,
  disabled,
  className,
  onCommit,
}: {
  value: number;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
  onCommit: (amount: number) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [draft, setDraft] = useState(() => formatMoneyDraft(value));
  const [baseline, setBaseline] = useState(value);
  const [pending, startTransition] = useTransition();

  if (baseline !== value) {
    setBaseline(value);
    setDraft(formatMoneyDraft(value));
  }

  function commit() {
    startTransition(async () => {
      const result = await commitMoneyOnBlur({
        previous: value,
        draft,
        save: onCommit,
        toast: ({ amount, onUndo }) => {
          showSavedMoneyToast(amount, async () => {
            const undone = await onUndo();
            if (!undone.ok) toast.error(undone.error);
          });
        },
      });
      if (!result.ok) {
        toast.error(result.error);
        setDraft(formatMoneyDraft(value));
        return;
      }
      setBaseline(result.amount);
      setDraft(formatMoneyDraft(result.amount));
    });
  }

  return (
    <Input
      aria-label={ariaLabel}
      inputMode="decimal"
      value={draft}
      disabled={disabled || pending}
      className={className}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function formatMoneyDraft(amount: number) {
  return formatMoney(amount, { cents: true }).replace(/^\$/, "");
}
