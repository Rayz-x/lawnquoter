/** Office revoke ends the phone session; crew RPCs then fail with HTTP 401 (SQLSTATE 28000). */

import type { CrewStore } from "./queue";

export const PHONE_REVOKED_MESSAGE = "phone revoked";

export type CrewAuthFailure = {
  message?: string;
  code?: string;
  status?: number;
  statusCode?: string | number;
};

export function isPhoneRevokedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as CrewAuthFailure;
  const status =
    typeof err.status === "number"
      ? err.status
      : typeof err.statusCode === "number"
        ? err.statusCode
        : typeof err.statusCode === "string"
          ? Number(err.statusCode)
          : null;
  if (status === 401) return true;
  if (err.code === "28000") return true;
  return typeof err.message === "string" && /phone revoked/i.test(err.message);
}

export function phoneRevokedError(message = PHONE_REVOKED_MESSAGE): Error & { status: number; code: string } {
  const error = new Error(message) as Error & { status: number; code: string };
  error.status = 401;
  error.code = "28000";
  return error;
}

/** Gate codes leave the device; queued mutations stay until a cleared session can send them. */
export async function wipePacksOnRevoke(store: CrewStore, error: unknown): Promise<boolean> {
  if (!isPhoneRevokedError(error)) return false;
  await store.clearPacks();
  return true;
}
