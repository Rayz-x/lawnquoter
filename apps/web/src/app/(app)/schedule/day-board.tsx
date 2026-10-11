"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import {
  assignVisit,
  cancelVisit,
  clearPhoneRevoke,
  publishRoute,
  rainDayPush,
  reorderVisits,
  revokePhone,
  skipVisit,
} from "@/lib/actions/scheduling";
import type { AttentionTray } from "@/lib/scheduling/attention-tray";
import { formatOfficeDay } from "@/lib/scheduling/office-date";
import type { RevokedUnsyncedVisit } from "@/lib/scheduling/phone-revoke";
import { unsyncedVisitLabel } from "@/lib/scheduling/phone-revoke";
import { phoneSyncStatus } from "@/lib/scheduling/phone-sync";
import { nextWorkday } from "@/lib/scheduling/workday";
import { AttentionTrayPanel } from "./attention-tray-panel";

export type BoardVisit = {
  id: string;
  title: string;
  customer: string;
  address: string;
  status: string;
  scheduledDate: string | null;
  overdue: boolean;
  budgetMinutes: number | null;
  windowLabel: string | null;
};

export type PhoneSync = {
  profileId: string;
  name: string;
  packVersion: number | null;
  lastSyncedAt: string | null;
  revokedAt: string | null;
  unsynced: RevokedUnsyncedVisit[];
};

export type BoardColumn = {
  crewId: string;
  crewName: string;
  routeId: string | null;
  routeStatus: string | null;
  routeVersion: number | null;
  phones: PhoneSync[];
  visits: BoardVisit[];
};

const SKIP_REASONS = [
  ["customer_skip", "Customer skip"],
  ["weather", "Weather"],
  ["gate_locked", "Gate locked"],
  ["dog_loose", "Dog loose"],
  ["equipment", "Equipment"],
  ["unsafe", "Unsafe"],
  ["other", "Other"],
] as const;

function scheduledIds(visits: BoardVisit[]): string[] {
  return visits.filter((visit) => visit.status === "scheduled").map((visit) => visit.id);
}

function label(value: string): string {
  return value.replaceAll("_", " ");
}

function moveIds(ids: string[], index: number, delta: number): string[] {
  const next = [...ids];
  const target = index + delta;
  const [item] = next.splice(index, 1);
  if (!item) return ids;
  next.splice(target, 0, item);
  return next;
}

export function DayBoard({
  date,
  canWrite,
  timeZone,
  saturdayWorkday,
  tray,
  columns,
}: {
  date: string;
  canWrite: boolean;
  timeZone: string;
  saturdayWorkday: boolean;
  tray: AttentionTray;
  columns: BoardColumn[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const crews = columns.map((column) => ({ id: column.crewId, name: column.crewName }));
  const targetDay = nextWorkday(date, { saturdayWorkday });
  const targetLabel = formatOfficeDay(targetDay);
  const selectedIds = Object.entries(selected)
    .filter(([, on]) => on)
    .map(([id]) => id);

  const run = (work: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) => {
    startTransition(async () => {
      const result = await work();
      if (result.ok) {
        toast.success(success);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const runRain = (
    work: () => Promise<
      | { ok: true; data: { targetDate: string; pushed: number; skipped: number; untouched: number } }
      | { ok: false; error: string }
    >,
  ) => {
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const { pushed, skipped, untouched, targetDate } = result.data;
      toast.success(
        `Rain day → ${formatOfficeDay(targetDate)}: ${pushed} pushed, ${skipped} skipped` +
          (untouched > 0 ? `, ${untouched} left in progress` : ""),
      );
      setSelected({});
      router.refresh();
    });
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[20rem_1fr]">
      <AttentionTrayPanel date={date} canWrite={canWrite} tray={tray} crews={crews} />

      <div className="grid gap-4">
        {canWrite ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() =>
                runRain(() =>
                  rainDayPush({
                    date,
                    visitIds: selectedIds.length > 0 ? selectedIds : undefined,
                  }),
                )
              }
            >
              {pending ? <Spinner data-icon="inline-start" /> : null}
              {selectedIds.length > 0
                ? `Rain day · selection → ${targetLabel}`
                : `Rain day · all crews → ${targetLabel}`}
            </Button>
            {selectedIds.length > 0 ? (
              <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setSelected({})}>
                Clear selection
              </Button>
            ) : null}
          </div>
        ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {columns.length === 0 ? (
          <Empty className="md:col-span-2">
            <EmptyHeader>
              <EmptyTitle>No crews</EmptyTitle>
              <EmptyDescription>Create a crew under Settings, then assign this day’s visits.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          columns.map((column) => (
            <Card key={column.crewId}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  {column.crewName}
                  {column.routeStatus ? (
                    <Badge variant={column.routeStatus === "published" ? "secondary" : "outline"} className="capitalize">
                      {label(column.routeStatus)}
                    </Badge>
                  ) : (
                    <Badge variant="outline">No route</Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  {column.visits.length === 0 ? "No stops this day." : `${column.visits.length} stops`}
                </CardDescription>
                {canWrite && scheduledIds(column.visits).length > 0 ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => runRain(() => rainDayPush({ date, crewId: column.crewId }))}
                  >
                    Rain day → {targetLabel}
                  </Button>
                ) : null}
                <PhoneSyncLines
                  phones={column.phones}
                  routeVersion={column.routeVersion}
                  timeZone={timeZone}
                  canWrite={canWrite}
                  pending={pending}
                  onRevoke={(profileId) =>
                    run(() => revokePhone(profileId).then((result) => (result.ok ? { ok: true } : result)), "Phone revoked")
                  }
                  onClear={(profileId) =>
                    run(() => clearPhoneRevoke(profileId), "Phone allowed again")
                  }
                />
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {column.visits.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Assign a visit from Needs attention.</p>
                ) : (
                  <ol className="flex flex-col gap-3">
                    {column.visits.map((visit, index) => (
                      <li key={visit.id}>
                        <VisitCard
                          visit={visit}
                          select={
                            canWrite && visit.status === "scheduled"
                              ? {
                                  checked: Boolean(selected[visit.id]),
                                  onChange: (checked) =>
                                    setSelected((prev) => ({ ...prev, [visit.id]: checked })),
                                }
                              : null
                          }
                        >
                          {canWrite && column.routeId && visit.status === "scheduled" ? (
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={pending || index === 0}
                                aria-label={`Move ${visit.title} up`}
                                onClick={() => {
                                  const routeId = column.routeId;
                                  if (!routeId) return;
                                  const next = moveIds(column.visits.map((item) => item.id), index, -1);
                                  const ordered = next.filter((id) => scheduledIds(column.visits).includes(id));
                                  if (ordered.length === 0) return;
                                  run(() => reorderVisits(routeId, ordered), "Order updated");
                                }}
                              >
                                Move up
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={pending || index === column.visits.length - 1}
                                aria-label={`Move ${visit.title} down`}
                                onClick={() => {
                                  const routeId = column.routeId;
                                  if (!routeId) return;
                                  const next = moveIds(column.visits.map((item) => item.id), index, 1);
                                  const ordered = next.filter((id) => scheduledIds(column.visits).includes(id));
                                  if (ordered.length === 0) return;
                                  run(() => reorderVisits(routeId, ordered), "Order updated");
                                }}
                              >
                                Move down
                              </Button>
                            </div>
                          ) : null}
                          {canWrite && visit.status === "scheduled" ? (
                            <AssignControls
                              visit={visit}
                              date={date}
                              crews={crews.filter((crew) => crew.id !== column.crewId)}
                              pending={pending}
                              label="Move to"
                              onAssign={(crewId) =>
                                run(() => assignVisit({ visitId: visit.id, crewId, date }), "Visit moved")
                              }
                            />
                          ) : null}
                          {canWrite ? (
                            <StopControls
                              visit={visit}
                              pending={pending}
                              onSkip={(reason) => run(() => skipVisit(visit.id, reason), "Visit skipped")}
                              onCancel={(reason) => run(() => cancelVisit(visit.id, reason), "Visit cancelled")}
                            />
                          ) : null}
                        </VisitCard>
                      </li>
                    ))}
                  </ol>
                )}
                {canWrite && column.routeId && column.routeStatus === "draft" ? (
                  column.visits.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Add a visit before publishing.</p>
                  ) : (
                    <Button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        const routeId = column.routeId;
                        if (!routeId) return;
                        run(() => publishRoute(routeId), "Route published");
                      }}
                    >
                      {pending ? <Spinner data-icon="inline-start" /> : null}
                      Publish route
                    </Button>
                  )
                ) : null}
              </CardContent>
            </Card>
          ))
        )}
      </div>
      </div>
    </div>
  );
}

function VisitCard({
  visit,
  select,
  children,
}: {
  visit: BoardVisit;
  select?: { checked: boolean; onChange: (checked: boolean) => void } | null;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          {select ? (
            <input
              type="checkbox"
              className="mt-1 size-4 accent-primary"
              checked={select.checked}
              onChange={(event) => select.onChange(event.target.checked)}
              aria-label={`Select ${visit.title} for rain day`}
            />
          ) : null}
          <div>
            <div className="font-medium">{visit.title}</div>
            <div className="text-muted-foreground">{visit.customer}</div>
            <div className="text-muted-foreground">{visit.address}</div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {visit.overdue ? <Badge variant="destructive">Overdue</Badge> : null}
          <Badge variant="outline" className="capitalize">
            {label(visit.status)}
          </Badge>
        </div>
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">{visit.scheduledDate ?? "Unscheduled"}</p>
      {visit.budgetMinutes != null || visit.windowLabel ? (
        <p className="text-xs text-muted-foreground tabular-nums">
          {visit.windowLabel ? visit.windowLabel : null}
          {visit.windowLabel && visit.budgetMinutes != null ? " · " : null}
          {visit.budgetMinutes != null ? `${visit.budgetMinutes} min` : null}
        </p>
      ) : null}
      {children}
    </div>
  );
}

function AssignControls({
  visit,
  date,
  crews,
  pending,
  label: fieldLabel = "Assign to",
  onAssign,
}: {
  visit: BoardVisit;
  date: string;
  crews: { id: string; name: string }[];
  pending: boolean;
  label?: string;
  onAssign: (crewId: string) => void;
}) {
  const [crewId, setCrewId] = useState(crews[0]?.id ?? "");
  if (visit.status !== "scheduled" || crews.length === 0) return null;
  const selected = crews.some((crew) => crew.id === crewId) ? crewId : crews[0]!.id;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex min-w-36 flex-col gap-1">
        <label htmlFor={`assign-${visit.id}-${date}`} className="text-xs text-muted-foreground">
          {fieldLabel}
        </label>
        <NativeSelect id={`assign-${visit.id}-${date}`} value={selected} onChange={(event) => setCrewId(event.target.value)}>
          {crews.map((crew) => (
            <option key={crew.id} value={crew.id}>
              {crew.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Button type="button" size="sm" disabled={pending} onClick={() => onAssign(selected)}>
        {fieldLabel === "Move to" ? "Move" : "Assign"}
      </Button>
    </div>
  );
}

function PhoneSyncLines({
  phones,
  routeVersion,
  timeZone,
  canWrite,
  pending,
  onRevoke,
  onClear,
}: {
  phones: PhoneSync[];
  routeVersion: number | null;
  timeZone: string;
  canWrite: boolean;
  pending: boolean;
  onRevoke: (profileId: string) => void;
  onClear: (profileId: string) => void;
}) {
  const now = new Date();
  if (phones.length === 0) {
    return (
      <p className="inline-flex items-center gap-1 text-xs text-warning">
        <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
        <span>No phone has synced today</span>
      </p>
    );
  }
  return (
    <ul className="mt-1 flex flex-col gap-2 text-xs">
      {phones.map((phone) => {
        if (phone.revokedAt) {
          return (
            <li key={phone.profileId} className="flex flex-col gap-1 text-warning">
              <div className="inline-flex items-start gap-1">
                <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  {phone.name} · Revoked · {unsyncedVisitLabel(phone.unsynced.length)}
                </span>
              </div>
              {phone.unsynced.length > 0 ? (
                <ul className="ml-5 list-disc text-muted-foreground">
                  {phone.unsynced.map((visit) => (
                    <li key={visit.id}>
                      {visit.title}
                      {visit.address ? ` · ${visit.address}` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
              {canWrite ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  className="h-7 w-fit px-2 text-xs"
                  onClick={() => onClear(phone.profileId)}
                >
                  Allow phone
                </Button>
              ) : null}
            </li>
          );
        }
        const status = phoneSyncStatus({
          phoneName: phone.name,
          packVersion: phone.packVersion,
          routeVersion,
          lastSyncedAt: phone.lastSyncedAt,
          now,
          timeZone,
        });
        // Mismatch label already includes the name ("Route v3 · Ana has v2").
        const text =
          status.versionLabel == null
            ? `${phone.name} · ${status.syncLabel}`
            : status.attention && status.versionLabel.includes(" has v")
              ? `${status.versionLabel} · ${status.syncLabel}`
              : `${phone.name} · ${status.versionLabel} · ${status.syncLabel}`;
        return (
          <li
            key={phone.profileId}
            className={
              status.attention
                ? "flex flex-col gap-1 text-warning"
                : "flex flex-col gap-1 text-muted-foreground"
            }
          >
            <div className="inline-flex items-center gap-1">
              {status.attention ? <TriangleAlert aria-hidden className="size-3.5 shrink-0" /> : null}
              <span>{text}</span>
            </div>
            {canWrite ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                className="h-7 w-fit px-2 text-xs"
                onClick={() => onRevoke(phone.profileId)}
              >
                Revoke phone
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function StopControls({
  visit,
  pending,
  onSkip,
  onCancel,
}: {
  visit: BoardVisit;
  pending: boolean;
  onSkip: (reason: (typeof SKIP_REASONS)[number][0]) => void;
  onCancel: (reason: string) => void;
}) {
  const [skipReason, setSkipReason] = useState<(typeof SKIP_REASONS)[number][0]>("customer_skip");
  const [cancelReason, setCancelReason] = useState("");
  if (!["scheduled", "in_progress", "paused"].includes(visit.status)) return null;
  return (
    <>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-36 flex-col gap-1">
          <label htmlFor={`skip-${visit.id}`} className="text-xs text-muted-foreground">
            Skip reason
          </label>
          <NativeSelect
            id={`skip-${visit.id}`}
            value={skipReason}
            onChange={(event) => setSkipReason(event.target.value as (typeof SKIP_REASONS)[number][0])}
          >
            {SKIP_REASONS.map(([value, name]) => (
              <option key={value} value={value}>
                {name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => onSkip(skipReason)}>
          Skip
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-36 flex-col gap-1">
          <label htmlFor={`cancel-${visit.id}`} className="text-xs text-muted-foreground">
            Cancel reason
          </label>
          <Input id={`cancel-${visit.id}`} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} />
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending || cancelReason.trim().length === 0}
          onClick={() => onCancel(cancelReason.trim())}
        >
          Cancel
        </Button>
      </div>
    </>
  );
}
