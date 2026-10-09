"use client";

import { useEffect } from "react";
import { VIEW_DWELL_MS, VIEW_INTERACTION_DEBOUNCE_MS, viewSignalAllowed } from "@/lib/quotes/view-signal";

function signal(): { visibility: string; hasFocus: boolean; webdriver: boolean } {
  return {
    visibility: document.visibilityState,
    hasFocus: document.hasFocus(),
    webdriver: navigator.webdriver,
  };
}

/** Posts one view after a real interaction or a visible, focused dwell. */
export function RecordView({ token, status }: { token: string; status: string }) {
  useEffect(() => {
    if (status === "accepted" || status === "declined") return;
    const key = `lq-view:${token}`;
    try {
      if (sessionStorage.getItem(key)) return;
    } catch {
      // sessionStorage can throw in private mode. The RPC is still idempotent.
    }

    let sent = false;
    let dwell = 0;
    let interaction = 0;

    const send = () => {
      if (sent) return;
      if (!viewSignalAllowed(signal())) return;
      sent = true;
      void fetch(`/q/${token}/view`, {
        method: "POST",
        keepalive: true,
        headers: { "x-lq-view": "1" },
      })
        .then((response) => {
          if (!response.ok) {
            sent = false;
            return;
          }
          try {
            sessionStorage.setItem(key, "1");
          } catch {
            // The RPC already recorded the view.
          }
        })
        .catch(() => {
          sent = false;
        });
    };

    const onInteract = () => {
      window.clearTimeout(interaction);
      interaction = window.setTimeout(send, VIEW_INTERACTION_DEBOUNCE_MS);
    };
    const armDwell = () => {
      window.clearTimeout(dwell);
      if (!viewSignalAllowed(signal())) return;
      dwell = window.setTimeout(send, VIEW_DWELL_MS);
    };
    const pauseDwell = () => window.clearTimeout(dwell);

    const events = ["pointerdown", "keydown", "touchstart"] as const;
    for (const event of events) document.addEventListener(event, onInteract, { passive: true });
    document.addEventListener("visibilitychange", armDwell);
    window.addEventListener("focus", armDwell);
    window.addEventListener("blur", pauseDwell);
    armDwell();

    return () => {
      window.clearTimeout(dwell);
      window.clearTimeout(interaction);
      for (const event of events) document.removeEventListener(event, onInteract);
      document.removeEventListener("visibilitychange", armDwell);
      window.removeEventListener("focus", armDwell);
      window.removeEventListener("blur", pauseDwell);
    };
  }, [token, status]);

  return null;
}
