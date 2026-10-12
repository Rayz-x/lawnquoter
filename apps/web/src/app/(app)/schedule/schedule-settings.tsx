"use client";

import { Settings } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { WeatherRule } from "@/lib/scheduling/weather-rules";
import { SnowActivationCard } from "./snow-activation-card";
import { WeatherCard } from "./weather-card";

export function ScheduleSettingsPanel({ date, rules }: { date: string; rules: WeatherRule[] }) {
  return (
    <div data-schedule-settings-panel className="flex min-w-0 flex-col gap-4">
      <WeatherCard date={date} rules={rules} />
      <SnowActivationCard date={date} />
    </div>
  );
}

export function ScheduleSettings({ date, rules }: { date: string; rules: WeatherRule[] }) {
  return (
    <Sheet>
      <span className="flex min-w-0 max-w-[11rem] flex-col items-end gap-1">
        <SheetTrigger
          render={
            <Button type="button" variant="outline" size="icon" className="size-11" aria-label="Schedule settings" />
          }
        >
          <Settings />
        </SheetTrigger>
      </span>
      <SheetContent
        side="bottom"
        className="max-h-[85dvh] w-full overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))] sm:max-w-lg"
      >
        <SheetHeader>
          <SheetTitle>Schedule settings</SheetTitle>
          <SheetDescription>
            Weather rules and snow events for this day. The board stays as it is until you save or activate.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          <ScheduleSettingsPanel date={date} rules={rules} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
