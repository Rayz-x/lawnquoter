"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, ChevronDown, Plus, Search } from "lucide-react";
import { useTheme } from "next-themes";
import type { OrgRole } from "@lawnquoter/shared";
import { activateOrg } from "@/lib/auth/activate-org";
import { createClient } from "@/lib/supabase/client";
import { visibleNav } from "./nav-config";
import { CommandPalette, type PaletteCommand } from "./command-palette";
import { NavSectionTitle, OfficeMenubar, OfficeTabBar, useFineHover } from "./office-nav";
import { UserMenu } from "./user-menu";

export type OfficeOrg = { id: string; name: string };

function monogram(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "L") + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function OfficeShell({
  orgName,
  orgs,
  currentOrgId,
  userEmail,
  userName,
  role,
  requestCount,
  children,
}: {
  orgName: string;
  orgs: OfficeOrg[];
  currentOrgId: string;
  userEmail: string | null;
  userName: string | null;
  role: OrgRole;
  requestCount: number;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [switching, setSwitching] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const router = useRouter();
  const fineHover = useFineHover();
  const { resolvedTheme, setTheme } = useTheme();
  const themeRef = useRef(resolvedTheme);
  useEffect(() => {
    themeRef.current = resolvedTheme;
  }, [resolvedTheme]);
  const barRef = useRef<HTMLElement>(null);
  const orgRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const [orgOpen, setOrgOpen] = useState(false);
  const categories = visibleNav(role);
  const items = categories.flatMap((category) => category.items);
  const canQuote = items.some((item) => item.href === "/quotes");
  const chooseOrg = (orgId: string) => {
    if (orgId === currentOrgId || switching) return;
    setSwitching(orgId);
    setSwitchError(null);
    void activateOrg(createClient(), orgId).then((result) => {
      setSwitching(null);
      if (!result.ok) {
        setSwitchError(result.error);
        return;
      }
      setOrgOpen(false);
      router.replace("/dashboard");
      router.refresh();
    });
  };

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const apply = () => setWidth(bar.getBoundingClientRect().width);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette(true);
        return;
      }
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "?" || (event.shiftKey && event.key === "/")) {
        event.preventDefault();
        setHelp(true);
      } else if (event.key.toLowerCase() === "c") {
        event.preventDefault();
        router.push("/quotes/new");
      } else if (event.key.toLowerCase() === "t") {
        event.preventDefault();
        setTheme(themeRef.current === "dark" ? "light" : "dark");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, setTheme]);

  useEffect(() => {
    if (!orgOpen) return;
    function onPointer(event: PointerEvent) {
      if (!orgRef.current?.contains(event.target as Node)) setOrgOpen(false);
    }
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, [orgOpen]);

  const commands: PaletteCommand[] = [
    ...items.map((item) => ({ id: item.href, label: item.title, hint: "Go to", href: item.href })),
    { id: "new-quote", label: "New quote", hint: "Action", href: "/quotes/new", keys: "C" },
  ];

  return (
    <div className="dispatch flex min-h-dvh flex-col">
      <header ref={barRef} className="dispatch-bar sticky top-0 z-40">
        <div className="flex h-[3.25rem] items-center gap-2 px-2 sm:px-3">
          <div ref={orgRef} className="relative">
            <button
              type="button"
              className="hit-expand flex h-10 max-w-44 items-center gap-2 rounded-md px-1.5 text-start"
              aria-expanded={orgOpen}
              aria-haspopup="menu"
              onClick={() => setOrgOpen((open) => !open)}
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-md bg-[var(--lime)] text-[11px] font-bold text-[var(--lime-ink)]">
                {monogram(orgName)}
              </span>
              <span className="hidden min-w-0 truncate text-sm font-medium min-[760px]:block">{orgName}</span>
              <ChevronDown aria-hidden className="hidden size-3.5 opacity-70 min-[760px]:block" />
            </button>
            {orgOpen ? (
              <div role="menu" className="absolute start-0 top-[calc(100%+0.35rem)] z-50 min-w-56 rounded-lg border border-white/10 bg-[oklch(0.22_0.01_160)] p-1 text-sm shadow-lg">
                <p className="px-2 py-1 text-[10px] tracking-wide text-[oklch(0.72_0.01_160)] uppercase">Organizations</p>
                {(orgs.length > 0 ? orgs : [{ id: currentOrgId, name: orgName }]).map((org) => (
                  <button
                    key={org.id}
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-start hover:bg-white/5 disabled:opacity-70"
                    disabled={org.id === currentOrgId || switching !== null}
                    onClick={() => chooseOrg(org.id)}
                  >
                    <span className="truncate">{org.name}</span>
                    {org.id === currentOrgId ? <span className="text-[10px] text-[var(--lime)]">Active</span> : switching === org.id ? <span className="text-[10px]">Switching</span> : null}
                  </button>
                ))}
                {switchError ? <p className="px-2 py-1.5 text-xs text-red-300">{switchError}</p> : null}
              </div>
            ) : null}
          </div>

          <NavSectionTitle categories={categories} pathname={pathname} />

          <OfficeMenubar categories={categories} pathname={pathname} width={width} requestCount={requestCount} fineHover={fineHover} />

          <button type="button" className="dispatch-search" onClick={() => setPalette(true)}>
            <Search aria-hidden className="size-4" />
            <span className="dispatch-search-label">Search or jump to…</span>
            <kbd className="dispatch-search-kbd">⌘K</kbd>
          </button>

          <div className="ms-auto flex items-center gap-1">
            <Link href="/dashboard#needs-attention" className="dispatch-icon" aria-label={requestCount > 0 ? `${requestCount} new requests` : "Needs attention"}>
              <Bell className="size-4" />
              {requestCount > 0 ? <span className="dispatch-pip" aria-hidden /> : null}
            </Link>
            <Link href="/quotes/new" className="dispatch-new">
              <Plus className="size-4" />
              <span>New</span>
              <kbd>C</kbd>
            </Link>
            <UserMenu email={userEmail} name={userName} role={role} links={categories.filter((category) => category.place === "user").flatMap((category) => category.items)} />
          </div>
        </div>

        <OfficeTabBar categories={categories} pathname={pathname} requestCount={requestCount} showNew={canQuote} />
      </header>

      <div className="dispatch-main flex min-h-0 flex-1 flex-col">{children}</div>

      <CommandPalette open={palette} onOpenChange={setPalette} commands={commands} />
      {help ? (
        <div className="fixed inset-0 z-50 bg-black/50" onClick={() => setHelp(false)}>
          <div className="mx-auto mt-[20dvh] max-w-sm rounded-xl bg-popover p-4 text-popover-foreground shadow-lg" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="shortcut-title">
            <p id="shortcut-title" className="text-sm font-semibold">Shortcuts</p>
            <div className="mt-3 grid gap-2 text-sm">
              <Shortcut keys="⌘K" label="Search or jump" />
              <Shortcut keys="C" label="New quote" />
              <Shortcut keys="T" label="Toggle dark and daylight" />
              <Shortcut keys="J K" label="Move through Needs attention" />
              <Shortcut keys="?" label="Show shortcuts" />
            </div>
            <button type="button" className="mt-4 min-h-11 text-sm underline" onClick={() => setHelp(false)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Shortcut({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <kbd className="font-mono text-xs text-muted-foreground">{keys}</kbd>
    </span>
  );
}

