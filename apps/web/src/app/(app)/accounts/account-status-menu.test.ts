import { describe, expect, it } from "vitest";
import { accountStatusMenuItems } from "./account-status-menu";

describe("accountStatusMenuItems", () => {
  it("offers Activate and Archive for a lead", () => {
    expect(accountStatusMenuItems("lead").map((item) => item.label)).toEqual([
      "Export",
      "Activate",
      "Archive",
    ]);
  });

  it("offers Archive for an active account, not Activate", () => {
    const labels = accountStatusMenuItems("active").map((item) => item.label);
    expect(labels).toContain("Archive");
    expect(labels).toContain("Mark as Lead");
    expect(labels).not.toContain("Activate");
    expect(labels).not.toContain("Unarchive");
  });

  it("offers Activate and Unarchive for an archived account", () => {
    expect(accountStatusMenuItems("inactive").map((item) => item.label)).toEqual([
      "Export",
      "Mark as Lead",
      "Activate",
      "Unarchive",
    ]);
  });
});
