"use server";

import { revalidatePath } from "next/cache";
import { serviceRequestBody } from "@/lib/portal/scope";
import { loadPortal } from "@/lib/portal/load";
import { createAdminClient } from "@/lib/supabase/server";

export async function requestService(token: string, formData: FormData): Promise<void> {
  const portal = await loadPortal(token);
  if (!portal) throw new Error("This link has expired.");
  const body = serviceRequestBody(String(formData.get("body") ?? ""));
  if (!body) throw new Error("Describe the work in 2000 characters or fewer.");
  const propertyId = String(formData.get("property_id") ?? "");
  const property = portal.properties.find((item) => item.id === propertyId);
  const admin = createAdminClient();
  const { data: link } = await admin.from("portal_links").select("id, org_id, account_id").eq("token", token).maybeSingle();
  if (!link) throw new Error("This link has expired.");
  const { error } = await admin.from("portal_requests").insert({
    org_id: link.org_id,
    account_id: property?.accountId ?? link.account_id,
    property_id: property?.id ?? null,
    portal_link_id: link.id,
    body,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/portal/${token}`);
}
