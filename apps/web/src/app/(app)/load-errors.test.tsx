import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type DbResult = { data: unknown; error: { message: string } | null };

const db = vi.hoisted(() => ({
  tables: {} as Record<string, DbResult>,
  rpcs: {} as Record<string, DbResult>,
}));

const studio = vi.hoisted(() => ({
  count: null as number | null,
}));

vi.mock("next/font/local", () => ({
  default: () => ({ variable: "--font-heading-sturdy", className: "font" }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => createElement("a", { href }, children),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  useRouter: () => ({ push() {}, refresh() {}, replace() {} }),
  usePathname: () => "/",
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock("@/lib/auth/session", () => ({
  requireOrg: vi.fn(async () => ({
    userId: "user-1",
    email: "ada@example.com",
    orgId: "org-1",
    orgRole: "owner" as const,
  })),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) => query(table),
    rpc: async (fn: string) => db.rpcs[fn] ?? { data: null, error: null },
  })),
}));

vi.mock("@/components/app-shell/page-header", () => ({
  PageHeader: ({ title }: { title: string }) => createElement("h1", null, title),
}));

vi.mock("@/components/map/property-map", () => ({
  PropertyMap: () => null,
}));

vi.mock("./properties/[id]/measure/measure-studio", () => ({
  MeasureStudio: ({ initialFeatures }: { initialFeatures: unknown[] }) => {
    studio.count = initialFeatures.length;
    return createElement("div", { "data-studio": "open", "data-count": String(initialFeatures.length) });
  },
}));

function query(table: string) {
  const result = () => db.tables[table] ?? { data: [], error: null };
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const method of ["select", "eq", "order", "limit", "ilike", "is", "in", "neq", "not", "or"]) {
    chain[method] = self;
  }
  chain.single = () => Promise.resolve(result());
  chain.maybeSingle = () => Promise.resolve(result());
  chain.then = (resolve: (value: DbResult) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result()).then(resolve, reject);
  return chain;
}

function failTable(table: string, message: string) {
  db.tables[table] = { data: null, error: { message } };
}

async function markup(view: ReactNode | Promise<ReactNode>) {
  return renderToStaticMarkup(await view);
}

import AccountsPage from "./accounts/page";
import NewAccountPage from "./accounts/new/page";
import AccountDetailPage from "./accounts/[id]/page";
import PropertiesPage from "./properties/page";
import PropertyDetailPage from "./properties/[id]/page";
import MeasurePage from "./properties/[id]/measure/page";
import QuotesPage from "./quotes/page";
import NewQuotePage from "./quotes/new/page";
import QuoteDetailPage from "./quotes/[id]/page";
import PricingPage from "./settings/pricing/page";
import ProfilePage from "./settings/profile/page";
import TeamPage from "./settings/team/page";
import SettingsPage from "./settings/page";

beforeEach(() => {
  db.tables = {};
  db.rpcs = {};
  studio.count = null;
});

describe("measure page", () => {
  it("does not open the studio with an empty feature list when saved features fail to load", async () => {
    db.tables.properties = {
      data: {
        id: "property-1",
        name: "Front lawn",
        formatted_address: "1 Main St",
        address_line1: "1 Main St",
        parcel_source: null,
        footprint_source: null,
        imagery_date: null,
      },
      error: null,
    };
    db.rpcs.measurement_ensure = { data: "measurement-1", error: null };
    db.rpcs.property_geometry = { data: {}, error: null };
    db.rpcs.measurement_features_geojson = { data: null, error: { message: "feature read failed" } };

    const html = await markup(MeasurePage({ params: Promise.resolve({ id: "property-1" }) }));

    expect(html).toContain("feature read failed");
    expect(html).not.toContain("data-studio");
    expect(studio.count).toBeNull();
  });

  it("opens the studio when the measurement has no features yet", async () => {
    db.tables.properties = {
      data: {
        id: "property-1",
        name: "Front lawn",
        formatted_address: "1 Main St",
        address_line1: "1 Main St",
        parcel_source: null,
        footprint_source: null,
        imagery_date: null,
      },
      error: null,
    };
    db.rpcs.measurement_ensure = { data: "measurement-1", error: null };
    db.rpcs.property_geometry = { data: {}, error: null };
    db.rpcs.measurement_features_geojson = { data: [], error: null };

    const html = await markup(MeasurePage({ params: Promise.resolve({ id: "property-1" }) }));

    expect(html).toContain("data-studio");
    expect(studio.count).toBe(0);
  });
});

describe("list and form pages", () => {
  it("shows an accounts query error instead of an empty list", async () => {
    failTable("accounts", "accounts read failed");
    const html = await markup(AccountsPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("accounts read failed");
    expect(html).not.toContain("No accounts yet");
  });

  it("shows a parent-account query error instead of an empty parent list", async () => {
    failTable("accounts", "parents read failed");
    const html = await markup(NewAccountPage());
    expect(html).toContain("parents read failed");
    expect(html).not.toContain("Parent account");
  });

  it("shows an account query error instead of a 404", async () => {
    failTable("accounts", "account read failed");
    const html = await markup(AccountDetailPage({ params: Promise.resolve({ id: "account-1" }), searchParams: Promise.resolve({}) }));
    expect(html).toContain("account read failed");
  });

  it("shows a properties query error instead of an empty list", async () => {
    failTable("properties", "properties read failed");
    const html = await markup(PropertiesPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("properties read failed");
    expect(html).not.toContain("No properties");
  });

  it("shows a property query error instead of a 404", async () => {
    failTable("properties", "property read failed");
    const html = await markup(PropertyDetailPage({ params: Promise.resolve({ id: "property-1" }) }));
    expect(html).toContain("property read failed");
  });

  it("shows a quotes query error instead of an empty list", async () => {
    failTable("quotes", "quotes read failed");
    const html = await markup(QuotesPage());
    expect(html).toContain("quotes read failed");
    expect(html).not.toContain("No quotes yet");
  });

  it("shows a new-quote query error instead of an empty customer form", async () => {
    failTable("accounts", "quote accounts read failed");
    const html = await markup(NewQuotePage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("quote accounts read failed");
    expect(html).not.toContain("Open builder");
  });

  it("shows a quote query error instead of a 404", async () => {
    failTable("quotes", "quote read failed");
    const html = await markup(QuoteDetailPage({ params: Promise.resolve({ id: "quote-1" }) }));
    expect(html).toContain("quote read failed");
  });

  it("shows a pricing query error instead of an empty catalog", async () => {
    failTable("services", "services read failed");
    const html = await markup(PricingPage());
    expect(html).toContain("services read failed");
    expect(html).not.toContain("Add weekly mow");
  });

  it("shows a profile query error instead of a blank form", async () => {
    failTable("profiles", "profile read failed");
    const html = await markup(ProfilePage());
    expect(html).toContain("profile read failed");
    expect(html).not.toContain("Full name");
  });

  it("shows a team query error instead of an empty member list", async () => {
    failTable("memberships", "members read failed");
    const html = await markup(TeamPage());
    expect(html).toContain("members read failed");
    expect(html).not.toContain("No per-seat fees");
  });
});

describe("settings page", () => {
  it("uses notFound when the org row is missing", async () => {
    db.tables.orgs = { data: null, error: null };
    await expect(SettingsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NOT_FOUND");
  });

  it("shows an org query error instead of a blank page", async () => {
    failTable("orgs", "org read failed");
    const html = await markup(SettingsPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("org read failed");
  });
});
