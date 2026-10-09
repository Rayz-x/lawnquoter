import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient as createBareClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "@/lib/supabase/database.types";
import { supabasePublishableKey, supabaseSecretKey, supabaseUrl } from "./env";

/** Request-scoped client that acts as the signed-in user (RLS applies). */
export async function createClient(options?: { headers?: Record<string, string> }) {
  const cookieStore = await cookies();
  return createServerClient<Database>(supabaseUrl(), supabasePublishableKey(), {
    global: options?.headers ? { headers: options.headers } : undefined,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component; proxy.ts refreshes the session instead.
        }
      },
    },
  });
}

/**
 * Privileged client that bypasses RLS. Use only in trusted server code
 * (webhooks, cron, public quote-page RPCs) and always scope queries by org_id.
 */
export function createAdminClient() {
  return createBareClient<Database>(supabaseUrl(), supabaseSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
