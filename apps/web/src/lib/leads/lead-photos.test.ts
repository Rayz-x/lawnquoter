import { describe, expect, it } from "vitest";
import {
  LEAD_PHOTO_MAX_BYTES,
  LEAD_PHOTO_MAX_COUNT,
  buildLeadPhotoObjectPath,
  validateLeadPhotoCandidates,
} from "./lead-photos";

function candidate(
  overrides: Partial<{ mimeType: string; byteLength: number }> = {},
) {
  return {
    mimeType: "image/jpeg",
    byteLength: 12_000,
    ...overrides,
  };
}

describe("validateLeadPhotoCandidates", () => {
  it("accepts up to three image files under the size cap", () => {
    const result = validateLeadPhotoCandidates([
      candidate(),
      candidate({ mimeType: "image/png" }),
      candidate({ mimeType: "image/webp", byteLength: LEAD_PHOTO_MAX_BYTES }),
    ]);
    expect(result).toEqual({ ok: true });
  });

  it("rejects a fourth image", () => {
    const result = validateLeadPhotoCandidates([
      candidate(),
      candidate(),
      candidate(),
      candidate(),
    ]);
    expect(result).toEqual({ ok: false, reason: "too_many" });
    expect(LEAD_PHOTO_MAX_COUNT).toBe(3);
  });

  it("rejects a non-image mime type", () => {
    const result = validateLeadPhotoCandidates([
      candidate({ mimeType: "application/pdf" }),
    ]);
    expect(result).toEqual({ ok: false, reason: "non_image" });
  });

  it("rejects a file over the size cap", () => {
    const result = validateLeadPhotoCandidates([
      candidate({ byteLength: LEAD_PHOTO_MAX_BYTES + 1 }),
    ]);
    expect(result).toEqual({ ok: false, reason: "too_large" });
  });
});

describe("buildLeadPhotoObjectPath", () => {
  it("builds org/lead/file.ext keys for allowed image types", () => {
    const orgId = "11111111-1111-4111-8111-111111111111";
    const leadId = "22222222-2222-4222-8222-222222222222";
    const fileId = "33333333-3333-4333-8333-333333333333";
    expect(buildLeadPhotoObjectPath(orgId, leadId, fileId, "image/jpeg")).toBe(
      `${orgId}/${leadId}/${fileId}.jpg`,
    );
    expect(buildLeadPhotoObjectPath(orgId, leadId, fileId, "image/png")).toBe(
      `${orgId}/${leadId}/${fileId}.png`,
    );
  });
});
