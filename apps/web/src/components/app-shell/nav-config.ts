import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Building2,
  CalendarDays,
  ClipboardList,
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
} from "lucide-react";
import type { OrgRole } from "@lawnquoter/shared";
import { ADMIN_ROLES, DISPATCH_ROLES, SALES_ROLES } from "@lawnquoter/shared";
import { OFFICE_ROLES } from "@/lib/auth/office-roles";

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Roles allowed to see the item; undefined = everyone in the org. */
  roles?: readonly OrgRole[];
};

export type NavGroup = { label: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [{ title: "Dashboard", href: "/dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Sales",
    items: [
      { title: "Leads & Pipeline", href: "/leads", icon: Inbox, roles: SALES_ROLES },
      { title: "Quotes", href: "/quotes", icon: FileText, roles: SALES_ROLES },
      { title: "Bids", href: "/bids", icon: ClipboardList, roles: SALES_ROLES },
    ],
  },
  {
    label: "Customers",
    items: [
      { title: "Accounts", href: "/accounts", icon: Building2 },
      { title: "Properties", href: "/properties", icon: MapPinned },
      { title: "Agreements", href: "/agreements", icon: Repeat, roles: OFFICE_ROLES },
    ],
  },
  {
    label: "Operations",
    items: [
      { title: "Schedule", href: "/schedule", icon: CalendarDays, roles: OFFICE_ROLES },
      { title: "Crew App", href: "/crew", icon: Smartphone },
      { title: "Invoices", href: "/invoices", icon: Receipt, roles: ADMIN_ROLES },
    ],
  },
  {
    label: "Insights",
    items: [{ title: "Analytics", href: "/analytics", icon: BarChart3, roles: ADMIN_ROLES }],
  },
  {
    label: "Setup",
    items: [
      { title: "Services & Pricing", href: "/settings/pricing", icon: Tags, roles: ADMIN_ROLES },
      { title: "Team", href: "/settings/team", icon: Users, roles: ADMIN_ROLES },
      { title: "Crews", href: "/settings/crews", icon: HardHat, roles: DISPATCH_ROLES },
      { title: "Settings", href: "/settings", icon: Settings, roles: ADMIN_ROLES },
    ],
  },
];

export function visibleNav(role: OrgRole): NavGroup[] {
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.roles || i.roles.includes(role)),
  })).filter((g) => g.items.length > 0);
}
