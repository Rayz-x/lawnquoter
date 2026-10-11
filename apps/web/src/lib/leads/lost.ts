/** Lost reasons for mark-lost (L11). Status `lost` requires `lost_reason`; Other also requires `lost_note`. */
export const LEAD_LOST_REASONS = [
  "price",
  "competitor",
  "no_response",
  "out_of_area",
  "not_a_fit",
  "spam",
  "other",
] as const;

export type LeadLostReason = (typeof LEAD_LOST_REASONS)[number];

export const LEAD_LOST_REASON_LABELS: Record<LeadLostReason, string> = {
  price: "Price",
  competitor: "Competitor",
  no_response: "No response",
  out_of_area: "Out of area",
  not_a_fit: "Not a fit",
  spam: "Spam",
  other: "Other",
};

export type LeadPipelineStatus = "new" | "contacted" | "quoted" | "won" | "lost" | "spam";

export type LeadLostInput = {
  reason: string | null | undefined;
  note?: string | null | undefined;
};

export type LeadLostValidationError =
  | "reason_required"
  | "note_required_for_other"
  | "invalid_reason";

export function parseLeadLostReason(value: string | null | undefined): LeadLostReason | null {
  if (!value) return null;
  return (LEAD_LOST_REASONS as readonly string[]).includes(value) ? (value as LeadLostReason) : null;
}

/** Rejects mark-lost without a reason; Other requires a non-empty note. */
export function validateMarkLost(input: LeadLostInput): LeadLostValidationError | null {
  const reason = parseLeadLostReason(input.reason?.trim() || null);
  if (!input.reason?.trim()) return "reason_required";
  if (!reason) return "invalid_reason";
  if (reason === "other" && !input.note?.trim()) return "note_required_for_other";
  return null;
}

export function markLostValidationMessage(error: LeadLostValidationError): string {
  switch (error) {
    case "reason_required":
      return "Choose a lost reason.";
    case "note_required_for_other":
      return "Add a note when the reason is Other.";
    case "invalid_reason":
      return "That lost reason is not allowed.";
  }
}

/** Declined/expired quotes linked to an open lead should prompt for a lost reason. */
export function shouldPromptLostForQuote(input: {
  quoteStatus: string;
  leadStatus: LeadPipelineStatus | null;
}): boolean {
  if (input.quoteStatus !== "declined" && input.quoteStatus !== "expired") return false;
  if (!input.leadStatus) return false;
  if (input.leadStatus === "lost" || input.leadStatus === "won" || input.leadStatus === "spam") {
    return false;
  }
  return true;
}

export type LeadRecord = {
  id: string;
  orgId: string;
  status: LeadPipelineStatus;
  lostReason: LeadLostReason | null;
  lostNote: string | null;
};

export type LeadActivityRecord = {
  id: string;
  leadId: string;
  orgId: string;
  kind: string;
  payload: Record<string, unknown>;
};

export type LeadLostStore = {
  getLead(leadId: string): Promise<LeadRecord | null>;
  saveLead(lead: LeadRecord): Promise<void>;
  appendActivity(activity: Omit<LeadActivityRecord, "id"> & { id?: string }): Promise<LeadActivityRecord>;
};

export type MarkLostResult =
  | { ok: true; lead: LeadRecord; activity: LeadActivityRecord }
  | { ok: false; error: string };

export type ReopenLeadResult =
  | { ok: true; lead: LeadRecord; activity: LeadActivityRecord }
  | { ok: false; error: string };

export async function markLeadLost(
  store: LeadLostStore,
  input: { leadId: string; orgId: string; reason: string | null | undefined; note?: string | null },
): Promise<MarkLostResult> {
  const validation = validateMarkLost({ reason: input.reason, note: input.note });
  if (validation) return { ok: false, error: markLostValidationMessage(validation) };

  const reason = parseLeadLostReason(input.reason!.trim())!;
  const note = input.note?.trim() || null;
  const lead = await store.getLead(input.leadId);
  if (!lead || lead.orgId !== input.orgId) return { ok: false, error: "Lead not found." };
  if (lead.status === "won") return { ok: false, error: "Won leads cannot be marked lost." };
  if (lead.status === "lost") return { ok: false, error: "This lead is already lost." };

  const next: LeadRecord = {
    ...lead,
    status: "lost",
    lostReason: reason,
    lostNote: note,
  };
  await store.saveLead(next);
  const activity = await store.appendActivity({
    leadId: lead.id,
    orgId: input.orgId,
    kind: "lead.lost",
    payload: { reason, note, previous_status: lead.status },
  });
  return { ok: true, lead: next, activity };
}

export async function reopenLead(
  store: LeadLostStore,
  input: { leadId: string; orgId: string },
): Promise<ReopenLeadResult> {
  const lead = await store.getLead(input.leadId);
  if (!lead || lead.orgId !== input.orgId) return { ok: false, error: "Lead not found." };
  if (lead.status !== "lost") return { ok: false, error: "Only lost leads can be reopened." };

  const next: LeadRecord = {
    ...lead,
    status: "contacted",
    lostReason: null,
    lostNote: null,
  };
  await store.saveLead(next);
  const activity = await store.appendActivity({
    leadId: lead.id,
    orgId: input.orgId,
    kind: "lead.reopened",
    payload: { previous_status: "lost", previous_reason: lead.lostReason, previous_note: lead.lostNote },
  });
  return { ok: true, lead: next, activity };
}
