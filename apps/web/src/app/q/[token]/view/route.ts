import { NextResponse } from "next/server";
import { isPreviewRequest } from "@/lib/quotes/view-signal";
import { createClient } from "@/lib/supabase/server";

const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (isPreviewRequest(req.headers) || req.headers.get("x-lq-view") !== "1") {
    return new NextResponse(null, { status: 204 });
  }
  const { token } = await params;
  if (!TOKEN.test(token)) return new NextResponse(null, { status: 400 });
  const supabase = await createClient();
  const { error } = await supabase.rpc("quote_record_view", { p_token: token });
  if (error) return new NextResponse(null, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
