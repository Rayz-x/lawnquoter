import { describe, expect, it } from "vitest";
import {
  createMemoryCrewStore,
  enqueueMutation,
  flushOutbox,
  saveDayPack,
} from "./queue";
import { isPhoneRevokedError, phoneRevokedError, wipePacksOnRevoke } from "./phone-revoke";

const who = { user_id: "u1", org_id: "o1" };
const scope = { userId: "u1", orgId: "o1" };
const now = new Date("2026-10-09T15:00:00.000Z");

describe("isPhoneRevokedError", () => {
  it("treats HTTP 401 and SQLSTATE 28000 as a revoked phone session", () => {
    expect(isPhoneRevokedError(phoneRevokedError())).toBe(true);
    expect(isPhoneRevokedError({ message: "phone revoked", code: "28000" })).toBe(true);
    expect(isPhoneRevokedError({ status: 401, message: "JWT expired" })).toBe(true);
    expect(isPhoneRevokedError({ message: "not allowed", code: "42501" })).toBe(false);
    expect(isPhoneRevokedError(new Error("offline"))).toBe(false);
  });
});

describe("wipe on revoke", () => {
  it("clears day packs when sync returns 401 after office revoke", async () => {
    const store = createMemoryCrewStore();
    await saveDayPack(store, "2026-10-09", { stops: 2 }, now);
    await enqueueMutation(store, { kind: "visit_start", visit_id: "v1", ...who }, now);
    expect(await store.listPacks()).toHaveLength(1);

    const result = await flushOutbox(store, async () => {
      throw phoneRevokedError();
    }, scope, now);

    expect(result.revoked).toBe(true);
    expect(await store.listPacks()).toEqual([]);
    // Outbox stays so the lead can recover work after office clears the revoke.
    expect(await store.listOutbox()).toHaveLength(1);
  });

  it("wipes packs through the shared helper without touching the outbox", async () => {
    const store = createMemoryCrewStore();
    await saveDayPack(store, "2026-10-09", { stops: 1 }, now);
    await enqueueMutation(store, { kind: "visit_finish", visit_id: "v1", ...who }, now);
    await wipePacksOnRevoke(store, phoneRevokedError());
    expect(await store.listPacks()).toEqual([]);
    expect(await store.listOutbox()).toHaveLength(1);
    await wipePacksOnRevoke(store, new Error("offline"));
    expect(await store.listOutbox()).toHaveLength(1);
  });
});
