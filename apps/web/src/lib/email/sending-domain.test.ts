import { describe, expect, it, vi } from "vitest";
import { createSendingDomain, loadSendingDomains, parseSendingDomain, parseSendingDomains, resendApiKey } from "./sending-domain";

const payload = {
  data: [
    {
      id: "dom_1",
      name: "northlawn.example",
      status: "pending",
      records: [
        { record: "SPF", name: "send", type: "TXT", value: "v=spf1 include:amazonses.com ~all", status: "pending" },
        { record: "DKIM", name: "resend._domainkey", type: "TXT", value: "p=from-resend", status: "pending" },
      ],
    },
    { id: 12, name: "skipped.example" },
  ],
};

describe("sending domain", () => {
  it("reads only the records Resend returned", () => {
    const domains = parseSendingDomains(payload);
    expect(domains).toHaveLength(1);
    expect(domains[0]?.records.map((record) => record.purpose)).toEqual(["SPF", "DKIM"]);
    expect(domains[0]?.records[1]?.value).toBe("p=from-resend");
    expect(parseSendingDomains({})).toEqual([]);
    expect(parseSendingDomain(" https://NorthLawn.example/quotes ")).toBeNull();
    expect(parseSendingDomain("mail.northlawn.example")).toBe("mail.northlawn.example");
  });

  it("stays disconnected without a key, including during tests", () => {
    expect(resendApiKey({ NODE_ENV: "test", RESEND_API_KEY: "re_live" })).toBeNull();
    expect(resendApiKey({ NODE_ENV: "production" })).toBeNull();
    expect(resendApiKey({ NODE_ENV: "production", RESEND_API_KEY: " re_live " })).toBe("re_live");
  });

  it("loads a domain detail when the list omits records", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/domains")) {
        return { ok: true, json: async () => ({ data: [{ id: "dom_1", name: "northlawn.example", status: "pending" }] }) };
      }
      return { ok: true, json: async () => ({ id: "dom_1", name: "northlawn.example", status: "verified", records: [{ record: "DKIM", name: "resend._domainkey", type: "TXT", value: "p=detail", status: "verified" }] }) };
    });
    const domains = await loadSendingDomains("re_live", fetchImpl as unknown as typeof fetch);
    expect(domains[0]?.records[0]?.value).toBe("p=detail");
    const created = await createSendingDomain("re_live", "northlawn.example", vi.fn(async () => ({ ok: false })) as unknown as typeof fetch);
    expect(created).toEqual({ ok: false, error: "Resend did not add that domain" });
  });
});
