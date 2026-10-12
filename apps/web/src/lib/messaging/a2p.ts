import type { TwilioConfig } from "./sms";
import { TWILIO_NOT_CONNECTED } from "./sms";

const PROFILE_POLICY = "RNdfbf3fae0e1107f8aded0e7cead80bf5";
const A2P_POLICY = "RNb0d4771c2c98518d916a3d4cd70a8f8b";

export type A2pDraft = { legalName: string; ein: string; website: string; email: string; sample: string };

export function parseA2pDraft(draft: A2pDraft): { ok: true; value: A2pDraft & { ein: string } } | { ok: false; error: string } {
  const legalName = draft.legalName.trim();
  const ein = draft.ein.replace(/\D/g, "");
  const website = draft.website.trim();
  const email = draft.email.trim();
  const sample = draft.sample.trim();
  if (legalName.length < 2 || legalName.length > 120) return { ok: false, error: "Enter the legal business name." };
  if (!/^[0-9]{9}$/.test(ein)) return { ok: false, error: "Enter the 9-digit EIN." };
  if (!/^https?:\/\//i.test(website)) return { ok: false, error: "Enter a website that starts with http:// or https://." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Enter the business email." };
  if (sample.length < 20 || sample.length > 320) return { ok: false, error: "Enter a sample text between 20 and 320 characters." };
  return { ok: true, value: { legalName, ein, website, email, sample } };
}

export function a2pStep(row: { brandStatus: string; campaignStatus: string }): 0 | 1 | 2 {
  if (row.campaignStatus === "pending" || row.campaignStatus === "approved") return 2;
  if (row.brandStatus === "pending" || row.brandStatus === "approved") return 1;
  return 0;
}

async function postForm(
  config: TwilioConfig,
  url: string,
  params: Record<string, string>,
  fetch: (url: string, init?: RequestInit) => Promise<Response>,
): Promise<{ sid?: string } | null> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
  });
  if (!response.ok) return null;
  return (await response.json()) as { sid?: string };
}

export async function submitA2p(input: {
  config: TwilioConfig | null;
  draft: A2pDraft;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
}): Promise<{ ok: true; brandSid: string; campaignSid: string; messagingServiceSid: string } | { ok: false; error: string }> {
  if (!input.config) return { ok: false, error: TWILIO_NOT_CONNECTED };
  const parsed = parseA2pDraft(input.draft);
  if (!parsed.ok) return parsed;
  const config = input.config;
  const draft = parsed.value;
  const profile = await postForm(config, "https://trusthub.twilio.com/v1/CustomerProfiles", {
    FriendlyName: draft.legalName,
    Email: draft.email,
    PolicySid: PROFILE_POLICY,
  }, input.fetch);
  if (!profile?.sid) return { ok: false, error: "Twilio rejected the business profile." };
  const endUser = await postForm(config, "https://trusthub.twilio.com/v1/EndUsers", {
    FriendlyName: draft.legalName,
    Type: "customer_profile_business_information",
    Attributes: JSON.stringify({
      business_name: draft.legalName,
      business_registration_identifier: "EIN",
      business_registration_number: draft.ein,
      website_url: draft.website,
      business_identity: "direct_customer",
      business_regions_of_operation: "USA_AND_CANADA",
    }),
  }, input.fetch);
  if (!endUser?.sid) return { ok: false, error: "Twilio rejected the business profile." };
  const assigned = await postForm(config, `https://trusthub.twilio.com/v1/CustomerProfiles/${profile.sid}/EntityAssignments`, { ObjectSid: endUser.sid }, input.fetch);
  if (!assigned?.sid) return { ok: false, error: "Twilio rejected the business profile." };
  const trust = await postForm(config, "https://trusthub.twilio.com/v1/TrustProducts", {
    FriendlyName: `${draft.legalName} A2P`,
    Email: draft.email,
    PolicySid: A2P_POLICY,
  }, input.fetch);
  if (!trust?.sid) return { ok: false, error: "Twilio rejected the brand." };
  const trusted = await postForm(config, `https://trusthub.twilio.com/v1/TrustProducts/${trust.sid}/EntityAssignments`, { ObjectSid: endUser.sid }, input.fetch);
  if (!trusted?.sid) return { ok: false, error: "Twilio rejected the brand." };
  const brand = await postForm(config, "https://messaging.twilio.com/v1/a2p/BrandRegistrations", {
    CustomerProfileBundleSid: profile.sid,
    A2PProfileBundleSid: trust.sid,
  }, input.fetch);
  if (!brand?.sid) return { ok: false, error: "Twilio rejected the brand." };
  const service = await postForm(config, "https://messaging.twilio.com/v1/Services", { FriendlyName: draft.legalName }, input.fetch);
  if (!service?.sid) return { ok: false, error: "Twilio rejected the campaign." };
  const campaign = await postForm(config, `https://messaging.twilio.com/v1/Services/${service.sid}/Compliance/Usa2p`, {
    BrandRegistrationSid: brand.sid,
    Description: "Quote, invoice, and appointment texts for this lawn care company.",
    MessageFlow: "Customers opt in on a quote or invoice request.",
    MessageSamples: draft.sample,
    UsAppToPersonUsecase: "LOW_VOLUME",
    HasEmbeddedLinks: "true",
    HasEmbeddedPhone: "false",
  }, input.fetch);
  if (!campaign?.sid) return { ok: false, error: "Twilio rejected the campaign." };
  return { ok: true, brandSid: brand.sid, campaignSid: campaign.sid, messagingServiceSid: service.sid };
}
