"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, ChevronDown, Plus, Search } from "lucide-react";
import { useTheme } from "next-themes";
import type { OrgRole } from "@lawnquoter/shared";
import { activeNavHref, visibleNav, type NavItem } from "./nav-config";
import { CommandPalette, type PaletteCommand } from "./command-palette";
import { UserMenu } from "./user-menu";

export type OfficeOrg = { id: string; name: string };

function onBar(item: NavItem, width: number | null, current: boolean) {
  if (item.place !== "primary") return false;
  if (width == null) return true;
  if (width < 760) return false;
  if (current) return true;
  if (width < 1000) return item.priority <= 3;
  if (width < 1250) return item.priority <= 5;
  return true;
}

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
  const router = useRouter();
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
  const items = visibleNav(role).flatMap((group) => group.items);
  const current = activeNavHref(pathname, items);
  const section = items.find((item) => item.href === current);
  const showCrew = items.some((item) => item.href === "/crew/today");

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
    ...items
      .filter((item) => item.place !== "user")
      .map((item) => ({ id: item.href, label: item.title, hint: "Go to", href: item.href })),
    { id: "new-quote", label: "New quote", hint: "Action", href: "/quotes/new", keys: "C" },
  ];

  const moreItems = items.filter((item) => item.place === "more" || (item.place === "primary" && !onBar(item, width, item.href === current)));

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
                  <div key={org.id} role="menuitem" className="flex items-center justify-between gap-3 rounded-md px-2 py-2">
                    <span className="truncate">{org.name}</span>
                    {org.id === currentOrgId ? <span className="text-[10px] text-[var(--lime)]">Active</span> : null}
                  </div>
                ))}
                <p className="px-2 py-1.5 text-xs text-[oklch(0.72_0.01_160)]">This session stays in the active company.</p>
              </div>
            ) : null}
          </div>

          <span className="dispatch-section-title truncate text-sm font-semibold">{section?.title ?? "LawnQuoter"}</span>

          <nav aria-label="Primary" className="dispatch-links flex items-center gap-0.5">
            {items
              .filter((item) => item.place === "primary")
              .map((item) => {
                const active = item.href === current;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    data-nav-priority={item.priority}
                    data-nav-current={active ? "true" : "false"}
                    aria-current={active ? "page" : undefined}
                    className="dispatch-link"
                  >
                    {item.title}
                    {item.href === "/leads" && requestCount > 0 ? (
                      <span className="dispatch-count">{requestCount > 99 ? "99+" : requestCount}</span>
                    ) : null}
                  </Link>
                );
              })}
          </nav>

          <MoreMenu items={moreItems} current={current} className="dispatch-more-desktop" />

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
            <UserMenu email={userEmail} name={userName} role={role} showCrew={showCrew} />
          </div>
        </div>

        <nav aria-label="Mobile" className="dispatch-tabs">
          <Tab href="/dashboard" label="Today" current={current === "/dashboard"} />
          <Tab href="/quotes" label="Quotes" current={current === "/quotes"} />
          <Link href="/quotes/new" className="dispatch-tab-new" aria-label="New quote">
            <Plus className="size-6" />
          </Link>
          <Tab href="/schedule" label="Schedule" current={current === "/schedule"} />
          <MoreMenu items={items.filter((item) => item.place !== "user" && !["/dashboard", "/quotes", "/schedule"].includes(item.href))} current={current} label="More" up />
        </nav>
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

function Tab({ href, label, current }: { href: string; label: string; current: boolean }) {
  return (
    <Link href={href} aria-current={current ? "page" : undefined} className="dispatch-tab">
      {label}
    </Link>
  );
}

function MoreMenu({
  items,
  current,
  className,
  label = "More",
  up = false,
}: {
  items: NavItem[];
  current: string | null;
  className?: string;
  label?: string;
  up?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={`relative ${className ?? ""}`}>
      <button type="button" className={up ? "dispatch-tab" : "dispatch-link"} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((value) => !value)}>
        {label}
        {up ? null : <ChevronDown aria-hidden className="size-3.5 opacity-70" />}
      </button>
      {open ? (
        <div role="menu" className={`absolute z-50 min-w-52 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg ${up ? "end-0 bottom-[calc(100%+0.4rem)]" : "end-0 top-[calc(100%+0.35rem)]"}`}>
          <p className="px-2 py-1 text-[10px] tracking-wide text-muted-foreground uppercase">More sections</p>
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              role="menuitem"
              aria-current={item.href === current ? "page" : undefined}
              className="flex min-h-11 items-center rounded-md px-2 text-sm aria-[current=page]:bg-accent"
              onClick={() => setOpen(false)}
            >
              {item.title}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
