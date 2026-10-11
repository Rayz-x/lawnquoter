export type EvidencePackInvoice = {
  id: string;
  orgId: string;
  accountId: string;
  visitId: string | null;
  number: number | null;
  paymentDisputeOpen: boolean;
  paymentDisputeDeadline: string | null;
};

export type EvidencePackVisit = {
  id: string;
  completedAt: string | null;
  jobId: string | null;
  agreementId: string | null;
};

export type EvidencePackPhoto = {
  id: string;
  storagePath: string;
  kind: string;
  createdAt: string;
};

export type EvidencePackAcceptance = {
  id: string;
  quoteId: string;
  signerName: string;
  signerEmail: string | null;
  documentHash: string;
  acceptedAt: string;
  method: string;
};

export type EvidencePackStore = {
  loadInvoice: (invoiceId: string) => Promise<EvidencePackInvoice | null>;
  loadVisit: (visitId: string) => Promise<EvidencePackVisit | null>;
  loadAfterPhoto: (visitId: string) => Promise<EvidencePackPhoto | null>;
  loadAcceptance: (input: {
    orgId: string;
    jobId: string | null;
    agreementId: string | null;
  }) => Promise<EvidencePackAcceptance | null>;
};

export type EvidencePack = {
  invoiceId: string;
  invoiceNumber: number | null;
  disputeOpen: boolean;
  disputeDeadline: string | null;
  afterPhoto: EvidencePackPhoto | null;
  completionTime: string | null;
  acceptance: EvidencePackAcceptance | null;
};

export async function assembleEvidencePack(deps: {
  invoiceId: string;
  store: EvidencePackStore;
}): Promise<{ ok: true; pack: EvidencePack } | { ok: false; error: string }> {
  const invoice = await deps.store.loadInvoice(deps.invoiceId);
  if (!invoice) return { ok: false, error: "Invoice not found." };
  if (!invoice.visitId) return { ok: false, error: "Invoice has no visit record." };

  const visit = await deps.store.loadVisit(invoice.visitId);
  if (!visit) return { ok: false, error: "Visit not found." };

  const [afterPhoto, acceptance] = await Promise.all([
    deps.store.loadAfterPhoto(visit.id),
    deps.store.loadAcceptance({
      orgId: invoice.orgId,
      jobId: visit.jobId,
      agreementId: visit.agreementId,
    }),
  ]);

  return {
    ok: true,
    pack: {
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      disputeOpen: invoice.paymentDisputeOpen,
      disputeDeadline: invoice.paymentDisputeDeadline,
      afterPhoto,
      completionTime: visit.completedAt,
      acceptance,
    },
  };
}
