"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { FieldHint } from "@/components/entry";
import { Switch } from "@/components/ui/switch";
import {
  readBatterySaver,
  setBatterySaver,
  subscribeBatterySaver,
  suggestBatterySaver,
} from "@/lib/crew/battery-saver";

export function BatterySaverSettings() {
  const enabled = useSyncExternalStore(subscribeBatterySaver, () => readBatterySaver(localStorage), () => false);
  const hint = useBatteryHint(enabled);

  return (
    <div className="flex flex-col gap-2 rounded-xl border px-3 py-3">
      <label className="flex min-h-12 items-center justify-between gap-3">
        <span>
          <span className="block text-[17px] font-semibold">Battery saver</span>
          <FieldHint>Outline map and fewer animations. Keeps Sun mode when you picked it. Saved on this phone.</FieldHint>
        </span>
        <Switch
          checked={enabled}
          onCheckedChange={(checked) => setBatterySaver(localStorage, checked)}
          aria-label="Battery saver"
        />
      </label>
      {hint ? <p className="text-[15px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function useBatteryHint(enabled: boolean) {
  const [lowBattery, setLowBattery] = useState(false);
  useEffect(() => {
    if (enabled) return;
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<{ level: number; charging: boolean }>;
    };
    if (typeof nav.getBattery !== "function") return;
    let stop = false;
    void nav
      .getBattery()
      .then((battery) => {
        if (stop) return;
        setLowBattery(suggestBatterySaver({ supported: true, level: battery.level, charging: battery.charging }));
      })
      .catch(() => {
        if (!stop) setLowBattery(false);
      });
    return () => {
      stop = true;
    };
  }, [enabled]);
  if (enabled || !lowBattery) return null;
  return "Battery is low. Turning this on can stretch the rest of the day.";
}
