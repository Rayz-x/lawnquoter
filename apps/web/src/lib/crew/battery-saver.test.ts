import { describe, expect, it, vi } from "vitest";
import {
  CREW_BATTERY_SAVER_EVENT,
  CREW_BATTERY_SAVER_KEY,
  crewShellDisplayClass,
  readBatterySaver,
  setBatterySaver,
  suggestBatterySaver,
} from "./battery-saver";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
    removeItem(key: string) {
      map.delete(key);
    },
  };
}

describe("crew battery saver preference", () => {
  it("defaults to off and survives a reload via storage", () => {
    const storage = memoryStorage();
    expect(readBatterySaver(storage)).toBe(false);
    setBatterySaver(storage, true);
    expect(storage.getItem(CREW_BATTERY_SAVER_KEY)).toBe("1");
    expect(readBatterySaver(storage)).toBe(true);
    setBatterySaver(storage, false);
    expect(readBatterySaver(storage)).toBe(false);
  });

  it("notifies listeners when the toggle changes", () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    setBatterySaver(memoryStorage(), true);
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: CREW_BATTERY_SAVER_EVENT }));
    vi.unstubAllGlobals();
  });
});

describe("crewShellDisplayClass", () => {
  it("forces the dark outdoor theme and reduced motion when battery saver is on", () => {
    expect(crewShellDisplayClass("light", true)).toBe("dark crew-battery-saver");
    expect(crewShellDisplayClass("sun", true)).toBe("dark crew-battery-saver");
    expect(crewShellDisplayClass("dark", true)).toBe("dark crew-battery-saver");
  });

  it("keeps the normal light / dark / sun classes when battery saver is off", () => {
    expect(crewShellDisplayClass("light", false)).toBe("crew-display-light");
    expect(crewShellDisplayClass("sun", false)).toBe("crew-display-light sun");
    expect(crewShellDisplayClass("dark", false)).toBe("dark");
  });
});

describe("suggestBatterySaver", () => {
  it("only offers a hint when the Battery Status API reports a low uncharged level", () => {
    expect(suggestBatterySaver({ supported: false })).toBe(false);
    expect(suggestBatterySaver({ supported: true, level: 0.4, charging: false })).toBe(false);
    expect(suggestBatterySaver({ supported: true, level: 0.15, charging: true })).toBe(false);
    expect(suggestBatterySaver({ supported: true, level: 0.15, charging: false })).toBe(true);
  });
});
