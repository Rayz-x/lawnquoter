/**
 * Offline E2E seam: Maria queues work, signs out (wipes route data), Bob sees
 * her waiting outbox attributed to her, and only her scope can send it.
 */
import { describe, expect, it } from "vitest";
import {
  createMemoryCrewStore,
  enqueueMutation,
  flushOutbox,
  foreignOutboxWaitingMessage,
  loadDayPack,
  saveDayPack,
  syncItems,
  wipeRouteDataOnSignOut,
} from "./queue";

const now = new Date("2026-10-10T18:00:00.000Z");

describe("offline E2E: outbox survives sign-out", () => {
  it("wipes addresses and codes, keeps Maria's outbox for the next lead", async () => {
    const phone = createMemoryCrewStore();
    const maria = { user_id: "maria", org_id: "org-1", author_name: "Maria Ruiz" };
    await enqueueMutation(phone, { kind: "visit_start", visit_id: "v1", client_id: "1", ...maria }, now);
    await enqueueMutation(phone, { kind: "visit_set_note", visit_id: "v1", client_id: "2", ...maria }, new Date(now.getTime() + 1));
    await enqueueMutation(phone, { kind: "visit_finish", visit_id: "v1", client_id: "3", ...maria }, new Date(now.getTime() + 2));
    await saveDayPack(
      phone,
      "2026-10-10",
      {
        gate_code: "4422",
        access_notes: "dogs in back",
        stops: [{ address: "12 Oak St", note_crew: "leave bag" }],
      },
      now,
    );

    await wipeRouteDataOnSignOut(phone);

    expect(await loadDayPack(phone, "2026-10-10")).toBeNull();
    expect(await phone.listPacks()).toEqual([]);
    expect((await phone.listOutbox()).map((row) => row.client_id)).toEqual(["1", "2", "3"]);
    expect(foreignOutboxWaitingMessage(await phone.listOutbox(), "bob", "org-1")).toBe("3 items from Maria waiting");

    const bobScope = { userId: "bob", orgId: "org-1" };
    const attempted = await flushOutbox(phone, async () => {
      throw new Error("bob must not send maria's rows");
    }, bobScope);
    expect(attempted).toEqual({ sent: 0, pending: 3 });
    expect(syncItems(await phone.listOutbox(), now.toISOString(), bobScope)).toEqual([]);

    const mariaScope = { userId: "maria", orgId: "org-1" };
    const sent = await flushOutbox(phone, async (items) => {
      expect(items.map((item) => item.client_id)).toEqual(["1", "2", "3"]);
      return items.map((item) => ({ client_id: item.client_id, status: "applied" as const, message: null }));
    }, mariaScope);
    expect(sent).toEqual({ sent: 3, pending: 0 });
  });
});
