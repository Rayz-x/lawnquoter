/** Free space under this threshold triggers the outbox / Me storage warning. */
export const LOW_STORAGE_BYTES = 50 * 1024 * 1024;

export type StorageEstimate = { usage?: number; quota?: number };

export function remainingStorageBytes(estimate: StorageEstimate | null): number | null {
  if (!estimate || typeof estimate.usage !== "number" || typeof estimate.quota !== "number") {
    return null;
  }
  if (!Number.isFinite(estimate.usage) || !Number.isFinite(estimate.quota)) return null;
  return Math.max(0, estimate.quota - estimate.usage);
}

export function isLowStorage(estimate: StorageEstimate | null): boolean {
  const remaining = remainingStorageBytes(estimate);
  return remaining !== null && remaining < LOW_STORAGE_BYTES;
}

export function lowStorageWarning(): string {
  return "Phone storage is low. Photos are waiting. Connect to Wi-Fi to send them.";
}

/** Shown on Me when navigator.storage.persist() was denied or not granted. */
export function persistentStorageWarning(persisted: boolean | null): string | null {
  if (persisted === false) {
    return "This phone may clear offline photos. Install LawnQuoter Crew from the browser menu.";
  }
  return null;
}

export type CompletionPhotoInput = {
  status: string;
  photoPending: boolean;
  photoLost: boolean;
  /** Local outbox still holds an after photo that has not synced. */
  afterQueued?: boolean;
  afterNeedsOffice?: boolean;
};

/** Crew-facing status for a completed stop while the after photo catches up. */
export function completionLabel(input: CompletionPhotoInput): string | null {
  if (input.status !== "completed") return null;
  const lost = input.photoLost || (input.afterQueued === true && input.afterNeedsOffice === true);
  if (lost) return "Completed, photo lost";
  const pending =
    input.photoPending || (input.afterQueued === true && input.afterNeedsOffice !== true);
  if (pending) return "Completed, photo pending";
  return "Completed";
}

/** Camera dismiss / back with no file must not error or queue work. */
export function cameraPickIsNoop(file: File | null | undefined): boolean {
  return file == null;
}
