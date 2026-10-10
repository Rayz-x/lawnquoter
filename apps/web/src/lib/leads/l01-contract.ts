/**
 * Expected L01 surface used by L11 (not owned here; no migration in this ticket).
 *
 * Tables:
 * - public.lead_requests (id, org_id, status, quote_id, …)
 * - public.lead_activities (id, org_id, lead_request_id, kind, payload, …)
 *
 * Status enum includes at least: new | contacted | quoted | won | lost | spam
 * Lost reason is stored on activity payload (`lead.lost`), not a dedicated column.
 */
export const L01_LEAD_TABLES = ["lead_requests", "lead_activities"] as const;
