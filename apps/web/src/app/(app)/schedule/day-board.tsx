"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { assignVisit, publishRoute, reorderVisits } from "@/lib/actions/scheduling";

export type BoardVisit = {
  id: string;
  title: string;
  customer: string;
  address: string;
  status: string;
  sort: number;
  budgetMinutes: number | null;
  windowLabel: string | null;
};

export type BoardColumn = {
  crewId: string;
  crewName: string;
  routeId: string | null;
  routeStatus: string | null;
  visits: BoardVisit[];
};

function label(value: string): string {
  return value.replaceAll("_", " ");
}

function nextSort(visits: BoardVisit[]): number {
  return visits.reduce((max, visit) => Math.max(max, visit.sort + 1), 0);
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
  unassigned,
  columns,
}: {
  date: string;
  canWrite: boolean;
  unassigned: BoardVisit[];
  columns: BoardColumn[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const crews = columns.map((column) => ({ id: column.crewId, name: column.crewName }));

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

  return (
    <div className="grid gap-4 xl:grid-cols-[20rem_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Unassigned</CardTitle>
          <CardDescription>
            {unassigned.length === 0 ? "Every visit this day has a crew." : `${unassigned.length} still need a crew.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {unassigned.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>None waiting</EmptyTitle>
                <EmptyDescription>Visits without a crew for this day show up here.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            unassigned.map((visit) => (
              <VisitCard key={visit.id} visit={visit}>
                {canWrite ? (
                  crews.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Create a crew before assigning this visit.</p>
                  ) : (
                    <AssignControls
                      visit={visit}
                      date={date}
                      crews={crews}
                      sort={columns.reduce<Record<string, number>>((acc, column) => {
                        acc[column.crewId] = nextSort(column.visits);
                        return acc;
                      }, {})}
                      pending={pending}
                      onAssign={(crewId, sort) =>
                        run(
                          () => assignVisit({ visitId: visit.id, crewId, date, sort }),
                          "Visit assigned",
                        )
                      }
                    />
                  )
                ) : null}
              </VisitCard>
            ))
          )}
        </CardContent>
      </Card>

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
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {column.visits.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Assign a visit from the unassigned list.</p>
                ) : (
                  <ol className="flex flex-col gap-3">
                    {column.visits.map((visit, index) => (
                      <li key={visit.id}>
                        <VisitCard visit={visit}>
                          {canWrite && column.routeId ? (
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
                                  run(
                                    () => reorderVisits(routeId, moveIds(column.visits.map((item) => item.id), index, -1)),
                                    "Order updated",
                                  );
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
                                  run(
                                    () => reorderVisits(routeId, moveIds(column.visits.map((item) => item.id), index, 1)),
                                    "Order updated",
                                  );
                                }}
                              >
                                Move down
                              </Button>
                            </div>
                          ) : null}
                          {canWrite ? (
                            <AssignControls
                              visit={visit}
                              date={date}
                              crews={crews.filter((crew) => crew.id !== column.crewId)}
                              sort={columns.reduce<Record<string, number>>((acc, item) => {
                                acc[item.crewId] = nextSort(item.visits);
                                return acc;
                              }, {})}
                              pending={pending}
                              label="Move to"
                              onAssign={(crewId, sort) =>
                                run(() => assignVisit({ visitId: visit.id, crewId, date, sort }), "Visit moved")
                              }
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
  );
}

function VisitCard({ visit, children }: { visit: BoardVisit; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium">{visit.title}</div>
          <div className="text-muted-foreground">{visit.customer}</div>
          <div className="text-muted-foreground">{visit.address}</div>
        </div>
        <Badge variant="outline" className="capitalize">
          {label(visit.status)}
        </Badge>
      </div>
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
  sort,
  pending,
  label: fieldLabel = "Assign to",
  onAssign,
}: {
  visit: BoardVisit;
  date: string;
  crews: { id: string; name: string }[];
  sort: Record<string, number>;
  pending: boolean;
  label?: string;
  onAssign: (crewId: string, sort: number) => void;
}) {
  const [crewId, setCrewId] = useState(crews[0]?.id ?? "");
  if (crews.length === 0) return null;
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
      <Button type="button" size="sm" disabled={pending} onClick={() => onAssign(selected, sort[selected] ?? 0)}>
        {fieldLabel === "Move to" ? "Move" : "Assign"}
      </Button>
    </div>
  );
}
