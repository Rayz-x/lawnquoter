import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { PublicQuote } from "@/lib/quotes/public-quote";
import { createClient } from "@/lib/supabase/server";
import { ProposalView } from "./proposal-view";

export const metadata: Metadata = { title: "Proposal" };

export default async function PublicQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("quote_public", { p_token: token });
  if (!data) notFound();
  return <ProposalView token={token} payload={data as PublicQuote} />;
}
