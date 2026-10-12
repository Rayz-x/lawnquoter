import { describe, expect, it } from "vitest";
import { walkCoordinate, walkPhotoPath, walkPins } from "./walk";

const orgId = "11111111-1111-4111-8111-111111111111";
const fileId = "22222222-2222-4222-8222-222222222222";

describe("site walk photos and pins", () => {
  it("stores a jpeg under the org and file id", () => {
    expect(walkPhotoPath(orgId, fileId, "image/jpeg")).toBe(`${orgId}/${fileId}.jpg`);
    expect(walkPhotoPath(orgId, fileId, "image/png")).toBe(`${orgId}/${fileId}.png`);
    expect(walkPhotoPath(orgId, fileId, "image/webp")).toBe(`${orgId}/${fileId}.webp`);
  });

  it("rejects a photo that is not a jpeg, png, or webp", () => {
    expect(walkPhotoPath(orgId, fileId, "image/gif")).toBeNull();
    expect(walkPhotoPath("not-an-org", fileId, "image/jpeg")).toBeNull();
  });

  it("treats a blank pin as no coordinate", () => {
    expect(walkCoordinate("", "lat")).toBeNull();
    expect(walkCoordinate("39.8", "lat")).toBe(39.8);
    expect(walkCoordinate("91", "lat")).toBeNull();
  });

  it("pins only notes that have a map coordinate", () => {
    expect(
      walkPins([
        { id: "a", body: "Gate", lat: 39.8, lng: -89.6 },
        { id: "b", body: "No pin", lat: null, lng: null },
        { id: "c", body: "Off the map", lat: 91, lng: 0 },
      ]),
    ).toEqual([{ id: "a", body: "Gate", lng: -89.6, lat: 39.8 }]);
  });
});
