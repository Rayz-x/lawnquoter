import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, securityHeaderGroups } from "./security-headers";

describe("contentSecurityPolicy", () => {
  it("omits unsafe-eval in production and allows Next, Supabase, tiles, and the geocoder", () => {
    const csp = contentSecurityPolicy({
      isDev: false,
      supabaseUrl: "https://example.supabase.co",
      frameAncestors: "'none'",
    });
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("https://example.supabase.co");
    expect(csp).toContain("wss://example.supabase.co");
    expect(csp).toContain("https://server.arcgisonline.com");
    expect(csp).toContain("https://ibasemaps-api.arcgis.com");
    expect(csp).toContain("https://maps.googleapis.com");
    expect(csp).toContain("https://places.googleapis.com");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("allows unsafe-eval only in development", () => {
    const csp = contentSecurityPolicy({ isDev: true, frameAncestors: "'none'" });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });
});

describe("securityHeaderGroups", () => {
  const groups = securityHeaderGroups({
    isDev: false,
    supabaseUrl: "https://example.supabase.co",
  });

  function headersFor(source: string) {
    return groups.find((group) => group.source === source)?.headers ?? [];
  }

  function value(source: string, key: string) {
    return headersFor(source).find((header) => header.key === key)?.value;
  }

  it("locks framing down except on the widget routes", () => {
    expect(value("/:path*", "Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(value("/widget", "Content-Security-Policy")).toContain("frame-ancestors *");
    expect(value("/widget/:path*", "Content-Security-Policy")).toContain("frame-ancestors *");
    expect(value("/widget", "Content-Security-Policy")).not.toContain("frame-ancestors 'none'");
  });

  it("sends HSTS, nosniff, and a strict referrer policy in production", () => {
    expect(value("/", "Strict-Transport-Security")).toBe("max-age=63072000; includeSubDomains; preload");
    expect(value("/", "X-Content-Type-Options")).toBe("nosniff");
    expect(value("/", "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });
});
