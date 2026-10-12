export const QUIET_DAYS = 3;

export function isGoneQuiet(input: {
  status: string;
  sentAt: string | null;
  viewedAt: string | null;
  replied: boolean;
  asOfMs: number;
}): boolean {
  if (input.status !== "sent" || input.viewedAt || input.replied || !input.sentAt) return false;
  const sent = Date.parse(input.sentAt);
  if (Number.isNaN(sent)) return false;
  return input.asOfMs - sent >= QUIET_DAYS * 86_400_000;
}
