"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { modifiersSchema, modifiersWithDefaults, type Modifiers } from "@lawnquoter/pricing-engine";
import { SectionCard } from "@/components/entry";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { saveModifiers } from "./actions";

const DEAD_MODIFIER_KEYS = ["bagging", "travel", "routeDensityDiscount"] as const;

function modifiersForEditor(modifiers: Modifiers): string {
  const live: Record<string, unknown> = { ...modifiers };
  for (const key of DEAD_MODIFIER_KEYS) delete live[key];
  return JSON.stringify(live, null, 2);
}

function jsonIssues(text: string): string[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    const pos = Number(/position (\d+)/.exec(String(error))?.[1] ?? 0);
    return [`Line ${text.slice(0, pos).split("\n").length}: Modifiers must be valid JSON`];
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) return ["Line 1: Modifiers must be a JSON object"];
  const parsed = modifiersSchema.safeParse(modifiersWithDefaults(json));
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => {
    const key = [...issue.path].reverse().find((part) => typeof part === "string");
    let line = 1;
    if (typeof key === "string") {
      text.split("\n").some((source, index) => {
        if (!source.includes(`"${key}"`)) return false;
        line = index + 1;
        return true;
      });
    }
    return `Line ${line}: ${issue.message}`;
  });
}

export function ModifiersForm({ priceListId, modifiers }: { priceListId: string; modifiers: Modifiers }) {
  const router = useRouter();
  const saved = modifiersForEditor(modifiers);
  const [text, setText] = useState(saved);
  const [seen, setSeen] = useState(saved);
  const [issues, setIssues] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  if (saved !== seen) {
    setSeen(saved);
    setText(saved);
    setIssues([]);
  }

  return (
    <SectionCard
      title="Property modifiers"
      description="Slope, gate width, first-cut, obstacles, and service minimums."
      actions={
        <>
          <Button
            type="button"
            disabled={pending}
            onClick={() => {
              const found = jsonIssues(text);
              setIssues(found);
              if (found.length) return;
              const fd = new FormData();
              fd.set("price_list_id", priceListId);
              fd.set("modifiers", text);
              startTransition(async () => {
                const result = await saveModifiers(fd);
                if (result.ok) {
                  setIssues([]);
                  router.refresh();
                } else setIssues([result.error]);
              });
            }}
          >
            {pending ? <Spinner data-icon="inline-start" /> : null}
            Save
          </Button>
          <Button type="button" variant="outline" disabled={pending || text === saved} onClick={() => { setText(saved); setIssues([]); }}>
            Cancel
          </Button>
        </>
      }
    >
      <Field data-invalid={issues.length > 0 || undefined}>
        <FieldLabel htmlFor="modifiers">Modifiers JSON</FieldLabel>
        <Textarea id="modifiers" rows={18} className="font-mono text-xs" value={text} aria-invalid={issues.length > 0 || undefined} onChange={(event) => setText(event.target.value)} />
        <FieldDescription>Applied after each rule. Nothing is stored until you save.</FieldDescription>
        {issues.length ? (
          <FieldError>
            <ul>
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </FieldError>
        ) : null}
      </Field>
    </SectionCard>
  );
}
