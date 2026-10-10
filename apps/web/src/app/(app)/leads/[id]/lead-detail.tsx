"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FactStrip } from "@/components/entry";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { ContactChannel, LeadActivity, LeadRequest } from "@/lib/leads/detail";
import { leadAddressLine, leadDisplayName } from "@/lib/leads/detail";
import { logLeadContact, reassignLead, setLeadFollowUp } from "./actions";

export type LeadDetailPerson = { id: string; name: string };

export type LeadDetailView = {
  lead: LeadRequest;
  activities: LeadActivity[];
  assigneeName: string | null;
  people: LeadDetailPerson[];
  canEdit: boolean;
};

const CHANNELS: { value: ContactChannel; label: string }[] = [
  { value: "call", label: "Call" },
  { value: "text", label: "Text" },
  { value: "email", label: "Email" },
];

function statusLabel(status: string) {
  return status.replaceAll("_", " ");
}

export function LeadDetail({ lead, activities, assigneeName, people, canEdit }: LeadDetailView) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [channel, setChannel] = useState<ContactChannel>("call");
  const [note, setNote] = useState("");
  const [assigneeId, setAssigneeId] = useState(lead.assigned_to ?? people[0]?.id ?? "");
  const [followUp, setFollowUp] = useState(lead.next_follow_up_on ?? "");
  const title = leadDisplayName(lead);
  const address = leadAddressLine(lead);

  const run = (work: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) => {
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(success);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-4" data-testid="lead-detail">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-sans text-lg font-semibold tracking-tight">{title}</h2>
          {address ? <p className="text-sm text-muted-foreground">{address}</p> : null}
        </div>
        <Badge variant="secondary" className="capitalize">
          {statusLabel(lead.status)}
        </Badge>
      </div>

      <FactStrip
        facts={[
          { label: "Assignee", value: assigneeName ?? "Unassigned" },
          { label: "Source", value: lead.source ?? "—" },
          {
            label: "First contact",
            value: lead.first_contacted_at
              ? new Date(lead.first_contacted_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
              : "Not yet",
          },
          { label: "Next follow-up", value: lead.next_follow_up_on ?? "—" },
        ]}
      />

      {canEdit ? (
        <div className="grid gap-4 lg:grid-cols-3" data-testid="lead-actions">
          <Card>
            <CardHeader>
              <CardTitle>Log contact</CardTitle>
              <CardDescription>Sets first contact once; every log writes to the timeline.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lead-channel">Channel</Label>
                <NativeSelect
                  id="lead-channel"
                  value={channel}
                  onChange={(event) => setChannel(event.target.value as ContactChannel)}
                >
                  {CHANNELS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lead-note">Note</Label>
                <Textarea id="lead-note" value={note} onChange={(event) => setNote(event.target.value)} rows={3} />
              </div>
              <Button
                type="button"
                disabled={pending}
                data-testid="lead-log-contact"
                onClick={() => {
                  const form = new FormData();
                  form.set("channel", channel);
                  form.set("note", note);
                  run(() => logLeadContact(lead.id, form), "Contact logged");
                }}
              >
                Log contact
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Reassign</CardTitle>
              <CardDescription>Change who owns this lead.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lead-assignee">Assignee</Label>
                <NativeSelect
                  id="lead-assignee"
                  value={assigneeId}
                  onChange={(event) => setAssigneeId(event.target.value)}
                >
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <Button
                type="button"
                variant="secondary"
                disabled={pending || !assigneeId}
                data-testid="lead-reassign"
                onClick={() => {
                  const form = new FormData();
                  form.set("assigneeId", assigneeId);
                  run(() => reassignLead(lead.id, form), "Lead reassigned");
                }}
              >
                Reassign
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Follow-up</CardTitle>
              <CardDescription>Set the next follow-up date.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lead-follow-up">Date</Label>
                <Input
                  id="lead-follow-up"
                  type="date"
                  value={followUp}
                  onChange={(event) => setFollowUp(event.target.value)}
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                disabled={pending || !followUp}
                data-testid="lead-set-follow-up"
                onClick={() => {
                  const form = new FormData();
                  form.set("nextFollowUpOn", followUp);
                  run(() => setLeadFollowUp(lead.id, form), "Follow-up saved");
                }}
              >
                Set follow-up
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="lead-view-only">
          View only — contact, assignment, and follow-up actions are hidden for read-only users.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
          <CardDescription>Append-only activity for this lead.</CardDescription>
        </CardHeader>
        <CardContent>
          {activities.length === 0 ? (
            <Empty className="border-0 p-4" data-testid="lead-timeline-empty">
              <EmptyHeader>
                <EmptyTitle>No activity yet</EmptyTitle>
                <EmptyDescription>Logged contacts and changes show up here.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ol className="flex flex-col gap-3" data-testid="lead-timeline">
              {activities.map((item) => (
                <li key={item.id} className="border-b border-border/60 pb-3 last:border-0 last:pb-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-medium">{item.summary}</p>
                    <time className="text-xs text-muted-foreground" dateTime={item.occurred_at}>
                      {new Date(item.occurred_at).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                  <p className="text-xs text-muted-foreground">{item.kind}</p>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
