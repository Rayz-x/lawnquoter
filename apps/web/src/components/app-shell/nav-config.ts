import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Building2,
  CalendarDays,
  FileText,
  HardHat,
  Inbox,
  LayoutDashboard,
  MapPinned,
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
      { title: "Leads", href: "/leads", icon: Inbox, roles: OFFICE_ROLES },
      { title: "Quotes", href: "/quotes", icon: FileText, roles: SALES_ROLES },
      { title: "Lead sources", href: "/leads/report", icon: BarChart3, roles: OFFICE_ROLES },
    ],
  },
  {
    label: "Customers",
    items: [
      { title: "Accounts", href: "/accounts", icon: Building2 },
      { title: "Properties", href: "/properties", icon: MapPinned },
      { title: "Agreements", href: "/agreements", icon: Repeat, roles: OFFICE_ROLES },
      { title: "Payments", href: "/payments", icon: Wallet, roles: OFFICE_ROLES },
    ],
  },
  {
    label: "Operations",
    items: [
      { title: "Schedule", href: "/schedule", icon: CalendarDays, roles: OFFICE_ROLES },
      { title: "Crew App", href: "/crew/today", icon: Smartphone, roles: FIELD_ROLES },
    ],
  },
  {
    label: "Setup",
    items: [
      { title: "Services & Pricing", href: "/settings/pricing", icon: Tags, roles: ADMIN_ROLES },
      { title: "Team", href: "/settings/team", icon: Users, roles: ADMIN_ROLES },
      { title: "Crews", href: "/settings/crews", icon: HardHat, roles: DISPATCH_ROLES },
      { title: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

export function visibleNav(role: OrgRole): NavGroup[] {
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.roles || i.roles.includes(role)),
  })).filter((g) => g.items.length > 0);
}
