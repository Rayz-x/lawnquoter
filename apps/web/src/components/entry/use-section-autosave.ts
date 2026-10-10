"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  createSectionAutosaveController,
  watchAutosaveLeave,
  type SectionAutosaveAction,
  type SectionAutosaveController,
  type SectionAutosaveOptions,
} from "./section-autosave";

export function useSectionAutosave<T>({
  action,
  debounceMs = 600,
  initial,
  onRollback,
  onError,
}: {
  action: SectionAutosaveAction<T>;
  /**
   * Debounce for text. Pass the whole section, or a partial object that is merged
   * into it, so one field does not drop another. Chips and toggles pass
   * `{ immediate: true, rollback: true }` and restore the last choice if the save fails.
   */
  debounceMs?: number;
  initial?: T;
  onRollback?: (values: T) => void;
  onError?: (message: string) => void;
}) {
  const [controller] = useState<SectionAutosaveController<T>>(() =>
    createSectionAutosaveController({
      action,
      debounceMs: () => debounceMs,
      initial,
      onRollback,
      onError,
    }),
  );

  useEffect(() => {
    controller.setHandlers({ action, debounceMs: () => debounceMs, onRollback, onError });
  }, [controller, action, debounceMs, onRollback, onError]);

  useEffect(() => {
    if (initial !== undefined) controller.setBaseline(initial);
  }, [controller, initial]);

  useEffect(() => {
    const stop = watchAutosaveLeave(window, () => controller.flush());
    return () => {
      stop();
      controller.flush();
    };
  }, [controller]);

  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

  return {
    status: snapshot.status,
    error: snapshot.error,
    rollback: snapshot.rollback,
    isPending: snapshot.isPending,
    save: controller.save,
    retry: controller.retry,
  };
}

export type { SectionAutosaveOptions };
