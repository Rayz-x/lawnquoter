import { NextResponse } from "next/server";
import { suggestAddresses } from "@/lib/geo/geocode";

export const runtime = "nodejs";

/** Public address autocomplete for the hosted lead form. Typed address still allowed without a pick. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (q.length < 3 || q.length > 200) {
    return NextResponse.json({ suggestions: [] });
  }
  try {
    const results = await suggestAddresses(q);
    return NextResponse.json({
      suggestions: results.slice(0, 5).map((item) => ({
        label: item.formattedAddress,
      })),
    });
  } catch {
    return NextResponse.json({ suggestions: [] });
  }
}
