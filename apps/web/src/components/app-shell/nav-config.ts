import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Building2,
  CalendarDays,
  CircleDollarSign,
  FileText,
  HardHat,
  Inbox,
  LayoutDashboard,
  MapPinned,
  Receipt,
  Repeat,
  Settings,
  Smartphone,
  Tags,
  Users,
  Wallet,
} from "lucide-react";
import type { OrgRole } from "@lawnquoter/shared";
import { ADMIN_ROLES, DISPATCH_ROLES, FIELD_ROLES, SALES_ROLES } from "@lawnquoter/shared";
import { OFFICE_ROLES } from "@/lib/auth/office-roles";

export type NavPlace = "primary" | "more" | "user";

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Roles allowed to see the item; undefined = everyone in the org. */
  roles?: readonly OrgRole[];
  /**
   * Primary-bar fold order. Lower stays on the bar as it narrows.
   * 0–3 stay until the phone tab bar. 4–5 fold under 1000px. 6–7 fold under 1250px.
   */
  priority: number;
  /** primary = top bar (folds into More). more = More menu. user = avatar menu. */
  place: NavPlace;
};

export type NavGroup = { label: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Work",
    items: [
      { title: "Today", href: "/dashboard", icon: LayoutDashboard, priority: 0, place: "primary" },
      { title: "Requests", href: "/leads", icon: Inbox, roles: OFFICE_ROLES, priority: 1, place: "primary" },
      { title: "Quotes", href: "/quotes", icon: FileText, roles: SALES_ROLES, priority: 2, place: "primary" },
      { title: "Accounts", href: "/accounts", icon: Building2, priority: 3, place: "primary" },
      { title: "Properties", href: "/properties", icon: MapPinned, priority: 4, place: "primary" },
    ],
  },
  {
    label: "Field",
    items: [
      { title: "Schedule", href: "/schedule", icon: CalendarDays, roles: OFFICE_ROLES, priority: 5, place: "primary" },
      { title: "Crews", href: "/settings/crews", icon: HardHat, roles: DISPATCH_ROLES, priority: 6, place: "primary" },
      { title: "Invoices", href: "/invoices", icon: Receipt, roles: OFFICE_ROLES, priority: 7, place: "primary" },
      { title: "Agreements", href: "/agreements", icon: Repeat, roles: OFFICE_ROLES, priority: 8, place: "more" },
      { title: "Payments", href: "/payments", icon: Wallet, roles: OFFICE_ROLES, priority: 9, place: "more" },
      { title: "Billing review", href: "/billing/review", icon: CircleDollarSign, roles: OFFICE_ROLES, priority: 10, place: "more" },
      { title: "Crew App", href: "/crew/today", icon: Smartphone, roles: FIELD_ROLES, priority: 20, place: "user" },
    ],
  },
  {
    label: "Company",
    items: [
      { title: "Reports", href: "/leads/report", icon: BarChart3, roles: OFFICE_ROLES, priority: 11, place: "more" },
      { title: "Pricing", href: "/settings/pricing", icon: Tags, roles: ADMIN_ROLES, priority: 12, place: "more" },
      { title: "Team", href: "/settings/team", icon: Users, roles: ADMIN_ROLES, priority: 13, place: "more" },
      { title: "Settings", href: "/settings", icon: Settings, priority: 14, place: "more" },
    ],
  },
];

/** Longest matching href wins, so /leads/report does not light up Requests. */
export function activeNavHref(pathname: string, items: readonly NavItem[]): string | null {
  let best: NavItem | null = null;
  for (const item of items) {
    const match = pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (!match) continue;
    if (!best || item.href.length > best.href.length) best = item;
  }
  return best?.href ?? null;
}

export function visibleNav(role: OrgRole): NavGroup[] {
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.roles || i.roles.includes(role)),
  })).filter((g) => g.items.length > 0);
}
