import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SectionCard } from "./section-card";
import { SectionMenu, splitSectionMenuItems } from "./section-menu";
import { createSectionAutosaveController } from "./section-autosave";
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
      actions: createElement("button", { type: "button" }, "Save address"),
      menu: createElement(SectionMenu, {
        items: [
          { id: "edit", label: "Edit", onSelect: () => undefined },
          { id: "remove", label: "Remove", destructive: true, onSelect: () => undefined },
        ],
      }),
    }));
    expect(card).toContain("Mowing conditions");
    expect(card).toContain("Saved ✓");
    expect(card).toContain("Invalid slope");
    expect(card).toContain("size-11");
    expect(card).toContain("Gentle");
    expect(card).toContain('data-entry="section-save"');
    expect(card).toContain("Save address");
    expect(card).toContain("Section actions");
    expect(html(createElement(SectionCard, { title: "Access" }, "Gate"))).not.toContain("section-save");

    const tabs = html(createElement(TabBox, {
      value: "contacts",
      onValueChange: () => undefined,
      tabs: [
        { value: "properties", label: "Properties", count: 2, menu: "Property menu", content: "Properties body" },
        { value: "contacts", label: "Contacts", count: 0, menu: "Contact menu", content: "Contacts body" },
      ],
    }));
    expect(tabs).toContain("Properties (2)");
    expect(tabs).toContain("Contacts (0)");
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

    autosave.save("bad", { immediate: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(autosave.getSnapshot()).toMatchObject({ status: "error", error: "Invalid slope", rollback: "steep" });
    expect(rolled).toEqual(["steep"]);

    action.mockRejectedValueOnce(new Error("offline"));
    autosave.save("mild", { immediate: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(autosave.getSnapshot()).toMatchObject({ status: "error", error: "offline", rollback: "steep" });
    expect(rolled).toEqual(["steep", "steep"]);
    autosave.dispose();
    vi.useRealTimers();
  });

  it("flushes an edit that is still inside the debounce window", async () => {
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
});
