export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T }))
  | { ok: false; error: string };

export function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

export function emptyToNull<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v === "" ? null : v])) as T;
}
