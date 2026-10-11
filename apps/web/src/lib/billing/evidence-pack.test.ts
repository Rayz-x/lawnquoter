import { describe, expect, it } from "vitest";
import { assembleEvidencePack, type EvidencePackStore } from "./evidence-pack";

function store(overrides: Partial<EvidencePackStore> = {}): EvidencePackStore {
  return {
    async loadInvoice(invoiceId) {
      if (invoiceId !== "inv-1") return null;
      return {
        id: "inv-1",
        orgId: "org-1",
        accountId: "acct-1",
        visitId: "visit-1",
        number: 42,
        paymentDisputeOpen: true,
        paymentDisputeDeadline: "2026-11-01T00:00:00.000Z",
      };
    },
    async loadVisit(visitId) {
      if (visitId !== "visit-1") return null;
      return {
        id: "visit-1",
        completedAt: "2026-10-01T15:30:00.000Z",
        jobId: "job-1",
        agreementId: "agr-1",
      };
    },
    async loadAfterPhoto(visitId) {
      if (visitId !== "visit-1") return null;
      return {
        id: "photo-1",
        storagePath: "org-1/visit-1/client-1.jpg",
        kind: "after",
        createdAt: "2026-10-01T15:28:00.000Z",
      };
    },
    async loadAcceptance(input) {
      void input;
      return {
        id: "acc-1",
        quoteId: "quote-1",
        signerName: "Pat Customer",
        signerEmail: "pat@example.com",
        documentHash: "hash-abc",
        acceptedAt: "2026-09-15T12:00:00.000Z",
        method: "click",
      };
    },
    ...overrides,
  };
}

describe("assembleEvidencePack", () => {
  it("includes after photo, completion timestamp, and acceptance record", async () => {
    const pack = await assembleEvidencePack({ invoiceId: "inv-1", store: store() });
    expect(pack).toEqual({
      ok: true,
      pack: {
        invoiceId: "inv-1",
        invoiceNumber: 42,
        disputeOpen: true,
        disputeDeadline: "2026-11-01T00:00:00.000Z",
        afterPhoto: {
          id: "photo-1",
          storagePath: "org-1/visit-1/client-1.jpg",
          kind: "after",
          createdAt: "2026-10-01T15:28:00.000Z",
        },
        completionTime: "2026-10-01T15:30:00.000Z",
        acceptance: {
          id: "acc-1",
          quoteId: "quote-1",
          signerName: "Pat Customer",
          signerEmail: "pat@example.com",
          documentHash: "hash-abc",
          acceptedAt: "2026-09-15T12:00:00.000Z",
          method: "click",
        },
      },
    });
  });

  it("fails when the invoice has no visit record", async () => {
    const pack = await assembleEvidencePack({
      invoiceId: "inv-1",
      store: store({
        async loadInvoice() {
          return {
            id: "inv-1",
            orgId: "org-1",
            accountId: "acct-1",
            visitId: null,
            number: 42,
            paymentDisputeOpen: false,
            paymentDisputeDeadline: null,
          };
        },
      }),
    });
    expect(pack).toEqual({ ok: false, error: "Invoice has no visit record." });
  });
});
