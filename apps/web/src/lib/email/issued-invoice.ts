import type { OutboundEmail } from "./provider";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function issuedInvoiceMessage(input: {
  to: string;
  orgName: string;
  numberLabel: string;
  invoiceUrl: string;
  pdf: Buffer;
}): OutboundEmail {
  const text = `Your invoice from ${input.orgName} is ready.

Invoice ${input.numberLabel}
View and download: ${input.invoiceUrl}

A PDF copy is attached.
`;
  const html = `<p>Your invoice from ${escapeHtml(input.orgName)} is ready.</p>
<p>Invoice ${escapeHtml(input.numberLabel)}<br>
<a href="${escapeHtml(input.invoiceUrl)}">View invoice</a></p>
<p>A PDF copy is attached.</p>`;

  return {
    to: input.to,
    subject: `Invoice ${input.numberLabel} from ${input.orgName}`,
    text,
    html,
    attachments: [
      {
        filename: `${input.numberLabel}.pdf`,
        content: input.pdf,
        contentType: "application/pdf",
      },
    ],
  };
}
