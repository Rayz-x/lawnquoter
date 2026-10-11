/**
 * L01 tables used when marking a lead lost or reopening it.
 *
 * - public.lead_requests (status, lost_reason, lost_note, …)
 * - public.lead_activities (kind, summary, meta, …)
 *
 * Status enum: new | contacted | quoted | won | lost | spam
 */
export const L01_LEAD_TABLES = ["lead_requests", "lead_activities"] as const;
