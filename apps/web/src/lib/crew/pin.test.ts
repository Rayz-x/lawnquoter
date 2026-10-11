import { describe, expect, it } from "vitest";
import {
  CREW_IDLE_MS,
  createPinLockController,
  hashCrewPin,
  pinDigestMaterial,
  pinLooksValid,
  shouldLockForIdle,
  writeLocalPinHash,
} from "./pin";

function memoryStorage(seed: Record<string, string> = {}) {
  const data = { ...seed };
  return {
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
  };
}

describe("crew PIN lock", () => {
  it("locks after idle and stays unlocked while active", () => {
    const activeAt = Date.parse("2026-10-10T12:00:00.000Z");
    expect(shouldLockForIdle(activeAt, activeAt + CREW_IDLE_MS - 1)).toBe(false);
    expect(shouldLockForIdle(activeAt, activeAt + CREW_IDLE_MS)).toBe(true);
    expect(shouldLockForIdle(activeAt, activeAt + CREW_IDLE_MS, 60_000)).toBe(true);
  });

  it("accepts a four to six digit PIN", () => {
    expect(pinLooksValid("1234")).toBe(true);
    expect(pinLooksValid("123456")).toBe(true);
    expect(pinLooksValid("12")).toBe(false);
    expect(pinLooksValid("1234567")).toBe(false);
    expect(pinLooksValid("12ab")).toBe(false);
  });

  it("builds a stable digest material for the author", () => {
    expect(pinDigestMaterial("user-1", "1234")).toBe("user-1:1234");
  });

  it("locks after idle and unlocks only with the lead PIN", async () => {
    const storage = memoryStorage();
    writeLocalPinHash(storage, "maria", await hashCrewPin("maria", "2468"));
    let now = Date.parse("2026-10-10T12:00:00.000Z");
    const lock = createPinLockController({
      userId: "maria",
      storage,
      idleMs: 1_000,
      now: () => now,
    });
    expect(lock.isLocked()).toBe(false);
    now += 1_000;
    lock.tick();
    expect(lock.isLocked()).toBe(true);
    expect(await lock.unlock("0000")).toBe(false);
    expect(lock.isLocked()).toBe(true);
    expect(await lock.unlock("2468")).toBe(true);
    expect(lock.isLocked()).toBe(false);
  });
});
