import { describe, expect, it } from "vitest";
import {
  enhancementPayload,
  queueEnhancement,
  skipNeedsNote,
  skipNeedsPhoto,
  skipPayload,
  skipPhotoKind,
} from "./field";
import { createMemoryCrewStore } from "./queue";

const who = { userId: "user-1", orgId: "org-1" };

describe("skip and enhancement", () => {
  it("requires an after photo for a locked gate or a loose dog", () => {
    expect(skipNeedsPhoto("gate_locked")).toBe(true);
    expect(skipNeedsPhoto("dog_loose")).toBe(true);
    expect(skipPhotoKind("gate_locked")).toBe("after");
    expect(skipPhotoKind("dog_loose")).toBe("after");
    expect(skipNeedsPhoto("weather")).toBe(false);
    expect(skipNeedsPhoto("unsafe")).toBe(false);
    expect(skipPhotoKind("weather")).toBeNull();
  });

  it("requires a note for an unsafe skip and builds the sync payload", () => {
    expect(skipNeedsNote("unsafe")).toBe(true);
    expect(skipNeedsNote("weather")).toBe(false);
    expect(skipPayload("unsafe", "  ")).toBeNull();
    expect(skipPayload("unsafe", "bee nest by the meter")).toEqual({
      reason: "unsafe",
      note: "bee nest by the meter",
    });
    expect(skipPayload("weather", "")).toEqual({ reason: "weather" });
    expect(skipPayload("nope", "x")).toBeNull();
  });

  it("queues an upsell behind its photo in the outbox", async () => {
    const store = createMemoryCrewStore();
    const now = new Date("2026-10-09T15:00:00.000Z");
    await queueEnhancement(store, { clientId: "enh-1", visitId: "visit-1", ...who, tag: "mulch", note: "  " }, null, now);
    await queueEnhancement(store, { clientId: "enh-2", visitId: "visit-1", ...who, tag: "mulch", note: "beds" }, "photo-1", now);
    const rows = await store.listOutbox();
    expect(rows.map((row) => row.payload)).toEqual([
      { tag: "mulch", photo_ids: [] },
      { tag: "mulch", note: "beds", photo_client_id: "photo-1" },
    ]);
    expect(rows[1]?.created_at > rows[0]!.created_at).toBe(true);
    expect(enhancementPayload("nope", "")).toBeNull();
  });
});
