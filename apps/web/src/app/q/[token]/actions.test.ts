import { beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SELECTED_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SELECTED_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const harness = vi.hoisted(() => {
  const hdrs = new Headers();
  const rpc = vi.fn();
  const send = vi.fn(async () => ({ id: "mail-1", sent: true }));
  const createClient = vi.fn<(options?: { headers?: Record<string, string> }) => Promise<{ rpc: typeof rpc }>>(
    async () => ({ rpc }),
  );
  const createEmailProvider = vi.fn(() => ({ send }));
  return { hdrs, rpc, send, createClient, createEmailProvider };
});

vi.mock("next/headers", () => ({
  headers: async () => harness.hdrs,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: (options?: { headers?: Record<string, string> }) => harness.createClient(options),
}));
vi.mock("@/lib/email/provider", () => ({
  createEmailProvider: () => harness.createEmailProvider(),
}));
vi.mock("./proposal-pdf", () => ({ ProposalPdf: vi.fn() }));

import { acceptQuote } from "./actions";

function acceptForm() {
  const fd = new FormData();
  fd.set("signer_name", "Ada Lovelace");
  fd.set("signer_email", "ada@example.com");
  fd.set("disclosure", "on");
  fd.append("selected", SELECTED_A);
  fd.append("selected", SELECTED_B);
  return fd;
}

beforeEach(() => {
  for (const key of [...harness.hdrs.keys()]) harness.hdrs.delete(key);
  harness.rpc.mockReset();
  harness.send.mockClear();
  harness.createClient.mockClear();
  harness.createEmailProvider.mockClear();
  harness.rpc.mockImplementation(async (fn: string) => {
    if (fn === "quote_public") {
      return {
        data: {
          number: 12,
          org: { name: "North Lawn", logo_raster_url: null },
          acceptance: {
            document_hash: "sealed-hash",
            selections: [SELECTED_A, SELECTED_B],
            accepted_at: "2026-10-10T00:00:00.000Z",
            signer_name: "Ada Lovelace",
            signer_email: "ada@example.com",
            accepted_total: 100,
            accepted_not_to_exceed: 100,
            has_ranges: false,
            not_to_exceed_clause: null,
            disclosure_version: "v1",
          },
        },
        error: null,
      };
    }
    return { data: { already: true, document_hash: "sealed-hash" }, error: null };
  });
});

describe("acceptQuote", () => {
  it("sends the hidden selections and client IP to the accept RPC, and does not email an already-accepted quote", async () => {
    harness.hdrs.set("x-forwarded-for", "203.0.113.8, 10.0.0.8");

    const result = await acceptQuote(TOKEN, acceptForm());

    expect(harness.createClient).toHaveBeenCalledTimes(1);
    expect(harness.createClient).toHaveBeenCalledWith({
      headers: { "x-forwarded-for": "203.0.113.8" },
    });
    expect(harness.rpc).toHaveBeenCalledTimes(1);
    expect(harness.rpc).toHaveBeenCalledWith("quote_accept", {
      p_token: TOKEN,
      p_signer_name: "Ada Lovelace",
      p_signer_email: "ada@example.com",
      p_disclosure: true,
      p_selected: [SELECTED_A, SELECTED_B],
    });
    expect(result).toEqual({
      ok: true,
      data: { hash: "sealed-hash", already: true, emailed: false },
    });
    expect(harness.createEmailProvider).not.toHaveBeenCalled();
    expect(harness.send).not.toHaveBeenCalled();
  });
});
