/** IP (charset-checked) and user agent to forward with a public signature. */
export function signerAuditHeaders(hdrs: Headers): Record<string, string> {
  const forwarded = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim();
  const raw = forwarded || hdrs.get("x-real-ip")?.trim() || "";
  const ip = raw && /^[0-9a-fA-F:.]+$/.test(raw) ? raw : "";
  const userAgent = hdrs.get("user-agent");
  const headers: Record<string, string> = {};
  if (ip) headers["x-forwarded-for"] = ip;
  if (userAgent) headers["user-agent"] = userAgent;
  return headers;
}
