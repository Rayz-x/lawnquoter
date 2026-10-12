/** The fixture is on only when E2E_MODE=1, and never on Vercel production. */
export function e2eEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.VERCEL_ENV === "production") return false;
  return env.E2E_MODE === "1";
}
