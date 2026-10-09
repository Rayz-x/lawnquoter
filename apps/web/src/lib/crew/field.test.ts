import { describe, expect, it } from "vitest";
import { createMemoryCrewStore } from "./queue";
import { enhancementPayload, sendReadyEnhancements, skipNeedsPhoto, type PendingEnhancement } from "./field";

const who = { userId: "user-1", orgId: "org-1" };
const pending = (extra: Partial<PendingEnhancement> = {}): PendingEnhancement => ({
  clientId: "enh-1",
  visitId: "visit-1",
  userId: who.userId,
  orgId: who.orgId,
  tag: "mulch",
  note: " beds are thin ",
  photoClientId: null,
  ...extra,
});

describe("skip and enhancement", () => {
  it("requires an issue photo only for a locked gate or a loose dog", () => {
    expect(skipNeedsPhoto("gate_locked")).toBe(true);
    expect(skipNeedsPhoto("dog_loose")).toBe(true);
    expect(skipNeedsPhoto("weather")).toBe(false);
    expect(skipNeedsPhoto("customer_skip")).toBe(false);
  });

  it("waits to file an upsell until its photo row exists", async () => {
    const store = createMemoryCrewStore();
    const waiting = pending({ photoClientId: "photo-1" });
    const still = await sendReadyEnhancements(store, who, [waiting], async () => null);
    expect(still).toEqual([waiting]);
    expect(await store.listOutbox()).toEqual([]);

    const done = await sendReadyEnhancements(store, who, [waiting], async () => "photo-row");
    expect(done).toEqual([]);
    const [row] = await store.listOutbox();
    expect(row).toMatchObject({
      client_id: "enh-1",
      kind: "enhancement_create",
      visit_id: "visit-1",
      payload: { tag: "mulch", note: "beds are thin", photo_ids: ["photo-row"] },
    });
  });

  it("files an upsell with no photo immediately", () => {
    expect(enhancementPayload(pending({ note: "  " }))).toEqual({ tag: "mulch", photo_ids: [] });
    expect(enhancementPayload(pending({ tag: "nope" }))).toBeNull();
  });
});
