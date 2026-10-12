import { CATALOG_SEED_V1 } from "@lawnquoter/pricing-engine";

export const WIZARD_STEPS = ["company", "branding", "services", "team", "area"] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

const ZIP = /^\d{5}$/;

export function parseServiceZips(raw: string): { ok: true; zips: string[] } | { ok: false; error: string } {
  const parts = raw.split(/[\s,]+/).map((part) => part.trim()).filter(Boolean);
  if (parts.some((part) => !ZIP.test(part))) return { ok: false, error: "Use 5-digit ZIP codes, separated by commas." };
  const zips: string[] = [];
  for (const part of parts) if (!zips.includes(part)) zips.push(part);
  return { ok: true, zips };
}

export function catalogStarterPicks(keys: string[]): { ok: true; picks: { key: string; price: number }[] } {
  const picks = [];
  for (const key of keys) {
    const entry = CATALOG_SEED_V1.find((item) => item.key === key);
    if (!entry) continue;
    picks.push({ key: entry.key, price: entry.starter.typical });
  }
  return { ok: true, picks };
}

/** Skip installs nothing. A checked box is priced at the catalog typical price. */
export function wizardServiceInstall(skip: boolean, keys: string[]): { key: string; price: number }[] {
  if (skip) return [];
  return catalogStarterPicks(keys).picks;
}

function settingsRecord(settings: unknown): Record<string, unknown> {
  return settings && typeof settings === "object" && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {};
}

/** Existing companies have no onboarding flag and stay finished. A new company stores the step it is on. */
export function resumeOnboarding(input: { hasOrg: boolean; settings: unknown }): WizardStep | "done" {
  if (!input.hasOrg) return "company";
  const settings = settingsRecord(input.settings);
  if (settings.onboarding_complete === true) return "done";
  const step = settings.onboarding_step;
  if (typeof step === "string" && (WIZARD_STEPS as readonly string[]).includes(step)) return step as WizardStep;
  return "done";
}
