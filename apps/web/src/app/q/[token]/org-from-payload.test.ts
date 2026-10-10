import { describe, expect, it } from "vitest";
import { orgFromPayload } from "./org-from-payload";

describe("orgFromPayload logo size", () => {
  it("keeps RPC integers and drops the numeric strings the page copy coerced", () => {
    // page.tsx turned "240" into 240 via Number(). pdf/route.ts returned null unless typeof was "number".
    expect(orgFromPayload({ logo_width: 240, logo_height: 48 })).toMatchObject({
      logo_width: 240,
      logo_height: 48,
    });
    expect(orgFromPayload({ logo_width: "240", logo_height: "48" })).toMatchObject({
      logo_width: null,
      logo_height: null,
    });
  });
});
