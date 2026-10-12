export const WISETACK_NOT_CONNECTED = "Not connected - add a Wisetack key to enable.";

/** Financing link for proposals of $500 or more. Unset URL means the feature is off. */
export function wisetackHref(prequalUrl: string | null | undefined, amountDollars: number): string | null {
  const url = prequalUrl?.trim();
  if (!url) return null;
  if (!Number.isFinite(amountDollars) || amountDollars < 500) return null;
  return url;
}
