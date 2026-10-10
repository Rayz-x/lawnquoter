"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { markLeadLostAction } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { LEAD_LOST_REASON_LABELS, LEAD_LOST_REASONS, type LeadLostReason } from "@/lib/leads/lost";

type Props = {
  leadId: string;
  quoteId?: string | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerLabel?: string;
  title?: string;
  description?: string;
};

export function MarkLostDialog({
  leadId,
  quoteId,
  open: controlledOpen,
  onOpenChange,
  triggerLabel = "Mark lost",
  title = "Mark lead lost",
  description = "Choose why this lead was lost.",
}: Props) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  const [reason, setReason] = useState<LeadLostReason | "">("");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  function reset() {
    setReason("");
    setNote("");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (!next) reset();
      }}
    >
      {controlledOpen === undefined ? (
        <DialogTrigger render={<Button variant="destructive" />}>{triggerLabel}</DialogTrigger>
      ) : null}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            startTransition(async () => {
              const result = await markLeadLostAction({
                leadId,
                quoteId,
                reason,
                note: note.trim() || undefined,
              });
              if (result.ok) {
                setOpen(false);
                reset();
                toast.success("Lead marked lost");
                return;
              }
              toast.error(result.error);
            });
          }}
        >
          <fieldset className="grid gap-2" disabled={pending}>
            <legend className="text-sm font-medium">Reason</legend>
            <RadioGroup
              value={reason}
              onValueChange={(value) => setReason(value as LeadLostReason)}
              className="grid gap-2"
              data-testid="lost-reason-group"
            >
              {LEAD_LOST_REASONS.map((value) => (
                <Label key={value} className="flex cursor-pointer items-center gap-2 font-normal">
                  <RadioGroupItem value={value} />
                  {LEAD_LOST_REASON_LABELS[value]}
                </Label>
              ))}
            </RadioGroup>
          </fieldset>
          {reason === "other" ? (
            <div className="grid gap-2">
              <Label htmlFor="lost-note">Note</Label>
              <Textarea
                id="lost-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                required
                placeholder="What happened?"
                data-testid="lost-note"
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={pending || !reason}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              Mark lost
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
