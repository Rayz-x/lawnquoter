import { createClient } from "@/lib/supabase/client";
import { parseSyncResults, photoStoragePath, type OutboxRow, type SyncItem, type SyncResult } from "./queue";

export async function sendCrewSync(items: SyncItem[]): Promise<SyncResult[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("crew_sync", { p_mutations: items });
  if (error) throw new Error(error.message);
  return parseSyncResults(data);
}

/** Uploads the object before crew_sync inserts the photo row. A repeat is success. */
export async function uploadVisitPhoto(row: OutboxRow, bytes: Blob): Promise<void> {
  const path = photoStoragePath(row.org_id, row.visit_id, row.client_id);
  const { error } = await createClient().storage.from("visit-photos").upload(path, bytes, {
    contentType: "image/jpeg",
    upsert: false,
  });
  if (!error) return;
  const status = "statusCode" in error ? String(error.statusCode) : "";
  if (status === "409" || /already exists/i.test(error.message)) return;
  throw new Error("Could not upload the photo");
}
