import "server-only";

import type { createAdminClient } from "@/lib/supabase/server";
import type {
  EvidencePackAcceptance,
  EvidencePackInvoice,
  EvidencePackPhoto,
  EvidencePackStore,
  EvidencePackVisit,
} from "./evidence-pack";

type AdminClient = ReturnType<typeof createAdminClient>;

type UntypedFilter = {
  eq: (col: string, value: string) => UntypedFilter;
  order: (col: string, opts: { ascending: boolean }) => UntypedFilter;
  limit: (n: number) => UntypedFilter;
  maybeSingle: () => Promise<{
    data: Record<string, unknown> | null;
    error: { message: string; code?: string } | null;
  }>;
};

type UntypedAdmin = {
  from: (table: string) => {
    select: (cols: string) => UntypedFilter;
  };
};

async function quoteIdForVisit(
  client: UntypedAdmin,
  input: { orgId: string; jobId: string | null; agreementId: string | null },
): Promise<string | null> {
  if (input.jobId) {
    const { data, error } = await client
      .from("jobs")
      .select("quote_id")
      .eq("id", input.jobId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data?.quote_id) return String(data.quote_id);
  }
  if (input.agreementId) {
    const { data, error } = await client
      .from("agreements")
      .select("quote_id")
      .eq("id", input.agreementId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data?.quote_id) return String(data.quote_id);
  }
  void input.orgId;
  return null;
}

export function createEvidencePackStore(admin: AdminClient): EvidencePackStore {
  const client = admin as unknown as UntypedAdmin;

  return {
    async loadInvoice(invoiceId) {
      const { data, error } = await client
        .from("invoices")
        .select(
          "id, org_id, account_id, visit_id, number, payment_dispute_open, payment_dispute_deadline",
        )
        .eq("id", invoiceId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return {
        id: String(data.id),
        orgId: String(data.org_id),
        accountId: String(data.account_id),
        visitId: data.visit_id == null ? null : String(data.visit_id),
        number: data.number == null ? null : Number(data.number),
        paymentDisputeOpen: Boolean(data.payment_dispute_open),
        paymentDisputeDeadline:
          data.payment_dispute_deadline == null
            ? null
            : String(data.payment_dispute_deadline),
      } satisfies EvidencePackInvoice;
    },

    async loadVisit(visitId) {
      const { data, error } = await client
        .from("visits")
        .select("id, completed_at, job_id, agreement_id")
        .eq("id", visitId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return {
        id: String(data.id),
        completedAt: data.completed_at == null ? null : String(data.completed_at),
        jobId: data.job_id == null ? null : String(data.job_id),
        agreementId: data.agreement_id == null ? null : String(data.agreement_id),
      } satisfies EvidencePackVisit;
    },

    async loadAfterPhoto(visitId) {
      const { data, error } = await client
        .from("visit_photos")
        .select("id, storage_path, kind, created_at")
        .eq("visit_id", visitId)
        .eq("kind", "after")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return {
        id: String(data.id),
        storagePath: String(data.storage_path),
        kind: String(data.kind),
        createdAt: String(data.created_at),
      } satisfies EvidencePackPhoto;
    },

    async loadAcceptance(input) {
      const quoteId = await quoteIdForVisit(client, input);
      if (!quoteId) return null;
      const { data, error } = await client
        .from("acceptances")
        .select(
          "id, quote_id, signer_name, signer_email, document_hash, accepted_at, method",
        )
        .eq("quote_id", quoteId)
        .order("accepted_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return {
        id: String(data.id),
        quoteId: String(data.quote_id),
        signerName: String(data.signer_name),
        signerEmail: data.signer_email == null ? null : String(data.signer_email),
        documentHash: String(data.document_hash),
        acceptedAt: String(data.accepted_at),
        method: String(data.method),
      } satisfies EvidencePackAcceptance;
    },
  };
}
