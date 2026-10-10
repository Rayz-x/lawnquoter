import { describe, expect, it } from "vitest";
import { normalizeLeadFilters, statusFilterValues } from "./filters";

describe("normalizeLeadFilters", () => {
  it("defaults to active (non-spam) statuses", () => {
    expect(normalizeLeadFilters({})).toEqual({ status: "active", source: null, assignee: null });
    expect(statusFilterValues("active")).toEqual(["new", "contacted", "quoted", "won", "lost"]);
  });

  it("treats Spam as a status filter, not a delete", () => {
    expect(normalizeLeadFilters({ status: "spam" }).status).toBe("spam");
    expect(statusFilterValues("spam")).toEqual(["spam"]);
  });
});
