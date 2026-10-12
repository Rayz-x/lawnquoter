"use client";


import { canSubmitPartlyDone, PARTLY_DONE_REASON_MAX } from "@/lib/crew/partly-done";

export function PartlyDoneSheet({
  reason,
  onReason,
  hasAfterPhoto,
  busy,
  error,
  onBack,
  onPickAfter,
  onConfirm,
}: {
  reason: string;
  onReason(value: string): void;
  hasAfterPhoto: boolean;
  busy: boolean;
  error: string | null;
  onBack(): void;
  onPickAfter(): void;
  onConfirm(): void;
}) {
  const ready = canSubmitPartlyDone({ reason, hasAfterPhoto });
  return (
    <div
      className="fixed inset-0 z-40 overflow-y-auto bg-background px-4 pt-[max(1rem,env(safe-area-inset-top,0px))] pb-8"
      data-testid="partly-done-sheet"
    >
      <span className="flex min-w-0 flex-col items-start gap-1">
        <button type="button" className="inline-flex min-h-12 items-center text-[17px] font-semibold" onClick={onBack}>
          Back
        </button>
      </span>
      <h2 className="mt-2 font-serif text-2xl font-bold">Partly done</h2>
      <p className="mt-2 text-[15px] text-muted-foreground">
        After photo and a short reason are required. A return visit goes to Needs attention for the office.
      </p>
      <label className="mt-4 block text-[15px] font-semibold" htmlFor="partly-done-reason">
        Reason
      </label>
      <textarea
        id="partly-done-reason"
        value={reason}
        maxLength={PARTLY_DONE_REASON_MAX}
        onChange={(event) => onReason(event.target.value)}
        placeholder="What is left for the return visit?"
        className="mt-2 min-h-28 w-full rounded-xl border p-3 text-[17px]"
        data-testid="partly-done-reason"
      />
      <button
        type="button"
        className="mt-3 flex min-h-14 w-full items-center justify-center rounded-xl border text-[17px] font-semibold"
        onClick={onPickAfter}
        data-testid="partly-done-photo"
      >
        {hasAfterPhoto ? "After photo ready" : "Take an after photo"}
      </button>
      <button
        type="button"
        className="mt-3 flex min-h-14 w-full items-center justify-center rounded-xl bg-primary text-[17px] font-semibold text-primary-foreground disabled:opacity-50"
        disabled={!ready || busy}
        onClick={onConfirm}
        data-testid="partly-done-confirm"
      >
        Finish partly done
      </button>
      {error ? <p className="mt-3 text-[15px] font-semibold text-destructive">{error}</p> : null}
    </div>
  );
}
