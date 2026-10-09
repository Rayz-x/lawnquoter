/** Shown when an accepted quote cannot be deleted. Matches the database guard. */
export const ACCEPTED_QUOTE_DELETE_ERROR = "Accepted quotes cannot be deleted.";

export function deleteQuoteError(status: string): string | null {
  if (status === "accepted") return ACCEPTED_QUOTE_DELETE_ERROR;
  return null;
}
