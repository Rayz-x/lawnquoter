/** Canonical account lead-source picklist (human-readable stored values). */

export const WEBSITE_FORM_SOURCE = "Website form" as const;

/** User-selectable values — never includes Website form. */
export const LEAD_SOURCES = [
  "Google",
  "Referral",
  "Door hanger",
  "Yard sign",
  "Repeat",
  "Other",
] as const;

export type UserLeadSource = (typeof LEAD_SOURCES)[number];
export type LeadSource = UserLeadSource | typeof WEBSITE_FORM_SOURCE;

export type LeadSourceOk = {
  ok: true;
  lead_source: LeadSource | null;
  lead_source_other: string | null;
};

export type LeadSourceErr = { ok: false; error: string };

const USER_SET = new Set<string>(LEAD_SOURCES);

export function parseLeadSource(source: string, other: string): LeadSourceOk | LeadSourceErr {
  const lead_source = source.trim();
  const lead_source_other = other.trim();

  if (!lead_source) {
    return { ok: true, lead_source: null, lead_source_other: null };
  }

  if (lead_source === WEBSITE_FORM_SOURCE) {
    return { ok: false, error: "Website form lead source can only be set by the system." };
  }

  if (!USER_SET.has(lead_source)) {
    return { ok: false, error: "Choose a lead source from the list." };
  }

  if (lead_source === "Other") {
    if (!lead_source_other) {
      return { ok: false, error: "Describe the lead source when Other is selected." };
    }
    if (lead_source_other.length > 100) {
      return { ok: false, error: "Lead source details are too long." };
    }
    return { ok: true, lead_source: "Other", lead_source_other };
  }

  return { ok: true, lead_source: lead_source as UserLeadSource, lead_source_other: null };
}

export function formatLeadSource(source: string | null, other: string | null): string | null {
  if (!source) return null;
  if (source === "Other" && other?.trim()) return `Other — ${other.trim()}`;
  return source;
}
