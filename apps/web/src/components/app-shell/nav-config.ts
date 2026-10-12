import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Building2,
  CalendarDays,
  CircleDollarSign,
  FileText,
  Landmark,
  HardHat,
  Inbox,
  Mail,
  LayoutDashboard,
  MapPinned,
  Receipt,
  Repeat,
  Settings,
  Upload,
  Smartphone,
  Tags,
  UserCircle,
  Users,
  Wallet,
} from "lucide-react";
import type { OrgRole } from "@lawnquoter/shared";
import { ADMIN_ROLES, DISPATCH_ROLES, FIELD_ROLES, SALES_ROLES } from "@lawnquoter/shared";
import { OFFICE_ROLES } from "@/lib/auth/office-roles";

export type NavPlace = "bar" | "user";

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Roles allowed to see the item. Undefined means every role in the org. */
  roles?: readonly OrgRole[];
};

export type NavCategory = {
  label: string;
  items: NavItem[];
  /**
   * Lower stays on the bar longer.
   * 0–3 stay until the phone tabs. 4 folds under 1000px. 5–6 fold under 1100px.
   */
  priority: number;
  /** bar = top categories. user = avatar menu. */
  place: NavPlace;
};

export const NAV_CATEGORIES: NavCategory[] = [
  {
    label: "Home",
    priority: 0,
    place: "bar",
    items: [{ title: "Today", href: "/dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Schedule",
    priority: 1,
    place: "bar",
    items: [{ title: "Schedule", href: "/schedule", icon: CalendarDays, roles: OFFICE_ROLES }],
  },
  {
    label: "Clients",
    priority: 2,
    place: "bar",
    items: [
      { title: "Accounts", href: "/accounts", icon: Building2 },
      { title: "Properties", href: "/properties", icon: MapPinned },
      { title: "Import customers", href: "/accounts/import", icon: Upload, roles: ["owner"] },
      { title: "Requests", href: "/leads", icon: Inbox, roles: OFFICE_ROLES },
    ],
  },
  {
    label: "Sales",
    priority: 3,
    place: "bar",
    items: [
      { title: "Quotes", href: "/quotes", icon: FileText, roles: SALES_ROLES },
      { title: "Bids", href: "/bids", icon: Landmark, roles: SALES_ROLES },
      { title: "Price book", href: "/settings/pricing", icon: Tags, roles: ADMIN_ROLES },
    ],
  },
  {
    label: "Work",
    priority: 4,
    place: "bar",
    items: [
      { title: "Agreements", href: "/agreements", icon: Repeat, roles: OFFICE_ROLES },
      { title: "Renewals", href: "/renewals", icon: CalendarDays, roles: OFFICE_ROLES },
      { title: "Crews", href: "/settings/crews", icon: HardHat, roles: DISPATCH_ROLES },
    ],
  },
  {
    label: "Money",
    priority: 5,
    place: "bar",
    items: [
      { title: "Invoices", href: "/invoices", icon: Receipt, roles: OFFICE_ROLES },
      { title: "Payments", href: "/payments", icon: Wallet, roles: OFFICE_ROLES },
      { title: "Billing review", href: "/billing/review", icon: CircleDollarSign, roles: OFFICE_ROLES },
    ],
  },
  {
    label: "Reports",
    priority: 6,
    place: "bar",
    items: [
      { title: "Reports", href: "/leads/report", icon: BarChart3, roles: OFFICE_ROLES },
      { title: "Funnel", href: "/leads/analytics", icon: BarChart3, roles: OFFICE_ROLES },
      { title: "Job costing", href: "/reports/job-costing", icon: BarChart3, roles: OFFICE_ROLES },
    ],
  },
  {
    label: "Settings",
    priority: 20,
    place: "user",
    items: [
      { title: "Profile", href: "/settings/profile", icon: UserCircle },
      { title: "Settings", href: "/settings", icon: Settings },
      { title: "Messages", href: "/settings/messages", icon: Mail, roles: OFFICE_ROLES },
      { title: "Team", href: "/settings/team", icon: Users, roles: ADMIN_ROLES },
      { title: "Crew App", href: "/crew/today", icon: Smartphone, roles: FIELD_ROLES },
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

export function visibleNav(role: OrgRole): NavCategory[] {
  return NAV_CATEGORIES.map((category) => ({
    ...category,
    items: category.items.filter((item) => !item.roles || item.roles.includes(role)),
  })).filter((category) => category.items.length > 0);
}

/** Category that owns the current route, after role filtering. */
export function categoryFor(pathname: string, categories: readonly NavCategory[]): NavCategory | null {
  const rows = categories.flatMap((category) => category.items.map((item) => ({ item, category })));
  const href = activeNavHref(pathname, rows.map((row) => row.item));
  return rows.find((row) => row.item.href === href)?.category ?? null;
}
