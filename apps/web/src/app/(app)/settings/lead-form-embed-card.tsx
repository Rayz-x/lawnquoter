"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { SectionCard } from "@/components/entry";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  hostedQuoteFormUrl,
  instantQuoteIframeEmbed,
  quoteButtonSnippet,
  quoteIframeEmbed,
} from "@/lib/leads/embed-snippets";

function CopyField({
  label,
  value,
  rows = 3,
}: {
  label: string;
  value: string;
  rows?: number;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      toast.success("Copied");
      window.setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{label}</p>
        <Button type="button" variant="outline" size="sm" className="h-11 lg:h-8" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <Textarea
        readOnly
        rows={rows}
        value={value}
        aria-label={label}
        className="min-h-11 font-mono text-xs"
      />
    </div>
  );
}

/**
 * Owner-only settings card: hosted link, button snippet, and iframe embed.
 * UTM tags on the snippets are captured from the page URL when the form loads (L05).
 */
export function LeadFormEmbedCard({
  isOwner,
  origin,
  slug,
}: {
  isOwner: boolean;
  origin: string;
  slug: string;
}): ReactNode {
  if (!isOwner) return null;

  const hosted = hostedQuoteFormUrl(origin, slug);
  const button = quoteButtonSnippet(origin, slug);
  const embed = quoteIframeEmbed(origin, slug);
  const widget = instantQuoteIframeEmbed(origin, slug);

  return (
    <SectionCard
      title="Hosted form"
      heading="h2"
      description="Share the link, a button, or an embed. Attribution (UTM, referrer, landing page) comes from the form page URL."
      className="w-full min-w-0"
    >
      <div className="flex w-full min-w-0 flex-col gap-4">
        <CopyField label="Hosted link" value={hosted} rows={2} />
        <CopyField label="Button snippet" value={button} rows={3} />
        <CopyField label="Embed snippet" value={embed} rows={4} />
        <CopyField label="Instant quote embed" value={widget} rows={4} />
      </div>
    </SectionCard>
  );
}
