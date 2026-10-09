"use client";

import { useEffect, useRef, useState } from "react";
import { packIsFresh } from "@/app/(crew)/crew/today";
import { afterPhotoReady, downscalePhoto, packPhotoKinds } from "@/lib/crew/photo";
import { browserCrewStore, enqueuePhoto, flushOutbox, notifyCrewQueue } from "@/lib/crew/queue";
import { sendCrewSync, uploadVisitPhoto } from "@/lib/crew/sync";

type Shot = { clientId: string; kind: string; url: string | null; needsOffice: boolean };

export type VisitPhotosHandle = { pickAfter(): void };

export function VisitPhotos({
  visitId, userId, orgId, onAfter, pickRef,
}: {
  visitId: string;
  userId: string;
  orgId: string;
  onAfter(ready: boolean): void;
  pickRef: { current: VisitPhotosHandle | null };
}) {
  const input = useRef<HTMLInputElement>(null);
  const kind = useRef<"before" | "after">("after");
  const [shots, setShots] = useState<Shot[]>([]);
  const [savedAfter, setSavedAfter] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    pickRef.current = { pickAfter() { kind.current = "after"; input.current?.click(); } };
    return () => { pickRef.current = null; };
  }, [pickRef]);

  useEffect(() => {
    let stop = false;
    const urls: string[] = [];
    const load = async () => {
      const store = browserCrewStore();
      const packs = (await store.listPacks()).filter((row) => packIsFresh(row.saved_at, new Date()));
      const saved = packs.some((row) => packPhotoKinds(row.pack, visitId).includes("after"));
      const rows = (await store.listOutbox()).filter((row) => row.user_id === userId && row.org_id === orgId && row.visit_id === visitId && row.kind === "visit_photo_record");
      const next: Shot[] = [];
      for (const row of rows) {
        const bytes = await store.getPhoto(row.client_id);
        const url = bytes ? URL.createObjectURL(bytes) : null;
        if (stop) {
          if (url) URL.revokeObjectURL(url);
          return;
        }
        if (url) urls.push(url);
        next.push({ clientId: row.client_id, kind: typeof row.payload.photo_kind === "string" ? row.payload.photo_kind : "", url, needsOffice: row.needs_office });
      }
      if (stop) return;
      setSavedAfter(saved);
      setShots(next);
      onAfter(afterPhotoReady(saved ? ["after"] : [], next));
    };
    void load();
    window.addEventListener("crew-queue", load);
    return () => {
      stop = true;
      window.removeEventListener("crew-queue", load);
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [visitId, userId, orgId, onAfter]);

  function pick(next: "before" | "after") {
    kind.current = next;
    input.current?.click();
  }

  async function onFile(file: File | undefined) {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      const [jpeg, fix] = await Promise.all([downscalePhoto(file), coarseFix()]);
      await enqueuePhoto(browserCrewStore(), {
        visit_id: visitId, user_id: userId, org_id: orgId, bytes: jpeg, photo_kind: kind.current,
        taken_at: new Date().toISOString(), lat: fix?.lat, lng: fix?.lng,
      });
      notifyCrewQueue();
      void flushOutbox(browserCrewStore(), sendCrewSync, { userId, orgId }, new Date(), uploadVisitPhoto);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "";
      setError(message === "That photo is too large." || message === "Could not read that photo." ? message : "Could not save that photo.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  const office = shots.some((shot) => shot.kind === "after" && shot.needsOffice);
  return (
    <div className="mt-4">
      <p className="text-[15px] font-semibold">After photo required</p>
      {shots.some((shot) => shot.url) ? (
        <ul className="mt-2 flex gap-2 overflow-x-auto">
          {shots.flatMap((shot) => shot.url ? [<li key={shot.clientId} role="img" aria-label={shot.kind === "after" ? "After photo" : "Before photo"} className="h-16 w-16 rounded-lg bg-cover bg-center" style={{ backgroundImage: `url("${shot.url}")` }} />] : [])}
        </ul>
      ) : null}
      {savedAfter ? <p className="mt-2 text-[15px]">After photo saved</p> : null}
      {office ? <p className="mt-2 text-[15px] font-semibold text-warning">That after photo needs the office.</p> : null}
      <div className="mt-2 flex gap-2">
        <button type="button" className="inline-flex min-h-14 flex-1 items-center justify-center rounded-xl border text-[17px] font-semibold" disabled={busy} onClick={() => pick("before")}>Before</button>
        <button type="button" className="inline-flex min-h-14 flex-[2] items-center justify-center rounded-xl bg-primary text-[17px] font-semibold text-primary-foreground" disabled={busy} onClick={() => pick("after")}>{busy ? "Saving photo" : "Take after photo"}</button>
      </div>
      {error ? <p className="mt-2 text-[15px] font-semibold text-destructive">{error}</p> : null}
      <input ref={input} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(event) => void onFile(event.target.files?.[0])} />
    </div>
  );
}

function coarseFix(): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), 1500);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        window.clearTimeout(timer);
        resolve({ lat: position.coords.latitude, lng: position.coords.longitude });
      },
      () => {
        window.clearTimeout(timer);
        resolve(null);
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 1200 },
    );
  });
}
