import { describe, expect, it } from "vitest";
import { canSubmitPartlyDone, normalizePartlyDoneReason, partlyDoneFinishPayload } from "./partly-done";

describe("partly done finish form", () => {
  it("requires a non-empty reason and an after photo", () => {
    expect(canSubmitPartlyDone({ reason: "", hasAfterPhoto: true })).toBe(false);
    expect(canSubmitPartlyDone({ reason: "   ", hasAfterPhoto: true })).toBe(false);
    expect(canSubmitPartlyDone({ reason: "Rain stopped us", hasAfterPhoto: false })).toBe(false);
    expect(canSubmitPartlyDone({ reason: "Rain stopped us", hasAfterPhoto: true })).toBe(true);
  });

  it("builds a visit_finish payload for sync", () => {
    expect(partlyDoneFinishPayload("  gate stuck  ")).toEqual({
      outcome: "partly",
      reason: "gate stuck",
    });
    expect(partlyDoneFinishPayload("")).toBeNull();
    expect(normalizePartlyDoneReason(`x${"y".repeat(600)}`).length).toBe(500);
  });
});
