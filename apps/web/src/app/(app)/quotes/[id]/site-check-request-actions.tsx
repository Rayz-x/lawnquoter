"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SITE_CHECK_REQUESTED_PENDING } from "@/lib/quotes/site-check";
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

  return (
    <div className="mt-3 space-y-2 border-t border-warning/20 pt-3">
      <p className="text-xs text-muted-foreground">Customer request</p>
      <p className="text-sm">{SITE_CHECK_REQUESTED_PENDING}</p>
      {requestedEmail ? (
        <p className="text-xs text-muted-foreground">
          Requested by {requestedEmail}
          {requestNote ? ` · “${requestNote}”` : ""}
        </p>
      ) : null}
      {!declining ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await approveSiteCheckRequest(quoteId, siteCheckId);
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                toast.success("Visit window confirmed");
              })
            }
          >
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
            Reason for declining
          </label>
          <Input
            id="decline-reason"
            value={reason}
            required
            maxLength={2000}
            disabled={pending}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. outside service area"
          />
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
    </div>
  );
}
