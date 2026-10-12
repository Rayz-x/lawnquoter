import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { e2eEnabled } from "@/lib/e2e/gate";
import { supabasePublishableKey, supabaseUrl } from "./env";

const PUBLIC_PREFIXES = [
  "/login",
  "/auth",
  "/q/",
  "/co/",
  "/i/",
  "/s/",
  "/r/",
  "/w/",
  "/api/leads/intake",
  "/api/public",
  // Linked from every page. A login redirect is HTML, which the browser reports as a manifest syntax error.
  "/manifest.webmanifest",
  "/crew/manifest.webmanifest",
  "/sw.js",
  "/offline.html",
];

export function isPublicPath(pathname: string, allowE2e = false) {
  if (allowE2e && (pathname === "/e2e" || pathname.startsWith("/e2e/"))) return true;
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

/** Refreshes the Supabase session cookie and redirects unauthenticated app traffic to /login. */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getClaims validates the JWT locally (asymmetric keys) without a network round-trip.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const { pathname } = request.nextUrl;

  if (!claims && !isPublicPath(pathname, e2eEnabled())) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(url);
  }

  if (claims && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
