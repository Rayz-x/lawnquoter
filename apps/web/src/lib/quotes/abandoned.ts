export const ABANDONED_DAYS = 2;

export function isAbandonedQuote(input: {
  status: string;
  viewedAt: string | null;
  replied: boolean;
  alreadySent: boolean;
  asOfMs: number;
}): boolean {
  if (input.alreadySent || input.replied || input.status !== "viewed" || !input.viewedAt) return false;
  const viewed = Date.parse(input.viewedAt);
  if (Number.isNaN(viewed)) return false;
  return input.asOfMs - viewed >= ABANDONED_DAYS * 86_400_000;
}
