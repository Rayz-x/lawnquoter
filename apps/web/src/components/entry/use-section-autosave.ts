"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  createSectionAutosaveController,
  type SectionAutosaveAction,
  type SectionAutosaveController,
} from "./section-autosave";

export function useSectionAutosave<T>({
  action,
  debounceMs = 600,
  initial,
  onRollback,
}: {
  action: SectionAutosaveAction<T>;
  /** Text saves on blur through this delay. Chips, toggles, and steppers pass `{ immediate: true }`. */
  debounceMs?: number;
  initial?: T;
  onRollback?: (values: T) => void;
}) {
  const [controller] = useState<SectionAutosaveController<T>>(() =>
    createSectionAutosaveController({
      action,
      debounceMs: () => debounceMs,
      initial,
      onRollback,
    }),
  );

  useEffect(() => {
    controller.setHandlers({ action, debounceMs: () => debounceMs, onRollback });
  }, [controller, action, debounceMs, onRollback]);

  useEffect(() => () => controller.dispose(), [controller]);

  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

  return { status: snapshot.status, error: snapshot.error, rollback: snapshot.rollback, save: controller.save };
}
