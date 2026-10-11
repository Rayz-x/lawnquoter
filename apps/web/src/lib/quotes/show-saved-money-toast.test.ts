import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { showSavedMoneyToast } from "./show-saved-money-toast";

vi.mock("sonner", () => ({
  toast: { success: vi.fn() },
}));

describe("showSavedMoneyToast", () => {
  beforeEach(() => {
    vi.mocked(toast.success).mockClear();
  });

  it("shows the Saved $45.00 · Undo toast copy with an Undo action", async () => {
    const onUndo = vi.fn();
    showSavedMoneyToast(45, onUndo);
    expect(toast.success).toHaveBeenCalledWith("Saved $45.00 · Undo", {
      action: { label: "Undo", onClick: expect.any(Function) },
    });
    const options = vi.mocked(toast.success).mock.calls[0]?.[1] as
      | { action?: { onClick: (...args: unknown[]) => void } }
      | undefined;
    options?.action?.onClick();
    expect(onUndo).toHaveBeenCalled();
  });
});
