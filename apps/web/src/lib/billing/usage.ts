/** Reads the company totals returned by usage_totals. A bad payload is not a zero. */
export function usageFromRpc(data: unknown): { imagerySessions: number; measurements: number } | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  if (typeof row.imagery_sessions !== "number" || typeof row.measurements !== "number") return null;
  return { imagerySessions: row.imagery_sessions, measurements: row.measurements };
}
