import { describe, expect, it } from "vitest";
import { QBO_NOT_CONNECTED, qboConflict, qboCustomerBody, syncQboCustomers, type QboSyncStore } from "./qbo";

describe("QuickBooks customers", () => {
  it("maps a child account to a sub-customer", () => {
    expect(qboCustomerBody("Parent Co", null)).toEqual({ DisplayName: "Parent Co", Job: false });
    expect(qboCustomerBody("North lot", "42")).toEqual({
      DisplayName: "North lot",
      Job: true,
      ParentRef: { value: "42" },
    });
  });

  it("flags a conflict only when both sides changed after the last sync", () => {
    expect(qboConflict("2026-10-02", "2026-10-03", "2026-10-01")).toBe(true);
    expect(qboConflict("2026-10-02", "2026-09-01", "2026-10-01")).toBe(false);
    expect(qboConflict("2026-10-02", "2026-10-03", null)).toBe(false);
  });

  it("does not sync until the QuickBooks keys are set", async () => {
    delete process.env.QBO_CLIENT_ID;
    delete process.env.QBO_CLIENT_SECRET;
    const store = { accounts: async () => [], links: async () => [], saveLink: async () => {}, saveConflict: async () => {}, log: async () => {} };
    expect(await syncQboCustomers(store, { upsertCustomer: async () => ({ id: "1", syncToken: "0" }), remoteName: async () => null })).toEqual({
      error: QBO_NOT_CONNECTED,
    });
  });

  it("pushes the parent before the child and records a conflict", async () => {
    process.env.QBO_CLIENT_ID = "id";
    process.env.QBO_CLIENT_SECRET = "secret";
    const bodies: unknown[] = [];
    const conflicts: string[] = [];
    const store: QboSyncStore = {
      accounts: async () => [
        { id: "child", name: "North lot", parentAccountId: "parent", updatedAt: "2026-10-02" },
        { id: "parent", name: "Parent Co", parentAccountId: null, updatedAt: "2026-10-04" },
      ],
      links: async () => [
        { localId: "parent", qboId: "42", syncToken: "0", lastSyncedAt: "2026-10-01", remoteUpdatedAt: "2026-10-03" },
      ],
      saveLink: async () => {},
      saveConflict: async (input) => {
        conflicts.push(input.localName);
      },
      log: async () => {},
    };
    const result = await syncQboCustomers(store, {
      upsertCustomer: async (body) => {
        bodies.push(body);
        return { id: "99", syncToken: "1" };
      },
      remoteName: async () => ({ name: "Parent Co QBO", updatedAt: "2026-10-03" }),
    });
    delete process.env.QBO_CLIENT_ID;
    delete process.env.QBO_CLIENT_SECRET;
    expect(result).toEqual({ pushed: 1, conflicts: 1 });
    expect(conflicts).toEqual(["Parent Co"]);
    expect(bodies).toEqual([{ DisplayName: "North lot", Job: true, ParentRef: { value: "42" } }]);
  });
});
