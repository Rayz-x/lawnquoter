import type { LeadReportRow } from "./speed-to-lead-report";

/** Raw lead_requests-shaped row (L01). Local contract — not database.types. */
export type LeadRequestReportRaw = {
  created_at: string;
  first_contacted_at: string | null;
  /** Attribution source (L01 `lead_requests.source`). */
  source: string | null;
  status: string | null;
  quote_id: string | null;
  account_id: string | null;
};

export function isMissingLeadRequestsRelation(message: string | undefined): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes("lead_requests") &&
    (lower.includes("does not exist") ||
      lower.includes("could not find") ||
      lower.includes("schema cache") ||
      lower.includes("relation"))
  );
}

/** Map a lead_requests row; spam excluded. Conversion from status or links. */
export function mapLeadRequestToReportRow(row: LeadRequestReportRaw): LeadReportRow | null {
  if (!row.created_at) return null;
  const status = (row.status ?? "").toLowerCase();
  if (status === "spam") return null;
  const source = row.source;
  const converted =
    status === "won" ||
    status === "quoted" ||
    row.quote_id != null ||
    row.account_id != null;
  return {
    source,
    createdAt: row.created_at,
    firstContactedAt: row.first_contacted_at,
    converted,
  };
}
