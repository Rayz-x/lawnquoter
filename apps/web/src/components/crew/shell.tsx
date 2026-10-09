"use client";

import { CalendarDays, Inbox, Map, UserCircle } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState, type ReactNode } from "react";
import { browserCrewStore } from "@/lib/crew/queue";
import { clearCrewCaches, crewWorkerUrl } from "@/lib/crew/sw-policy";
import { useCrewSync } from "@/lib/crew/use-crew-sync";

const TABS = [
  { href: "/crew/today", label: "Today", icon: CalendarDays },
  { href: "/crew/map", label: "Map", icon: Map },
  { href: "/crew/outbox", label: "Outbox", icon: Inbox },
  { href: "/crew/me", label: "Me", icon: UserCircle },
] as const;

export function CrewShell({ children, userId, orgId }: { children: ReactNode; userId: string; orgId: string }) {
  const pathname = usePathname();
  const waiting = useOutboxCount(userId, orgId);
  useCrewSync(userId, orgId);
  useCrewDisplay();
  useEffect(() => {
    const build = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;
    void navigator.serviceWorker
      ?.register(crewWorkerUrl(build), { scope: "/crew/" })
      .then((registration) => {
        const sync = (registration as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }).sync;
        return sync?.register("crew-outbox");
      })
      .catch(() => undefined);
    void navigator.storage?.persist?.();
  }, []);
  useEffect(() => {
    const key = `${userId}:${orgId}`;
    const previous = localStorage.getItem("crew-cache-user");
    if (previous && previous !== key) {
      void clearCrewCaches();
      void browserCrewStore().clearPacks();
    }
    localStorage.setItem("crew-cache-user", key);
  }, [userId, orgId]);

  const tabs = !pathname.includes("/visits/");
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <div className={tabs ? "flex flex-1 flex-col pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))]" : "flex flex-1 flex-col"}>{children}</div>
      {tabs ? <CrewTabs pathname={pathname} waiting={waiting} /> : null}
    </div>
  );
}

function useCrewDisplay() {
  const { setTheme } = useTheme();
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const mode = localStorage.getItem("crew-display");
      root.classList.toggle("sun", mode === "sun");
      if (mode === "dark") setTheme("dark");
      else if (mode === "light" || mode === "sun") setTheme("light");
    };
    apply();
    window.addEventListener("crew-display", apply);
    return () => {
      root.classList.remove("sun");
      window.removeEventListener("crew-display", apply);
    };
  }, [setTheme]);
}

function useOutboxCount(userId: string, orgId: string) {
  const [waiting, setWaiting] = useState(0);
  useEffect(() => {
    const store = browserCrewStore();
    let stop = false;
    const refresh = () => {
      void store.listOutbox().then((rows) => {
        if (!stop) setWaiting(rows.filter((row) => row.user_id === userId && row.org_id === orgId).length);
      });
    };
    refresh();
    window.addEventListener("crew-queue", refresh);
    return () => {
      stop = true;
      window.removeEventListener("crew-queue", refresh);
    };
  }, [userId, orgId]);
  return waiting;
}

function CrewTabs({ pathname, waiting }: { pathname: string; waiting: number }) {
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
                <span className="flex items-center gap-1">
                  {tab.label}
                  {tab.href === "/crew/outbox" && waiting > 0 ? (
                    <span className="min-w-5 rounded-full bg-warning px-1 text-center text-xs text-warning-foreground">{waiting}</span>
                  ) : null}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
