"use client";

import { useEffect, useState } from "react";
import {
  isLowStorage,
  lowStorageWarning,
  persistentStorageWarning,
  type StorageEstimate,
} from "@/lib/crew/photo-pending";

export function StorageSettings() {
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null);

  useEffect(() => {
    let stop = false;
    const refresh = async () => {
      try {
        const persistedResult = (await navigator.storage?.persisted?.()) ?? null;
        if (!stop) setPersisted(typeof persistedResult === "boolean" ? persistedResult : null);
      } catch {
        if (!stop) setPersisted(null);
      }
      try {
        const next = (await navigator.storage?.estimate?.()) ?? null;
        if (!stop) {
          setEstimate(
            next && typeof next === "object"
              ? { usage: typeof next.usage === "number" ? next.usage : undefined, quota: typeof next.quota === "number" ? next.quota : undefined }
              : null,
          );
        }
      } catch {
        if (!stop) setEstimate(null);
      }
    };
    void refresh();
    window.addEventListener("crew-storage", refresh);
    return () => {
      stop = true;
      window.removeEventListener("crew-storage", refresh);
    };
  }, []);

  const persistWarn = persistentStorageWarning(persisted);
  const low = isLowStorage(estimate);

  return (
    <div className="flex flex-col gap-2 rounded-xl border px-3 py-3">
      <p className="text-[17px] font-semibold">Storage</p>
      <p className="text-[15px] text-muted-foreground">
        Offline route and photos stay on this phone until they send.
      </p>
      {persistWarn ? <p className="text-[15px] font-semibold text-warning">{persistWarn}</p> : null}
      {low ? <p className="text-[15px] font-semibold text-warning">{lowStorageWarning()}</p> : null}
    </div>
  );
}
