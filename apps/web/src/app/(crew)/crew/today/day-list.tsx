"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { VisitScreen } from "../visits/[id]/visit-screen";
import { saveLeadForPack } from "../visits/visit";
import { browserCrewStore, flushOutbox, loadDayPack, notifyCrewQueue, saveDayPack, scopeKey } from "@/lib/crew/queue";
import { sendCrewSync, uploadVisitPhoto } from "@/lib/crew/sync";
import { orgToday } from "@/lib/scheduling/office-date";
import { createClient } from "@/lib/supabase/client";
import type { Json } from "@/lib/supabase/database.types";
import {
  dayHeading,
  driveUrl,
  finishLabel,
  listRows,
  newStopIds,
  officeTel,
  offlineDayPack,
  packErrorMessage,
  parseDayPack,
  progressLabel,
  routeUpdateMessage,
  statusLabel,
  syncPill,
  type DayPackView,
  type DayStop,
} from "../today";

export function DayList({ timeZone, userId, orgId }: { timeZone: string; userId: string; orgId: string }) {
  const [now, setNow] = useState(() => new Date());
  const date = orgToday(timeZone, now);
  const [view, setView] = useState<DayPackView | null>(null);
  const [sending, setSending] = useState(false);
  const [waiting, setWaiting] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newIds, setNewIds] = useState<string[]>([]);
  const [showDone, setShowDone] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const display = useSyncExternalStore(subscribeDisplay, readDisplay, () => "light" as const);

  useEffect(() => {
    const store = browserCrewStore();
    let stop = false;
    const count = () => void store.listOutbox().then((rows) => {
      if (!stop) setWaiting(rows.filter((row) => row.user_id === userId && row.org_id === orgId).length);
    });
    count();
    window.addEventListener("crew-queue", count);
    return () => {
      stop = true;
      window.removeEventListener("crew-queue", count);
    };
  }, [userId, orgId]);

  useEffect(() => {
    const tick = () => setNow(new Date());
    const id = window.setInterval(tick, 60_000);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, []);

  useEffect(() => {
    const store = browserCrewStore();
    let stop = false;
    const refresh = async () => {
      setSending(true);
      const sessionKey = scopeKey(userId, orgId);
      if (localStorage.getItem("crew-session") !== sessionKey) {
        await store.clearPacks();
        localStorage.setItem("crew-session", sessionKey);
      }
      const stored = await loadDayPack(store, date);
      const row = offlineDayPack(stored ? { date: stored.date, savedAt: stored.saved_at, pack: stored.pack } : null, date, new Date());
      if (stored && !row) await store.deletePack(date);
      const cached = row ? parseDayPack(row.pack) : null;
      if (!stop && cached) setView(cached);
      else if (!stop && !cached) setView(null);
      try {
        await flushOutbox(store, sendCrewSync, { userId, orgId }, new Date(), uploadVisitPhoto);
        notifyCrewQueue();
        const { data, error: rpcError } = await createClient().rpc("crew_day_pack", { p_date: date });
        if (rpcError) throw new Error(rpcError.message);
        const next = parseDayPack(data);
        if (!next) throw new Error("empty");
        const added = cached ? newStopIds(cached.stops.map((stop) => stop.id), next.stops.map((stop) => stop.id)) : [];
        const removed = cached ? newStopIds(next.stops.map((stop) => stop.id), cached.stops.map((stop) => stop.id)) : [];
        const message = routeUpdateMessage(
          added.flatMap((id) => {
            const number = next.stops.find((stop) => stop.id === id)?.number;
            return number ? [number] : [];
          }),
          removed.flatMap((id) => {
            const number = cached?.stops.find((stop) => stop.id === id)?.number;
            return number ? [number] : [];
          }),
          new Date(),
        );
        if (!stop && message) {
          setNotice(message);
          toast(message);
        }
        await saveDayPack(store, date, data as Json);
        try {
          const supabase = createClient();
          const [{ data: crews, error: crewError }, { data: membership, error: memberError }] = await Promise.all([
            supabase.rpc("my_crews"),
            supabase.from("memberships").select("role, status").eq("user_id", userId).eq("org_id", orgId).maybeSingle(),
          ]);
          if (!crewError && !memberError) saveLeadForPack(localStorage, userId, orgId, data, crews, membership);
        } catch {
          // A failed lead read leaves the last saved flag in place.
        }
        if (!stop) {
          setView(next);
          setError(null);
          setNewIds(added);
        }
      } catch (caught) {
        if (!stop && !cached) setError(packErrorMessage(caught instanceof Error ? caught.message : ""));
      } finally {
        if (!stop) setSending(false);
      }
    };
    void refresh();
    window.addEventListener("online", refresh);
    window.addEventListener("crew-pack", refresh);
    return () => {
      stop = true;
      window.removeEventListener("online", refresh);
      window.removeEventListener("crew-pack", refresh);
    };
  }, [date, userId, orgId]);

  const rows = view ? listRows(view.stops) : null;
  const doneCount = view?.stops.filter((stop) => stop.status === "completed").length ?? 0;
  const finish = view ? finishLabel(view.stops, new Date()) : null;
  const tel = officeTel(view?.officePhone ?? null);
  const drive = rows?.upNext?.lat != null && rows.upNext.lng != null ? rows.upNext : null;

  return (
    <section className="flex flex-1 flex-col px-4 pt-[max(1rem,env(safe-area-inset-top,0px))] pb-28">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[15px] text-muted-foreground">{view ? `${dayHeading(view.date)} · ${view.crewName}` : "Today"}</p>
          <h1 className="text-2xl font-bold">Today</h1>
        </div>
        <div className="flex items-center gap-2">
          <p className="rounded-full bg-muted px-3 py-2 text-[15px] font-semibold">{syncPill(waiting, sending)}</p>
          <button type="button" className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-xl border px-3 text-[15px] font-semibold" onClick={cycleDisplay}>
            {display === "sun" ? "Sun" : display === "dark" ? "Dark" : "Light"}
          </button>
        </div>
      </header>
      {!online ? <p className="mt-3 rounded-xl bg-warning/15 px-3 py-2 text-[15px] font-semibold text-warning">No signal. Your work is saved on this phone.</p> : null}
      {notice ? <p className="mt-3 text-[15px] font-semibold">{notice}</p> : null}
      {!view && sending ? <p className="mt-6 text-[17px]">Loading the route.</p> : null}
      {!view && error ? <p className="mt-6 text-[17px]">{error}</p> : null}
      {view && view.stops.length === 0 ? (
        <div className="mt-6 flex flex-col gap-3">
          <p className="text-[17px]">No stops today. Check with the office.</p>
          {tel ? <a href={tel} className="inline-flex min-h-14 items-center justify-center rounded-xl border text-[17px] font-semibold">Call office</a> : null}
        </div>
      ) : null}
      {view && rows && view.stops.length > 0 ? (
        <>
          <div className="mt-4">
            <p className="text-[17px] font-semibold">{progressLabel(view.stops)}</p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={view.stops.length} aria-valuenow={doneCount}>
              <div className="h-full bg-primary" style={{ width: `${(doneCount / view.stops.length) * 100}%` }} />
            </div>
            {finish ? <p className="mt-2 text-[15px] text-muted-foreground">{finish}</p> : null}
          </div>
          <div className="mt-4 flex flex-col gap-2">
            {rows.done.length > 0 ? (
              <button type="button" className="flex min-h-12 items-center text-left text-[17px] font-semibold" onClick={() => setShowDone((open) => !open)}>
                {rows.done.length} stops done · {showDone ? "Hide" : "Show"}
              </button>
            ) : null}
            {showDone ? rows.done.map((stop) => <StopCard key={stop.id} stop={stop} fresh={newIds.includes(stop.id)} onOpen={setOpenId} />) : null}
            {rows.upNext ? <StopCard stop={rows.upNext} fresh={newIds.includes(rows.upNext.id)} next onOpen={setOpenId} /> : null}
            {rows.rest.map((stop) => <StopCard key={stop.id} stop={stop} fresh={newIds.includes(stop.id)} onOpen={setOpenId} />)}
          </div>
        </>
      ) : null}
      {drive ? (
        <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-10 px-4">
          <a
            href={driveUrl(drive.lat!, drive.lng!, false)}
            className="flex min-h-14 items-center justify-center rounded-xl bg-primary text-[17px] font-semibold text-primary-foreground"
            onClick={(event) => {
              if (!/iPad|iPhone|iPod/.test(navigator.userAgent)) return;
              event.preventDefault();
              window.location.assign(driveUrl(drive.lat!, drive.lng!, true));
            }}
          >
            Drive to stop {drive.number}
          </a>
        </div>
      ) : null}
      {openId ? (
        <div className="fixed inset-0 z-30 overflow-y-auto bg-background">
          <VisitScreen visitId={openId} timeZone={timeZone} userId={userId} orgId={orgId} onBack={() => setOpenId(null)} />
        </div>
      ) : null}
    </section>
  );
}

function StopCard({ stop, fresh, next = false, onOpen }: { stop: DayStop; fresh: boolean; next?: boolean; onOpen: (id: string) => void }) {
  const closed = stop.status === "skipped" || stop.status === "cant_complete" || stop.status === "cancelled";
  const label = statusLabel(stop.status);
  const border = next ? "border-2 border-primary" : closed ? "border border-destructive" : "border";
  return (
    <article data-crew-card className={`rounded-xl bg-card ${border}`}>
      <Link href={`/crew/visits/${stop.id}`} className="block min-h-12 p-4" onClick={(event) => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0 || navigator.onLine) return; event.preventDefault(); onOpen(stop.id); }}>
        <p className="text-[15px] font-semibold text-muted-foreground" data-crew-meta>
          {next ? "Up next" : `Stop ${stop.number}`}
          {fresh ? " · New" : ""}
          {label ? ` · ${label}` : ""}
        </p>
        <p className="text-[18px] font-bold [overflow-wrap:anywhere]">{stop.address}</p>
        {stop.lastName ? <p className="text-[17px]">{stop.lastName}</p> : null}
        {stop.title ? <p className="text-[15px] text-muted-foreground">{stop.title}</p> : null}
        {stop.skipReason ? <p className="mt-1 text-[15px]">{stop.skipReason}</p> : null}
        {stop.chips.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-2">
            {stop.chips.map((chip) => (
              <li key={chip.label} className={`inline-flex items-center gap-1 rounded-full px-2 text-[15px] font-semibold ${chip.warning ? "text-warning" : "bg-muted"}`}>
                {chip.warning ? <TriangleAlert aria-hidden className="size-4" /> : null}
                {chip.label}
              </li>
            ))}
          </ul>
        ) : null}
      </Link>
    </article>
  );
}

const DISPLAY_MODES = ["light", "dark", "sun"] as const;
type CrewDisplayMode = (typeof DISPLAY_MODES)[number];

function subscribeDisplay(notify: () => void) {
  window.addEventListener("crew-display", notify);
  return () => window.removeEventListener("crew-display", notify);
}
function readDisplay(): CrewDisplayMode {
  const saved = localStorage.getItem("crew-display");
  return saved === "dark" || saved === "sun" || saved === "light" ? saved : "light";
}
function cycleDisplay() {
  const current = readDisplay();
  const next = DISPLAY_MODES[(DISPLAY_MODES.indexOf(current) + 1) % DISPLAY_MODES.length] ?? "light";
  localStorage.setItem("crew-display", next);
  window.dispatchEvent(new Event("crew-display"));
}

function subscribeOnline(notify: () => void) {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
}

