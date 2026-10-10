import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ChipGroup } from "./chip-group";
import { FactStrip } from "./fact-strip";
import { InternalNote } from "./internal-note";
import { MoreDisclosure } from "./more-disclosure";
import { SectionCard } from "./section-card";
import { Stepper } from "./stepper";
import { ToggleRow } from "./toggle-row";
import { SectionMenu, splitSectionMenuItems } from "./section-menu";
import { createSectionAutosaveController, watchAutosaveLeave } from "./section-autosave";
import { resolveEntryTab, TabBox } from "./tab-box";
import { useSectionAutosave } from "./use-section-autosave";

function html(node: ReactNode) {
  return renderToStaticMarkup(node);
}

function Probe() {
  const autosave = useSectionAutosave({ action: async () => undefined });
  return createElement("span", null, autosave.status);
}

describe("entry primitives", () => {
  it("renders a section card, category tabs, and an explicit save slot", () => {
    const card = html(createElement(SectionCard, {
      title: "Mowing conditions",
      description: "Affects pricing",
      status: "saved",
      error: "Invalid slope",
      mode: "view",
      facts: [{ label: "Slope", value: "Gentle" }],
      onEdit: () => undefined,
      onRetry: () => undefined,
      actions: createElement("button", { type: "button" }, "Save address"),
      menu: createElement(SectionMenu, {
        items: [
          { id: "edit", label: "Edit", onSelect: () => undefined },
          { id: "remove", label: "Remove", destructive: true, onSelect: () => undefined },
        ],
      }),
    }));
    expect(card).toContain("<h2");
    expect(card).toContain("aria-labelledby");
    expect(card).toContain("Mowing conditions");
    expect(card).toContain('role="status"');
    expect(card).toContain('aria-busy="false"');
    expect(card).toContain("text-success");
    expect(card).toContain("Saved ✓");
    expect(card).toContain("text-destructive");
    expect(card).toContain("Invalid slope");
    expect(card).toContain("Retry");
    expect(card).toContain("Edit Slope: Gentle");
    expect(card).toContain("size-11");
    expect(card).toContain("Gentle");
    expect(card).toContain('data-entry="section-save"');
    expect(card).toContain("Save address");
    expect(card).toContain("Section actions");
    const plain = html(createElement(SectionCard, { title: "Access", heading: "h3" }, "Gate"));
    expect(plain).toContain("<h3");
    expect(plain).toContain('role="status"');
    expect(plain).toContain("Gate");
    expect(plain).not.toContain("section-save");
    const internal = html(createElement(SectionCard, { title: "Crew note", weight: "internal" }, "Dogs"));
    expect(internal).toContain('data-weight="internal"');
    expect(internal).toContain("bg-muted");
    const more = html(createElement(MoreDisclosure, null, "Exact inches"));
    expect(more).toContain('aria-expanded="false"');
    expect(more).toContain("aria-controls");
    expect(more).toContain("Exact inches");

    const tabs = html(createElement(TabBox, {
      value: "contacts",
      onValueChange: () => undefined,
      tabs: [
        { value: "properties", label: "Properties", count: 2, menu: "Property menu", content: "Properties body" },
        { value: "contacts", label: "Contacts", count: 0, menu: "Contact menu", content: "Contacts body" },
      ],
    }));
    expect(tabs).toContain("Properties");
    expect(tabs).toContain('data-count=""');
    expect(tabs).toContain(">2<");
    expect(tabs).toContain("overflow-x-auto");
    expect(tabs).toContain("max-lg:rounded-full");
    expect(tabs).not.toContain("Properties (2)");
    expect(tabs).toContain("Contact menu");
    expect(tabs).not.toContain("Property menu");
    expect(tabs).toContain('data-variant="line"');
    expect(resolveEntryTab("missing", ["properties", "contacts"], "properties")).toBe("properties");
    expect(resolveEntryTab("contacts", ["properties", "contacts"], "properties")).toBe("contacts");
    expect(splitSectionMenuItems([
      { id: "b", label: "Remove", destructive: true, onSelect: () => undefined },
      { id: "a", label: "Edit", onSelect: () => undefined },
    ]).actions.map((item) => item.id)).toEqual(["a"]);
    expect(html(createElement(Probe))).toContain("idle");
  });

  it("renders chips, a stepper, a toggle row, a fact strip, and an internal note", () => {
    const chips = html(createElement(ChipGroup, {
      label: "Slope",
      value: "gentle",
      onValueChange: () => undefined,
      options: [
        { value: "gentle", label: "Gentle" },
        { value: "unknown", label: "Unknown" },
      ],
    }));
    expect(chips).toContain('data-entry="chip-group"');
    expect(chips).toContain("h-11");
    expect(chips).toContain("lg:h-8");
    expect(chips).toContain("Gentle");
    expect(chips).toContain("Unknown");

    const stepper = html(createElement(Stepper, { label: "Stairs", value: 2, onValueChange: () => undefined }));
    expect(stepper).toContain('data-entry="stepper"');
    expect(stepper).toContain('inputMode="numeric"');
    expect(stepper).toContain("size-11");
    expect(stepper).toContain('value="2"');
    expect(stepper).toContain("Decrease Stairs");

    const row = html(createElement(ToggleRow, { label: "Dogs", checked: true, onCheckedChange: () => undefined }));
    expect(row).toContain('data-entry="toggle-row"');
    expect(row).toContain("min-h-11");
    expect(row).toContain("Dogs");

    const facts = html(createElement(FactStrip, {
      facts: [{ label: "Turf", value: "12,400", detail: "front / back", hint: "From parcel" }],
    }));
    expect(facts).toContain('data-entry="fact-strip"');
    expect(facts).toContain("Turf");
    expect(facts).toContain("12,400");
    expect(facts).toContain("✦ From parcel");
    expect(facts).toContain("front / back");

    const note = html(createElement(InternalNote, null, "Gate sticks"));
    expect(note).toContain('data-weight="internal"');
    expect(note).toContain("bg-muted");
    expect(note).toContain("Gate sticks");
    expect(note).toContain("Internal note");
  });

  it("debounces text, saves chips immediately, and rolls a failed save back", async () => {
    vi.useFakeTimers();
    const action = vi.fn(async (value: string) => {
      if (value === "bad") return { ok: false as const, error: "Invalid slope" };
      return { ok: true as const };
    });
    const rolled: string[] = [];
    const autosave = createSectionAutosaveController({
      action,
      debounceMs: () => 600,
      initial: "flat",
      onRollback: (value) => rolled.push(value),
    });

    autosave.save("gentle");
    autosave.save("gentle-2");
    expect(autosave.getSnapshot().isPending).toBe(true);
    await vi.advanceTimersByTimeAsync(599);
    expect(action).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(action).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledWith("gentle-2");
    expect(autosave.getSnapshot().status).toBe("saved");

    autosave.save("steep", { immediate: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(action).toHaveBeenCalledWith("steep");
    expect(autosave.getSnapshot().status).toBe("saved");

    autosave.save("bad", { immediate: true, rollback: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(autosave.getSnapshot()).toMatchObject({ status: "error", error: "Invalid slope", rollback: "steep" });
    expect(rolled).toEqual(["steep"]);

    action.mockRejectedValueOnce(new Error("offline"));
    autosave.save("mild", { immediate: true, rollback: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(autosave.getSnapshot()).toMatchObject({
      status: "error",
      error: "Couldn't save this section. Try again.",
      rollback: "steep",
    });
    expect(rolled).toEqual(["steep", "steep"]);
    autosave.dispose();
    vi.useRealTimers();
  });

  it("flushes an unmount that is still inside the debounce window", async () => {
    vi.useFakeTimers();
    const action = vi.fn(async () => ({ ok: true as const }));
    const autosave = createSectionAutosaveController({
      action,
      debounceMs: () => 600,
      initial: "flat",
    });

    autosave.save("gentle");
    autosave.save("gentle slope");
    await vi.advanceTimersByTimeAsync(200);
    expect(action).not.toHaveBeenCalled();

    autosave.dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(action).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledWith("gentle slope");

    await vi.advanceTimersByTimeAsync(600);
    expect(action).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("stays usable after a strict-mode cleanup and does not drop an in-flight save", async () => {
    vi.useFakeTimers();
    let release: (value: unknown) => void = () => undefined;
    const action = vi.fn((value: string) => {
      if (value === "later") return new Promise((resolve) => { release = resolve; });
      return Promise.resolve({ ok: true as const });
    });
    const autosave = createSectionAutosaveController({ action, debounceMs: () => 600, initial: "flat" });

    autosave.dispose();
    autosave.save("next", { immediate: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(action).toHaveBeenCalledWith("next");

    autosave.save("later", { immediate: true });
    autosave.dispose();
    expect(action).toHaveBeenCalledTimes(2);
    release({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(autosave.getSnapshot().status).toBe("saved");
    vi.useRealTimers();
  });

  it("serializes saves and rolls back to the success, not an older baseline", async () => {
    vi.useFakeTimers();
    let release: (value: unknown) => void = () => undefined;
    const rolled: string[] = [];
    const action = vi.fn((value: string) => {
      if (value === "b") return new Promise((resolve) => { release = resolve; });
      return Promise.resolve({ ok: false as const, error: "Invalid slope" });
    });
    const autosave = createSectionAutosaveController({
      action,
      debounceMs: () => 600,
      initial: "a",
      onRollback: (value) => rolled.push(value),
    });

    autosave.save("b", { immediate: true });
    autosave.save("c", { immediate: true, rollback: true });
    expect(action).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledWith("b");

    release({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(action).toHaveBeenCalledTimes(2);
    expect(action).toHaveBeenLastCalledWith("c");
    expect(autosave.getSnapshot()).toMatchObject({ status: "error", rollback: "b" });
    expect(rolled).toEqual(["b"]);
    vi.useRealTimers();
  });

  it("merges a second field instead of dropping the pending one", async () => {
    vi.useFakeTimers();
    const action = vi.fn(async () => ({ ok: true as const }));
    const autosave = createSectionAutosaveController({
      action,
      debounceMs: () => 600,
      initial: { notes: "", dogs: false },
    });

    autosave.save({ notes: "hello" });
    autosave.save({ dogs: true }, { immediate: true, rollback: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(action).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledWith({ notes: "hello", dogs: true });
    vi.useRealTimers();
  });

  it("keeps typed text, offers retry, and restores only a failed toggle", async () => {
    vi.useFakeTimers();
    const rolled: Array<{ notes: string; dogs: boolean }> = [];
    const action = vi.fn(async (value: { notes: string; dogs: boolean }) => {
      if (value.dogs) return { ok: false as const, error: "Invalid slope" };
      return { ok: true as const };
    });
    const autosave = createSectionAutosaveController({
      action,
      debounceMs: () => 600,
      initial: { notes: "", dogs: false },
      onRollback: (value) => rolled.push(value),
    });

    autosave.save({ notes: "hello" }, { immediate: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(rolled).toEqual([]);
    expect(autosave.getSnapshot().status).toBe("saved");

    autosave.save({ dogs: true }, { immediate: true, rollback: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(rolled).toEqual([{ notes: "hello", dogs: false }]);
    expect(autosave.getSnapshot().error).toBe("Invalid slope");

    autosave.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(action).toHaveBeenLastCalledWith({ notes: "hello", dogs: true });
    vi.useRealTimers();
  });

  it("surfaces a flush that fails after unmount", async () => {
    vi.useFakeTimers();
    const errors: string[] = [];
    const action = vi.fn(async () => {
      throw new Error("socket hang up");
    });
    const autosave = createSectionAutosaveController({
      action,
      debounceMs: () => 600,
      initial: "flat",
      onError: (message) => errors.push(message),
    });

    autosave.save("gentle");
    await vi.advanceTimersByTimeAsync(200);
    expect(action).not.toHaveBeenCalled();
    autosave.dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(action).toHaveBeenCalledWith("gentle");
    expect(errors).toEqual(["Couldn't save this section. Try again."]);
    expect(autosave.getSnapshot().status).toBe("error");
    vi.useRealTimers();
  });

  it("refreshes the rollback baseline and skips a clean section", async () => {
    vi.useFakeTimers();
    const rolled: string[] = [];
    const action = vi.fn(async () => ({ ok: false as const, error: "Invalid slope" }));
    const autosave = createSectionAutosaveController({
      action,
      debounceMs: () => 600,
      initial: "flat",
      onRollback: (value) => rolled.push(value),
    });

    autosave.save("flat", { immediate: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(action).not.toHaveBeenCalled();

    autosave.setBaseline("server");
    autosave.save("nope", { immediate: true, rollback: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(rolled).toEqual(["server"]);
    vi.useRealTimers();
  });

  it("flushes on pagehide and when the page is hidden", () => {
    const listeners = new Map<string, () => void>();
    const documentListeners = new Map<string, () => void>();
    const win = {
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
      document: {
        visibilityState: "visible",
        addEventListener: (type: string, listener: () => void) => documentListeners.set(type, listener),
        removeEventListener: (type: string) => documentListeners.delete(type),
      },
    };
    let flushes = 0;
    const stop = watchAutosaveLeave(win, () => { flushes += 1; });
    listeners.get("pagehide")?.();
    win.document.visibilityState = "hidden";
    documentListeners.get("visibilitychange")?.();
    win.document.visibilityState = "visible";
    documentListeners.get("visibilitychange")?.();
    expect(flushes).toBe(2);
    stop();
    listeners.get("pagehide")?.();
    expect(flushes).toBe(2);
  });
});
