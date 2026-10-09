import { describe, expect, it } from "vitest";
import { PHOTO_LIMIT, afterPhotoReady, packPhotoKinds, scaledSize } from "./photo";

const pack = {
  visits: [
    { id: "v1", photos: [{ kind: "before" }, { kind: "after" }] },
    { id: "v2", photos: [{ kind: "before" }] },
  ],
};

describe("visit photos", () => {
  it("fits the long edge and leaves a small photo alone", () => {
    expect(scaledSize(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(scaledSize(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
    expect(scaledSize(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(PHOTO_LIMIT).toBe(460800);
  });

  it("reads photo kinds from the day pack", () => {
    expect(packPhotoKinds(pack, "v1")).toEqual(["before", "after"]);
    expect(packPhotoKinds(pack, "v2")).toEqual(["before"]);
    expect(packPhotoKinds(pack, "missing")).toEqual([]);
  });

  it("requires an after photo that is still sendable", () => {
    expect(afterPhotoReady(["after"], [])).toBe(true);
    expect(afterPhotoReady([], [{ kind: "after", needsOffice: false }])).toBe(true);
    expect(afterPhotoReady([], [{ kind: "after", needsOffice: true }])).toBe(false);
    expect(afterPhotoReady(["before"], [{ kind: "before", needsOffice: false }])).toBe(false);
  });
});
