/**
 * E2E seam for idle PIN lock: after idle the controller locks; only the PIN unlocks.
 */
import { describe, expect, it } from "vitest";
import { createPinLockController, hashCrewPin, writeLocalPinHash } from "@/lib/crew/pin";

function memoryStorage() {
  const data: Record<string, string> = {};
  return {
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
  };
}

describe("E2E: PIN lock", () => {
  it("locks the crew shell after idle until the lead PIN unlocks it", async () => {
    const storage = memoryStorage();
    writeLocalPinHash(storage, "lead-1", await hashCrewPin("lead-1", "1357"));
    let now = 1_000_000;
    const lock = createPinLockController({
      userId: "lead-1",
      storage,
      idleMs: 30_000,
      now: () => now,
    });

    lock.touch();
    now += 29_999;
    lock.tick();
    expect(lock.isLocked()).toBe(false);

    now += 1;
    lock.tick();
    expect(lock.isLocked()).toBe(true);

    expect(await lock.unlock("9999")).toBe(false);
    expect(lock.isLocked()).toBe(true);
    expect(await lock.unlock("1357")).toBe(true);
    expect(lock.isLocked()).toBe(false);
  });
});
