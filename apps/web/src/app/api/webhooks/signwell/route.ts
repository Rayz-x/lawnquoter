import { NextResponse } from "next/server";
import { handleSignWellWebhook } from "@/lib/billing/signwell-webhook";
import { signWellApiKey, signWellWebhookId } from "@/lib/billing/signwell";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid SignWell event." }, { status: 401 });
  }

  const result = await handleSignWellWebhook(body, {
    webhookId: signWellWebhookId(),
    apiKey: signWellApiKey(),
    nowSeconds: Math.floor(Date.now() / 1000),
    record: async (completion) => {
      const admin = createAdminClient();
      const { error } = await admin.rpc("record_signwell_completion", {
        p_document_id: completion.documentId,
        p_signer_name: completion.signerName,
        p_signer_email: completion.signerEmail,
      });
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    },
  });

  if (result.status === 200) return NextResponse.json({ ok: true });
  return NextResponse.json({ error: result.error }, { status: result.status });
}
