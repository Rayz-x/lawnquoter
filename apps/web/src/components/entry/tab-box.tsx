"use client";

import type { ReactNode } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type EntryTab = {
  value: string;
  label: string;
  count?: number;
  menu?: ReactNode;
  content: ReactNode;
};

export function resolveEntryTab(tab: string | null | undefined, allowed: readonly string[], fallback: string) {
  return tab && allowed.includes(tab) ? tab : fallback;
}

export function TabBox({
  tabs,
  value,
  onValueChange,
  label = "Categories",
}: {
  tabs: EntryTab[];
  value: string;
  onValueChange: (value: string) => void;
  label?: string;
}) {
  if (tabs.length === 0) return null;
  const active = tabs.find((tab) => tab.value === value);

  return (
    <Card data-entry="tab-box">
      <Tabs value={value} onValueChange={(next) => { if (typeof next === "string") onValueChange(next); }}>
        <CardHeader>
          <div className="flex w-full min-w-0 items-center gap-2">
            <TabsList
              variant="line"
              aria-label={label}
              className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain max-lg:h-11 max-lg:rounded-full max-lg:bg-muted max-lg:p-1"
            >
              {tabs.map((tab) => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className="max-lg:h-9 max-lg:rounded-full max-lg:px-3 max-lg:after:opacity-0 max-lg:data-active:bg-background"
                >
                  {tab.label}
                  {tab.count === undefined ? null : (
                    <span data-count="" className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground">
                      {tab.count}
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
            {active?.menu ? <div data-entry="tab-menu">{active.menu}</div> : null}
          </div>
        </CardHeader>
        <CardContent>
          {tabs.map((tab) => (
            <TabsContent key={tab.value} value={tab.value}>
              {tab.content}
            </TabsContent>
          ))}
        </CardContent>
      </Tabs>
    </Card>
  );
}
