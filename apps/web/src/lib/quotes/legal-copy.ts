/**
 * DRAFT: pending legal review
 *
 * Consumer disclosures for electronic acceptance, and the not-to-exceed
 * sentence. This file is the only prose a lawyer should edit.
 *
 * The database copies NOT_TO_EXCEED_CLAUSE and ESIGN_DISCLOSURE_VERSION into
 * the hashed offer and the audit event. If either changes, add a new migration
 * so private.not_to_exceed_clause_template() and private.esign_disclosure_version()
 * stay identical. Do not edit an old migration.
 *
 * This is a technical draft, not legal advice.
 */

export const ESIGN_DISCLOSURE_VERSION = "2026-10-09-draft";

/** Sentence shown when the customer accepts a price range. `{amount}` is the cap. */
export const NOT_TO_EXCEED_CLAUSE =
  "You agree to pay no more than {amount}; the final invoice may be lower.";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatNotToExceedAmount(amount: number): string {
  return usd.format(Number.isFinite(amount) ? amount : 0);
}

export function notToExceedClause(amount: string): string {
  return NOT_TO_EXCEED_CLAUSE.replaceAll("{amount}", amount);
}

export const ESIGN_DISCLOSURES = [
  {
    id: "electronic-business",
    heading: "Consent to do business electronically",
    body: "By checking the box and accepting, you consent to do business electronically for this proposal. That includes receiving this disclosure, the accepted proposal, and related records in electronic form. This consent applies to this transaction only. You show that you can access the electronic record by reviewing this page and the PDF copy emailed to you after you accept.",
  },
  {
    id: "paper-copy",
    heading: "Paper copies",
    body: "You have the right to receive a paper copy of this proposal and of the electronic records related to it. To request a paper copy, email or call the company using the contact details on this proposal and ask for a paper copy. We will send it at no charge. Requesting a paper copy does not by itself withdraw your consent to electronic records.",
  },
  {
    id: "withdraw-consent",
    heading: "Withdrawing consent",
    body: "You may withdraw your consent to electronic records before you accept by leaving this page without accepting. After you accept, you may withdraw consent for future records by emailing or calling the company using the contact details on this proposal and stating that you withdraw consent to do business electronically. Withdrawal does not affect a proposal you have already accepted. After you withdraw, later records will be provided on paper or by another method you agree to.",
  },
  {
    id: "hardware-software",
    heading: "Hardware and software requirements",
    body: "To view and keep these electronic records you need a phone, tablet, or computer with a current version of Chrome, Firefox, Safari, or Edge; software that can open PDF files; and an email account that can receive a PDF attachment. You can download the PDF from this page and from the message sent after you accept.",
  },
  {
    id: "update-contact",
    heading: "Updating your contact information",
    body: "To update the email address or other contact information used for these electronic records, email or call the company using the contact details on this proposal and provide the new information. Keep that email account able to receive messages until you have your copy of the accepted proposal.",
  },
] as const;
