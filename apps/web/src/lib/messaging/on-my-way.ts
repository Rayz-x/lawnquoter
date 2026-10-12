import { renderTemplate, suggestedTemplate } from "./template";
import { mayText, toE164, TWILIO_NOT_CONNECTED } from "./sms";

const OPEN = new Set(["scheduled", "in_progress", "paused"]);

/** Office can text. A crew member can text only as the live lead for that stop's crew. */
export function crewMayTextOnMyWay(input: {
  office: boolean;
  role: string;
  userId: string;
  active: boolean;
  crewKnown: boolean;
  openLeadId: string | null;
  defaultLeadId: string | null;
}): boolean {
  if (input.office) return true;
  if (!input.crewKnown || input.role !== "crew_lead" || !input.active) return false;
  return (input.openLeadId ?? input.defaultLeadId) === input.userId;
}

export function onMyWayText(input: {
  templateBody: string | null;
  company: string;
  address: string;
  phone: string | null;
  optedIn: boolean;
  inbound: boolean;
  connected: boolean;
  status: string;
}): { ok: true; to: string; body: string } | { ok: false; error: string } {
  if (!input.connected) return { ok: false, error: TWILIO_NOT_CONNECTED };
  if (!OPEN.has(input.status)) return { ok: false, error: "On my way is only for a stop that has not finished." };
  const address = input.address.trim();
  if (!address) return { ok: false, error: "This stop has no street address." };
  const to = input.phone ? toE164(input.phone) : null;
  if (!to) return { ok: false, error: "Add a mobile number on this account before texting." };
  const allowed = mayText({ optedIn: input.optedIn, inbound: input.inbound });
  if (!allowed.ok) return allowed;
  const source = input.templateBody?.trim() || suggestedTemplate("sms", "on_my_way").body;
  const body = renderTemplate(source, { company: input.company, address, customerName: "", link: "", amount: "" });
  if (!body.trim() || body.length > 1600) return { ok: false, error: "Enter a text up to 1,600 characters." };
  return { ok: true, to, body };
}
