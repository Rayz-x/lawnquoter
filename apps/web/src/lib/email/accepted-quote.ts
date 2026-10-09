import type { OutboundEmail } from "./provider";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function acceptedQuoteMessage(input: {
  to: string;
  orgName: string;
  quoteNumber: number;
  documentHash: string;
  clause: string | null;
  pdf: Buffer;
}): OutboundEmail {
  const clauseLine = input.clause ? `${input.clause}\n` : "";
  const text = `This is your copy of the accepted proposal from ${input.orgName}.

Quote #${input.quoteNumber}
Document hash: ${input.documentHash}
${clauseLine}
The attached PDF is the sealed copy of the proposal you accepted.
`;
  const html = `<p>This is your copy of the accepted proposal from ${escapeHtml(input.orgName)}.</p>
<p>Quote #${input.quoteNumber}<br>Document hash: ${escapeHtml(input.documentHash)}</p>
${input.clause ? `<p>${escapeHtml(input.clause)}</p>` : ""}
<p>The attached PDF is the sealed copy of the proposal you accepted.</p>`;

  return {
    to: input.to,
    subject: `Accepted quote #${input.quoteNumber} from ${input.orgName}`,
    text,
    html,
    attachments: [
      {
        filename: `quote-${input.quoteNumber}-accepted.pdf`,
        content: input.pdf,
        contentType: "application/pdf",
      },
    ],
  };
}
