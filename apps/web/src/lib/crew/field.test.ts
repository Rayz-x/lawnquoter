import { describe, expect, it } from "vitest";
import { enhancementPayload, queueEnhancement, skipNeedsPhoto } from "./field";
import { createMemoryCrewStore } from "./queue";

const who = { userId: "user-1", orgId: "org-1" };

describe("skip and enhancement", () => {
  it("requires an issue photo only for a locked gate or a loose dog", () => {
    expect(skipNeedsPhoto("gate_locked")).toBe(true);
    expect(skipNeedsPhoto("dog_loose")).toBe(true);
    expect(skipNeedsPhoto("weather")).toBe(false);
    expect(skipNeedsPhoto("customer_skip")).toBe(false);
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

  it("never puts a price on an upsell payload", () => {
    const payload = enhancementPayload("aeration", "front lawn", null);
    expect(payload).toEqual({ tag: "aeration", note: "front lawn", photo_ids: [] });
    expect(payload).not.toHaveProperty("price");
    expect(payload).not.toHaveProperty("cost");
    expect(payload).not.toHaveProperty("amount");
    expect(JSON.stringify(payload)).not.toMatch(/price|cost|amount|margin|hourly_rate/i);
  });

  it("files an upsell request with tag note and optional photo only", async () => {
    const store = createMemoryCrewStore();
    const now = new Date("2026-10-10T14:00:00.000Z");
    const row = await queueEnhancement(
      store,
      { clientId: "enh-filed", visitId: "visit-9", ...who, tag: "overseed", note: "thin spots by the fence" },
      "photo-9",
      now,
    );
    expect(row).not.toBeNull();
    expect(row?.kind).toBe("enhancement_create");
    expect(row?.payload).toEqual({
      tag: "overseed",
      note: "thin spots by the fence",
      photo_client_id: "photo-9",
    });
    const keys = Object.keys(row?.payload ?? {});
    expect(keys.sort()).toEqual(["note", "photo_client_id", "tag"]);
  });
});
