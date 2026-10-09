import { describe, expect, it } from "vitest";
import {
  createMemoryCrewStore,
  enqueueMutation,
  flushOutbox,
  loadDayPack,
  outboxBlocksSignOut,
  packDatesToDrop,
  parseSyncResults,
  purgeExpiredPacks,
  saveDayPack,
  syncItems,
  type SyncResult,
} from "./queue";

const now = new Date("2026-10-09T15:00:00.000Z");

describe("crew outbox", () => {
  it("writes one client id and keeps the original time", async () => {
    const store = createMemoryCrewStore();
    const row = await enqueueMutation(
      store,
      { kind: "visit_start", visit_id: "visit-1", occurred_at: "2026-10-09T14:00:00.000Z" },
      now,
    );
    const items = syncItems(await store.listOutbox(), "2026-10-09T15:00:05.000Z");
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
    await expect(enqueueMutation(store, { kind: "not_a_kind", visit_id: "visit-1" }, now)).rejects.toThrow("Unknown crew mutation");
  });

  it("sends in order, drops applied and replayed rows, and stops on an error", async () => {
    const store = createMemoryCrewStore();
    const first = await enqueueMutation(store, { kind: "visit_pause", visit_id: "v", client_id: "a" }, new Date("2026-10-09T15:00:01.000Z"));
    const second = await enqueueMutation(store, { kind: "visit_resume", visit_id: "v", client_id: "b" }, new Date("2026-10-09T15:00:02.000Z"));
    await enqueueMutation(store, { kind: "visit_finish", visit_id: "v", client_id: "c" }, new Date("2026-10-09T15:00:03.000Z"));
    const seen: string[] = [];
    const result = await flushOutbox(store, async (items) => {
      seen.push(...items.map((item) => item.client_id));
      return [
        { client_id: first.client_id, status: "applied", message: null },
        { client_id: second.client_id, status: "error", message: "not the lead" },
      ] satisfies SyncResult[];
    });
    expect(seen).toEqual(["a", "b", "c"]);
    expect(result).toEqual({ sent: 1, pending: 2 });
    const left = (await store.listOutbox()).map((row) => [row.client_id, row.attempts, row.last_error]);
    expect(left).toEqual([
      ["b", 1, "not the lead"],
      ["c", 0, null],
    ]);
  });

  it("keeps the queue when the network fails and removes a replay", async () => {
    const store = createMemoryCrewStore();
    await enqueueMutation(store, { kind: "visit_set_note", visit_id: "v", client_id: "a" }, now);
    const failed = await flushOutbox(store, async () => {
      throw new Error("offline");
    });
    expect(failed.pending).toBe(1);
    expect((await store.listOutbox())[0]?.last_error).toBe("offline");
    const replayed = await flushOutbox(store, async () => [{ client_id: "a", status: "replayed", message: null }]);
    expect(replayed).toEqual({ sent: 1, pending: 0 });
    expect(await store.listOutbox()).toEqual([]);
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
    await enqueueMutation(store, { kind: "visit_start", visit_id: "v" }, now);
    await saveDayPack(store, "2026-10-09", {}, now);
    expect(outboxBlocksSignOut(await store.listOutbox())).toBe(true);
    await store.clear();
    expect(outboxBlocksSignOut(await store.listOutbox())).toBe(false);
    expect(await store.listPacks()).toEqual([]);
  });
});
