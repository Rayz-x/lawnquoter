"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { FieldHint } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { approveSiteCheckRequest, declineSiteCheckRequest } from "../actions";

export function SiteCheckRequestActions({
  quoteId,
  siteCheckId,
  requestedEmail,
  requestNote,
}: {
  quoteId: string;
  siteCheckId: string;
  requestedEmail: string | null;
  requestNote: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [approveOpen, setApproveOpen] = useState(false);
  const [windowStart, setWindowStart] = useState("");
  const [windowEnd, setWindowEnd] = useState("");

  function openApprove() {
    // Same default the server applies when no nearby visit: tomorrow through +5 days.
    const day = (offset: number) => {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    setWindowStart(day(1));
    setWindowEnd(day(5));
    setApproveOpen(true);
  }

  function confirmApprove() {
    startTransition(async () => {
      const result = await approveSiteCheckRequest(quoteId, siteCheckId, {
        start: windowStart,
        end: windowEnd,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setApproveOpen(false);
      toast.success("Visit window confirmed");
    });
  }

  return (
    <div className="mt-3 space-y-2 border-t border-warning/20 pt-3">
      <p className="text-xs text-muted-foreground">Customer request</p>
      <p className="text-sm">Approve to give the customer a visit window, or decline with a reason.</p>
      {requestedEmail ? (
        <p className="text-xs text-muted-foreground">
          Requested by {requestedEmail}
          {requestNote ? ` · “${requestNote}”` : ""}
        </p>
      ) : null}
      {!declining ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={pending} onClick={openApprove}>
            Approve
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setDeclining(true)}>
            Decline
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const fd = new FormData();
            fd.set("reason", reason);
            startTransition(async () => {
              const result = await declineSiteCheckRequest(quoteId, siteCheckId, fd);
              if (!result.ok) {
                toast.error(result.error);
                return;
              }
              toast.success("Request declined");
              setDeclining(false);
              setReason("");
            });
          }}
        >
          <label className="text-xs text-muted-foreground" htmlFor="decline-reason">
            Message to the customer (they&apos;ll see this)
          </label>
          <Input
            id="decline-reason"
            aria-describedby="decline-reason-hint"
            className="w-full"
            value={reason}
            required
            maxLength={2000}
            disabled={pending}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. outside service area"
          />
          <FieldHint id="decline-reason-hint">What the customer reads when you turn down the visit.</FieldHint>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending || !reason.trim()}>
              Decline request
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setDeclining(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      <AlertDialog open={approveOpen} onOpenChange={setApproveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve the final-price visit</AlertDialogTitle>
            <AlertDialogDescription>The customer will see this window.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
              <label htmlFor="site-window-start">From</label>
              <Input
                id="site-window-start"
                aria-describedby="site-window-start-hint"
                type="date"
                value={windowStart}
                disabled={pending}
                onChange={(event) => setWindowStart(event.target.value)}
              />
              <FieldHint id="site-window-start-hint">The first day the crew can visit to set the final price.</FieldHint>
            </div>
            <div className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
              <label htmlFor="site-window-end">To</label>
              <Input
                id="site-window-end"
                aria-describedby="site-window-end-hint"
                type="date"
                value={windowEnd}
                min={windowStart || undefined}
                disabled={pending}
                onChange={(event) => setWindowEnd(event.target.value)}
              />
              <FieldHint id="site-window-end-hint">The last day the crew can visit to set the final price.</FieldHint>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Back</AlertDialogCancel>
            <Button
              type="button"
              disabled={pending || !windowStart || !windowEnd || windowEnd < windowStart}
              onClick={confirmApprove}
            >
              Approve and share window
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
