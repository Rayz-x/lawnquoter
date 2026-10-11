"use client";

import { useState } from "react";
import { clearClocks, clearLiveLead } from "@/app/(crew)/crew/visits/visit";
import { browserCrewStore, outboxBlocksSignOut, wipeRouteDataOnSignOut } from "@/lib/crew/queue";
import { clearCrewCaches } from "@/lib/crew/sw-policy";

export function CrewSignOut() {
  const [warn, setWarn] = useState(false);

  async function signOut() {
    const rows = await browserCrewStore().listOutbox();
    const pending = outboxBlocksSignOut(rows.filter((row) => !row.needs_office));
    if (pending && !warn) {
      setWarn(true);
      return;
    }
    await wipeRouteDataOnSignOut(browserCrewStore());
    clearClocks(localStorage);
    clearLiveLead(localStorage);
    await clearCrewCaches();
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
        {warn ? "Sign out anyway" : "Sign out"}
      </button>
      {warn ? (
        <p className="text-[15px] text-warning">Unsent work stays on this phone until this lead signs in again.</p>
      ) : null}
    </div>
  );
}
