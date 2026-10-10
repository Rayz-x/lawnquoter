import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { brandStyleSheet, deriveBrandTheme } from "@/lib/brand/derive-brand-theme";
import { isPublicChangeOrder } from "@/lib/billing/change-order";
import { createClient } from "@/lib/supabase/server";
import { ChangeOrderView } from "./change-order-view";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("change_order_public", { p_token: token });
  if (!isPublicChangeOrder(data)) return { title: "Change order" };
  return { title: `${data.org.name} change order` };
}

export default async function PublicChangeOrderPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("change_order_public", { p_token: token });
  if (!isPublicChangeOrder(data)) notFound();
  const theme = deriveBrandTheme(data.org.brand_color);

  return (
    <div data-tenant-brand>
      <style>{brandStyleSheet(theme)}</style>
      <ChangeOrderView token={token} payload={data} />
    </div>
  );
}
