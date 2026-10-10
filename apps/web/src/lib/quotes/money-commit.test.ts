import { describe, expect, it, vi } from "vitest";
import {
  commitMoneyOnBlur,
  parseMoneyDraft,
  savedMoneyToastCopy,
} from "./money-commit";

describe("savedMoneyToastCopy", () => {
  it("matches the Saved $45.00 · Undo copy", () => {
    expect(savedMoneyToastCopy(45)).toBe("Saved $45.00 · Undo");
    expect(savedMoneyToastCopy(45.5)).toBe("Saved $45.50 · Undo");
  });
});

describe("parseMoneyDraft", () => {
  it("accepts 0 or more with up to 2 decimals", () => {
    expect(parseMoneyDraft("45")).toEqual({ ok: true, amount: 45 });
    expect(parseMoneyDraft("45.00")).toEqual({ ok: true, amount: 45 });
    expect(parseMoneyDraft("$45.50")).toEqual({ ok: true, amount: 45.5 });
    expect(parseMoneyDraft(" 1,200.25 ")).toEqual({ ok: true, amount: 1200.25 });
  });

  it("rejects empty or invalid drafts", () => {
    expect(parseMoneyDraft("").ok).toBe(false);
    expect(parseMoneyDraft("abc").ok).toBe(false);
    expect(parseMoneyDraft("-1").ok).toBe(false);
    expect(parseMoneyDraft("1.234").ok).toBe(false);
  });
});

describe("commitMoneyOnBlur", () => {
  it("does not save when the draft matches the committed value", async () => {
    const save = vi.fn();
    const toast = vi.fn();
    const result = await commitMoneyOnBlur({
      previous: 45,
      draft: "45.00",
      save,
      toast,
    });
    expect(result).toEqual({ ok: true, unchanged: true, amount: 45 });
    expect(save).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("commits on blur and shows the Saved · Undo toast", async () => {
    const save = vi.fn(async () => ({ ok: true as const }));
    const toast = vi.fn();
    const result = await commitMoneyOnBlur({
      previous: 40,
      draft: "45",
      save,
      toast,
    });
    expect(result).toEqual({ ok: true, amount: 45 });
    expect(save).toHaveBeenCalledWith(45);
    expect(toast).toHaveBeenCalledWith({
      amount: 45,
      message: "Saved $45.00 · Undo",
      onUndo: expect.any(Function),
    });
  });

  it("undo restores the prior value through save", async () => {
    const save = vi.fn(async () => ({ ok: true as const }));
    const toast = vi.fn();
    await commitMoneyOnBlur({
      previous: 40,
      draft: "45",
      save,
      toast,
    });
    const onUndo = toast.mock.calls[0]?.[0]?.onUndo as () => Promise<void>;
    await onUndo();
    expect(save).toHaveBeenNthCalledWith(1, 45);
    expect(save).toHaveBeenNthCalledWith(2, 40);
  });

  it("returns an error without toasting when save fails", async () => {
    const save = vi.fn(async () => ({ ok: false as const, error: "Frozen" }));
    const toast = vi.fn();
    const result = await commitMoneyOnBlur({
      previous: 40,
      draft: "45",
      save,
      toast,
    });
    expect(result).toEqual({ ok: false, error: "Frozen" });
    expect(toast).not.toHaveBeenCalled();
  });
});
