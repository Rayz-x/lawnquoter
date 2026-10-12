"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChipGroup, SectionCard, ToggleRow } from "@/components/entry";
import { Button } from "@/components/ui/button";
import { Field, FieldHint, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  MESSAGE_CHANNELS,
  MESSAGE_PURPOSES,
  PURPOSE_LABELS,
  TEMPLATE_TOKENS,
  renderTemplate,
  suggestedTemplate,
  type MessageChannel,
  type MessagePurpose,
} from "@/lib/messaging/template";
import { deleteMessageTemplate, saveMessageTemplate } from "./actions";

export type TemplateEditorValue = {
  id: string;
  name: string;
  channel: MessageChannel;
  purpose: MessagePurpose;
  subject: string;
  body: string;
  isDefault: boolean;
};
const PREVIEW = { customerName: "Pat Lee", company: "North Lawn", link: "https://example.com/q/sample", amount: "$86.00", address: "100 Maple St" };

export function TemplateEditor({ initial, canEdit }: { initial: TemplateEditorValue | null; canEdit: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [channel, setChannel] = useState<MessageChannel>(initial?.channel ?? "sms");
  const [purpose, setPurpose] = useState<MessagePurpose>(initial?.purpose ?? "quote");
  const [name, setName] = useState(initial?.name ?? "");
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [isDefault, setIsDefault] = useState(initial?.isDefault ?? true);
  const locked = !canEdit || pending;

  const save = () => startTransition(async () => {
    const data = new FormData();
    if (initial?.id) data.set("id", initial.id);
    for (const [key, value] of Object.entries({ name, channel, purpose, subject: channel === "sms" ? "" : subject, body, is_default: String(isDefault) })) data.set(key, value);
    const result = await saveMessageTemplate(data);
    if (!result.ok) return void toast.error(result.error);
    toast.success("Template saved");
    router.replace(`/settings/messages?id=${result.data.id}`);
    router.refresh();
  });

  return (
    <SectionCard title={initial?.name ?? "New template"} heading="h2" description="Placeholders fill in when the message is sent." mode={canEdit ? "edit" : "view"}>
      <div className="flex flex-col gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-medium">Channel</p>
          <ChipGroup label="Channel" describedBy="template-channel-hint" value={channel} disabled={locked} options={MESSAGE_CHANNELS.map((value) => ({ value, label: value === "sms" ? "Text" : "Email" }))} onValueChange={(value) => { if (value !== "sms" && value !== "email") return; setChannel(value); if (value === "sms") setSubject(""); }} />
          <FieldHint id="template-channel-hint">Choose text for a short message, or email for a subject and a longer note.</FieldHint>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-medium">Purpose</p>
          <ChipGroup label="Purpose" describedBy="template-purpose-hint" value={purpose} disabled={locked} options={MESSAGE_PURPOSES.map((value) => ({ value, label: PURPOSE_LABELS[value] }))} onValueChange={(value) => { if ((MESSAGE_PURPOSES as readonly string[]).includes(value)) setPurpose(value as MessagePurpose); }} />
          <FieldHint id="template-purpose-hint">Choose when this message is sent, such as a quote, a reminder, or an invoice.</FieldHint>
        </div>
        <Field>
          <FieldLabel htmlFor="template-name">Name</FieldLabel>
          <Input id="template-name" aria-describedby="template-name-hint" value={name} disabled={locked} onChange={(event) => setName(event.target.value)} />
          <FieldHint id="template-name-hint">The name you see when you pick this template later.</FieldHint>
        </Field>
        {channel === "email" ? (
          <Field>
            <FieldLabel htmlFor="template-subject">Subject</FieldLabel>
            <Input id="template-subject" aria-describedby="template-subject-hint" value={subject} disabled={locked} onChange={(event) => setSubject(event.target.value)} />
            <FieldHint id="template-subject-hint">The subject line the customer sees in their inbox.</FieldHint>
          </Field>
        ) : null}
        <Field>
          <FieldLabel htmlFor="template-body">Message</FieldLabel>
          <Textarea id="template-body" aria-describedby="template-body-hint" value={body} disabled={locked} onChange={(event) => setBody(event.target.value)} />
          <FieldHint id="template-body-hint">The note the customer receives, with names filled in when it sends.</FieldHint>
        </Field>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            {TEMPLATE_TOKENS.map((token) => (
              <Button key={token} type="button" variant="outline" className="h-11 lg:h-8" onClick={() => setBody((current) => `${current}${current ? " " : ""}{${token}}`)}>{token}</Button>
            ))}
            <Button type="button" variant="outline" className="h-11 lg:h-8" onClick={() => { const suggested = suggestedTemplate(channel, purpose); setSubject(suggested.subject ?? ""); setBody(suggested.body); if (!name.trim()) setName(PURPOSE_LABELS[purpose]); }}>
              Use suggested wording
            </Button>
          </div>
        ) : null}
        <div className="flex min-w-0 flex-col gap-1">
          <ToggleRow label="Default for this channel and purpose" describedBy="template-default-hint" checked={isDefault} onCheckedChange={setIsDefault} disabled={locked} />
          <FieldHint id="template-default-hint">New messages of this kind use this template unless you pick another.</FieldHint>
        </div>
        <p className="text-sm text-muted-foreground">
          {channel === "email" && subject.trim() ? <span className="block font-medium text-foreground">{renderTemplate(subject, PREVIEW)}</span> : null}
          {renderTemplate(body, PREVIEW) || "The preview shows up here."}
        </p>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={save} disabled={pending}>{pending ? <Spinner data-icon="inline-start" /> : null}Save template</Button>
            {initial ? (
              <Button type="button" variant="outline" disabled={pending} onClick={() => startTransition(async () => {
                const result = await deleteMessageTemplate(initial.id);
                if (!result.ok) return void toast.error(result.error);
                toast.success("Template deleted");
                router.replace("/settings/messages");
                router.refresh();
              })}>Delete</Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}
