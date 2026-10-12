"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { FieldHint } from "@/components/entry";
import {
  ENHANCEMENT_TAGS,
  SKIP_REASONS,
  queueEnhancement,
  skipNeedsNote,
  skipNeedsPhoto,
  skipPayload,
  skipPhotoKind,
} from "@/lib/crew/field";
import { downscalePhoto } from "@/lib/crew/photo";
import { browserCrewStore, enqueueMutation, enqueuePhoto, flushOutbox, saveDayPack } from "@/lib/crew/queue";
import { sendCrewSync, uploadVisitPhoto } from "@/lib/crew/sync";
import type { Json } from "@/lib/supabase/database.types";
import { patchVisitPack, visitFromPack } from "../visit";

export function VisitActions({ visitId, userId, orgId, onLeave }: { visitId: string; userId: string; orgId: string; onLeave(): void }) {
  const issue = useRef<HTMLInputElement>(null);
  const upsell = useRef<HTMLInputElement>(null);
  const [sheet, setSheet] = useState<"problem" | "upsell" | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [issueFile, setIssueFile] = useState<File | null>(null);
  const [skipNote, setSkipNote] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [upsellFile, setUpsellFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmSkip() {
    if (!reason || busy) return;
    const payload = skipPayload(reason, skipNote);
    if (!payload) return;
    if (skipNeedsPhoto(reason) && !issueFile) return;
    setBusy(true);
    setError(null);
    try {
      const store = browserCrewStore();
      const photoKind = skipPhotoKind(reason);
      if (issueFile) {
        const jpeg = await downscalePhoto(issueFile);
        await enqueuePhoto(store, {
          visit_id: visitId,
          user_id: userId,
          org_id: orgId,
          bytes: jpeg,
          photo_kind: photoKind ?? "issue",
          taken_at: new Date().toISOString(),
        });
      }
      await enqueueMutation(store, { kind: "visit_skip", visit_id: visitId, user_id: userId, org_id: orgId, payload });
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
      const item = { clientId: crypto.randomUUID(), visitId, userId, orgId, tag, note };
      if (upsellFile) {
        const jpeg = await downscalePhoto(upsellFile);
        const row = await enqueuePhoto(store, { visit_id: visitId, user_id: userId, org_id: orgId, bytes: jpeg, photo_kind: "upsell", taken_at: new Date().toISOString() });
        await queueEnhancement(store, item, row.client_id);
      } else {
        await queueEnhancement(store, item, null);
      }
      void flushOutbox(store, sendCrewSync, { userId, orgId }, new Date(), uploadVisitPhoto);
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
  const needNote = reason ? skipNeedsNote(reason) : false;
  const optionalPhoto = reason === "unsafe";
  const canSkip =
    !!reason &&
    (!needPhoto || !!issueFile) &&
    (!needNote || !!skipNote.trim()) &&
    !busy;

  return (
    <>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <button type="button" className="inline-flex min-h-14 w-full items-center justify-center rounded-xl border text-[17px] font-semibold" onClick={() => { setSheet("problem"); setError(null); }}>Problem</button>
          <FieldHint>Skip this stop when you cannot finish it.</FieldHint>
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <button type="button" className="inline-flex min-h-14 w-full items-center justify-center rounded-xl border text-[17px] font-semibold" onClick={() => { setSheet("upsell"); setError(null); }}>Upsell</button>
          <FieldHint>Ask the office about extra work. No prices.</FieldHint>
        </span>
      </div>
      {sheet ? (
        <div className="fixed inset-0 z-40 overflow-y-auto bg-background px-4 pt-[max(1rem,env(safe-area-inset-top,0px))] pb-8">
          <span className="flex min-w-0 flex-col items-start gap-1">
            <button type="button" className="inline-flex min-h-12 items-center text-[17px] font-semibold" onClick={() => setSheet(null)}>Back</button>
            <FieldHint>Closes this and returns to the stop.</FieldHint>
          </span>
          {sheet === "problem" ? (
            <>
              <h2 className="mt-2 font-serif text-2xl font-bold">Problem</h2>
              <FieldHint>Pick why you cannot finish this stop.</FieldHint>
              <div className="mt-4 flex flex-col gap-2">
                {SKIP_REASONS.map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={`min-h-14 rounded-xl border px-3 text-left text-[17px] font-semibold ${reason === id ? "border-2 border-primary" : ""}`}
                    onClick={() => {
                      setReason(id);
                      setIssueFile(null);
                      setSkipNote("");
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {needNote ? (
                <span className="mt-4 flex min-w-0 flex-col gap-1">
                  <textarea
                    value={skipNote}
                    maxLength={2000}
                    onChange={(event) => setSkipNote(event.target.value)}
                    placeholder="What makes this unsafe?"
                    className="min-h-24 w-full rounded-xl border p-3 text-[17px]"
                  />
                  <FieldHint>Describe the hazard. A photo is optional.</FieldHint>
                </span>
              ) : null}
              {needPhoto || optionalPhoto ? (
                <span className="mt-4 flex min-w-0 flex-col gap-1">
                  <button
                    type="button"
                    className="flex min-h-14 w-full items-center justify-center rounded-xl border text-[17px] font-semibold"
                    onClick={() => issue.current?.click()}
                  >
                    {issueFile ? "Photo ready" : needPhoto ? "Take after photo" : "Add photo (optional)"}
                  </button>
                  <FieldHint>
                    {needPhoto ? "Takes the after photo required to skip this stop." : "Adds a photo of the problem. Optional."}
                  </FieldHint>
                </span>
              ) : null}
              <p className="mt-3 text-[15px] text-muted-foreground">
                {needPhoto
                  ? "Gate locked and dog loose need an after photo."
                  : needNote
                    ? "Describe the hazard. A photo is optional. This goes to the office as urgent."
                    : "Keep working, or skip this stop."}
              </p>
              <div className="mt-4 flex gap-2">
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <button type="button" className="inline-flex min-h-14 w-full items-center justify-center rounded-xl border text-[17px] font-semibold" onClick={() => setSheet(null)}>Keep working</button>
                  <FieldHint>Leaves the stop in progress.</FieldHint>
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <button type="button" className="inline-flex min-h-14 w-full items-center justify-center rounded-xl bg-primary text-[17px] font-semibold text-primary-foreground disabled:opacity-50" disabled={!canSkip} onClick={() => void confirmSkip()}>Cannot finish</button>
                  <FieldHint>Skips the stop and tells the office.</FieldHint>
                </span>
              </div>
            </>
          ) : (
            <>
              <h2 className="mt-2 font-serif text-2xl font-bold">Upsell</h2>
              <p className="mt-2 text-[15px] text-muted-foreground">
                Tag, note, and photo only. No prices. Same-day work needs office approval.
              </p>
              <FieldHint>What kind of extra work this is.</FieldHint>
              <div className="mt-4 flex flex-wrap gap-2">
                {ENHANCEMENT_TAGS.map(([id, label]) => (
                  <button key={id} type="button" className={`inline-flex min-h-12 items-center rounded-xl border px-3 text-[17px] font-semibold ${tag === id ? "border-2 border-primary" : ""}`} onClick={() => setTag(id)}>{label}</button>
                ))}
              </div>
              <label className="mt-4 flex min-w-0 flex-col gap-1">
                <textarea value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} placeholder="Note for the office" className="min-h-24 w-full rounded-xl border p-3 text-[17px]" />
                <FieldHint>What the office should know. No prices.</FieldHint>
              </label>
              <span className="mt-3 flex min-w-0 flex-col gap-1">
                <button type="button" className="flex min-h-14 w-full items-center justify-center rounded-xl border text-[17px] font-semibold" onClick={() => upsell.current?.click()}>{upsellFile ? "Photo ready" : "Add photo"}</button>
                <FieldHint>Adds a photo of the extra work.</FieldHint>
              </span>
              <span className="mt-3 flex min-w-0 flex-col gap-1">
                <button type="button" className="flex min-h-14 w-full items-center justify-center rounded-xl bg-primary text-[17px] font-semibold text-primary-foreground disabled:opacity-50" disabled={!tag || busy} onClick={() => void saveUpsell()}>Save request</button>
                <FieldHint>Saves the request on the phone for the office.</FieldHint>
              </span>
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
