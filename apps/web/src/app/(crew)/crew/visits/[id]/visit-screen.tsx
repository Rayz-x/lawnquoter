"use client";

import { gateWidthLabel, isNarrowGate } from "@/lib/property/gate";
import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { driveUrl, officeTel, packIsFresh, statusLabel } from "@/app/(crew)/crew/today";
import { browserCrewStore, enqueueMutation, flushOutbox, loadDayPack, saveDayPack, scopeKey, type OutboxRow } from "@/lib/crew/queue";
import { sendCrewSync, uploadVisitPhoto } from "@/lib/crew/sync";
import { createClient } from "@/lib/supabase/client";
import type { Json } from "@/lib/supabase/database.types";
import {
  activeAddress, alreadyDoneMessage, applyClock, budgetLabel, cachedLiveLead, crewIdFromPack, crewNameFromPack, elapsedMs, formatElapsed, isAlreadyDoneByOtherCrew, isMidVisitCancel, liveLeadFromPack, midVisitCancelMessage, patchVisitPack, projectVisit, readClock, saveLeadForPack, visitFromPack, visitsInPack, writeClock,
  type ClockAction, type Segment, type VisitClock, type VisitDetail,
} from "../visit";
import { VisitActions } from "./visit-actions";
import { VisitPhotos, type VisitPhotosHandle } from "./visit-photos";

const ACTIONS = new Set(["visit_start", "visit_pause", "visit_resume", "visit_finish", "visit_stop", "visit_set_crew_size"]);

export function VisitScreen({ visitId, timeZone, userId, orgId, onBack }: { visitId: string; timeZone: string; userId: string; orgId: string; onBack?: () => void }) {
  const router = useRouter();
  const scope = scopeKey(userId, orgId);
  const revision = useRef(0);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [now, setNow] = useState(() => new Date());
  const [detail, setDetail] = useState<VisitDetail | null>(null);
  const [others, setOthers] = useState<VisitDetail[]>([]);
  const [clock, setClock] = useState<VisitClock | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [packDate, setPackDate] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showGate, setShowGate] = useState(false);
  const [lead, setLead] = useState(false);
  const [packCrewName, setPackCrewName] = useState<string | null>(null);
  const photos = useRef<VisitPhotosHandle | null>(null);
  const [afterFor, setAfterFor] = useState(visitId);
  const [afterReady, setAfterReady] = useState(false);
  const [afterQueued, setAfterQueued] = useState(false);
  const [afterNeedsOffice, setAfterNeedsOffice] = useState(false);
  if (afterFor !== visitId) {
    setAfterFor(visitId);
    setAfterReady(false);
    setAfterQueued(false);
    setAfterNeedsOffice(false);
  }

  useEffect(() => {
    if (clock?.status !== "in_progress") return;
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, [clock?.status]);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      const seen = revision.current;
      const store = browserCrewStore();
      const packs = (await store.listPacks()).filter((row) => packIsFresh(row.saved_at, new Date()) && visitFromPack(row.pack, visitId));
      const row = packs.sort((a, b) => b.saved_at.localeCompare(a.saved_at))[0];
      const visit = row ? visitFromPack(row.pack, visitId) : null;
      const rows = (await store.listOutbox()).filter((item) => item.user_id === userId && item.org_id === orgId);
      const afterRows = rows.filter(
        (item) => item.visit_id === visitId && item.kind === "visit_photo_record" && item.payload.photo_kind === "after",
      );
      const afterQueue = afterRows.length > 0;
      const afterOffice = afterRows.some((item) => item.needs_office);
      let entries: Segment[] | null = null;
      try {
        const { data, error: rpcError } = await createClient().from("time_entries").select("kind, started_at, ended_at").eq("visit_id", visitId);
        if (!rpcError && data?.length) entries = data.flatMap((item) => (item.kind === "job" || item.kind === "pause" ? [{ kind: item.kind, startedAt: item.started_at, endedAt: item.ended_at }] : []));
      } catch {
        entries = null;
      }
      const crewId = row ? crewIdFromPack(row.pack) : null;
      let live = cachedLiveLead(localStorage, userId, orgId, crewId) === true;
      if (liveLeadFromPack(row?.pack) !== null && crewId) {
        live = saveLeadForPack(localStorage, userId, orgId, row?.pack, null, null) === true;
      } else {
        try {
          const supabase = createClient();
          const [{ data: crews, error: crewError }, { data: membership, error: memberError }] = await Promise.all([
            supabase.rpc("my_crews"),
            supabase.from("memberships").select("role, status").eq("user_id", userId).eq("org_id", orgId).maybeSingle(),
          ]);
          if (!crewError && !memberError && crewId) {
            live = saveLeadForPack(localStorage, userId, orgId, row?.pack, crews, membership) === true;
          }
        } catch {
          live = cachedLiveLead(localStorage, userId, orgId, crewId) === true;
        }
      }
      if (stop || seen !== revision.current) return;
      setLead(live);
      if (!visit || !row) {
        setDetail(null);
        setReady(true);
        return;
      }
      const next = projectVisit(visit, readClock(localStorage, scope, visitId), entries, pending(rows, visitId));
      writeClock(localStorage, scope, visitId, next);
      const office = row.pack && typeof row.pack === "object" && "office" in row.pack ? (row.pack as { office?: { phone?: unknown } }).office : null;
      setPhone(typeof office?.phone === "string" ? office.phone : null);
      setPackDate(row.date);
      setPackCrewName(crewNameFromPack(row.pack));
      setDetail(visit);
      setClock(next);
      setAfterQueued(afterQueue);
      setAfterNeedsOffice(afterOffice);
      setOthers(visitsInPack(row.pack).map((item) => ({ ...item, status: item.id === visitId ? next.status : projectVisit(item, readClock(localStorage, scope, item.id), null, pending(rows, item.id)).status })));
      setReady(true);
    };
    void load();
    window.addEventListener("online", load);
    window.addEventListener("crew-queue", load);
    window.addEventListener("crew-pack", load);
    return () => {
      stop = true;
      window.removeEventListener("online", load);
      window.removeEventListener("crew-queue", load);
      window.removeEventListener("crew-pack", load);
    };
  }, [visitId, userId, orgId, scope]);

  async function act(kind: ClockAction["kind"], crewSize?: number) {
    if (!lead || !detail || !clock || saving) return;
    revision.current += 1;
    setSaving(true);
    setError(null);
    try {
      const row = await enqueueMutation(browserCrewStore(), {
        kind, visit_id: visitId, user_id: userId, org_id: orgId,
        payload: kind === "visit_set_crew_size" ? { crew_size: crewSize } : {},
      });
      const next = applyClock(clock, { clientId: row.client_id, kind, at: row.occurred_at, crewSize });
      writeClock(localStorage, scope, visitId, next);
      setClock(next);
      revision.current += 1;
      setOthers((items) => items.map((item) => (item.id === visitId ? { ...item, status: next.status } : item)));
      if (packDate) {
        const store = browserCrewStore();
        const current = await loadDayPack(store, packDate);
        if (current) {
          const photoPending = kind === "visit_finish" ? afterQueued && !afterNeedsOffice : undefined;
          await saveDayPack(
            store,
            packDate,
            patchVisitPack(current.pack, visitId, {
              status: next.status,
              started_at: next.startedAt ?? undefined,
              crew_size: next.crewSize ?? undefined,
              ...(photoPending !== undefined ? { photo_pending: photoPending, photo_lost: afterNeedsOffice } : {}),
            }) as Json,
          );
        }
      }
      void flushOutbox(browserCrewStore(), sendCrewSync, { userId, orgId }, new Date(), uploadVisitPhoto);
      window.dispatchEvent(new Event("crew-pack"));
      if (kind === "visit_finish" || kind === "visit_stop") {
        toast(kind === "visit_stop" ? "Stopped. The office cancel stays." : `Stop ${detail.number} saved. It sends when you have signal.`);
        if (onBack) onBack();
        else router.push("/crew/today");
      }
    } catch {
      setError("Could not save that change.");
    } finally {
      setSaving(false);
    }
  }

  if (!ready) return <section className="px-4 pt-6 text-[17px]">Loading this stop.</section>;
  if (!detail || !clock) return <section className="px-4 pt-6 text-[17px]">This stop is not on this phone.</section>;

  const elapsed = elapsedMs(clock.segments, now);
  const over = budgetLabel(elapsed, detail.budgetMinutes);
  const running = clock.status === "in_progress" || clock.status === "paused" || clock.status === "completed";
  const blocked = clock.status === "scheduled" ? activeAddress(others, visitId) : null;
  const tel = officeTel(phone);
  const drive = detail.lat != null && detail.lng != null;
  const started = clock.startedAt ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(new Date(clock.startedAt)) : null;
  const ratio = detail.budgetMinutes ? Math.min(1, elapsed / (detail.budgetMinutes * 60_000)) : 0;
  const crewSize = clock.crewSize ?? 1;
  const midCancel = isMidVisitCancel(detail);
  const alreadyDone = isAlreadyDoneByOtherCrew(detail, clock, packCrewName);
  const closed = !midCancel && (clock.status === "cancelled" || detail.status === "cancelled");
  const needAfter = (clock.status === "in_progress" || clock.status === "paused" || midCancel) && !afterReady;
  const canAct = (!closed || midCancel) && (clock.status === "scheduled" || clock.status === "in_progress" || clock.status === "paused" || midCancel);
  const working = clock.status === "in_progress" || clock.status === "paused" || midCancel;

  return (
    <section className="flex flex-1 flex-col px-4 pt-[max(1rem,env(safe-area-inset-top,0px))] pb-28">
      {onBack ? <button type="button" className="inline-flex min-h-12 items-center text-[17px] font-semibold" onClick={onBack}>Today</button> : <Link href="/crew/today" className="inline-flex min-h-12 items-center text-[17px] font-semibold">Today</Link>}
      {!online ? <p className="mt-3 rounded-xl bg-warning/15 px-3 py-2 text-[15px] font-semibold text-warning">No signal. Your work is saved on this phone.</p> : null}
      <p className="mt-2 text-[15px] font-semibold text-muted-foreground">
        Stop {detail.number}
        {(() => {
          const label = statusLabel(clock.status, {
            photoPending: detail.photoPending || afterQueued,
            photoLost: detail.photoLost || afterNeedsOffice,
            afterQueued,
            afterNeedsOffice,
          });
          return label ? ` · ${label}` : "";
        })()}
      </p>
      <h1 className="font-serif text-2xl font-bold [overflow-wrap:anywhere]">{detail.address}</h1>
      {detail.lastName ? <p className="text-[17px]">{detail.lastName}</p> : null}
      {detail.title ? <p className="text-[15px] text-muted-foreground">{detail.title}</p> : null}
      {midCancel ? <p className="mt-3 rounded-xl bg-destructive/10 px-3 py-2 text-[15px] font-semibold text-destructive" data-testid="mid-visit-cancel">{midVisitCancelMessage()}</p> : null}
      {!midCancel && closed ? <p className="mt-3 rounded-xl bg-destructive/10 px-3 py-2 text-[15px] font-semibold text-destructive">Office cancelled this stop.</p> : null}
      {alreadyDone ? <p className="mt-3 rounded-xl bg-warning/15 px-3 py-2 text-[15px] font-semibold text-warning" data-testid="already-done">{alreadyDoneMessage(detail.completedByCrew)}</p> : null}
      <div className="mt-4 flex flex-col gap-2">
        {drive ? <a href={driveUrl(detail.lat!, detail.lng!, false)} className="flex min-h-14 items-center justify-center rounded-xl bg-primary text-[17px] font-semibold text-primary-foreground" onClick={(event) => openMaps(event, detail.lat!, detail.lng!)}>Navigate</a> : null}
        {tel ? <a href={tel} className="flex min-h-14 items-center justify-center rounded-xl border text-[17px] font-semibold">Call office</a> : null}
      </div>
      {detail.gateCode || detail.accessNotes || detail.hasDogs || detail.steep || detail.hasStairs || detail.gateWidthIn != null ? (
        <div className="mt-4 rounded-xl border p-4">
          {detail.gateCode && clock.status === "scheduled" ? <p className="text-[34px] font-bold tracking-[0.18em] tabular-nums">{detail.gateCode}</p> : null}
          {detail.gateCode && clock.status !== "scheduled" ? <button type="button" className="min-h-12 text-[17px] font-semibold" onClick={() => setShowGate((open) => !open)}>{showGate ? "Hide gate code" : "Show gate code"}</button> : null}
          {detail.gateCode && showGate && clock.status !== "scheduled" ? <p className="text-[34px] font-bold tracking-[0.18em] tabular-nums">{detail.gateCode}</p> : null}
          <ul className="mt-2 flex flex-wrap gap-2 text-[15px] font-semibold">
            {detail.gateWidthIn != null ? (
              <li className={isNarrowGate(detail.gateWidthIn) ? "text-warning" : ""}>
                {gateWidthLabel(detail.gateWidthIn)}
              </li>
            ) : null}
            {detail.hasDogs ? <li className="inline-flex items-center gap-1 text-warning"><TriangleAlert aria-hidden className="size-4" />Dog</li> : null}
            {detail.steep ? <li className="text-warning">Steep</li> : null}
            {detail.hasStairs ? <li className="text-warning">Stairs</li> : null}
          </ul>
          {detail.accessNotes ? <p className="mt-2 text-[17px]">{detail.accessNotes}</p> : null}
        </div>
      ) : null}
      {detail.officeNotes || detail.crewNote ? <p className="mt-4 border-l-4 border-brass-text pl-3 text-[17px]">{[detail.officeNotes, detail.crewNote].filter(Boolean).join(" ")}</p> : null}
      {detail.tasks.length > 0 ? <ul className="mt-4 flex flex-col gap-2">{detail.tasks.map((task) => <li key={task.label} className="text-[17px]">{task.label}{task.quantity ? ` · ${task.quantity}` : ""}{task.note ? <span className="mt-1 block text-[15px] text-muted-foreground">{task.note}</span> : null}</li>)}</ul> : null}
      {running ? (
        <div className="mt-4 rounded-xl border p-4">
          <p className="text-[52px] font-bold leading-none tabular-nums">{formatElapsed(elapsed)}</p>
          <p className="mt-2 text-[15px] text-muted-foreground">{started ? `Started ${started}` : "Started"}{detail.budgetMinutes ? ` · Budget ${detail.budgetMinutes} min` : ""}</p>
          {detail.budgetMinutes ? <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={detail.budgetMinutes} aria-valuenow={Math.min(detail.budgetMinutes, Math.floor(elapsed / 60_000))}><div className={`h-full ${over ? "bg-warning" : "bg-primary"}`} style={{ width: `${ratio * 100}%` }} /></div> : null}
          {over ? <p className="mt-2 text-[15px] font-semibold text-warning">{over}</p> : null}
          {lead && clock.status !== "completed" ? (
            <div className="mt-3 flex items-center gap-2">
              <button type="button" className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-xl border text-[17px] font-semibold" disabled={saving || crewSize <= 1} onClick={() => void act("visit_set_crew_size", crewSize - 1)}>−</button>
              <p className="text-[17px] font-semibold">On site {crewSize}</p>
              <button type="button" className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-xl border text-[17px] font-semibold" disabled={saving || crewSize >= 12} onClick={() => void act("visit_set_crew_size", crewSize + 1)}>+</button>
            </div>
          ) : null}
        </div>
      ) : null}
      {lead && working && !alreadyDone ? <VisitPhotos visitId={visitId} userId={userId} orgId={orgId} onAfter={setAfterReady} pickRef={photos} /> : null}
      {lead && canAct && !midCancel && !alreadyDone ? <VisitActions visitId={visitId} userId={userId} orgId={orgId} onLeave={() => { if (onBack) onBack(); else router.push("/crew/today"); }} /> : null}
      {blocked ? <p className="mt-4 text-[17px] font-semibold">Finish {blocked} first?</p> : null}
      {!lead ? <p className="mt-4 text-[17px]">The crew lead starts and finishes stops.</p> : null}
      {error ? <p className="mt-3 text-[15px] font-semibold text-destructive">{error}</p> : null}
      <div className="fixed inset-x-0 bottom-0 z-10 flex gap-2 bg-background px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom,0px))]">
        {lead && clock.status === "scheduled" && !closed && !midCancel ? <button type="button" className="flex min-h-14 flex-1 items-center justify-center rounded-xl bg-primary text-[17px] font-semibold text-primary-foreground disabled:opacity-50" disabled={saving || Boolean(blocked)} onClick={() => void act("visit_start")}>Start job</button> : null}
        {lead && clock.status === "in_progress" && !midCancel ? <button type="button" className="inline-flex min-h-16 min-w-16 items-center justify-center rounded-xl border text-[17px] font-semibold" disabled={saving} onClick={() => void act("visit_pause")}>Pause</button> : null}
        {lead && clock.status === "paused" && !midCancel ? <button type="button" className="inline-flex min-h-16 min-w-16 items-center justify-center rounded-xl border text-[17px] font-semibold" disabled={saving} onClick={() => void act("visit_resume")}>Resume</button> : null}
        {lead && midCancel && !alreadyDone ? (
          <button type="button" className="inline-flex min-h-14 flex-1 items-center justify-center rounded-xl border text-[17px] font-semibold" disabled={saving} onClick={() => void act("visit_stop")}>Stop</button>
        ) : null}
        {lead && working && !alreadyDone ? (
          needAfter
            ? <button type="button" className="flex min-h-14 flex-1 items-center justify-center rounded-xl bg-primary text-[17px] font-semibold text-primary-foreground" disabled={saving} onClick={() => photos.current?.pickAfter()}>Take an after photo to finish</button>
            : <button type="button" className="flex min-h-14 flex-1 items-center justify-center rounded-xl bg-primary text-[17px] font-semibold text-primary-foreground" disabled={saving} onClick={() => void act("visit_finish")}>{midCancel ? "Finish" : "Finish job"}</button>
        ) : null}
      </div>
    </section>
  );
}

function pending(rows: OutboxRow[], visitId: string): ClockAction[] {
  return rows
    .filter((row) => row.visit_id === visitId && !row.needs_office && ACTIONS.has(row.kind))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((row) => ({ clientId: row.client_id, kind: row.kind as ClockAction["kind"], at: row.occurred_at, crewSize: typeof row.payload.crew_size === "number" ? row.payload.crew_size : undefined }));
}

function openMaps(event: { preventDefault(): void }, lat: number, lng: number) {
  if (!/iPad|iPhone|iPod/.test(navigator.userAgent)) return;
  event.preventDefault();
  window.location.assign(driveUrl(lat, lng, true));
}

function subscribeOnline(notify: () => void) {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
}
