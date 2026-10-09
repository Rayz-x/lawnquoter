"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/database.types";
import { supabasePublishableKey, supabaseUrl } from "./env";

let browserClient: ReturnType<typeof createBrowserClient<Database>> | undefined;

export function createClient() {
  if (!browserClient) {
    browserClient = createBrowserClient<Database>(supabaseUrl(), supabasePublishableKey());
  }
  return browserClient;
}
