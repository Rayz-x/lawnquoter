import { describe, expect, it } from "vitest";
import { catalogStarterPicks, parseServiceZips, resumeOnboarding, wizardServiceInstall } from "./wizard";

describe("onboarding wizard", () => {
  it("keeps unique 5-digit ZIPs in the order they were typed", () => {
    expect(parseServiceZips("37064, 37067\n37064")).toEqual({ ok: true, zips: ["37064", "37067"] });
    expect(parseServiceZips("")).toEqual({ ok: true, zips: [] });
    expect(parseServiceZips("abc")).toEqual({ ok: false, error: "Use 5-digit ZIP codes, separated by commas." });
  });

  it("prices checked catalog services at the published typical price", () => {
    expect(catalogStarterPicks(["weekly-mowing", "missing"])).toEqual({
      ok: true,
      picks: [{ key: "weekly-mowing", price: 55 }],
    });
    expect(catalogStarterPicks([])).toEqual({ ok: true, picks: [] });
    expect(wizardServiceInstall(true, ["weekly-mowing"])).toEqual([]);
    expect(wizardServiceInstall(false, ["weekly-mowing"])).toEqual([{ key: "weekly-mowing", price: 55 }]);
  });

  it("resumes a new company and leaves an existing company alone", () => {
    expect(resumeOnboarding({ hasOrg: false, settings: {} })).toBe("company");
    expect(resumeOnboarding({ hasOrg: true, settings: {} })).toBe("done");
    expect(resumeOnboarding({ hasOrg: true, settings: { onboarding_step: "area" } })).toBe("area");
    expect(resumeOnboarding({ hasOrg: true, settings: { onboarding_complete: true, onboarding_step: "team" } })).toBe("done");
  });
});
