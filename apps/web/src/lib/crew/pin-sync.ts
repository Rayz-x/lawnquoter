import { createClient } from "@/lib/supabase/client";
import { hashCrewPin, pinLooksValid, verifyLocalPin, writeLocalPinHash } from "./pin";

export async function setCrewPin(userId: string, pin: string): Promise<void> {
  if (!pinLooksValid(pin)) throw new Error("PIN must be 4 to 6 digits");
  writeLocalPinHash(localStorage, userId, await hashCrewPin(userId, pin));
  const { error } = await createClient().rpc("set_crew_pin", { p_pin: pin });
  if (error) {
    // Local hash still locks the phone offline; retry the server write later.
  }
}

export async function verifyCrewPin(userId: string, pin: string): Promise<boolean> {
  if (!pinLooksValid(pin)) return false;
  try {
    const { data, error } = await createClient().rpc("verify_crew_pin", { p_pin: pin });
    if (!error && data === true) {
      writeLocalPinHash(localStorage, userId, await hashCrewPin(userId, pin));
      return true;
    }
    if (!error && data === false) return false;
  } catch {
    // Fall through to the cached hash.
  }
  return verifyLocalPin(localStorage, userId, pin);
}

export async function crewPinIsSet(userId: string): Promise<boolean> {
  try {
    const { data, error } = await createClient().rpc("crew_pin_is_set");
    if (!error) return data === true;
  } catch {
    // Offline: treat a cached hash as set.
  }
  return typeof localStorage !== "undefined" && !!localStorage.getItem(`crew-pin-hash:${userId}`);
}
