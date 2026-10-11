import "server-only";

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

type SiteverifyResponse = {
  success?: boolean;
};

/** Server-side Cloudflare Turnstile check. Missing secret fails closed. */
export async function verifyTurnstileToken(token: string, ip: string | null): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return false;
  const trimmed = token.trim();
  if (!trimmed) return false;

  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", trimmed);
  if (ip?.trim()) body.set("remoteip", ip.trim());

  try {
    const response = await fetch(SITEVERIFY, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) return false;
    const json = (await response.json()) as SiteverifyResponse;
    return json.success === true;
  } catch {
    return false;
  }
}
