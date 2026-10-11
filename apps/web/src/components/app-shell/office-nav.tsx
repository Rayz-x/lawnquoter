"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, Plus } from "lucide-react";
import { Menu } from "@base-ui/react/menu";
import { Menubar } from "@base-ui/react/menubar";
import { categoryFor, type NavCategory, type NavItem } from "./nav-config";

export function useFineHover() {
  const [fine, setFine] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(hover: hover) and (pointer: fine)");
    const apply = () => setFine(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  return fine;
}

/** True when the category stays on the desktop bar at this width. */
export function categoryOnBar(category: NavCategory, width: number | null, current: boolean) {
  if (category.place !== "bar") return false;
  if (width == null) return true;
  if (width < 760) return false;
  if (current) return true;
  if (width < 1000) return category.priority <= 3;
  if (width < 1100) return category.priority <= 4;
  return true;
}

function loneItem(category: NavCategory): NavItem | null {
  return category.items.length === 1 ? category.items[0]! : null;
}

export function OfficeMenubar({
  categories,
  pathname,
  width,
  requestCount,
  fineHover,
}: {
  categories: NavCategory[];
  pathname: string;
  width: number | null;
  requestCount: number;
  fineHover: boolean;
}) {
  const bar = categories.filter((category) => category.place === "bar");
  const active = categoryFor(pathname, bar);
  const shown = width == null ? bar : bar.filter((category) => categoryOnBar(category, width, category.label === active?.label));
  const folded = width == null ? [] : bar.filter((category) => !categoryOnBar(category, width, category.label === active?.label));

  return (
    <nav aria-label="Primary" className="dispatch-links">
      <Menubar modal={false} className="flex items-center gap-0.5">
        {shown.map((category) => (
          <CategoryControl
            key={category.label}
            category={category}
            active={category.label === active?.label}
            pathname={pathname}
            requestCount={requestCount}
            fineHover={fineHover}
          />
        ))}
        {folded.length > 0 ? (
          <CategoryMenu
            label="More"
            items={folded.flatMap((category) => category.items.map((item) => ({ ...item, group: category.label })))}
            pathname={pathname}
            fineHover={fineHover}
            className="dispatch-more-desktop"
          />
        ) : null}
      </Menubar>
    </nav>
  );
}

export function OfficeTabBar({
  categories,
  pathname,
  requestCount,
  showNew,
}: {
  categories: NavCategory[];
  pathname: string;
  requestCount: number;
  showNew: boolean;
}) {
  const bar = categories.filter((category) => category.place === "bar");
  const active = categoryFor(pathname, bar);

  return (
    <nav aria-label="Sections" className="dispatch-tabs">
      <div className="dispatch-tab-scroll">
        {bar.map((category) => {
          const lone = loneItem(category);
          const current = category.label === active?.label;
          if (lone) {
            return (
              <Link key={category.label} href={lone.href} aria-current={current ? "page" : undefined} className="dispatch-tab">
                {category.label}
              </Link>
            );
          }
          return (
            <CategoryMenu
              key={category.label}
              label={category.label}
              items={category.items.map((item) => ({ ...item, group: category.label }))}
              pathname={pathname}
              fineHover={false}
              current={current}
              requestCount={category.items.some((item) => item.href === "/leads") ? requestCount : 0}
              up
              triggerClass="dispatch-tab"
            />
          );
        })}
      </div>
      {showNew ? (
        <Link href="/quotes/new" className="dispatch-tab-new" aria-label="New quote">
          <Plus className="size-6" />
        </Link>
      ) : null}
    </nav>
  );
}

function CategoryControl({
  category,
  active,
  pathname,
  requestCount,
  fineHover,
}: {
  category: NavCategory;
  active: boolean;
  pathname: string;
  requestCount: number;
  fineHover: boolean;
}) {
  const lone = loneItem(category);
  const count = category.items.some((item) => item.href === "/leads") ? requestCount : 0;
  if (lone) {
    // A single destination is a plain link, not a menu trigger, so Enter, Cmd-click,
    // and middle-click all behave like normal navigation.
    return (
      <Link
        href={lone.href}
        className="dispatch-link dispatch-cat"
        data-nav-priority={category.priority}
        data-nav-current={active ? "true" : "false"}
        aria-current={active ? "page" : undefined}
      >
        {category.label}
        <Count count={count} />
      </Link>
    );
  }

  return (
    <CategoryMenu
      label={category.label}
      items={category.items.map((item) => ({ ...item, group: category.label }))}
      pathname={pathname}
      fineHover={fineHover}
      current={active}
      requestCount={count}
      priority={category.priority}
      className="dispatch-cat"
    />
  );
}

type MenuEntry = NavItem & { group: string };

function CategoryMenu({
  label,
  items,
  pathname,
  fineHover,
  current = false,
  requestCount = 0,
  priority,
  className,
  triggerClass = "dispatch-link",
  up = false,
}: {
  label: string;
  items: MenuEntry[];
  pathname: string;
  fineHover: boolean;
  current?: boolean;
  requestCount?: number;
  priority?: number;
  className?: string;
  triggerClass?: string;
  up?: boolean;
}) {
  const grouped = groupEntries(items);
  return (
    <Menu.Root highlightItemOnHover={fineHover}>
      <Menu.Trigger
        className={`${triggerClass} ${className ?? ""}`}
        data-nav-priority={priority}
        data-nav-current={current ? "true" : "false"}
        aria-current={current ? "true" : undefined}
        openOnHover={fineHover}
        delay={120}
        closeDelay={80}
      >
        {label}
        <Count count={requestCount} />
        {up ? null : <ChevronDown aria-hidden className="size-3.5 opacity-70" />}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side={up ? "top" : "bottom"} sideOffset={8} align={up ? "center" : "start"}>
          <Menu.Popup className="dispatch-menu">
            {grouped.map((group) => (
              <Menu.Group key={group.label}>
                {grouped.length > 1 ? <Menu.GroupLabel className="dispatch-menu-label">{group.label}</Menu.GroupLabel> : null}
                {group.items.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <Menu.LinkItem
                      key={item.href}
                      className="dispatch-menu-item"
                      aria-current={active ? "page" : undefined}
                      closeOnClick
                      render={<Link href={item.href} />}
                    >
                      <item.icon aria-hidden className="size-4 opacity-80" />
                      <span>{item.title}</span>
                      {item.href === "/leads" ? <Count count={requestCount} /> : null}
                    </Menu.LinkItem>
                  );
                })}
              </Menu.Group>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function groupEntries(items: MenuEntry[]) {
  const groups: { label: string; items: MenuEntry[] }[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last?.label === item.group) last.items.push(item);
    else groups.push({ label: item.group, items: [item] });
  }
  return groups;
}

function Count({ count }: { count: number }) {
  if (count <= 0) return null;
  return <span className="dispatch-count">{count > 99 ? "99+" : count}</span>;
}

export function NavSectionTitle({ categories, pathname }: { categories: NavCategory[]; pathname: string }) {
  const active = categoryFor(pathname, categories.filter((category) => category.place === "bar"));
  return <span className="dispatch-section-title truncate text-sm font-semibold">{active?.label ?? "LawnQuoter"}</span>;
}
