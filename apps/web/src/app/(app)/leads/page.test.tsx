import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireOrg = vi.hoisted(() =>
  vi.fn(async () => ({
    userId: "user-1",
    email: "crew@example.com" as string | null,
    orgId: "org-1",
    orgRole: "crew" as "owner" | "admin" | "sales" | "dispatcher" | "crew" | "crew_lead" | "read_only",
  })),
);

const listLeadRequests = vi.hoisted(() =>
  vi.fn(async (): Promise<{ ok: true; leads: unknown[] }> => ({
    ok: true,
    leads: [],
  })),
);

vi.mock("next/font/local", () => ({
  default: () => ({ variable: "--font-heading", className: "font" }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => createElement("a", { href }, children),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, refresh() {}, replace() {} }),
}));

vi.mock("@/lib/auth/session", () => ({ requireOrg }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { settings: {} }, error: null }),
          eq: () => ({
            order: async () => ({ data: [], error: null }),
          }),
          order: async () => ({ data: [], error: null }),
          is: async () => ({ data: [{ lead_request_id: "rotting" }], error: null }),
        }),
      }),
    }),
  })),
}));

vi.mock("@/lib/leads/queries", () => ({
  listLeadRequests,
  leadDisplayName: (lead: { contact_name: string | null }) => lead.contact_name ?? "Lead",
}));

vi.mock("@/components/app-shell/page-header", () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: ReactNode }) =>
    createElement("header", null, createElement("h1", null, title), actions),
}));

vi.mock("./manual-lead-dialog", () => ({
  ManualLeadDialog: () => createElement("button", null, "Add phone lead"),
}));

import LeadsPage from "./page";

describe("LeadsPage access", () => {
  beforeEach(() => {
    requireOrg.mockReset();
    listLeadRequests.mockClear();
  });

  it("denies crew on the route and does not query leads", async () => {
    requireOrg.mockResolvedValueOnce({
      userId: "user-1",
      email: "crew@example.com",
      orgId: "org-1",
      orgRole: "crew",
    });

    const html = renderToStaticMarkup(await LeadsPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("Office only");
    expect(html).not.toContain("Add phone lead");
    expect(listLeadRequests).not.toHaveBeenCalled();
  });

  it("lists a manual lead at the top for office roles", async () => {
    requireOrg.mockResolvedValueOnce({
      userId: "user-1",
      email: "owner@example.com",
      orgId: "org-1",
      orgRole: "owner",
    });
    listLeadRequests.mockResolvedValueOnce({
      ok: true,
      leads: [
        {
          id: "newest",
          org_id: "org-1",
          status: "new",
          contact_name: "Newest Lead",
          phone: "555-0100",
          email: null,
          source: "Google",
          source_other: null,
          assignee_id: null,
          assignee_name: null,
          next_follow_up_on: null,
          created_at: "2026-10-10T12:00:00.000Z",
          updated_at: "2026-10-10T12:00:00.000Z",
        },
        {
          id: "older",
          org_id: "org-1",
          status: "new",
          contact_name: "Older Lead",
          phone: "555-0101",
          email: null,
          source: "Referral",
          source_other: null,
          assignee_id: null,
          assignee_name: null,
          next_follow_up_on: null,
          created_at: "2026-10-10T11:00:00.000Z",
          updated_at: "2026-10-10T11:00:00.000Z",
        },
      ],
    });

    const html = renderToStaticMarkup(await LeadsPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("Newest Lead");
    expect(html).toContain("Older Lead");
    expect(html.indexOf("Newest Lead")).toBeLessThan(html.indexOf("Older Lead"));
    expect(html).toContain("Add phone lead");
    expect(html).toContain("Board");
  });

  it("shows rotting, the owner, and the lost reason on the board", async () => {
    requireOrg.mockResolvedValueOnce({
      userId: "user-1",
      email: "owner@example.com",
      orgId: "org-1",
      orgRole: "owner",
    });
    listLeadRequests.mockResolvedValueOnce({
      ok: true,
      leads: [
        {
          id: "rotting",
          org_id: "org-1",
          status: "new",
          contact_name: "Stale Ada",
          phone: "555-0100",
          email: null,
          source: "Google",
          source_other: null,
          assignee_id: "user-9",
          assignee_name: "Sam Owner",
          lost_reason: null,
          stage_entered_at: "2026-10-10T08:00:00.000Z",
          next_follow_up_on: null,
          created_at: "2026-10-10T08:00:00.000Z",
          updated_at: "2026-10-10T08:00:00.000Z",
        },
        {
          id: "lost",
          org_id: "org-1",
          status: "lost",
          contact_name: "Bea Lost",
          phone: null,
          email: "bea@example.com",
          source: "Referral",
          source_other: null,
          assignee_id: null,
          assignee_name: null,
          lost_reason: "price",
          stage_entered_at: "2026-10-01T12:00:00.000Z",
          next_follow_up_on: null,
          created_at: "2026-10-01T12:00:00.000Z",
          updated_at: "2026-10-01T12:00:00.000Z",
        },
      ],
    });

    const html = renderToStaticMarkup(
      await LeadsPage({ searchParams: Promise.resolve({ view: "board" }) }),
    );

    expect(html).toContain("Stale Ada");
    expect(html).toContain("Sam Owner");
    expect(html).toContain("Rotting");
    expect(html).toContain("Bea Lost");
    expect(html).toContain("Lost: Price");
    expect(html).toContain("1 open task");
    expect(html).toContain("Qualify first");
    expect(html).toContain("Quoted");
    expect(html).not.toContain("Next follow-up");
  });
});
