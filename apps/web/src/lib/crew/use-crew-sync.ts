"use client";

import { useEffect } from "react";
import { browserCrewStore, flushOutbox, notifyCrewQueue, purgeExpiredPacks } from "./queue";
import { sendCrewSync } from "./sync";

export function useCrewSync() {
  useEffect(() => {
    const store = browserCrewStore();
    const flush = () => {
      void flushOutbox(store, sendCrewSync).then(() => notifyCrewQueue());
      void purgeExpiredPacks(store);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "crew-flush") flush();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") flush();
    };
    flush();
    window.addEventListener("online", flush);
    document.addEventListener("visibilitychange", onVisible);
    navigator.serviceWorker?.addEventListener("message", onMessage);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") flush();
    }, 30_000);
    return () => {
      window.removeEventListener("online", flush);
      document.removeEventListener("visibilitychange", onVisible);
      navigator.serviceWorker?.removeEventListener("message", onMessage);
      window.clearInterval(timer);
    };
  }, []);
}
