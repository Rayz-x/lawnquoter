export const CREW_BATTERY_SAVER_KEY = "crew-battery-saver";
export const CREW_BATTERY_SAVER_EVENT = "crew-battery-saver";

export type CrewDisplayMode = "light" | "dark" | "sun";

export function readBatterySaver(storage: Pick<Storage, "getItem">): boolean {
  return storage.getItem(CREW_BATTERY_SAVER_KEY) === "1";
}

export function setBatterySaver(storage: Pick<Storage, "setItem">, on: boolean): void {
  storage.setItem(CREW_BATTERY_SAVER_KEY, on ? "1" : "0");
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CREW_BATTERY_SAVER_EVENT));
  }
}

export function subscribeBatterySaver(notify: () => void): () => void {
  window.addEventListener(CREW_BATTERY_SAVER_EVENT, notify);
  return () => window.removeEventListener(CREW_BATTERY_SAVER_EVENT, notify);
}

/** Battery saver forces the dark outdoor theme from #24 and reduces motion. */
export function crewShellDisplayClass(display: CrewDisplayMode, batterySaver: boolean): string {
  if (batterySaver) return "dark crew-battery-saver";
  if (display === "dark") return "dark";
  if (display === "sun") return "crew-display-light sun";
  return "crew-display-light";
}

/** Soft offer only — Safari has no Battery Status API, so never auto-enable. */
export function suggestBatterySaver(input: {
  supported: boolean;
  level?: number;
  charging?: boolean;
}): boolean {
  if (!input.supported) return false;
  if (input.charging) return false;
  return typeof input.level === "number" && input.level <= 0.2;
}
