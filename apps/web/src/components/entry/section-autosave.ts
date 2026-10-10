export type SectionAutosaveStatus = "idle" | "saving" | "saved" | "error";

export type SectionAutosaveSnapshot<T> = {
  status: SectionAutosaveStatus;
  error: string | null;
  /** Values the form should show after a chip or toggle is restored. Null while typing stays put. */
  rollback: T | null;
  isPending: boolean;
};

export type SectionAutosaveAction<T> = (values: T) => Promise<unknown>;

export type SectionAutosaveOptions = {
  /** Chips, toggles, and steppers save immediately. Text waits for the debounce. */
  immediate?: boolean;
  /** Restore the last saved choice when this save fails. Text omits it and stays on screen. */
  rollback?: boolean;
};

type Handlers<T> = {
  action: SectionAutosaveAction<T>;
  debounceMs: () => number;
  onRollback?: (values: T) => void;
  onError?: (message: string) => void;
};

/** A field patch when the section is an object; the whole value otherwise. */
export type SectionAutosavePatch<T> = T extends Record<string, unknown> ? Partial<T> : T;

export type SectionAutosaveController<T> = {
  setHandlers: (next: Handlers<T>) => void;
  setBaseline: (next: T) => void;
  getSnapshot: () => SectionAutosaveSnapshot<T>;
  subscribe: (listener: () => void) => () => void;
  save: (values: SectionAutosavePatch<T>, options?: SectionAutosaveOptions) => void;
  retry: () => void;
  flush: () => void;
  dispose: () => void;
};

type Revert = "all" | string[] | undefined;

const FRIENDLY_ERROR = "Couldn't save this section. Try again.";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function mergeValues<T>(base: T | undefined, patch: SectionAutosavePatch<T>): T {
  if (isPlainObject(base) && isPlainObject(patch)) return { ...base, ...patch } as T;
  return patch as T;
}

function failureMessage(result: unknown): string | null {
  if (!result || typeof result !== "object" || !("ok" in result)) return null;
  if ((result as { ok: unknown }).ok !== false) return null;
  const error = (result as { error?: unknown }).error;
  return typeof error === "string" && error.length > 0 ? error : FRIENDLY_ERROR;
}

function friendlyThrown() {
  return FRIENDLY_ERROR;
}

function applyRevert<T>(draft: T, committed: T | undefined, revert: Revert): T {
  if (revert === "all" || committed === undefined || !isPlainObject(draft) || !isPlainObject(committed)) {
    return (committed === undefined ? draft : committed) as T;
  }
  const next: Record<string, unknown> = { ...(draft as Record<string, unknown>) };
  const saved = committed as Record<string, unknown>;
  for (const key of revert ?? []) {
    if (Object.prototype.hasOwnProperty.call(saved, key)) next[key] = saved[key];
    else delete next[key];
  }
  return next as T;
}

export function watchAutosaveLeave(
  win: {
    addEventListener: (type: string, listener: () => void) => void;
    removeEventListener: (type: string, listener: () => void) => void;
    document: {
      visibilityState?: string;
      addEventListener: (type: string, listener: () => void) => void;
      removeEventListener: (type: string, listener: () => void) => void;
    };
  },
  flush: () => void,
) {
  const onHide = () => flush();
  const onVisibility = () => {
    if (win.document.visibilityState === "hidden") flush();
  };
  win.addEventListener("pagehide", onHide);
  win.document.addEventListener("visibilitychange", onVisibility);
  return () => {
    win.removeEventListener("pagehide", onHide);
    win.document.removeEventListener("visibilitychange", onVisibility);
  };
}

export function createSectionAutosaveController<T>({
  action,
  debounceMs,
  initial,
  onRollback,
  onError,
}: Handlers<T> & { initial?: T }): SectionAutosaveController<T> {
  let runAction = action;
  let readDebounce = debounceMs;
  let notifyRollback = onRollback;
  let notifyError = onError;
  let committed = initial;
  let draft = initial;
  let status: SectionAutosaveStatus = "idle";
  let error: string | null = null;
  let rollback: T | null = null;
  let inFlight = false;
  let hasPending = false;
  let hasQueued = false;
  let queuedForce = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingRevert: Revert;
  let lastAttempt: T | undefined;
  let lastRevert: Revert;
  let snapshot: SectionAutosaveSnapshot<T> = { status: "idle", error: null, rollback: null, isPending: false };
  const listeners = new Set<() => void>();

  function publish() {
    snapshot = {
      status,
      error,
      rollback,
      isPending: inFlight || hasPending || hasQueued || timer !== null,
    };
    for (const listener of listeners) listener();
  }

  function noteRevert(patch: SectionAutosavePatch<T>, rollbackOption?: boolean) {
    if (!rollbackOption) return;
    if (!isPlainObject(patch)) {
      pendingRevert = "all";
      return;
    }
    if (pendingRevert === "all") return;
    pendingRevert = [...new Set([...(pendingRevert ?? []), ...Object.keys(patch)])];
  }

  function fail(revert: Revert, message: string) {
    status = "error";
    error = message;
    notifyError?.(message);
    if (hasQueued || !revert) {
      rollback = null;
      return;
    }
    draft = applyRevert(draft as T, committed, revert);
    rollback = draft ?? null;
    if (rollback !== null) notifyRollback?.(rollback);
  }

  function start(force = false) {
    if (timer) clearTimeout(timer);
    timer = null;
    hasPending = false;
    if (inFlight) {
      hasQueued = true;
      if (force) queuedForce = true;
      publish();
      return;
    }
    const values = draft as T;
    const revert = pendingRevert;
    pendingRevert = undefined;
    void run(values, revert, force);
  }

  async function run(values: T, revert: Revert, force = false) {
    if (!force && committed !== undefined && same(values, committed)) {
      publish();
      return;
    }
    inFlight = true;
    status = "saving";
    error = null;
    rollback = null;
    lastAttempt = values;
    lastRevert = revert;
    publish();
    try {
      const result = await runAction(values);
      const failure = failureMessage(result);
      if (failure) fail(revert, failure);
      else {
        committed = values;
        if (!hasQueued) draft = values;
        status = "saved";
        error = null;
        rollback = null;
      }
    } catch {
      fail(revert, friendlyThrown());
    } finally {
      inFlight = false;
      if (hasQueued) {
        hasQueued = false;
        const next = draft as T;
        const nextRevert = pendingRevert;
        const forceNext = queuedForce;
        pendingRevert = undefined;
        queuedForce = false;
        void run(next, nextRevert, forceNext);
      } else {
        publish();
      }
    }
  }

  return {
    setHandlers(next) {
      runAction = next.action;
      readDebounce = next.debounceMs;
      notifyRollback = next.onRollback;
      notifyError = next.onError;
    },
    setBaseline(next) {
      const dirty = committed === undefined ? draft !== undefined : !same(draft, committed);
      committed = next;
      if (!dirty && !inFlight && !hasPending && !hasQueued) draft = next;
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    save(values, options) {
      draft = draft === undefined ? (values as T) : mergeValues(draft, values);
      noteRevert(values, options?.rollback);
      if (timer) clearTimeout(timer);
      timer = null;
      if (inFlight) {
        hasPending = false;
        hasQueued = true;
        publish();
        return;
      }
      if (committed !== undefined && same(draft, committed)) {
        hasPending = false;
        pendingRevert = undefined;
        publish();
        return;
      }
      const wait = options?.immediate ? 0 : readDebounce();
      if (wait <= 0) {
        start();
        return;
      }
      hasPending = true;
      timer = setTimeout(() => start(), wait);
      publish();
    },
    retry() {
      if (lastAttempt === undefined) return;
      const values = draft !== undefined && (committed === undefined || !same(draft, committed)) ? draft : lastAttempt;
      draft = values;
      pendingRevert = lastRevert;
      start(true);
    },
    flush() {
      if (!hasPending && timer === null) return;
      start();
    },
    dispose() {
      if (!hasPending && timer === null) return;
      start();
    },
  };
}
