import Link from "next/link";

export type DisputeFlagProps = {
  invoiceId: string;
  invoiceLabel: string;
  deadline: string | null;
};

function formatDeadline(deadline: string | null) {
  if (!deadline) return "Deadline unknown";
  const date = new Date(deadline);
  if (Number.isNaN(date.getTime())) return "Deadline unknown";
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Shows an open payment dispute with evidence due date and pack download. */
export function DisputeFlag({ invoiceId, invoiceLabel, deadline }: DisputeFlagProps) {
  return (
    <div className="border-destructive/40 bg-destructive/5 flex flex-col gap-2 border-l-2 px-3 py-2">
      <p className="text-sm font-medium">Dispute open · {invoiceLabel}</p>
      <p className="text-muted-foreground text-sm">Evidence due {formatDeadline(deadline)}</p>
      <p>
        <Link
          className="text-sm underline underline-offset-2"
          href={`/api/invoices/${invoiceId}/evidence-pack`}
        >
          Download evidence pack
        </Link>
      </p>
    </div>
  );
}
