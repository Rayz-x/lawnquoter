"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  endAgreement,
  pauseAgreement,
  resumeAgreement,
  updateAgreementSeason,
} from "@/lib/actions/scheduling";
import { DEFAULT_SEASON, formatSeasonLabel } from "@/lib/scheduling/season";

type SeasonFields = {
  startMonth: number;
  startDay: number;
  endMonth: number;
  endDay: number;
};

function toSeason(
  startMonth: number | null,
  startDay: number | null,
  endMonth: number | null,
  endDay: number | null,
): SeasonFields | null {
  if (startMonth == null || startDay == null || endMonth == null || endDay == null) return null;
  return { startMonth, startDay, endMonth, endDay };
}

export function AgreementLifecycleForm({
  agreementId,
  status,
  resumeOn,
  seasonStartMonth,
  seasonStartDay,
  seasonEndMonth,
  seasonEndDay,
  orgSeason,
  canEditSeason,
  canManageStatus,
}: {
  agreementId: string;
  status: "active" | "paused" | "ended";
  resumeOn: string | null;
  seasonStartMonth: number | null;
  seasonStartDay: number | null;
  seasonEndMonth: number | null;
  seasonEndDay: number | null;
  orgSeason: SeasonFields;
  canEditSeason: boolean;
  canManageStatus: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const override = toSeason(seasonStartMonth, seasonStartDay, seasonEndMonth, seasonEndDay);
  const [useOverride, setUseOverride] = useState(override != null);
  const [season, setSeason] = useState<SeasonFields>(override ?? orgSeason);
  const [resumeDate, setResumeDate] = useState(resumeOn ?? "");
  const [untilNotice, setUntilNotice] = useState(!resumeOn);
  const [endDate, setEndDate] = useState("");

  const effective = useOverride ? season : orgSeason;

  if (status === "ended") {
    return (
      <p className="text-sm text-muted-foreground">
        Ended. Season was {formatSeasonLabel(effective)}. History is kept; future visits were cancelled.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {canEditSeason ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            startTransition(async () => {
              const result = await updateAgreementSeason(agreementId, useOverride ? season : null);
              if (result.ok) {
                toast.success("Season saved");
                router.refresh();
              } else {
                toast.error(result.error);
              }
            });
          }}
        >
          <FieldGroup>
            <Field>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={useOverride}
                  onChange={(event) => setUseOverride(event.target.checked)}
                />
                Custom season for this agreement
              </label>
            </Field>
            {useOverride ? (
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["startMonth", "Start month"],
                    ["startDay", "Start day"],
                    ["endMonth", "End month"],
                    ["endDay", "End day"],
                  ] as const
                ).map(([key, label]) => (
                  <Field key={key}>
                    <FieldLabel htmlFor={`agr-${key}`}>{label}</FieldLabel>
                    <Input
                      id={`agr-${key}`}
                      type="number"
                      min={1}
                      max={key.endsWith("Month") ? 12 : 31}
                      required
                      value={season[key]}
                      onChange={(event) =>
                        setSeason({ ...season, [key]: Number(event.target.value) })
                      }
                    />
                  </Field>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Uses company season {formatSeasonLabel(orgSeason)} (default{" "}
                {formatSeasonLabel(DEFAULT_SEASON)}).
              </p>
            )}
          </FieldGroup>
          <Button type="submit" variant="outline" disabled={pending}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            Save season
          </Button>
        </form>
      ) : (
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Season</dt>
            <dd>
              {formatSeasonLabel(effective)}
              {override ? "" : " (company default)"}
            </dd>
          </div>
        </dl>
      )}

      {!canManageStatus ? (
        status === "paused" ? (
          <p className="text-sm text-muted-foreground border-t pt-4">
            Paused {resumeOn ? `until ${resumeOn}` : "until further notice"}.
          </p>
        ) : null
      ) : status === "active" ? (
        <form
          className="flex flex-col gap-3 border-t pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            startTransition(async () => {
              const result = await pauseAgreement(agreementId, untilNotice ? null : resumeDate || null);
              if (result.ok) {
                toast.success("Agreement paused");
                router.refresh();
              } else {
                toast.error(result.error);
              }
            });
          }}
        >
          <p className="text-sm font-medium">Pause</p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={untilNotice}
              onChange={(event) => setUntilNotice(event.target.checked)}
            />
            Until further notice
          </label>
          {!untilNotice ? (
            <Field>
              <FieldLabel htmlFor="resume-on">Resume on</FieldLabel>
              <Input
                id="resume-on"
                type="date"
                required
                value={resumeDate}
                onChange={(event) => setResumeDate(event.target.value)}
              />
            </Field>
          ) : null}
          <Button type="submit" variant="outline" disabled={pending || (!untilNotice && !resumeDate)}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            Pause agreement
          </Button>
        </form>
      ) : (
        <div className="flex flex-col gap-2 border-t pt-4">
          <p className="text-sm">
            Paused {resumeOn ? `until ${resumeOn}` : "until further notice"}.
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => {
              startTransition(async () => {
                const result = await resumeAgreement(agreementId);
                if (result.ok) {
                  toast.success("Agreement resumed");
                  router.refresh();
                } else {
                  toast.error(result.error);
                }
              });
            }}
          >
            {pending ? <Spinner data-icon="inline-start" /> : null}
            Resume now
          </Button>
        </div>
      )}

      {canManageStatus ? (
        <form
          className="flex flex-col gap-3 border-t pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            startTransition(async () => {
              const result = await endAgreement(agreementId, endDate || null);
              if (result.ok) {
                toast.success("Agreement ended");
                router.refresh();
              } else {
                toast.error(result.error);
              }
            });
          }}
        >
          <p className="text-sm font-medium">End agreement</p>
          <p className="text-sm text-muted-foreground">
            Cancels future scheduled visits. Completed history stays.
          </p>
          <Field>
            <FieldLabel htmlFor="end-date">End date (optional)</FieldLabel>
            <Input
              id="end-date"
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </Field>
          <Button type="submit" variant="destructive" disabled={pending}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            End agreement
          </Button>
        </form>
      ) : null}
    </div>
  );
}
