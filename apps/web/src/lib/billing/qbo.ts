export const QBO_NOT_CONNECTED = "Not connected - add a QuickBooks key to enable.";

export type QboCustomerBody = {
  DisplayName: string;
  Job: boolean;
  ParentRef?: { value: string };
};

/** A parent account is a customer. A child account is a sub-customer job. */
export function qboCustomerBody(name: string, parentQboId: string | null): QboCustomerBody {
  if (parentQboId) return { DisplayName: name, Job: true, ParentRef: { value: parentQboId } };
  return { DisplayName: name, Job: false };
}

/** Both sides changed after the last sync. */
export function qboConflict(localUpdatedAt: string, remoteUpdatedAt: string | null, lastSyncedAt: string | null): boolean {
  if (!lastSyncedAt || !remoteUpdatedAt) return false;
  return localUpdatedAt > lastSyncedAt && remoteUpdatedAt > lastSyncedAt;
}

export function qboConfigured(): boolean {
  return Boolean(process.env.QBO_CLIENT_ID?.trim() && process.env.QBO_CLIENT_SECRET?.trim());
}

export type QboAccount = {
  id: string;
  name: string;
  parentAccountId: string | null;
  updatedAt: string;
};

export type QboLink = {
  localId: string;
  qboId: string;
  syncToken: string | null;
  lastSyncedAt: string | null;
  remoteUpdatedAt: string | null;
};

export type QboSyncStore = {
  accounts(): Promise<QboAccount[]>;
  links(): Promise<QboLink[]>;
  saveLink(input: { localId: string; qboId: string; parentQboId: string | null; syncToken: string }): Promise<void>;
  saveConflict(input: { localId: string; localName: string; remoteName: string }): Promise<void>;
  log(input: { localId: string; qboId: string | null; outcome: string; detail: string }): Promise<void>;
};

export type QboCustomerClient = {
  upsertCustomer(body: QboCustomerBody, existing: { id: string; syncToken: string | null } | null): Promise<{ id: string; syncToken: string }>;
  remoteName(qboId: string): Promise<{ name: string; updatedAt: string } | null>;
};

export async function syncQboCustomers(
  store: QboSyncStore,
  client: QboCustomerClient,
): Promise<{ pushed: number; conflicts: number } | { error: string }> {
  if (!qboConfigured()) return { error: QBO_NOT_CONNECTED };
  const links = new Map((await store.links()).map((link) => [link.localId, link]));
  const accounts = [...(await store.accounts())].sort((left, right) => Number(left.parentAccountId != null) - Number(right.parentAccountId != null));
  const qboIds = new Map<string, string>();
  let pushed = 0;
  let conflicts = 0;
  for (const account of accounts) {
    const parentQboId = account.parentAccountId ? (qboIds.get(account.parentAccountId) ?? links.get(account.parentAccountId)?.qboId ?? null) : null;
    const link = links.get(account.id) ?? null;
    if (link && qboConflict(account.updatedAt, link.remoteUpdatedAt, link.lastSyncedAt)) {
      const remote = await client.remoteName(link.qboId);
      await store.saveConflict({ localId: account.id, localName: account.name, remoteName: remote?.name ?? account.name });
      await store.log({ localId: account.id, qboId: link.qboId, outcome: "conflict", detail: "Both sides changed" });
      conflicts += 1;
      qboIds.set(account.id, link.qboId);
      continue;
    }
    const saved = await client.upsertCustomer(
      qboCustomerBody(account.name, parentQboId),
      link ? { id: link.qboId, syncToken: link.syncToken } : null,
    );
    await store.saveLink({ localId: account.id, qboId: saved.id, parentQboId, syncToken: saved.syncToken });
    await store.log({ localId: account.id, qboId: saved.id, outcome: "pushed", detail: parentQboId ? "Sub-customer" : "Customer" });
    qboIds.set(account.id, saved.id);
    pushed += 1;
  }
  return { pushed, conflicts };
}
