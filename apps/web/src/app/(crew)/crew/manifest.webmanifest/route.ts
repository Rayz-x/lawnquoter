import { crewManifest } from "@/lib/crew/manifest";

export function GET() {
  return new Response(JSON.stringify(crewManifest()), {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
