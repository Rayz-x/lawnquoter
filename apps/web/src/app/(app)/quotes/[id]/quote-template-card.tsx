"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { HelpTip } from "@/components/help/help-tip";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { QUOTE_TEMPLATE_KINDS } from "@/lib/quotes/template-config";
import { applyQuoteTemplate, saveQuoteTemplate } from "../template-action";

const KIND_LABEL: Record<(typeof QUOTE_TEMPLATE_KINDS)[number], string> = {
  mowing: "Mowing",
  fert: "Fertilizer",
  cleanup: "Cleanup",
  snow: "Snow",
  irrigation: "Irrigation",
  install: "Install",
  other: "Other",
};

export function QuoteTemplateCard({
  quoteId,
  templates,
}: {
  quoteId: string;
  templates: { id: string; name: string; service_kind: string | null }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [serviceKind, setServiceKind] = useState("");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1">
          Templates
          <HelpTip
            label="Help for quote templates"
            text="Save these lines, then add that template on the next quote."
            href="/help/quote-builder#templates"
          />
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            startTransition(async () => {
              const saved = await saveQuoteTemplate({ quoteId, name, serviceKind });
              if (!saved.ok) {
                toast.error(saved.error);
                return;
              }
              toast.success("Template saved");
              setName("");
              router.refresh();
            });
          }}
        >
          <Field>
            <FieldLabel htmlFor="template-name">Save these lines</FieldLabel>
            <Input id="template-name" value={name} required placeholder="Weekly mowing" onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="template-kind">Service line</FieldLabel>
            <NativeSelect id="template-kind" value={serviceKind} onChange={(event) => setServiceKind(event.target.value)}>
              <option value="">Any</option>
              {QUOTE_TEMPLATE_KINDS.map((kind) => (
                <option key={kind} value={kind}>{KIND_LABEL[kind]}</option>
              ))}
            </NativeSelect>
          </Field>
          <Button type="submit" variant="outline" disabled={pending} className="min-h-11 w-fit">Save template</Button>
        </form>
        {templates.length ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              startTransition(async () => {
                const applied = await applyQuoteTemplate(quoteId, templateId);
                if (!applied.ok) {
                  toast.error(applied.error);
                  return;
                }
                toast.success(`Added ${applied.data.count} lines`);
                router.refresh();
              });
            }}
          >
            <Field>
              <FieldLabel htmlFor="template-apply">Add a template</FieldLabel>
              <NativeSelect id="template-apply" value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}{template.service_kind ? ` · ${KIND_LABEL[template.service_kind as keyof typeof KIND_LABEL] ?? template.service_kind}` : ""}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Button type="submit" disabled={pending} className="min-h-11 w-fit">Add lines</Button>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">No templates yet.</p>
        )}
      </CardContent>
    </Card>
  );
}
