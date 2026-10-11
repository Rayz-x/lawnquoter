import { describe, expect, it } from "vitest";
import {
  LOW_STORAGE_BYTES,
  cameraPickIsNoop,
  completionLabel,
  isLowStorage,
  lowStorageWarning,
  persistentStorageWarning,
  photoArrivalClearsPending,
  remainingStorageBytes,
} from "./photo-pending";

describe("photo pending and storage safeguards", () => {
  it("labels completed visits while the after photo is still pending", () => {
    expect(completionLabel({ status: "completed", photoPending: true, photoLost: false })).toBe(
      "Completed, photo pending",
    );
    expect(completionLabel({ status: "completed", photoPending: false, photoLost: false })).toBe(
      "Completed",
    );
    expect(
      completionLabel({
        status: "completed",
        photoPending: false,
        photoLost: false,
        afterQueued: true,
        afterNeedsOffice: false,
      }),
    ).toBe("Completed, photo pending");
  });

  it("flags a lost after photo on a completed visit", () => {
    expect(completionLabel({ status: "completed", photoPending: true, photoLost: true })).toBe(
      "Completed, photo lost",
    );
    expect(
      completionLabel({
        status: "completed",
        photoPending: true,
        photoLost: false,
        afterQueued: true,
        afterNeedsOffice: true,
      }),
    ).toBe("Completed, photo lost");
  });

  it("treats a late after-photo upload as clearing the pending state", () => {
    expect(photoArrivalClearsPending({ hadPending: true, afterPhotoArrived: true })).toBe(true);
    expect(photoArrivalClearsPending({ hadPending: true, afterPhotoArrived: false })).toBe(false);
    expect(photoArrivalClearsPending({ hadPending: false, afterPhotoArrived: true })).toBe(false);
  });

  it("warns when free storage is under 50 MB", () => {
    expect(LOW_STORAGE_BYTES).toBe(50 * 1024 * 1024);
    expect(remainingStorageBytes({ usage: 90, quota: 100 })).toBe(10);
    expect(isLowStorage({ usage: 40 * 1024 * 1024, quota: 100 * 1024 * 1024 })).toBe(false);
    expect(isLowStorage({ usage: 60 * 1024 * 1024, quota: 100 * 1024 * 1024 })).toBe(true);
    expect(isLowStorage({ usage: 10, quota: 20 })).toBe(true);
    expect(isLowStorage(null)).toBe(false);
    expect(lowStorageWarning()).toBe(
      "Phone storage is low. Photos are waiting. Connect to Wi-Fi to send them.",
    );
  });

  it("warns on Me when persistent storage was denied", () => {
    expect(persistentStorageWarning(false)).toBe(
      "This phone may clear offline photos. Install LawnQuoter Crew from the browser menu.",
    );
    expect(persistentStorageWarning(true)).toBeNull();
    expect(persistentStorageWarning(null)).toBeNull();
  });

  it("treats a camera back-out as a no-op", () => {
    expect(cameraPickIsNoop(undefined)).toBe(true);
    expect(cameraPickIsNoop(null)).toBe(true);
    expect(cameraPickIsNoop(new File(["x"], "after.jpg", { type: "image/jpeg" }))).toBe(false);
  });
});
