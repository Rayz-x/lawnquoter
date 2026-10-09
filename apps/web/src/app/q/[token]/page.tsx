import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProposalView } from "./proposal-view";

export const metadata: Metadata = { title: "Proposal" };

export default async function PublicQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("quote_public", { p_token: token });
  if (!data) notFound();
  const payload = data as {
    title: string;
    number: number;
    intro: string | null;
    notes_customer: string | null;
    expires_at: string | null;
    status: string;
    org: { name: string; phone: string | null; email: string | null; brand_color: string | null };
    items: Array<{
      id: string;
      name: string;
      description: string | null;
      state: "included" | "recommended" | "optional";
      option_group: string | null;
      option_tier: string;
      price: number;
      range_low: number | null;
      range_high: number | null;
      photo_url: string | null;
      selected: boolean;
    }>;
  };

  return <ProposalView token={token} payload={payload} />;
}
