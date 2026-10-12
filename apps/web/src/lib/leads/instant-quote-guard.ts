import {
  LEAD_INTAKE_IP_LIMIT,
  LEAD_INTAKE_ORG_LIMIT,
  LEAD_INTAKE_WINDOW_MS,
  hashClientIp,
} from "./submit-request";

export type InstantQuoteGuardResult = "ok" | "turnstile" | "honeypot" | "rate_limit";

/** Same order as public intake: Turnstile, then the hourly caps, then the honeypot. */
export async function instantQuoteWriteAllowed(
  input: {
    turnstileToken: string;
    honeypot: string;
    clientIp: string | null;
    orgId: string;
  },
  deps: {
    verifyTurnstile: (token: string, ip: string | null) => Promise<boolean>;
    countRecentByIpHash: (orgId: string, ipHash: string, sinceIso: string) => Promise<number>;
    countRecentByOrg: (orgId: string, sinceIso: string) => Promise<number>;
    nowMs: () => number;
  },
): Promise<InstantQuoteGuardResult> {
  const token = input.turnstileToken.trim();
  if (!token) return "turnstile";
  const verified = await deps.verifyTurnstile(token, input.clientIp);
  if (!verified) return "turnstile";

  const sinceIso = new Date(deps.nowMs() - LEAD_INTAKE_WINDOW_MS).toISOString();
  const ipHash = hashClientIp(input.clientIp);
  const [ipCount, orgCount] = await Promise.all([
    deps.countRecentByIpHash(input.orgId, ipHash, sinceIso),
    deps.countRecentByOrg(input.orgId, sinceIso),
  ]);
  if (ipCount >= LEAD_INTAKE_IP_LIMIT || orgCount >= LEAD_INTAKE_ORG_LIMIT) return "rate_limit";
  if (input.honeypot.trim()) return "honeypot";
  return "ok";
}
