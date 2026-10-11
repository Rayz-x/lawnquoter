import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/** One read of `change_order_public` per request. */
export const loadPublicChangeOrder = cache(async (token: string) => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("change_order_public", { p_token: token });
  return data;
});
