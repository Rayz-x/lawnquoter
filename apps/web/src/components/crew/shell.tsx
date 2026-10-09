"use client";

import { CalendarDays, Inbox, Map, UserCircle } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";

const TABS = [
  { href: "/crew/today", label: "Today", icon: CalendarDays },
  { href: "/crew/map", label: "Map", icon: Map },
  { href: "/crew/outbox", label: "Outbox", icon: Inbox },
  { href: "/crew/me", label: "Me", icon: UserCircle },
] as const;

export function CrewShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  useEffect(() => {
    void navigator.serviceWorker?.register("/sw.js", { scope: "/crew/" }).catch(() => undefined);
    void navigator.storage?.persist?.();
  }, []);

  const tabs = !pathname.includes("/visits/");
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <div className={tabs ? "flex flex-1 flex-col pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))]" : "flex flex-1 flex-col"}>{children}</div>
      {tabs ? <CrewTabs pathname={pathname} /> : null}
    </div>
  );
}

function CrewTabs({ pathname }: { pathname: string }) {
  return (
    <nav aria-label="Crew" className="fixed inset-x-0 bottom-0 z-20 border-t bg-background px-2 pb-[env(safe-area-inset-bottom,0px)]">
      <ul className="mx-auto flex max-w-lg gap-2">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <li key={tab.href} className="flex flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-16 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[15px] font-semibold ${active ? "text-primary" : "text-muted-foreground"}`}
              >
                <Icon aria-hidden className="size-5" />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
