import { describe, expect, it, vi } from "vitest";
import { LEAD_INTAKE_IP_LIMIT } from "./submit-request";
import { instantQuoteWriteAllowed } from "./instant-quote-guard";

const deps = () => ({
  verifyTurnstile: vi.fn(async () => true),
  countRecentByIpHash: vi.fn(async () => 0),
  countRecentByOrg: vi.fn(async () => 0),
  nowMs: () => Date.parse("2026-10-12T00:00:00Z"),
});

const input = {
  turnstileToken: "token-ok",
  honeypot: "",
  clientIp: "203.0.113.4",
  orgId: "org-1",
};

describe("instantQuoteWriteAllowed", () => {
  it("rejects a missing or failed Turnstile token before counting requests", async () => {
    const missing = deps();
    expect(await instantQuoteWriteAllowed({ ...input, turnstileToken: "  " }, missing)).toBe("turnstile");
    expect(missing.verifyTurnstile).not.toHaveBeenCalled();
    expect(missing.countRecentByIpHash).not.toHaveBeenCalled();

    const failed = deps();
    failed.verifyTurnstile.mockResolvedValue(false);
    expect(await instantQuoteWriteAllowed(input, failed)).toBe("turnstile");
    expect(failed.countRecentByOrg).not.toHaveBeenCalled();
  });

  it("rejects the same hourly limits as public intake", async () => {
    const limited = deps();
    limited.countRecentByIpHash.mockResolvedValue(LEAD_INTAKE_IP_LIMIT);
    expect(await instantQuoteWriteAllowed(input, limited)).toBe("rate_limit");
  });

  it("rejects a filled honeypot after Turnstile and the rate limit pass", async () => {
    const bot = deps();
    expect(await instantQuoteWriteAllowed({ ...input, honeypot: "http://spam.test" }, bot)).toBe("honeypot");
    expect(bot.verifyTurnstile).toHaveBeenCalledWith("token-ok", "203.0.113.4");
    expect(bot.countRecentByIpHash).toHaveBeenCalled();
  });

  it("allows a checked request", async () => {
    expect(await instantQuoteWriteAllowed(input, deps())).toBe("ok");
  });
});
