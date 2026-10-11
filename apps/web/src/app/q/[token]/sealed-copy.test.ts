import { beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const LINE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LINE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LINE_IDLE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const CAP = "You pay no more than $42.50";
const RANGE = "Estimated total $0.02 – $0.06";

const harness = vi.hoisted(() => {
  const documents: unknown[] = [];
  const rpc = vi.fn();
  const send = vi.fn(async () => ({ id: "mail-1", sent: true }));
  const createClient = vi.fn(async () => ({ rpc }));
  return { documents, rpc, send, createClient };
});

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.8", "user-agent": "vitest" }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => harness.createClient(),
}));
vi.mock("@/lib/email/provider", () => ({
  createEmailProvider: () => ({ send: harness.send }),
}));
vi.mock("@react-pdf/renderer", async () => {
  const actual = await vi.importActual<typeof import("@react-pdf/renderer")>("@react-pdf/renderer");
  return {
    ...actual,
    renderToBuffer: async (element: unknown) => {
      harness.documents.push(element);
      return Buffer.from("%PDF-1.4");
    },
  };
});

import { acceptQuote } from "./actions";
import { GET } from "./pdf/route";

function quotePayload() {
  return {
    title: "Spring cleanup",
    number: 42,
    intro: null,
    notes_customer: null,
    status: "accepted",
    org: {
      name: "North Lawn",
      phone: 5550199,
      email: null,
      website: null,
      brand_color: "#336699",
      logo_url: null,
      logo_dark_url: null,
      logo_raster_url: null,
      logo_width: null,
      logo_height: null,
      logo_shows_name: null,
      logo_needs_chip: false,
      heading_font: "classic",
    },
    items: [
      {
        id: LINE_A,
        name: "Hedge",
        description: null,
        state: "optional",
        option_group: null,
        option_tier: "none",
        price: 0.01,
        range_low: 0.014,
        range_high: 0.026,
        selected: false,
      },
      {
        id: LINE_B,
        name: "Bed",
        description: null,
        state: "optional",
        option_group: null,
        option_tier: "none",
        price: 0.01,
        range_low: 0.014,
        range_high: 0.026,
        selected: false,
      },
      {
        id: LINE_IDLE,
        name: "Unselected mulch",
        description: null,
        state: "optional",
        option_group: null,
        option_tier: "none",
        price: 500,
        range_low: 400,
        range_high: 600,
        selected: false,
      },
    ],
    acceptance: {
      document_hash: "sealed-hash",
      accepted_at: "2026-10-10T00:00:00.000Z",
      signer_name: "Ada Lovelace",
      signer_email: "ada@example.com",
      accepted_total: 42.5,
      accepted_not_to_exceed: null,
      has_ranges: true,
      not_to_exceed_clause: null,
      disclosure_version: "v1",
      selections: [LINE_A, LINE_B],
    },
  };
}

function acceptForm() {
  const fd = new FormData();
  fd.set("signer_name", "Ada Lovelace");
  fd.set("signer_email", "ada@example.com");
  fd.set("disclosure", "on");
  fd.append("selected", LINE_A);
  fd.append("selected", LINE_B);
  return fd;
}

function textOf(node: unknown): string {
  const parts: string[] = [];
  const visit = (value: unknown) => {
    if (value == null || typeof value === "boolean" || typeof value === "function") return;
    if (typeof value === "string" || typeof value === "number") {
      parts.push(String(value));
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    if (typeof value === "object" && "props" in value) {
      visit((value as { props?: { children?: unknown } }).props?.children);
    }
  };
  visit(node);
  return parts.join("\n");
}

let downloaded = "";
let emailed = "";

beforeEach(async () => {
  harness.documents.length = 0;
  harness.rpc.mockReset();
  harness.send.mockClear();
  harness.createClient.mockClear();
  harness.rpc.mockImplementation(async (fn: string) => {
    if (fn === "quote_public") return { data: quotePayload(), error: null };
    if (fn === "quote_accept") {
      return { data: { ok: true, already: false, document_hash: "sealed-hash" }, error: null };
    }
    return { data: null, error: { message: `unexpected rpc ${fn}` } };
  });

  const response = await GET(new Request(`http://localhost:3000/q/${TOKEN}/pdf`), {
    params: Promise.resolve({ token: TOKEN }),
  });
  expect(response.status).toBe(200);

  const result = await acceptQuote(TOKEN, acceptForm());
  expect(result).toEqual({
    ok: true,
    data: { hash: "sealed-hash", already: false, emailed: true },
  });
  expect(harness.documents).toHaveLength(2);
  downloaded = textOf(harness.documents[0]);
  emailed = textOf(harness.documents[1]);
});

describe("sealed quote copy", () => {
  it("uses the stored total as the cap on both the downloaded PDF and the emailed seal when the stored cap is missing", () => {
    expect(downloaded).toContain(CAP);
    expect(emailed).toContain(CAP);
    expect(downloaded).not.toContain("5550199");
    expect(emailed).not.toContain("5550199");
  });

  it("shows the same cents-rounded range on the downloaded PDF and the emailed seal", () => {
    expect(downloaded).toContain(RANGE);
    expect(emailed).toContain(RANGE);
    expect(downloaded).not.toContain("$400");
    expect(emailed).not.toContain("$400");
  });
});
