import { describe, expect, it } from "vitest";
import {
  createMemoryCrewStore,
  enqueueMutation,
  enqueuePhoto,
  flushOutbox,
  loadDayPack,
  outboxBlocksSignOut,
  packDatesToDrop,
  parseSyncResults,
  photoStoragePath,
  purgeExpiredPacks,
  saveDayPack,
  scopeKey,
  syncItems,
  type SyncResult,
} from "./queue";

const now = new Date("2026-10-09T15:00:00.000Z");
const scope = { userId: "user-1", orgId: "org-1" };
const who = { user_id: scope.userId, org_id: scope.orgId };

describe("crew outbox", () => {
  it("keeps user keys from colliding", () => {
    expect(scopeKey("a:b", "c")).not.toBe(scopeKey("a", "b:c"));
    expect(scopeKey("a:b", "c")).toBe(JSON.stringify(["a:b", "c"]));
  });

  it("writes one client id and keeps the original time", async () => {
    const store = createMemoryCrewStore();
    const row = await enqueueMutation(
      store,
      { kind: "visit_start", visit_id: "visit-1", occurred_at: "2026-10-09T14:00:00.000Z", ...who },
      now,
    );
    const items = syncItems(await store.listOutbox(), "2026-10-09T15:00:05.000Z", scope);
    expect(items).toEqual([
      {
        client_id: row.client_id,
        kind: "visit_start",
        visit_id: "visit-1",
        occurred_at: "2026-10-09T14:00:00.000Z",
        device_now: "2026-10-09T15:00:05.000Z",
        payload: {},
      },
    ]);
    await expect(enqueueMutation(store, { kind: "not_a_kind", visit_id: "visit-1", ...who }, now)).rejects.toThrow("Unknown crew mutation");
  });

  it("sends in order, drops applied and replayed rows, and stops on an error", async () => {
    const store = createMemoryCrewStore();
    const first = await enqueueMutation(store, { kind: "visit_pause", visit_id: "v", client_id: "a", ...who }, new Date("2026-10-09T15:00:01.000Z"));
    const second = await enqueueMutation(store, { kind: "visit_resume", visit_id: "v", client_id: "b", ...who }, new Date("2026-10-09T15:00:02.000Z"));
    await enqueueMutation(store, { kind: "visit_finish", visit_id: "v", client_id: "c", ...who }, new Date("2026-10-09T15:00:03.000Z"));
    const seen: string[] = [];
    const result = await flushOutbox(store, async (items) => {
      seen.push(...items.map((item) => item.client_id));
      return [
        { client_id: first.client_id, status: "applied", message: null },
        { client_id: second.client_id, status: "error", message: "not the lead" },
      ] satisfies SyncResult[];
    }, scope);
    expect(seen).toEqual(["a", "b", "c"]);
    expect(result).toEqual({ sent: 1, pending: 2 });
    const left = (await store.listOutbox()).map((row) => [row.client_id, row.attempts, row.last_error, row.needs_office]);
    expect(left).toEqual([
      ["b", 1, "not the lead", true],
      ["c", 0, null, false],
    ]);
    const again: string[] = [];
    await flushOutbox(store, async (items) => {
      again.push(...items.map((item) => item.client_id));
      return items.map((item) => ({ client_id: item.client_id, status: "applied" as const, message: null }));
    }, scope);
    expect(again).toEqual(["c"]);
  });

  it("keeps the queue when the network fails and removes a replay", async () => {
    const store = createMemoryCrewStore();
    await enqueueMutation(store, { kind: "visit_set_note", visit_id: "v", client_id: "a", ...who }, now);
    const failed = await flushOutbox(store, async () => {
      throw new Error("offline");
    }, scope);
    expect(failed.pending).toBe(1);
    expect((await store.listOutbox())[0]?.last_error).toBe("offline");
    expect((await store.listOutbox())[0]?.needs_office).toBe(false);
    const replayed = await flushOutbox(store, async () => [{ client_id: "a", status: "replayed", message: null }], scope);
    expect(replayed).toEqual({ sent: 1, pending: 0 });
    expect(await store.listOutbox()).toEqual([]);
  });

  it("sends only this user and org, and uploads a photo before the photo row", async () => {
    const store = createMemoryCrewStore();
    await enqueueMutation(store, { kind: "visit_start", visit_id: "v", client_id: "other", user_id: "user-2", org_id: "org-1" }, now);
    const bytes = new Blob(["jpeg"], { type: "image/jpeg" });
    const photo = await enqueuePhoto(store, { visit_id: "v", client_id: "photo", bytes, photo_kind: "after", ...who }, now);
    const order: string[] = [];
    await flushOutbox(store, async (items) => {
      order.push(`send:${items.map((item) => item.client_id).join(",")}`);
      return [{ client_id: photo.client_id, status: "applied", message: null }];
    }, scope, now, async (row, file) => {
      order.push(`upload:${photoStoragePath(row.org_id, row.visit_id, row.client_id)}:${file.size}`);
    });
    expect(order).toEqual([`upload:${photoStoragePath("org-1", "v", "photo")}:${bytes.size}`, "send:photo"]);
    expect(await store.getPhoto("photo")).toBeNull();
    expect((await store.listOutbox()).map((row) => row.client_id)).toEqual(["other"]);
  });

  it("keeps a failed upload for retry and parks a missing photo", async () => {
    const store = createMemoryCrewStore();
    await enqueuePhoto(store, { visit_id: "v", client_id: "photo", bytes: new Blob(["jpeg"]), photo_kind: "before", ...who }, now);
    const retried = await flushOutbox(store, async () => [], scope, now, async () => {
      throw new Error("offline");
    });
    expect(retried.sent).toBe(0);
    expect((await store.listOutbox())[0]?.needs_office).toBe(false);
    const bare = createMemoryCrewStore();
    await enqueueMutation(bare, { kind: "visit_photo_record", visit_id: "v", client_id: "gone", payload: { photo_kind: "after" }, ...who }, now);
    await flushOutbox(bare, async () => {
      throw new Error("should not send");
    }, scope);
    expect((await bare.listOutbox())[0]?.needs_office).toBe(true);
  });

  it("retries an unexpected sync error and parks a known one", async () => {
    const store = createMemoryCrewStore();
    await enqueueMutation(store, { kind: "visit_pause", visit_id: "v", client_id: "a", ...who }, now);
    const first = await flushOutbox(store, async () => [{ client_id: "a", status: "error", message: "could not apply that change" }], scope);
    expect(first).toMatchObject({ sent: 0, pending: 1 });
    expect((await store.listOutbox())[0]?.needs_office).toBe(false);
    const second = await flushOutbox(store, async () => [{ client_id: "a", status: "applied", message: null }], scope);
    expect(second).toEqual({ sent: 1, pending: 0 });
  });

  it("hands a repeated generic error to the office so later work can send", async () => {
    const store = createMemoryCrewStore();
    await enqueueMutation(store, { kind: "visit_set_note", visit_id: "v", client_id: "bad", ...who }, now);
    await enqueueMutation(store, { kind: "visit_finish", visit_id: "v2", client_id: "finish", ...who }, now);
    const reject = async () => [{ client_id: "bad", status: "error" as const, message: "could not apply that change" }];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await flushOutbox(store, reject, scope);
      expect((await store.listOutbox()).find((row) => row.client_id === "bad")?.needs_office).toBe(false);
    }
    await flushOutbox(store, reject, scope);
    expect((await store.listOutbox()).find((row) => row.client_id === "bad")).toMatchObject({ attempts: 5, needs_office: true });
    const seen: string[] = [];
    const sent = await flushOutbox(store, async (items) => {
      seen.push(...items.map((item) => item.client_id));
      return items.map((item) => ({ client_id: item.client_id, status: "applied" as const, message: null }));
    }, scope);
    expect(seen).toEqual(["finish"]);
    expect(sent).toEqual({ sent: 1, pending: 1 });
  });

  it("hands an unmatched upsell to the office and still finishes", async () => {
    const store = createMemoryCrewStore();
    await enqueueMutation(store, { kind: "enhancement_create", visit_id: "v", client_id: "enh", payload: { tag: "mulch", photo_client_id: "missing" }, ...who }, now);
    await enqueueMutation(store, { kind: "visit_finish", visit_id: "v", client_id: "fin", ...who }, new Date(now.getTime() + 1));
    const sent = await flushOutbox(store, async (items) => {
      return items.map((item) =>
        item.client_id === "enh"
          ? { client_id: item.client_id, status: "error" as const, message: "enhancement photo must belong to this visit" }
          : { client_id: item.client_id, status: "applied" as const, message: null },
      );
    }, scope, now, async () => undefined, async () => "photo-row");
    expect(sent).toEqual({ sent: 1, pending: 1 });
    expect(await store.listOutbox()).toMatchObject([
      { client_id: "enh", needs_office: true, last_error: "enhancement photo must belong to this visit" },
    ]);
  });

  it("parses crew_sync results", () => {
    expect(parseSyncResults({ results: [{ client_id: "a", status: "applied", message: null }, { status: "nope" }] })).toEqual([
      { client_id: "a", status: "applied", message: null },
    ]);
    expect(parseSyncResults(null)).toEqual([]);
  });
});

describe("day packs", () => {
  it("keeps two recent packs and drops anything older than 48 hours", async () => {
    const store = createMemoryCrewStore();
    await saveDayPack(store, "2026-10-07", { stops: 1 }, new Date("2026-10-07T12:00:00.000Z"));
    await saveDayPack(store, "2026-10-08", { stops: 2 }, new Date("2026-10-08T12:00:00.000Z"));
    await saveDayPack(store, "2026-10-09", { stops: 3 }, now);
    expect(await loadDayPack(store, "2026-10-07")).toBeNull();
    expect((await loadDayPack(store, "2026-10-09"))?.pack).toEqual({ stops: 3 });
    await saveDayPack(store, "2026-10-06", { stops: 0 }, new Date("2026-10-06T12:00:00.000Z"));
    await purgeExpiredPacks(store, now);
    expect(packDatesToDrop([{ date: "old", saved_at: "2026-10-07T14:00:00.000Z", pack: {} }], now)).toEqual(["old"]);
    expect(await store.listPacks()).toHaveLength(2);
  });

  it("blocks sign-out while rows are waiting and wipes packs on clear", async () => {
    const store = createMemoryCrewStore();
    await enqueueMutation(store, { kind: "visit_start", visit_id: "v", ...who }, now);
    await saveDayPack(store, "2026-10-09", {}, now);
    expect(outboxBlocksSignOut(await store.listOutbox())).toBe(true);
    await store.clear();
    expect(outboxBlocksSignOut(await store.listOutbox())).toBe(false);
    expect(await store.listPacks()).toEqual([]);
  });

  it("sends an upsell only after its photo is applied", async () => {
    const store = createMemoryCrewStore();
    const photo = await enqueuePhoto(store, { visit_id: "v", ...who, bytes: new Blob(["a"]), photo_kind: "upsell" }, now);
    await enqueueMutation(store, {
      client_id: "enh-1",
      kind: "enhancement_create",
      visit_id: "v",
      ...who,
      payload: { tag: "mulch", note: "beds", photo_client_id: photo.client_id },
    }, new Date(now.getTime() + 1));
    const batches: string[][] = [];
    const result = await flushOutbox(
      store,
      async (items) => {
        batches.push(items.map((item) => item.kind));
        return items.map((item) => ({ client_id: item.client_id, status: "applied" as const, message: null }));
      },
      scope,
      now,
      async () => undefined,
    );
    expect(batches).toEqual([["visit_photo_record"], ["enhancement_create"]]);
    expect(result).toMatchObject({ sent: 2, pending: 0 });
  });

  it("hands an unmatched upsell to the office and still finishes", async () => {
    const store = createMemoryCrewStore();
    await enqueueMutation(store, {
      client_id: "enh-1",
      kind: "enhancement_create",
      visit_id: "v",
      ...who,
      payload: { tag: "mulch", photo_client_id: "photo-gone" },
    }, now);
    await enqueueMutation(store, {
      client_id: "fin-1",
      kind: "visit_finish",
      visit_id: "v",
      ...who,
    }, new Date(now.getTime() + 1));
    const sent = await flushOutbox(store, async (items) => {
      return items.map((item) =>
        item.client_id === "enh-1"
          ? { client_id: item.client_id, status: "error" as const, message: "enhancement photo must belong to this visit" }
          : { client_id: item.client_id, status: "applied" as const, message: null },
      );
    }, scope, now, async () => undefined);
    expect(sent).toEqual({ sent: 1, pending: 1 });
    expect(await store.listOutbox()).toMatchObject([
      { client_id: "enh-1", needs_office: true, last_error: "enhancement photo must belong to this visit" },
    ]);
  });
});
