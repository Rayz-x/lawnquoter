import { describe, expect, it } from "vitest";
import { ORG_ROLES } from "@lawnquoter/shared";
import { SETTINGS_ADMIN_ONLY, SETTINGS_NOT_SAVED, mergeOrgSettings, orgSettingsDenied, orgUpdateFailure } from "./org-write";

describe("org settings writes", () => {
  it("merges jsonb so week-start and quote-default saves keep each other's keys", () => {
    const base = { week_start: "monday", quote_expiry_days: 30, quote_deposit: "10", hide_powered_by: false };
    expect(mergeOrgSettings(base, { week_start: "sunday" })).toEqual({ ...base, week_start: "sunday" });
    expect(mergeOrgSettings(base, { quote_expiry_days: 60, quote_deposit: "25" })).toEqual({ ...base, quote_expiry_days: 60, quote_deposit: "25" });
  });

  it("fails a zero-row update and allows only owners and admins", () => {
    expect(orgUpdateFailure(null, null)).toBe(SETTINGS_NOT_SAVED);
    expect(orgUpdateFailure(null, { id: "org" })).toBeNull();
    expect(orgUpdateFailure({ message: "invalid timezone" }, null)).toBe("invalid timezone");
    expect(orgSettingsDenied("owner")).toBeNull();
    expect(orgSettingsDenied("admin")).toBeNull();
    expect(ORG_ROLES.filter((role) => role !== "owner" && role !== "admin").every((role) => orgSettingsDenied(role) === SETTINGS_ADMIN_ONLY)).toBe(true);
  });
});
