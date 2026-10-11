import { formatMoney } from "@/lib/money";

export type MoneyParseResult =
  | { ok: true; amount: number }
  | { ok: false; error: string };

const MONEY_PATTERN = /^\d+(\.\d{1,2})?$/;

/** Toast body for a money blur commit. Undo is a separate toast action. */
export function savedMoneyToastCopy(amount: number) {
  return `Saved ${formatMoney(amount, { cents: true })} · Undo`;
}

/** Parse a money draft from an input. Strips $ and commas. */
export function parseMoneyDraft(draft: string): MoneyParseResult {
  const cleaned = draft.trim().replace(/[$,]/g, "");
  if (!cleaned) return { ok: false, error: "Enter a price of 0 or more, with up to 2 decimals." };
  if (!MONEY_PATTERN.test(cleaned)) {
    return { ok: false, error: "Enter a price of 0 or more, with up to 2 decimals." };
  }
  const amount = Number(cleaned);
  if (!Number.isFinite(amount) || amount < 0) {
    return { ok: false, error: "Enter a price of 0 or more, with up to 2 decimals." };
  }
  return { ok: true, amount };
}

function sameMoney(a: number, b: number) {
  return Math.round(a * 100) === Math.round(b * 100);
}

export type MoneyCommitOk =
  | { ok: true; amount: number; unchanged: true }
  | { ok: true; amount: number; unchanged?: false };

export type MoneyCommitFail = { ok: false; error: string };

/**
 * Commit a money field on blur. Unchanged drafts are a no-op. On success, show
 * `Saved $X.XX · Undo` and let Undo write the previous value back.
 */
export async function commitMoneyOnBlur({
  previous,
  draft,
  save,
  toast,
}: {
  previous: number;
  draft: string;
  save: (amount: number) => Promise<{ ok: true } | { ok: false; error: string }>;
  toast: (opts: {
    amount: number;
    message: string;
    onUndo: () => Promise<{ ok: true } | { ok: false; error: string }>;
  }) => void;
}): Promise<MoneyCommitOk | MoneyCommitFail> {
  const parsed = parseMoneyDraft(draft);
  if (!parsed.ok) return parsed;
  if (sameMoney(parsed.amount, previous)) {
    return { ok: true, amount: parsed.amount, unchanged: true };
  }
  const result = await save(parsed.amount);
  if (!result.ok) return result;
  const committed = previous;
  toast({
    amount: parsed.amount,
    message: savedMoneyToastCopy(parsed.amount),
    onUndo: () => save(committed),
  });
  return { ok: true, amount: parsed.amount };
}
