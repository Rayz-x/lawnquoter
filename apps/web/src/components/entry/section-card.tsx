"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
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
  /** Plain words for the edit button. Used when `value` is not text. */
  text?: string;
};

function factText(fact: SectionFact) {
  if (fact.text) return fact.text;
  if (typeof fact.value === "string" || typeof fact.value === "number") return String(fact.value);
  return fact.label;
}

export function SectionCard({
  title,
  description,
  status = "idle",
  error,
  menu,
  mode = "edit",
  facts,
  onEdit,
  onRetry,
  heading = "h2",
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
  onRetry?: () => void;
  heading?: "h2" | "h3";
  /** Explicit Save/Cancel slot. Office address and pricing JSON use it. Other cards autosave and omit it. */
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const titleId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const factButtons = useRef(new Map<string, HTMLButtonElement>());
  const editedFact = useRef<string | null>(null);
  const showFacts = mode === "view" && facts !== undefined;
  const HeadingTag = heading === "h3" ? "h3" : "h2";

  useEffect(() => {
    if (!editedFact.current) return;
    if (mode === "edit") {
      contentRef.current
        ?.querySelector<HTMLElement>("input:not([disabled]), textarea:not([disabled]), select:not([disabled])")
        ?.focus();
      return;
    }
    factButtons.current.get(editedFact.current)?.focus();
  }, [mode]);

  return (
    <Card data-entry="section-card" data-mode={mode}>
      <section aria-labelledby={titleId}>
        <CardHeader>
          <CardTitle>
            <HeadingTag id={titleId} className="text-base leading-snug font-medium">
              {title}
            </HeadingTag>
          </CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
          <CardAction>
            <div className="flex items-center gap-2">
              <div role="status" aria-live="polite" aria-busy={status === "saving"} data-status={status}>
                {status === "idle" ? null : (
                  <Badge variant={status === "error" ? "destructive" : "secondary"}>{STATUS_LABEL[status]}</Badge>
                )}
              </div>
              {menu}
            </div>
          </CardAction>
        </CardHeader>
        <CardContent ref={contentRef}>
          <div className="flex flex-col gap-3">
            {error ? (
              <Field data-invalid>
                <FieldError>{error}</FieldError>
                {onRetry ? (
                  <Button type="button" variant="outline" onClick={onRetry}>
                    Retry
                  </Button>
                ) : null}
              </Field>
            ) : null}
            {showFacts ? (
              <dl className="flex flex-col gap-3">
                {facts.map((fact) => (
                  <div key={fact.label} className="flex flex-col gap-1">
                    <dt className="text-sm text-muted-foreground">{fact.label}</dt>
                    <dd>
                      {onEdit ? (
                        <Button
                          type="button"
                          variant="ghost"
                          className="min-h-11 justify-start lg:min-h-9"
                          aria-label={`Edit ${fact.label}: ${factText(fact)}`}
                          ref={(node) => {
                            if (node) factButtons.current.set(fact.label, node);
                            else factButtons.current.delete(fact.label);
                          }}
                          onClick={() => {
                            editedFact.current = fact.label;
                            onEdit();
                          }}
                        >
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
      </section>
    </Card>
  );
}
