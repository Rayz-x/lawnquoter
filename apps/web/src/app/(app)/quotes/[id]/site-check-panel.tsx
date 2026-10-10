"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/money";
import {
  SITE_CHECK_AFTER_ACCEPTANCE,
  siteCheckCustomerSees,
  siteCheckReasonsSummary,
} from "@/lib/quotes/site-check";
import { waiveLineSiteCheck } from "../actions";

export type SiteCheckLine = {
  id: string;
  name: string;
  price: number;
  range_low: number | null;
  range_high: number | null;
  site_check_reasons: string[];
};

export function SiteCheckPanel({
  quoteId,
  lines,
  selectedIds,
  confidence,
  editable,
}: {
  quoteId: string;
  lines: SiteCheckLine[];
  selectedIds: string[];
  confidence: number | null;
  editable: boolean;
}) {
  const flagged = lines.filter((line) => line.site_check_reasons.length > 0);
  const [pending, startTransition] = useTransition();
  const [waivingId, setWaivingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  if (flagged.length === 0) return null;

  const reasons = [...new Set(flagged.flatMap((line) => line.site_check_reasons))];
  const customerSees = siteCheckCustomerSees(lines, selectedIds);

  return (
    <section
      aria-label="Site check"
      className="rounded-lg bg-warning/10 px-3 py-3 text-sm ring-1 ring-warning/30"
    >
      <h2 className="font-medium text-warning">Site check · {flagged.length} line{flagged.length === 1 ? "" : "s"}</h2>
      <dl className="mt-2 grid gap-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Why</dt>
          <dd className="text-warning">
            {siteCheckReasonsSummary(reasons)}
            {confidence != null ? ` · confidence ${confidence.toFixed(2)}` : ""}
          </dd>
        </div>
        {customerSees ? (
          <div>
            <dt className="text-xs text-muted-foreground">Customer sees</dt>
            <dd>
              {formatMoney(customerSees.low)} – {formatMoney(customerSees.high)}
              {" · "}
              can accept now with a not-to-exceed of {formatMoney(customerSees.notToExceed)}
            </dd>
          </div>
        ) : null}
        <div>
          <dt className="text-xs text-muted-foreground">After acceptance</dt>
          <dd>{SITE_CHECK_AFTER_ACCEPTANCE}</dd>
        </div>
      </dl>
      {editable ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {flagged.map((line) => (
            <Button
              key={line.id}
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => {
                setWaivingId(line.id);
                setReason("");
              }}
            >
              Price as firm… ({line.name})
            </Button>
          ))}
        </div>
      ) : null}
      {waivingId ? (
        <form
          className="mt-3 flex flex-col gap-2 border-t border-warning/20 pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            const lineId = waivingId;
            const fd = new FormData();
            fd.set("reason", reason);
            startTransition(async () => {
              const result = await waiveLineSiteCheck(quoteId, lineId, fd);
              if (!result.ok) {
                toast.error(result.error);
                return;
              }
              toast.success("Line priced as firm");
              setWaivingId(null);
              setReason("");
            });
          }}
        >
          <label className="text-xs text-muted-foreground" htmlFor="waive-reason">
            Reason for pricing as firm
          </label>
          <Input
            id="waive-reason"
            value={reason}
            required
            maxLength={2000}
            disabled={pending}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. Customer confirmed bed depth on site last year"
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending || !reason.trim()}>
              Lock at estimate
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setWaivingId(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
