"use client";

import { toast } from "sonner";
import { savedMoneyToastCopy } from "./money-commit";

/** Show `Saved $45.00 · Undo` with a clickable Undo action. */
export function showSavedMoneyToast(
  amount: number,
  onUndo: () => void | Promise<unknown>,
) {
  toast.success(savedMoneyToastCopy(amount), {
    action: {
      label: "Undo",
      onClick: () => {
        void onUndo();
      },
    },
  });
}
