"use client";

import { useEffect, useState } from "react";
import {
  browserCrewStore,
  flushOutbox,
  notifyCrewQueue,
  type OutboxRow,
} from "@/lib/crew/queue";
import { sendCrewSync, uploadVisitPhoto } from "@/lib/crew/sync";

const LABELS: Record<string, string> = {
  visit_start: "Job started",
  visit_pause: "Paused",
  visit_resume: "Resumed",
  visit_finish: "Finished",
  visit_skip: "Skipped",
  visit_reopen: "Reopened",
  visit_set_crew_size: "Crew size",
  visit_set_note: "Note",
  visit_task_set: "Checklist",
  visit_photo_record: "Photo",
  enhancement_create: "Upsell",
};

export function OutboxPanel({ userId, orgId }: { userId: string; orgId: string }) {
  const [rows, setRows] = useState<OutboxRow[]>([]);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const load = () => {
      void browserCrewStore()
        .listOutbox()
        .then((next) =>
          setRows(
            next
              .filter((row) => row.user_id === userId && row.org_id === orgId)
              .sort((a, b) => a.created_at.localeCompare(b.created_at)),
          ),
        );
    };
    load();
    window.addEventListener("crew-queue", load);
    return () => window.removeEventListener("crew-queue", load);
  }, [userId, orgId]);

  async function send() {
    setSending(true);
    await flushOutbox(browserCrewStore(), sendCrewSync, { userId, orgId }, new Date(), uploadVisitPhoto);
    notifyCrewQueue();
    setSending(false);
  }

  return (
    <section className="flex flex-col gap-4 px-4 pt-[max(1rem,env(safe-area-inset-top,0px))]">
      <h1 className="text-2xl font-bold">Outbox</h1>
      <p className="text-[15px] text-muted-foreground">
        {rows.length === 0 ? "All sent." : "Keep working. Everything is saved on this phone."}
      </p>
      <ul className="flex flex-col gap-3">
        {rows.map((row) => (
          <li key={row.client_id} className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            <p className="text-[17px] font-semibold">{LABELS[row.kind] ?? row.kind}</p>
            <p className="mt-1 text-[15px] text-muted-foreground">{row.needs_office ? "Needs the office" : (row.last_error ?? "Waiting")}</p>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={sending || rows.length === 0}
        onClick={() => void send()}
        className="inline-flex min-h-14 w-full items-center justify-center rounded-xl border bg-background text-[17px] font-semibold disabled:opacity-50"
      >
        {sending ? "Sending" : "Try sending now"}
      </button>
    </section>
  );
}
