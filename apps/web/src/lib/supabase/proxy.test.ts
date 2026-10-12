import { describe, expect, it } from "vitest";
import { isPublicPath } from "./proxy";

describe("isPublicPath", () => {
  it("serves the crew manifest and service worker without a login redirect", () => {
    expect(isPublicPath("/crew/manifest.webmanifest")).toBe(true);
    expect(isPublicPath("/sw.js")).toBe(true);
    expect(isPublicPath("/offline.html")).toBe(true);
    expect(isPublicPath("/manifest.webmanifest")).toBe(true);
    expect(isPublicPath("/co/sample-token")).toBe(true);
    expect(isPublicPath("/i/sample-token")).toBe(true);
    expect(isPublicPath("/s/sample-token")).toBe(true);
    expect(isPublicPath("/crew/today")).toBe(false);
  });

  it("serves the hosted request-a-quote form and intake without login", () => {
    expect(isPublicPath("/r/acme-lawn")).toBe(true);
    expect(isPublicPath("/api/leads/intake")).toBe(true);
    expect(isPublicPath("/api/webhooks/twilio/sms")).toBe(true);
    expect(isPublicPath("/api/public/anything")).toBe(true);
  });
});
