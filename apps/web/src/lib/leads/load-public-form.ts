import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import { DEFAULT_LEAD_FORM_SERVICES } from "./public-form-payload";
import { responseTargetMinutes } from "./response-target";

const DEFAULT_CONSENT =
  "I agree to receive SMS updates about my request. Message and data rates may apply. Reply STOP to opt out.";

export type PublicLeadFormOrg = {
  orgId: string;
  orgName: string;
  slug: string;
  services: string[];
  consentText: string;
  responseTargetMinutes: number;
};

function settingsArray(settings: unknown, key: string): string[] {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return [];
  const raw = (settings as Record<string, unknown>)[key];
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function settingsText(settings: unknown, key: string): string | null {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return null;
  const value = (settings as Record<string, unknown>)[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

/** Resolve a non-guessable lead_form_slug to public form props. */
export async function loadPublicLeadForm(slug: string): Promise<PublicLeadFormOrg | null> {
  const trimmed = slug.trim();
  if (!trimmed || trimmed.length > 80) return null;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("orgs")
    .select("id, name, settings")
    .filter("settings->>lead_form_slug", "eq", trimmed)
    .maybeSingle();

  if (error || !data) return null;

  const services = settingsArray(data.settings, "lead_form_services");
  return {
    orgId: String(data.id),
    orgName: data.name?.trim() || "Lawn care",
    slug: trimmed,
    services: services.length ? services : [...DEFAULT_LEAD_FORM_SERVICES],
    consentText: settingsText(data.settings, "lead_consent_text") ?? DEFAULT_CONSENT,
    responseTargetMinutes: responseTargetMinutes(data.settings),
  };
}
