import { createHmac, timingSafeEqual } from "node:crypto";

export const LEAD_CONNECTORS = [
  { id: "google_lsa", label: "Google Local Services", env: "GOOGLE_LSA_WEBHOOK_SECRET", source: "Google" },
  { id: "thumbtack", label: "Thumbtack", env: "THUMBTACK_WEBHOOK_SECRET", source: "Thumbtack" },
  { id: "yelp", label: "Yelp", env: "YELP_WEBHOOK_SECRET", source: "Yelp" },
  { id: "angi", label: "Angi", env: "ANGI_WEBHOOK_SECRET", source: "Angi" },
  { id: "zapier", label: "Zapier", env: "INBOUND_LEAD_WEBHOOK_SECRET", source: "Zapier" },
  { id: "facebook", label: "Facebook Lead Ads", env: "FACEBOOK_APP_SECRET", source: "Facebook" },
  { id: "facebook_verify", label: "Facebook Lead Ads verify", env: "FACEBOOK_LEAD_ADS_VERIFY_TOKEN", source: "Facebook" },
  { id: "facebook_page", label: "Facebook Lead Ads fields", env: "FACEBOOK_PAGE_ACCESS_TOKEN", source: "Facebook" },
] as const;

const BEARER_CONNECTOR_IDS = new Set<LeadConnectorId>(["google_lsa", "thumbtack", "yelp", "angi", "zapier"]);

export type LeadConnectorId = (typeof LEAD_CONNECTORS)[number]["id"];

export type LeadConnectorState = {
  id: LeadConnectorId;
  label: string;
  env: string;
  source: string;
  connected: boolean;
  message: string;
};

export type InboundLead = {
  contactName: string;
  phone: string | null;
  email: string | null;
  address: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
};

export function leadConnectorStates(env: Record<string, string | undefined>): LeadConnectorState[] {
  return LEAD_CONNECTORS.map((connector) => {
    const connected = Boolean(env[connector.env]?.trim());
    return {
      ...connector,
      connected,
      message: connected ? "Connected" : `Not connected — add ${connector.env} to enable`,
    };
  });
}

export function bearerConnector(id: string) {
  const connector = LEAD_CONNECTORS.find((item) => item.id === id) ?? null;
  if (!connector || !BEARER_CONNECTOR_IDS.has(connector.id)) return null;
  return connector;
}

function clip(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

export function parseInboundLead(body: Record<string, unknown>): InboundLead | null {
  const contactName = clip(body.contactName ?? body.name ?? body.full_name, 200);
  const phone = clip(body.phone ?? body.phone_number, 40);
  const email = clip(body.email, 320);
  if (!contactName || (!phone && !email)) return null;
  if (phone && phone.length < 3) return null;
  if (email && !email.includes("@")) return null;
  return {
    contactName,
    phone: phone && phone.length >= 3 ? phone : null,
    email: email && email.includes("@") ? email : null,
    address: clip(body.address ?? body.street, 500) ?? "Not provided",
    utmSource: clip(body.utmSource ?? body.utm_source, 200),
    utmMedium: clip(body.utmMedium ?? body.utm_medium, 200),
    utmCampaign: clip(body.utmCampaign ?? body.utm_campaign, 200),
  };
}

export function inboundLeadRow(orgId: string, source: string, lead: InboundLead) {
  return {
    org_id: orgId,
    contact_name: lead.contactName,
    phone: lead.phone,
    email: lead.email,
    address_typed: lead.address,
    source,
    needs_address_check: lead.address === "Not provided",
    utm_source: lead.utmSource,
    utm_medium: lead.utmMedium,
    utm_campaign: lead.utmCampaign,
  };
}

function sameSecret(expected: string, provided: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function inboundAuthDecision(
  secret: string | undefined,
  authorization: string | null,
  secretName: string,
): { ok: true } | { ok: false; status: 503 | 401; message: string } {
  const expected = secret?.trim();
  if (!expected) return { ok: false, status: 503, message: `Not connected — add ${secretName} to enable` };
  const provided = authorization?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!provided || !sameSecret(expected, provided)) return { ok: false, status: 401, message: "Unauthorized" };
  return { ok: true };
}

export function facebookSignatureMatches(appSecret: string, rawBody: string, header: string | null): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const digest = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  return sameSecret(`sha256=${digest}`, header.trim());
}
