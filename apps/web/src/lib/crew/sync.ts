import { createClient } from "@/lib/supabase/client";
import { parseSyncResults, type SyncItem, type SyncResult } from "./queue";

export async function sendCrewSync(items: SyncItem[]): Promise<SyncResult[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("crew_sync", { p_mutations: items });
  if (error) throw new Error(error.message);
  return parseSyncResults(data);
}
