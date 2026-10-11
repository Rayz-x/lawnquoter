import { beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const harness = vi.hoisted(() => {
  const hdrs = new Headers();
  const rpc = vi.fn();
  const createClient = vi.fn<(options?: { headers?: Record<string, string> }) => Promise<{ rpc: typeof rpc }>>(
    async () => ({ rpc }),
  );
  return { hdrs, rpc, createClient };
});

vi.mock("next/headers", () => ({
  headers: async () => harness.hdrs,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: (options?: { headers?: Record<string, string> }) => harness.createClient(options),
}));

import { acceptChangeOrder } from "./actions";

function acceptForm() {
  const fd = new FormData();
  fd.set("signer_name", "Pat Customer");
  fd.set("signer_email", "pat@example.com");
  fd.set("disclosure", "on");
  return fd;
}

beforeEach(() => {
  for (const key of [...harness.hdrs.keys()]) harness.hdrs.delete(key);
  harness.rpc.mockReset();
  harness.createClient.mockClear();
  harness.rpc.mockResolvedValue({
    data: { ok: true, already: false, document_hash: "co-hash", new_cap_cents: 15000 },
    error: null,
  });
});

describe("acceptChangeOrder", () => {
  it("accepts a change order via the public token and returns the raised cap", async () => {
    harness.hdrs.set("x-forwarded-for", "198.51.100.4");

    const result = await acceptChangeOrder(TOKEN, acceptForm());

    expect(harness.createClient).toHaveBeenCalledWith({
      headers: { "x-forwarded-for": "198.51.100.4" },
    });
    expect(harness.rpc).toHaveBeenCalledWith("change_order_accept", {
      p_token: TOKEN,
      p_signer_name: "Pat Customer",
      p_signer_email: "pat@example.com",
      p_disclosure: true,
    });
    expect(result).toEqual({
      ok: true,
      data: { hash: "co-hash", already: false, newCapCents: 15000 },
    });
  });

  it("rejects when the ESIGN disclosure is missing", async () => {
    const fd = new FormData();
    fd.set("signer_name", "Pat Customer");
    fd.set("signer_email", "pat@example.com");

    const result = await acceptChangeOrder(TOKEN, fd);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/disclosure/i);
    }
    expect(harness.rpc).not.toHaveBeenCalled();
  });
});
