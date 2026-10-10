"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError } from "@/components/ui/field";
import type { SectionAutosaveStatus } from "./section-autosave";

const STATUS_LABEL: Record<Exclude<SectionAutosaveStatus, "idle">, string> = {
  saving: "Saving…",
  saved: "Saved ✓",
  error: "Error",
};

export type SectionFact = {
  label: string;
  value: ReactNode;
};

export function SectionCard({
  title,
  description,
  status = "idle",
  error,
  menu,
  mode = "edit",
  facts,
  onEdit,
  actions,
  children,
}: {
  title: string;
  description?: string;
  status?: SectionAutosaveStatus;
  error?: string | null;
  menu?: ReactNode;
  mode?: "view" | "edit";
  facts?: SectionFact[];
  onEdit?: () => void;
  /** Explicit Save/Cancel slot. Office address and pricing JSON use it. Other cards autosave and omit it. */
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const showFacts = mode === "view" && facts !== undefined;

  return (
    <Card data-entry="section-card" data-mode={mode}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {status !== "idle" || menu ? (
          <CardAction>
            <div className="flex items-center gap-2">
              {status !== "idle" ? (
                <Badge variant={status === "error" ? "destructive" : "secondary"} role="status" data-status={status}>
                  {STATUS_LABEL[status]}
                </Badge>
              ) : null}
              {menu}
            </div>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3">
          {error ? (
            <Field data-invalid>
              <FieldError>{error}</FieldError>
            </Field>
          ) : null}
          {showFacts ? (
            <dl className="flex flex-col gap-3">
              {facts.map((fact) => (
                <div key={fact.label} className="flex flex-col gap-1">
                  <dt className="text-sm text-muted-foreground">{fact.label}</dt>
                  <dd>
                    {onEdit ? (
                      <Button type="button" variant="ghost" className="min-h-11 justify-start lg:min-h-9" onClick={onEdit}>
                        {fact.value}
                      </Button>
                    ) : (
                      fact.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            children
          )}
        </div>
      </CardContent>
      {actions ? <CardFooter data-entry="section-save">{actions}</CardFooter> : null}
    </Card>
  );
}
