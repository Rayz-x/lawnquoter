"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { SectionMenu, type SectionMenuItem } from "@/components/entry";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  approveSameDayExtra,
  assignVisit,
  cancelVisit,
  rescheduleVisit,
  skipVisit,
} from "@/lib/actions/scheduling";
import {
  ATTENTION_BUCKETS,
  TRAY_BUCKET_LIMIT,
  canApproveSameDay,
  canAssign,
  canReschedule,
  canSkipOrCancel,
  countBadgeClass,
  trayCounts,
  trayTotal,
  visibleBucketVisits,
  visitIdentityLine,
  type AttentionBucket,
  type AttentionTray,
  type AttentionVisit,
} from "@/lib/scheduling/attention-tray";
import { cn } from "@/lib/utils";

const SKIP_REASONS = [
  ["customer_skip", "Customer skip"],
  ["weather", "Weather"],
  ["gate_locked", "Gate locked"],
  ["dog_loose", "Dog loose"],
  ["equipment", "Equipment"],
  ["unsafe", "Unsafe"],
  ["other", "Other"],
] as const;

type SkipReason = (typeof SKIP_REASONS)[number][0];

type DialogState =
  | { kind: "assign" | "reschedule"; visit: AttentionVisit }
  | { kind: "skip"; visit: AttentionVisit }
  | { kind: "cancel"; visit: AttentionVisit }
  | null;

function statusLabel(status: string): string {
  return status.replaceAll("_", " ");
}

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
  const [dialog, setDialog] = useState<DialogState>(null);
  const [expanded, setExpanded] = useState<Partial<Record<AttentionBucket, boolean>>>({});
  const counts = trayCounts(tray);
  const total = trayTotal(counts);

  const run = (work: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) => {
    startTransition(async () => {
      const result = await work();
      if (result.ok) {
        toast.success(success);
        setDialog(null);
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
            <Badge
              key={bucket.key}
              variant="outline"
              className={cn(countBadgeClass(bucket.key, counts[bucket.key]))}
              data-testid={`tray-count-${bucket.key}`}
            >
              {bucket.label} {counts[bucket.key]}
            </Badge>
          ))}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {total === 0 ? (
          <Empty className="border-0 p-4" data-testid="tray-empty">
            <EmptyHeader>
              <EmptyTitle>Nothing needs attention · Dispatch looks clear</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          ATTENTION_BUCKETS.filter((bucket) => tray[bucket.key].length > 0).map((bucket) => (
            <BucketSection
              key={bucket.key}
              bucket={bucket.key}
              label={bucket.label}
              visits={tray[bucket.key]}
              expanded={!!expanded[bucket.key]}
              onToggleExpand={() =>
                setExpanded((current) => ({ ...current, [bucket.key]: !current[bucket.key] }))
              }
              canWrite={canWrite}
              pending={pending}
              onMenuAction={(next) => setDialog(next)}
              onApproveSameDay={(enhancementId) => {
                run(() => approveSameDayExtra(enhancementId), "Same-day extra approved until end of day");
              }}
            />
          ))
        )}
      </CardContent>

      <AssignDialog
        open={dialog?.kind === "assign" || dialog?.kind === "reschedule"}
        mode={dialog?.kind === "reschedule" ? "reschedule" : "assign"}
        visit={dialog?.kind === "assign" || dialog?.kind === "reschedule" ? dialog.visit : null}
        date={date}
        crews={crews}
        pending={pending}
        onClose={() => setDialog(null)}
        onConfirm={(crewId, serviceDate) => {
          if (!dialog || (dialog.kind !== "assign" && dialog.kind !== "reschedule")) return;
          const visitId = dialog.visit.id;
          if (dialog.kind === "reschedule") {
            run(() => rescheduleVisit({ visitId, crewId, date: serviceDate }), "Visit moved to day");
          } else {
            run(() => assignVisit({ visitId, crewId, date: serviceDate }), "Visit assigned");
          }
        }}
      />
      <SkipDialog
        open={dialog?.kind === "skip"}
        visit={dialog?.kind === "skip" ? dialog.visit : null}
        pending={pending}
        onClose={() => setDialog(null)}
        onConfirm={(reason) => {
          if (dialog?.kind !== "skip") return;
          run(() => skipVisit(dialog.visit.id, reason), "Visit skipped");
        }}
      />
      <CancelDialog
        open={dialog?.kind === "cancel"}
        visit={dialog?.kind === "cancel" ? dialog.visit : null}
        pending={pending}
        onClose={() => setDialog(null)}
        onConfirm={(reason) => {
          if (dialog?.kind !== "cancel") return;
          run(() => cancelVisit(dialog.visit.id, reason), "Visit cancelled");
        }}
      />
    </Card>
  );
}

function BucketSection({
  bucket,
  label,
  visits,
  expanded,
  onToggleExpand,
  canWrite,
  pending,
  onMenuAction,
  onApproveSameDay,
}: {
  bucket: AttentionBucket;
  label: string;
  visits: AttentionVisit[];
  expanded: boolean;
  onToggleExpand: () => void;
  canWrite: boolean;
  pending: boolean;
  onMenuAction: (dialog: DialogState) => void;
  onApproveSameDay: (enhancementId: string) => void;
}) {
  const shown = visibleBucketVisits(visits, expanded);
  const hidden = visits.length - shown.length;
  return (
    <section aria-label={label} className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">
        {label} <span className="text-muted-foreground tabular-nums">({visits.length})</span>
      </h3>
      {shown.map((visit) => (
        <TrayCard
          key={visit.id}
          bucket={bucket}
          visit={visit}
          canWrite={canWrite}
          pending={pending}
          onMenuAction={onMenuAction}
          onApproveSameDay={onApproveSameDay}
        />
      ))}
      {hidden > 0 ? (
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={onToggleExpand}>
          Show all {visits.length}
        </Button>
      ) : null}
      {expanded && visits.length > TRAY_BUCKET_LIMIT ? (
        <Button type="button" variant="ghost" size="sm" className="self-start" onClick={onToggleExpand}>
          Show fewer
        </Button>
      ) : null}
    </section>
  );
}

function TrayCard({
  bucket,
  visit,
  canWrite,
  pending,
  onMenuAction,
  onApproveSameDay,
}: {
  bucket: AttentionBucket;
  visit: AttentionVisit;
  canWrite: boolean;
  pending: boolean;
  onMenuAction: (dialog: DialogState) => void;
  onApproveSameDay: (enhancementId: string) => void;
}) {
  const router = useRouter();
  const items: SectionMenuItem[] = [];
  if (canWrite && bucket === "needs_reschedule" && canReschedule(visit.status)) {
    items.push({
      id: "reschedule",
      label: "Move to day…",
      onSelect: () => onMenuAction({ kind: "reschedule", visit }),
    });
  } else if (canWrite && canAssign(visit.status) && (bucket === "unassigned" || bucket === "overdue")) {
    items.push({
      id: "assign",
      label: "Assign…",
      onSelect: () => onMenuAction({ kind: "assign", visit }),
    });
  }
  if (canWrite && canSkipOrCancel(visit.status)) {
    items.push({
      id: "skip",
      label: "Skip…",
      onSelect: () => onMenuAction({ kind: "skip", visit }),
    });
    items.push({
      id: "cancel",
      label: "Cancel…",
      onSelect: () => onMenuAction({ kind: "cancel", visit }),
    });
  }
  if (canWrite && bucket === "flags" && canApproveSameDay(visit) && visit.enhancement_id && !pending) {
    const enhancementId = visit.enhancement_id;
    items.push({
      id: "approve-same-day",
      label: "Approve same day",
      onSelect: () => onApproveSameDay(enhancementId),
    });
  }
  if (visit.property_id) {
    items.push({
      id: "open",
      label: "Open visit",
      onSelect: () => {
        router.push(`/properties/${visit.property_id}`);
      },
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium">{visit.title}</div>
          <div className="text-muted-foreground">{visitIdentityLine(visit)}</div>
        </div>
        <div className="flex shrink-0 items-start gap-1">
          <Badge variant="outline" className="capitalize">
            {statusLabel(visit.status)}
          </Badge>
          {items.length > 0 ? <SectionMenu label="Visit actions" items={items} /> : null}
        </div>
      </div>
      {visit.reason ? <p className="text-sm text-warning">{visit.reason}</p> : null}
      <p className="text-xs text-muted-foreground tabular-nums">
        {visit.scheduled_date ?? "No day yet"}
        {visit.budget_minutes != null ? ` · ${visit.budget_minutes} min` : null}
        {visit.city ? ` · ${visit.city}` : null}
      </p>
    </div>
  );
}

function AssignDialog({
  open,
  mode,
  visit,
  date,
  crews,
  pending,
  onClose,
  onConfirm,
}: {
  open: boolean;
  mode: "assign" | "reschedule";
  visit: AttentionVisit | null;
  date: string;
  crews: { id: string; name: string }[];
  pending: boolean;
  onClose: () => void;
  onConfirm: (crewId: string, serviceDate: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        {visit ? (
          <AssignDialogBody
            key={`${mode}-${visit.id}`}
            mode={mode}
            visit={visit}
            date={date}
            crews={crews}
            pending={pending}
            onClose={onClose}
            onConfirm={onConfirm}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function AssignDialogBody({
  mode,
  visit,
  date,
  crews,
  pending,
  onClose,
  onConfirm,
}: {
  mode: "assign" | "reschedule";
  visit: AttentionVisit;
  date: string;
  crews: { id: string; name: string }[];
  pending: boolean;
  onClose: () => void;
  onConfirm: (crewId: string, serviceDate: string) => void;
}) {
  const [crewId, setCrewId] = useState(crews[0]?.id ?? "");
  const [serviceDate, setServiceDate] = useState(visit.scheduled_date ?? date);
  const selected = crews.some((crew) => crew.id === crewId) ? crewId : (crews[0]?.id ?? "");

  return (
    <>
      <DialogHeader>
        <DialogTitle>{mode === "reschedule" ? "Move to day" : "Assign visit"}</DialogTitle>
        <DialogDescription>
          {visit.title} · {visitIdentityLine(visit)}
        </DialogDescription>
      </DialogHeader>
      {crews.length === 0 ? (
        <p className="text-sm text-muted-foreground">Create a crew before assigning.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="tray-assign-date" className="text-xs text-muted-foreground">
              Day
            </label>
            <Input
              id="tray-assign-date"
              type="date"
              value={serviceDate}
              onChange={(event) => setServiceDate(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="tray-assign-crew" className="text-xs text-muted-foreground">
              Crew
            </label>
            <NativeSelect id="tray-assign-crew" value={selected} onChange={(event) => setCrewId(event.target.value)}>
              {crews.map((crew) => (
                <option key={crew.id} value={crew.id}>
                  {crew.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Back
        </Button>
        <Button
          type="button"
          disabled={pending || crews.length === 0 || !selected || !serviceDate}
          onClick={() => onConfirm(selected, serviceDate)}
        >
          {mode === "reschedule" ? "Move" : "Assign"}
        </Button>
      </DialogFooter>
    </>
  );
}

function SkipDialog({
  open,
  visit,
  pending,
  onClose,
  onConfirm,
}: {
  open: boolean;
  visit: AttentionVisit | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: (reason: SkipReason) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        {visit ? (
          <SkipDialogBody key={visit.id} visit={visit} pending={pending} onClose={onClose} onConfirm={onConfirm} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SkipDialogBody({
  visit,
  pending,
  onClose,
  onConfirm,
}: {
  visit: AttentionVisit;
  pending: boolean;
  onClose: () => void;
  onConfirm: (reason: SkipReason) => void;
}) {
  const [reason, setReason] = useState<SkipReason>("customer_skip");
  return (
    <>
      <DialogHeader>
        <DialogTitle>Skip visit</DialogTitle>
        <DialogDescription>
          {visit.title} · {visitIdentityLine(visit)}
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1">
        <label htmlFor="tray-skip-reason" className="text-xs text-muted-foreground">
          Skip reason
        </label>
        <NativeSelect
          id="tray-skip-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value as SkipReason)}
        >
          {SKIP_REASONS.map(([value, name]) => (
            <option key={value} value={value}>
              {name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Back
        </Button>
        <Button type="button" disabled={pending} onClick={() => onConfirm(reason)}>
          Skip
        </Button>
      </DialogFooter>
    </>
  );
}

function CancelDialog({
  open,
  visit,
  pending,
  onClose,
  onConfirm,
}: {
  open: boolean;
  visit: AttentionVisit | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        {visit ? (
          <CancelDialogBody key={visit.id} visit={visit} pending={pending} onClose={onClose} onConfirm={onConfirm} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CancelDialogBody({
  visit,
  pending,
  onClose,
  onConfirm,
}: {
  visit: AttentionVisit;
  pending: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <>
      <DialogHeader>
        <DialogTitle>Cancel visit</DialogTitle>
        <DialogDescription>
          {visit.title} · {visitIdentityLine(visit)}
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1">
        <label htmlFor="tray-cancel-reason" className="text-xs text-muted-foreground">
          Cancel reason
        </label>
        <Input id="tray-cancel-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Back
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={pending || reason.trim().length === 0}
          onClick={() => onConfirm(reason.trim())}
        >
          Cancel visit
        </Button>
      </DialogFooter>
    </>
  );
}
