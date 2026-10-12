"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { FieldHint } from "@/components/entry";
import { createPinLockController, pinLooksValid, readLocalPinHash, wallTime } from "@/lib/crew/pin";
import { crewPinIsSet, setCrewPin, verifyCrewPin } from "@/lib/crew/pin-sync";

export function CrewPinGate({ userId, children }: { userId: string; children: ReactNode }) {
  const [, setTick] = useState(0);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"ready" | "setup" | "unlock">(() =>
    readLocalPinHash(localStorage, userId) ? "ready" : "setup",
  );
  const lock = useMemo(
    () =>
      createPinLockController({
        userId,
        storage: localStorage,
        now: wallTime,
      }),
    [userId],
  );

  useEffect(() => {
    let stop = false;
    void crewPinIsSet(userId).then((set) => {
      if (stop) return;
      if (set && !readLocalPinHash(localStorage, userId)) setMode("unlock");
      else if (!set && !readLocalPinHash(localStorage, userId)) setMode("setup");
    });
    return () => {
      stop = true;
    };
  }, [userId]);

  useEffect(() => {
    const onActivity = () => {
      lock.touch();
      setTick((n) => n + 1);
    };
    const events = ["pointerdown", "keydown", "touchstart"] as const;
    for (const event of events) window.addEventListener(event, onActivity, { passive: true });
    const timer = window.setInterval(() => {
      lock.tick();
      if (lock.isLocked()) setMode("unlock");
      setTick((n) => n + 1);
    }, 5_000);
    return () => {
      for (const event of events) window.removeEventListener(event, onActivity);
      window.clearInterval(timer);
    };
  }, [lock]);

  async function submit() {
    if (busy || !pinLooksValid(pin)) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "setup") {
        await setCrewPin(userId, pin);
        lock.touch();
        setMode("ready");
        setPin("");
        return;
      }
      if (await lock.unlock(pin)) {
        setMode("ready");
        setPin("");
        return;
      }
      if (await verifyCrewPin(userId, pin)) {
        await lock.unlock(pin);
        setMode("ready");
        setPin("");
        return;
      }
      setError("Wrong PIN");
    } catch {
      setError("Could not check that PIN");
    } finally {
      setBusy(false);
    }
  }

  if (mode === "ready" && !lock.isLocked()) return children;

  const setup = mode === "setup";
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background px-6">
      <h1 className="text-2xl font-bold">{setup ? "Set a crew PIN" : "Enter PIN"}</h1>
      <p className="max-w-sm text-center text-[15px] text-muted-foreground">
        {setup
          ? "This phone locks after a few idle minutes so the next person needs your PIN."
          : "Unlock to keep working. Gate codes stay hidden until you unlock."}
      </p>
      <label className="flex w-full max-w-xs min-w-0 flex-col gap-1">
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label="Crew PIN"
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
          className="min-h-14 w-full rounded-xl border bg-background px-4 text-center text-2xl tracking-[0.4em]"
        />
        <FieldHint>{setup ? "A short number only you know. It locks this phone when it sits idle." : "The PIN you set for this phone."}</FieldHint>
      </label>
      {error ? <p className="text-[15px] text-destructive">{error}</p> : null}
      <span className="flex w-full max-w-xs min-w-0 flex-col gap-1">
        <button
          type="button"
          disabled={busy || !pinLooksValid(pin)}
          onClick={() => void submit()}
          className="inline-flex min-h-14 w-full items-center justify-center rounded-xl bg-primary text-[17px] font-semibold text-primary-foreground disabled:opacity-50"
        >
          {setup ? "Save PIN" : "Unlock"}
        </button>
        <FieldHint>{setup ? "Saves the PIN on this phone." : "Opens the route after the phone locked."}</FieldHint>
      </span>
    </div>
  );
}
