export type SectionAutosaveStatus = "idle" | "saving" | "saved" | "error";

export type SectionAutosaveSnapshot<T> = {
  status: SectionAutosaveStatus;
  error: string | null;
  rollback: T | null;
};

export type SectionAutosaveAction<T> = (values: T) => Promise<unknown>;

type Handlers<T> = {
  action: SectionAutosaveAction<T>;
  debounceMs: () => number;
  onRollback?: (values: T) => void;
};

export type SectionAutosaveController<T> = {
  setHandlers: (next: Handlers<T>) => void;
  getSnapshot: () => SectionAutosaveSnapshot<T>;
  subscribe: (listener: () => void) => () => void;
  save: (values: T, options?: { immediate?: boolean }) => void;
  dispose: () => void;
};

function failureMessage(result: unknown): string | null {
  if (!result || typeof result !== "object" || !("ok" in result)) return null;
  if ((result as { ok: unknown }).ok !== false) return null;
  const error = (result as { error?: unknown }).error;
  return typeof error === "string" && error.length > 0 ? error : "Could not save";
}

function thrownMessage(reason: unknown) {
  if (reason instanceof Error && reason.message) return reason.message;
  if (typeof reason === "string" && reason.length > 0) return reason;
  return "Could not save";
}

export function createSectionAutosaveController<T>({
  action,
  debounceMs,
  initial,
  onRollback,
}: Handlers<T> & { initial?: T }): SectionAutosaveController<T> {
  let runAction = action;
  let readDebounce = debounceMs;
  let notifyRollback = onRollback;
  let committed = initial;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let snapshot: SectionAutosaveSnapshot<T> = { status: "idle", error: null, rollback: null };
  const listeners = new Set<() => void>();

  function emit(next: SectionAutosaveSnapshot<T>) {
    snapshot = next;
    for (const listener of listeners) listener();
  }

  function fail(id: number, error: string) {
    if (id !== generation) return;
    const rollback = committed === undefined ? null : committed;
    emit({ status: "error", error, rollback });
    if (rollback !== null) notifyRollback?.(rollback);
  }

  async function run(values: T) {
    const id = ++generation;
    emit({ status: "saving", error: null, rollback: null });
    try {
      const result = await runAction(values);
      if (id !== generation) return;
      const failure = failureMessage(result);
      if (failure) {
        fail(id, failure);
        return;
      }
      committed = values;
      emit({ status: "saved", error: null, rollback: null });
    } catch (reason) {
      fail(id, thrownMessage(reason));
    }
  }

  return {
    setHandlers(next: Handlers<T>) {
      runAction = next.action;
      readDebounce = next.debounceMs;
      notifyRollback = next.onRollback;
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    save(values, options) {
      if (timer) clearTimeout(timer);
      timer = null;
      const wait = options?.immediate ? 0 : readDebounce();
      if (wait <= 0) {
        void run(values);
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        void run(values);
      }, wait);
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
      generation += 1;
    },
  };
}
