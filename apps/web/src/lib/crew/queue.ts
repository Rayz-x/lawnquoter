import type { Json } from "@/lib/supabase/database.types";

export const CREW_MUTATION_KINDS = [
  "visit_start",
  "visit_pause",
  "visit_resume",
  "visit_finish",
  "visit_skip",
  "visit_reopen",
  "visit_set_crew_size",
  "visit_set_note",
  "visit_task_set",
  "visit_photo_record",
  "enhancement_create",
] as const;

export type CrewMutationKind = (typeof CREW_MUTATION_KINDS)[number];
export type CrewPayload = { [key: string]: Json | undefined };

export type CrewScope = { userId: string; orgId: string };

/** Ids can contain ":", so a joined string is not a safe storage key. */
export function scopeKey(userId: string, orgId: string): string {
  return JSON.stringify([userId, orgId]);
}

export type OutboxRow = {
  client_id: string;
  kind: CrewMutationKind;
  visit_id: string;
  payload: CrewPayload;
  occurred_at: string;
  created_at: string;
  attempts: number;
  last_error: string | null;
  user_id: string;
  org_id: string;
  /** The server rejected this action. Leave it for the office instead of retrying. */
  needs_office: boolean;
};

export type PhotoUpload = (row: OutboxRow, bytes: Blob) => Promise<void>;

export type SyncItem = {
  client_id: string;
  kind: CrewMutationKind;
  visit_id: string;
  occurred_at: string;
  device_now: string;
  payload: CrewPayload;
};

export type SyncResult = {
  client_id: string;
  status: "applied" | "replayed" | "error";
  message: string | null;
};

export type DayPackRecord = {
  date: string;
  saved_at: string;
  pack: Json;
};

export type CrewStore = {
  listOutbox(): Promise<OutboxRow[]>;
  putOutbox(row: OutboxRow): Promise<void>;
  deleteOutbox(clientId: string): Promise<void>;
  /** One transaction for the applied deletes and the rejected row. */
  settle(remove: string[], failed: OutboxRow | null): Promise<void>;
  putPhoto(clientId: string, bytes: Blob): Promise<void>;
  getPhoto(clientId: string): Promise<Blob | null>;
  listPacks(): Promise<DayPackRecord[]>;
  putPack(row: DayPackRecord): Promise<void>;
  deletePack(date: string): Promise<void>;
  clearPacks(): Promise<void>;
  clear(): Promise<void>;
};

const PACK_KEEP = 2;
const PACK_MAX_AGE_MS = 48 * 60 * 60 * 1000;

export function photoStoragePath(orgId: string, visitId: string, clientId: string): string {
  return `${orgId}/${visitId}/${clientId}.jpg`;
}

export function newOutboxRow(
  input: {
    client_id?: string;
    kind: string;
    visit_id: string;
    payload?: CrewPayload;
    occurred_at?: string;
    user_id: string;
    org_id: string;
  },
  now: Date,
): OutboxRow {
  if (!CREW_MUTATION_KINDS.includes(input.kind as CrewMutationKind)) throw new Error("Unknown crew mutation");
  if (!input.user_id || !input.org_id) throw new Error("Queued work needs a user and org");
  return {
    client_id: input.client_id ?? crypto.randomUUID(),
    kind: input.kind as CrewMutationKind,
    visit_id: input.visit_id,
    payload: input.payload ?? {},
    occurred_at: input.occurred_at ?? now.toISOString(),
    created_at: now.toISOString(),
    attempts: 0,
    last_error: null,
    user_id: input.user_id,
    org_id: input.org_id,
    needs_office: false,
  };
}

/** Persists the row before returning. Confirm the action only after this resolves. */
export async function enqueueMutation(store: CrewStore, input: Parameters<typeof newOutboxRow>[0], now = new Date()) {
  const row = newOutboxRow(input, now);
  await store.putOutbox(row);
  return row;
}

/** Saves the file before the outbox row, so the sync can upload it before crew_sync inserts the photo. */
export async function enqueuePhoto(
  store: CrewStore,
  input: Omit<Parameters<typeof newOutboxRow>[0], "kind" | "payload"> & {
    bytes: Blob;
    photo_kind: string;
    taken_at?: string;
    lat?: number;
    lng?: number;
  },
  now = new Date(),
) {
  const row = newOutboxRow(
    {
      ...input,
      kind: "visit_photo_record",
      payload: {
        photo_kind: input.photo_kind,
        taken_at: input.taken_at,
        lat: input.lat,
        lng: input.lng,
      },
    },
    now,
  );
  await store.putPhoto(row.client_id, input.bytes);
  await store.putOutbox(row);
  return row;
}

export function syncItems(rows: OutboxRow[], deviceNow: string, scope: CrewScope): SyncItem[] {
  return rows
    .filter((row) => !row.needs_office && row.user_id === scope.userId && row.org_id === scope.orgId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.client_id.localeCompare(b.client_id))
    .map((row) => ({
      client_id: row.client_id,
      kind: row.kind,
      visit_id: row.visit_id,
      occurred_at: row.occurred_at,
      device_now: deviceNow,
      payload: row.payload,
    }));
}

export function applySyncResults(rows: OutboxRow[], results: SyncResult[]) {
  const byId = new Map(rows.map((row) => [row.client_id, row]));
  const remove: string[] = [];
  const parked: OutboxRow[] = [];
  for (const result of results) {
    const row = byId.get(result.client_id);
    if (!row) continue;
    if (result.status === "error") {
      parked.push({ ...row, attempts: row.attempts + 1, last_error: result.message, needs_office: true });
      continue;
    }
    remove.push(row.client_id);
  }
  return { remove, failed: parked[0] ?? null, parked };
}

export function parseSyncResults(data: unknown): SyncResult[] {
  const results = data && typeof data === "object" && "results" in data ? data.results : null;
  if (!Array.isArray(results)) return [];
  return results.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as { client_id?: unknown; status?: unknown; message?: unknown };
    if (typeof row.client_id !== "string") return [];
    if (row.status !== "applied" && row.status !== "replayed" && row.status !== "error") return [];
    return [{ client_id: row.client_id, status: row.status, message: typeof row.message === "string" ? row.message : null }];
  });
}

export function packDatesToDrop(packs: DayPackRecord[], now: Date): string[] {
  const ranked = [...packs].sort((a, b) => b.saved_at.localeCompare(a.saved_at));
  return ranked
    .filter((pack, index) => index >= PACK_KEEP || now.getTime() - Date.parse(pack.saved_at) > PACK_MAX_AGE_MS)
    .map((pack) => pack.date);
}

export function outboxBlocksSignOut(rows: OutboxRow[]) {
  return rows.length > 0;
}

let flushChain: Promise<unknown> = Promise.resolve();

export function flushOutbox(
  store: CrewStore,
  send: (items: SyncItem[]) => Promise<SyncResult[]>,
  scope: CrewScope,
  now = new Date(),
  upload?: PhotoUpload,
) {
  const run = flushChain.then(() => flushOutboxOnce(store, send, scope, now, upload));
  flushChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function enhancementPhotoClientId(payload: CrewPayload): string | null {
  return typeof payload.photo_client_id === "string" ? payload.photo_client_id : null;
}

async function flushOutboxOnce(
  store: CrewStore,
  send: (items: SyncItem[]) => Promise<SyncResult[]>,
  scope: CrewScope,
  now: Date,
  upload?: PhotoUpload,
) {
  let sent = 0;
  let pending = (await store.listOutbox()).length;
  for (let pass = 0; pass < 4; pass += 1) {
    const rows = await store.listOutbox();
    const items = syncItems(rows, now.toISOString(), scope);
    const ready: SyncItem[] = [];
    let halted = false;
    let deferred = false;
    for (const item of items) {
      const photoClientId = item.kind === "enhancement_create" ? enhancementPhotoClientId(item.payload) : null;
      if (photoClientId) {
        const photo = rows.find((row) => row.client_id === photoClientId && row.kind === "visit_photo_record");
        if (photo?.needs_office) {
          const row = rows.find((entry) => entry.client_id === item.client_id);
          if (row) await store.settle([], { ...row, attempts: row.attempts + 1, last_error: "The upsell photo needs the office.", needs_office: true });
          continue;
        }
        if (photo) {
          deferred = true;
          break;
        }
      }
      if (item.kind !== "visit_photo_record") {
        ready.push(item);
        continue;
      }
      const row = rows.find((entry) => entry.client_id === item.client_id);
      if (!row) continue;
      const bytes = await store.getPhoto(item.client_id);
      if (!bytes || !upload) {
        await store.settle([], { ...row, attempts: row.attempts + 1, last_error: "The photo file is missing.", needs_office: true });
        halted = true;
        break;
      }
      try {
        await upload(row, bytes);
      } catch (error) {
        await store.settle([], {
          ...row,
          attempts: row.attempts + 1,
          last_error: error instanceof Error ? error.message : "Could not upload the photo",
          needs_office: false,
        });
        halted = true;
        break;
      }
      ready.push(item);
    }
    if (ready.length === 0) {
      pending = (await store.listOutbox()).length;
      break;
    }
    let results: SyncResult[];
    try {
      results = await send(ready);
    } catch (error) {
      const row = rows.find((item) => item.client_id === ready[0]?.client_id);
      if (row && !halted) {
        await store.settle([], {
          ...row,
          attempts: row.attempts + 1,
          last_error: error instanceof Error ? error.message : "Could not send",
          needs_office: false,
        });
      }
      return { sent, pending: (await store.listOutbox()).length };
    }
    const { remove, failed, parked } = applySyncResults(rows, results);
    await store.settle(remove, null);
    for (const row of parked) await store.settle([], row);
    sent += remove.length;
    pending = (await store.listOutbox()).length;
    if (failed || halted || !deferred) break;
  }
  return { sent, pending };
}

export async function saveDayPack(store: CrewStore, date: string, pack: Json, now = new Date()) {
  await store.putPack({ date, saved_at: now.toISOString(), pack });
  for (const drop of packDatesToDrop(await store.listPacks(), now)) await store.deletePack(drop);
}

export async function loadDayPack(store: CrewStore, date: string) {
  return (await store.listPacks()).find((pack) => pack.date === date) ?? null;
}

export async function purgeExpiredPacks(store: CrewStore, now = new Date()) {
  for (const drop of packDatesToDrop(await store.listPacks(), now)) await store.deletePack(drop);
}

export function createMemoryCrewStore(): CrewStore {
  const outbox = new Map<string, OutboxRow>();
  const packs = new Map<string, DayPackRecord>();
  const photos = new Map<string, Blob>();
  return {
    async listOutbox() {
      return [...outbox.values()];
    },
    async putOutbox(row) {
      outbox.set(row.client_id, row);
    },
    async deleteOutbox(clientId) {
      outbox.delete(clientId);
      photos.delete(clientId);
    },
    async settle(remove, failed) {
      for (const clientId of remove) {
        outbox.delete(clientId);
        photos.delete(clientId);
      }
      if (failed) outbox.set(failed.client_id, failed);
    },
    async putPhoto(clientId, bytes) {
      photos.set(clientId, bytes);
    },
    async getPhoto(clientId) {
      return photos.get(clientId) ?? null;
    },
    async listPacks() {
      return [...packs.values()];
    },
    async putPack(row) {
      packs.set(row.date, row);
    },
    async deletePack(date) {
      packs.delete(date);
    },
    async clearPacks() {
      packs.clear();
    },
    async clear() {
      outbox.clear();
      packs.clear();
      photos.clear();
    },
  };
}

const DB_NAME = "lawnquoter-crew";
const DB_VERSION = 2;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "client_id" });
      if (!db.objectStoreNames.contains("packs")) db.createObjectStore("packs", { keyPath: "date" });
      if (!db.objectStoreNames.contains("photos")) db.createObjectStore("photos");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB aborted"));
  });
}

async function run<T>(names: string | string[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  const db = await openDb();
  try {
    const tx = db.transaction(names, mode);
    const done = transactionDone(tx);
    try {
      const result = await fn(tx);
      await done;
      return result;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        // The transaction may already be aborted.
      }
      await done.catch(() => undefined);
      throw error;
    }
  } finally {
    db.close();
  }
}

export function createIdbCrewStore(): CrewStore {
  return {
    listOutbox: () => run("outbox", "readonly", (tx) => requestToPromise(tx.objectStore("outbox").getAll() as IDBRequest<OutboxRow[]>)),
    putOutbox: (row) => run("outbox", "readwrite", async (tx) => void tx.objectStore("outbox").put(row)),
    deleteOutbox: (clientId) =>
      run(["outbox", "photos"], "readwrite", async (tx) => {
        tx.objectStore("outbox").delete(clientId);
        tx.objectStore("photos").delete(clientId);
      }),
    settle: (remove, failed) =>
      run(["outbox", "photos"], "readwrite", async (tx) => {
        const outbox = tx.objectStore("outbox");
        const photos = tx.objectStore("photos");
        for (const clientId of remove) {
          outbox.delete(clientId);
          photos.delete(clientId);
        }
        if (failed) outbox.put(failed);
      }),
    putPhoto: (clientId, bytes) => run("photos", "readwrite", async (tx) => void tx.objectStore("photos").put(bytes, clientId)),
    getPhoto: async (clientId) => {
      const bytes = await run("photos", "readonly", (tx) => requestToPromise(tx.objectStore("photos").get(clientId) as IDBRequest<Blob | undefined>));
      return bytes ?? null;
    },
    listPacks: () => run("packs", "readonly", (tx) => requestToPromise(tx.objectStore("packs").getAll() as IDBRequest<DayPackRecord[]>)),
    putPack: (row) => run("packs", "readwrite", async (tx) => void tx.objectStore("packs").put(row)),
    deletePack: (date) => run("packs", "readwrite", async (tx) => void tx.objectStore("packs").delete(date)),
    clearPacks: () => run("packs", "readwrite", async (tx) => void tx.objectStore("packs").clear()),
    clear: () =>
      run(["outbox", "packs", "photos"], "readwrite", async (tx) => {
        tx.objectStore("outbox").clear();
        tx.objectStore("packs").clear();
        tx.objectStore("photos").clear();
      }),
  };
}

let browserStore: CrewStore | undefined;

export function browserCrewStore(): CrewStore {
  browserStore ??= createIdbCrewStore();
  return browserStore;
}

export function notifyCrewQueue() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("crew-queue"));
}
