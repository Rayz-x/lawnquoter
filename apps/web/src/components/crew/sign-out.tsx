"use client";

import { useState } from "react";
import { browserCrewStore, outboxBlocksSignOut } from "@/lib/crew/queue";

export function CrewSignOut() {
  const [blocked, setBlocked] = useState(false);

  async function signOut() {
    const store = browserCrewStore();
    const rows = await store.listOutbox();
    if (outboxBlocksSignOut(rows)) {
      setBlocked(true);
      return;
    }
    await store.clear();
    const form = document.createElement("form");
    form.method = "post";
    form.action = "/auth/signout";
    document.body.append(form);
    form.submit();
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => void signOut()}
        className="inline-flex min-h-14 w-full items-center justify-center rounded-xl border text-[17px] font-semibold"
      >
        Sign out
      </button>
      {blocked ? <p className="text-[15px] text-warning">Sign out waits until the outbox is empty.</p> : null}
    </div>
  );
}
