export const RESEND_NOT_CONNECTED = "Not connected - add Resend key to enable";

export type DnsRecord = {
  purpose: string;
  type: string;
  name: string;
  value: string;
  status: string;
};

export type SendingDomain = {
  id: string;
  name: string;
  status: string;
  records: DnsRecord[];
};

export function resendApiKey(env: NodeJS.ProcessEnv): string | null {
  if (env.NODE_ENV === "test" || env.VITEST) return null;
  const key = env.RESEND_API_KEY?.trim();
  return key || null;
}

export function parseSendingDomain(value: string): string | null {
  const host = value.trim().toLowerCase().replace(/\.+$/, "");
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host)) return null;
  return host;
}

function parseRecord(row: unknown): DnsRecord | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  if (typeof record.name !== "string" || typeof record.value !== "string" || typeof record.type !== "string") return null;
  return {
    purpose: typeof record.record === "string" ? record.record : record.type,
    type: record.type,
    name: record.name,
    value: record.value,
    status: typeof record.status === "string" ? record.status : "",
  };
}

function parseDomain(row: unknown): SendingDomain | null {
  if (!row || typeof row !== "object") return null;
  const domain = row as Record<string, unknown>;
  if (typeof domain.id !== "string" || typeof domain.name !== "string") return null;
  const records = Array.isArray(domain.records) ? domain.records.flatMap((item) => {
    const parsed = parseRecord(item);
    return parsed ? [parsed] : [];
  }) : [];
  return {
    id: domain.id,
    name: domain.name,
    status: typeof domain.status === "string" ? domain.status : "pending",
    records,
  };
}

export function parseSendingDomains(payload: unknown): SendingDomain[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  const rows = Array.isArray(record.data) ? record.data : record.name ? [payload] : [];
  return rows.flatMap((row) => {
    const domain = parseDomain(row);
    return domain ? [domain] : [];
  });
}

export async function loadSendingDomains(key: string, fetchImpl: typeof fetch): Promise<SendingDomain[]> {
  const headers = { Authorization: `Bearer ${key}` };
  const list = await fetchImpl("https://api.resend.com/domains", { headers });
  if (!list.ok) return [];
  const domains = parseSendingDomains(await list.json());
  return Promise.all(domains.map(async (domain) => {
    if (domain.records.length > 0) return domain;
    const detail = await fetchImpl(`https://api.resend.com/domains/${domain.id}`, { headers });
    if (!detail.ok) return domain;
    return parseDomain(await detail.json()) ?? domain;
  }));
}

export async function createSendingDomain(key: string, name: string, fetchImpl: typeof fetch): Promise<{ ok: true } | { ok: false; error: string }> {
  const response = await fetchImpl("https://api.resend.com/domains", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) return { ok: false, error: "Resend did not add that domain" };
  return { ok: true };
}
