"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ENHANCEMENT_TAGS, SKIP_REASONS, readEnhancements, sendReadyEnhancements, skipNeedsPhoto, writeEnhancements,
  type PendingEnhancement,
} from "@/lib/crew/field";
import { downscalePhoto } from "@/lib/crew/photo";
import { browserCrewStore, enqueueMutation, enqueuePhoto, flushOutbox, notifyCrewQueue, saveDayPack } from "@/lib/crew/queue";
import { sendCrewSync, uploadVisitPhoto } from "@/lib/crew/sync";
import { createClient } from "@/lib/supabase/client";
import type { Json } from "@/lib/supabase/database.types";
import { patchVisitPack, visitFromPack } from "../visit";

export function VisitActions({ visitId, userId, orgId, onLeave }: { visitId: string; userId: string; orgId: string; onLeave(): void }) {
  const scope = `${userId}:${orgId}`;
  const issue = useRef<HTMLInputElement>(null);
  const upsell = useRef<HTMLInputElement>(null);
  const [sheet, setSheet] = useState<"problem" | "upsell" | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [issueFile, setIssueFile] = useState<File | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [upsellFile, setUpsellFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    const resolve = async () => {
      const store = browserCrewStore();
      const pending = readEnhancements(localStorage, scope);
      if (pending.length === 0) return;
      const left = await sendReadyEnhancements(store, { userId, orgId }, pending, lookupPhoto);
      if (stop) return;
      writeEnhancements(localStorage, scope, left);
      if (left.length !== pending.length) void flushOutbox(store, sendCrewSync, { userId, orgId }, new Date(), uploadVisitPhoto).then(() => notifyCrewQueue());
    };
    void resolve();
    window.addEventListener("crew-queue", resolve);
    window.addEventListener("online", resolve);
    return () => {
      stop = true;
      window.removeEventListener("crew-queue", resolve);
      window.removeEventListener("online", resolve);
    };
  }, [scope, userId, orgId]);

  async function confirmSkip() {
    if (!reason || busy) return;
    if (skipNeedsPhoto(reason) && !issueFile) return;
    setBusy(true);
    setError(null);
    try {
      const store = browserCrewStore();
      if (issueFile) {
        const jpeg = await downscalePhoto(issueFile);
        await enqueuePhoto(store, { visit_id: visitId, user_id: userId, org_id: orgId, bytes: jpeg, photo_kind: "issue", taken_at: new Date().toISOString() });
      }
      await enqueueMutation(store, { kind: "visit_skip", visit_id: visitId, user_id: userId, org_id: orgId, payload: { reason } });
      const packs = await store.listPacks();
      const row = packs.find((pack) => visitFromPack(pack.pack, visitId));
      if (row) await saveDayPack(store, row.date, patchVisitPack(row.pack, visitId, { status: "skipped", skip_reason: reason }) as Json);
      void flushOutbox(store, sendCrewSync, { userId, orgId }, new Date(), uploadVisitPhoto);
      window.dispatchEvent(new Event("crew-pack"));
      toast("Stop skipped. It sends when you have signal.");
      onLeave();
    } catch {
      setError("Could not save that skip.");
    } finally {
      setBusy(false);
    }
  }

  async function saveUpsell() {
    if (!tag || busy) return;
    setBusy(true);
    setError(null);
    try {
      const store = browserCrewStore();
      const item: PendingEnhancement = {
        clientId: crypto.randomUUID(), visitId, userId, orgId, tag, note, photoClientId: null,
      };
      if (upsellFile) {
        const jpeg = await downscalePhoto(upsellFile);
        const row = await enqueuePhoto(store, { visit_id: visitId, user_id: userId, org_id: orgId, bytes: jpeg, photo_kind: "upsell", taken_at: new Date().toISOString() });
        item.photoClientId = row.client_id;
        writeEnhancements(localStorage, scope, [...readEnhancements(localStorage, scope), item]);
        void flushOutbox(store, sendCrewSync, { userId, orgId }, new Date(), uploadVisitPhoto).then(() => notifyCrewQueue());
      } else {
        await sendReadyEnhancements(store, { userId, orgId }, [item], async () => null);
        void flushOutbox(store, sendCrewSync, { userId, orgId }, new Date(), uploadVisitPhoto);
      }
      toast("Upsell saved on this phone.");
      setSheet(null);
      setTag(null);
      setNote("");
      setUpsellFile(null);
    } catch {
      setError("Could not save that upsell.");
    } finally {
      setBusy(false);
    }
  }

  const needPhoto = reason ? skipNeedsPhoto(reason) : false;
  return (
    <>
      <div className="mt-4 flex gap-2">
        <button type="button" className="inline-flex min-h-14 flex-1 items-center justify-center rounded-xl border text-[17px] font-semibold" onClick={() => { setSheet("problem"); setError(null); }}>Problem</button>
        <button type="button" className="inline-flex min-h-14 flex-1 items-center justify-center rounded-xl border text-[17px] font-semibold" onClick={() => { setSheet("upsell"); setError(null); }}>Upsell</button>
      </div>
      {sheet ? (
        <div className="fixed inset-0 z-40 overflow-y-auto bg-background px-4 pt-[max(1rem,env(safe-area-inset-top,0px))] pb-8">
          <button type="button" className="inline-flex min-h-12 items-center text-[17px] font-semibold" onClick={() => setSheet(null)}>Back</button>
          {sheet === "problem" ? (
            <>
              <h2 className="mt-2 font-serif text-2xl font-bold">Problem</h2>
              <div className="mt-4 flex flex-col gap-2">
                {SKIP_REASONS.map(([id, label]) => (
                  <button key={id} type="button" className={`min-h-14 rounded-xl border px-3 text-left text-[17px] font-semibold ${reason === id ? "border-2 border-primary" : ""}`} onClick={() => { setReason(id); setIssueFile(null); }}>{label}</button>
                ))}
              </div>
              {needPhoto ? <button type="button" className="mt-4 flex min-h-14 w-full items-center justify-center rounded-xl border text-[17px] font-semibold" onClick={() => issue.current?.click()}>{issueFile ? "Photo ready" : "Take problem photo"}</button> : null}
              <p className="mt-3 text-[15px] text-muted-foreground">{needPhoto ? "Gate locked and dog loose need a photo." : "Keep working, or skip this stop."}</p>
              <div className="mt-4 flex gap-2">
                <button type="button" className="inline-flex min-h-14 flex-1 items-center justify-center rounded-xl border text-[17px] font-semibold" onClick={() => setSheet(null)}>Keep working</button>
                <button type="button" className="inline-flex min-h-14 flex-1 items-center justify-center rounded-xl bg-primary text-[17px] font-semibold text-primary-foreground disabled:opacity-50" disabled={!reason || (needPhoto && !issueFile) || busy} onClick={() => void confirmSkip()}>Cannot finish</button>
              </div>
            </>
          ) : (
            <>
              <h2 className="mt-2 font-serif text-2xl font-bold">Upsell</h2>
              <div className="mt-4 flex flex-wrap gap-2">
                {ENHANCEMENT_TAGS.map(([id, label]) => (
                  <button key={id} type="button" className={`inline-flex min-h-12 items-center rounded-xl border px-3 text-[17px] font-semibold ${tag === id ? "border-2 border-primary" : ""}`} onClick={() => setTag(id)}>{label}</button>
                ))}
              </div>
              <textarea value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} placeholder="Note for the office" className="mt-4 min-h-24 w-full rounded-xl border p-3 text-[17px]" />
              <button type="button" className="mt-3 flex min-h-14 w-full items-center justify-center rounded-xl border text-[17px] font-semibold" onClick={() => upsell.current?.click()}>{upsellFile ? "Photo ready" : "Add photo"}</button>
              <button type="button" className="mt-3 flex min-h-14 w-full items-center justify-center rounded-xl bg-primary text-[17px] font-semibold text-primary-foreground disabled:opacity-50" disabled={!tag || busy} onClick={() => void saveUpsell()}>Save upsell</button>
            </>
          )}
          {error ? <p className="mt-3 text-[15px] font-semibold text-destructive">{error}</p> : null}
          <input ref={issue} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(event) => setIssueFile(event.target.files?.[0] ?? null)} />
          <input ref={upsell} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(event) => setUpsellFile(event.target.files?.[0] ?? null)} />
        </div>
      ) : null}
    </>
  );
}

async function lookupPhoto(photoClientId: string) {
  const { data, error } = await createClient().from("visit_photos").select("id").eq("client_id", photoClientId).maybeSingle();
  if (error || !data) return null;
  return data.id;
}
