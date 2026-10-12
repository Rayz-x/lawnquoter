import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, securityHeaderGroups } from "./security-headers";

describe("contentSecurityPolicy", () => {
  it("omits unsafe-eval in production and allows Next, Supabase, and tiles", () => {
    const csp = contentSecurityPolicy({
      isDev: false,
      supabaseUrl: "https://example.supabase.co",
    });
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("https://example.supabase.co");
    expect(csp).toContain("wss://example.supabase.co");
    expect(csp).toContain("https://server.arcgisonline.com");
    expect(csp).toContain("https://ibasemaps-api.arcgis.com");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("allows unsafe-eval only in development", () => {
    const csp = contentSecurityPolicy({ isDev: true });
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

  it("locks framing down", () => {
    expect(value("/:path*", "Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });

  it("sends HSTS, nosniff, and a strict referrer policy in production", () => {
    expect(value("/", "Strict-Transport-Security")).toBe("max-age=63072000; includeSubDomains; preload");
    expect(value("/", "X-Content-Type-Options")).toBe("nosniff");
    expect(value("/", "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(value("/", "Permissions-Policy")).toContain("microphone=(self)");
    expect(value("/", "Permissions-Policy")).toContain("geolocation=(self)");
  });
});
