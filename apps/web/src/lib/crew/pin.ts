/** Idle before the crew shell asks for the lead PIN again. */
export const CREW_IDLE_MS = 5 * 60 * 1000;

/** Wall clock for idle checks (kept out of React render so purity lint stays clean). */
export function wallTime(): number {
  return Date.now();
}

export function shouldLockForIdle(lastActiveAt: number, now: number, idleMs = CREW_IDLE_MS): boolean {
  return now - lastActiveAt >= idleMs;
}

export function pinLooksValid(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}

/** Same salt shape the server hashes with private.sha256_hex. */
export function pinDigestMaterial(userId: string, pin: string): string {
  return `${userId}:${pin}`;
}

export function localPinHashKey(userId: string): string {
  return `crew-pin-hash:${userId}`;
}

export async function hashCrewPin(userId: string, pin: string): Promise<string> {
  const material = pinDigestMaterial(userId, pin);
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(material, "utf8").digest("hex");
}

export function readLocalPinHash(storage: Pick<Storage, "getItem">, userId: string): string | null {
  return storage.getItem(localPinHashKey(userId));
}

export function writeLocalPinHash(storage: Pick<Storage, "setItem">, userId: string, hash: string) {
  storage.setItem(localPinHashKey(userId), hash);
}

export async function verifyLocalPin(storage: Pick<Storage, "getItem">, userId: string, pin: string): Promise<boolean> {
  const saved = readLocalPinHash(storage, userId);
  if (!saved) return false;
  return (await hashCrewPin(userId, pin)) === saved;
}

export type PinLockController = {
  touch(): void;
  tick(): void;
  isLocked(): boolean;
  unlock(pin: string): Promise<boolean>;
};

/** Pure idle lock used by the crew shell. Offline unlock uses the cached hash. */
export function createPinLockController(input: {
  userId: string;
  storage: Pick<Storage, "getItem" | "setItem">;
  idleMs?: number;
  now: () => number;
}): PinLockController {
  let lastActive = input.now();
  let locked = false;
  return {
    touch() {
      if (!locked) lastActive = input.now();
    },
    tick() {
      if (!readLocalPinHash(input.storage, input.userId)) return;
      if (shouldLockForIdle(lastActive, input.now(), input.idleMs)) locked = true;
    },
    isLocked() {
      return locked;
    },
    async unlock(pin: string) {
      if (!(await verifyLocalPin(input.storage, input.userId, pin))) return false;
      locked = false;
      lastActive = input.now();
      return true;
    },
  };
}
