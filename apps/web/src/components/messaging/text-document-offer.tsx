import { TextDocumentButton } from "@/components/messaging/text-document-button";
import { readTwilioConfig, TWILIO_NOT_CONNECTED } from "@/lib/messaging/sms";

export function TextDocumentOffer({
  purpose,
  id,
  label,
  allowed,
}: {
  purpose: "quote" | "invoice";
  id: string;
  label: string;
  allowed: boolean;
}) {
  if (!allowed) return null;
  if (!readTwilioConfig(process.env)) return <p className="text-sm text-muted-foreground">{TWILIO_NOT_CONNECTED}</p>;
  return <TextDocumentButton purpose={purpose} id={id} label={label} />;
}
