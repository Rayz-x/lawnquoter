"use client";

import { useTheme } from "next-themes";
import Link from "next/link";

export function TodayToolbar() {
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme !== "light";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link href="/schedule" className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm">
        Route map
      </Link>
      <button
        type="button"
        className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm"
        onClick={() => setTheme(dark ? "light" : "dark")}
      >
        {dark ? "Daylight theme" : "Dark theme"}
      </button>
    </div>
  );
}
