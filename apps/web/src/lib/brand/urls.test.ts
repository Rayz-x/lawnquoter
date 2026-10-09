import { afterEach, describe, expect, it } from "vitest";
import { brandingAssetUrl, brandingObjectPath, isHttpUrl } from "./urls";

const ORG = "e606fd84-cbe4-432f-8f25-e9b2a7f88b75";

describe("branding object paths", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  it("accepts only this org's bucket path", () => {
    expect(brandingObjectPath(`${ORG}/logo-light-abc.png`, ORG)).toBe(`${ORG}/logo-light-abc.png`);
    expect(brandingObjectPath("https://evil.test/a.png", ORG)).toBeNull();
    expect(brandingObjectPath("http://127.0.0.1:3000/demo-brand/yellow.png", ORG)).toBeNull();
    expect(brandingObjectPath("/logo.png", ORG)).toBeNull();
    expect(brandingObjectPath("logo.png", ORG)).toBeNull();
    expect(brandingObjectPath("not-a-uuid/logo.png", ORG)).toBeNull();
    expect(brandingObjectPath(`00000000-0000-4000-8000-000000000099/logo.png`, ORG)).toBeNull();
    expect(brandingObjectPath(`${ORG}/../other/logo.png`, ORG)).toBeNull();
  });

  it("builds a public storage URL and never passes an absolute URL through", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    expect(brandingAssetUrl(`${ORG}/logo.png`, ORG)).toBe(
      `https://project.supabase.co/storage/v1/object/public/org-branding/${ORG}/logo.png`,
    );
    expect(brandingAssetUrl("https://evil.test/a.png", ORG)).toBeNull();
    expect(brandingAssetUrl("/etc/passwd")).toBeNull();
  });
});

describe("isHttpUrl", () => {
  it("allows http and https and rejects other schemes", () => {
    expect(isHttpUrl("https://greenacres.example")).toBe(true);
    expect(isHttpUrl("http://localhost:3000/path")).toBe(true);
    expect(isHttpUrl("")).toBe(false);
    expect(isHttpUrl("greenacres.example")).toBe(false);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("ftp://files.example/logo.png")).toBe(false);
  });
});
