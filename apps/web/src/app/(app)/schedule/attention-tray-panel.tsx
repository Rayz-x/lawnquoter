"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { assignVisit } from "@/lib/actions/scheduling";
import {
  ATTENTION_BUCKETS,
  trayCounts,
  type AttentionBucket,
  type AttentionTray,
  type AttentionVisit,
} from "@/lib/scheduling/attention-tray";

export function AttentionTrayPanel({
  date,
  canWrite,
  tray,
  crews,
}: {
  date: string;
  canWrite: boolean;
  tray: AttentionTray;
  crews: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const counts = trayCounts(tray);

  const assign = (visitId: string, crewId: string) => {
    startTransition(async () => {
      const result = await assignVisit({ visitId, crewId, date });
      if (result.ok) {
        toast.success("Visit assigned");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Card data-testid="needs-attention-tray">
      <CardHeader>
        <CardTitle>Needs attention</CardTitle>
        <CardDescription>
          Unassigned, overdue, reschedule, and flagged work. Overdue stays on its day.
        </CardDescription>
        <div className="flex flex-wrap gap-2 pt-1" aria-label="Attention tray counts">
          {ATTENTION_BUCKETS.map((bucket) => (
            <Badge key={bucket.key} variant="outline" data-testid={`tray-count-${bucket.key}`}>
              {bucket.label} {counts[bucket.key]}
            </Badge>
          ))}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {ATTENTION_BUCKETS.map((bucket) => (
          <BucketSection
            key={bucket.key}
            bucket={bucket.key}
            label={bucket.label}
            visits={tray[bucket.key]}
            date={date}
            canWrite={canWrite}
            crews={crews}
            pending={pending}
            onAssign={assign}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function BucketSection({
  bucket,
  label,
  visits,
  date,
  canWrite,
  crews,
  pending,
  onAssign,
}: {
  bucket: AttentionBucket;
  label: string;
  visits: AttentionVisit[];
  date: string;
  canWrite: boolean;
  crews: { id: string; name: string }[];
  pending: boolean;
  onAssign: (visitId: string, crewId: string) => void;
}) {
  const assignable = bucket === "unassigned" || bucket === "overdue";
  return (
    <section aria-label={label} className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">
        {label} <span className="text-muted-foreground tabular-nums">({visits.length})</span>
      </h3>
      {visits.length === 0 ? (
        <p className="text-sm text-muted-foreground">None right now.</p>
      ) : (
        visits.map((visit) => (
          <div key={visit.id} className="flex flex-col gap-2 rounded-md border p-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="font-medium">{visit.title}</div>
              <Badge variant="outline" className="capitalize">
                {visit.status.replaceAll("_", " ")}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground tabular-nums">{visit.scheduled_date ?? "No day yet"}</p>
            {canWrite && assignable && visit.status === "scheduled" ? (
              crews.length === 0 ? (
                <p className="text-xs text-muted-foreground">Create a crew before assigning.</p>
              ) : (
                <AssignRow visitId={visit.id} date={date} crews={crews} pending={pending} onAssign={onAssign} />
              )
            ) : null}
          </div>
        ))
      )}
    </section>
  );
}

function AssignRow({
  visitId,
  date,
  crews,
  pending,
  onAssign,
}: {
  visitId: string;
  date: string;
  crews: { id: string; name: string }[];
  pending: boolean;
  onAssign: (visitId: string, crewId: string) => void;
}) {
  const [crewId, setCrewId] = useState(crews[0]?.id ?? "");
  const selected = crews.some((crew) => crew.id === crewId) ? crewId : crews[0]!.id;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex min-w-36 flex-col gap-1">
        <label htmlFor={`tray-assign-${visitId}-${date}`} className="text-xs text-muted-foreground">
          Assign to
        </label>
        <NativeSelect id={`tray-assign-${visitId}-${date}`} value={selected} onChange={(e) => setCrewId(e.target.value)}>
          {crews.map((crew) => (
            <option key={crew.id} value={crew.id}>
              {crew.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Button type="button" size="sm" disabled={pending} onClick={() => onAssign(visitId, selected)}>
        Assign
      </Button>
    </div>
  );
}
