import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Tabs, TabsList, TabsTrigger } from "./tabs";

function slotClass(html: string, slot: string) {
  const match = html.match(new RegExp(`data-slot="${slot}"[^>]*class="([^"]*)"`));
  return (match?.[1] ?? "").split(/\s+/).filter(Boolean);
}

function accountTabs(children: ReactNode) {
  return renderToStaticMarkup(
    createElement(
      Tabs,
      { defaultValue: "properties" },
      createElement(TabsList, null, children),
    ),
  );
}

describe("tabs", () => {
  it("sizes each trigger to its label and scrolls the list when the row is wider than the page", () => {
    const html = accountTabs(
      <>
        {createElement(TabsTrigger, { value: "properties" }, "Properties (0)")}
        {createElement(TabsTrigger, { value: "contacts" }, "Contacts (0)")}
        {createElement(TabsTrigger, { value: "activity" }, "Activity")}
        {createElement(TabsTrigger, { value: "details" }, "Details")}
      </>,
    );

    const trigger = slotClass(html, "tabs-trigger");
    const list = slotClass(html, "tabs-list");

    expect(trigger).toEqual(expect.arrayContaining(["w-auto", "shrink-0", "whitespace-nowrap", "px-3"]));
    expect(trigger).not.toContain("flex-1");
    expect(list).toEqual(expect.arrayContaining(["w-max", "max-w-full", "min-w-0", "overflow-x-auto"]));
    expect(slotClass(html, "tabs")).toEqual(expect.arrayContaining(["w-full", "min-w-0"]));
  });
});
