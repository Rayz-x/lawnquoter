"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { formatMoney } from "@/lib/money";
import { splitAcceptedQuote } from "../split-action";

export function SplitQuoteForm({
  quoteId,
  lines,
}: {
  quoteId: string;
  lines: { id: string; name: string; price: number }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [titles, setTitles] = useState(["Job 1", "Job 2"]);
  const [placement, setPlacement] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((line, index) => [line.id, index === 0 ? "0" : "1"])),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Split into jobs</CardTitle>
        <CardDescription>Put the accepted lines on two jobs. A line stays on one job.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const groups = titles.map((title, index) => ({
              title,
              lineIds: lines.filter((line) => placement[line.id] === String(index)).map((line) => line.id),
            }));
            startTransition(async () => {
              const result = await splitAcceptedQuote({
                quoteId,
                lines: lines.map((line) => ({ id: line.id, name: line.name })),
                groups,
              });
              if (!result.ok) {
                toast.error(result.error);
                return;
              }
              toast.success(`Split into ${result.data.jobs.length} jobs`);
              router.refresh();
            });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {titles.map((title, index) => (
              <Field key={index}>
                <FieldLabel htmlFor={`split-title-${index}`}>Job {index + 1}</FieldLabel>
                <Input
                  id={`split-title-${index}`}
                 
                  value={title}
                  onChange={(event) =>
                    setTitles((current) => current.map((value, item) => (item === index ? event.target.value : value)))
                  }
                />
              </Field>
            ))}
          </div>
          <ul className="flex flex-col gap-2">
            {lines.map((line) => (
              <li key={line.id} className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span>
                  {line.name} · {formatMoney(line.price)}
                </span>
                <NativeSelect
                  aria-label={`Job for ${line.name}`}
                  value={placement[line.id] ?? "0"}
                  onChange={(event) => setPlacement((current) => ({ ...current, [line.id]: event.target.value }))}
                >
                  <option value="0">Job 1</option>
                  <option value="1">Job 2</option>
                </NativeSelect>
              </li>
            ))}
          </ul>
          <Button type="submit" disabled={pending || lines.length < 2} className="min-h-11 w-fit">
            Split into jobs
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
