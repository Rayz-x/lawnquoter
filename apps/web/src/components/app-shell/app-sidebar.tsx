"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { OrgRole } from "@lawnquoter/shared";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { visibleNav } from "./nav-config";
import { UserMenu } from "./user-menu";

export type AppSidebarProps = {
  orgName: string;
  userEmail: string | null;
  userName: string | null;
  role: OrgRole;
};

export function AppSidebar({ orgName, userEmail, userName, role }: AppSidebarProps) {
  const pathname = usePathname();
  const groups = visibleNav(role);

  return (
    <Sidebar collapsible="icon" className="overscroll-contain">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/dashboard" />}>
              <Image src="/brand/lq-mark.svg" alt="" width={24} height={24} unoptimized className="size-6 shrink-0" />
              <div className="grid min-w-0 flex-1 text-start text-sm leading-tight">
                <span className="truncate font-semibold">{orgName}</span>
                <span className="truncate text-xs text-muted-foreground">LawnQuoter</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const current = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        isActive={current}
                        tooltip={item.title}
                        render={<Link href={item.href} aria-current={current ? "page" : undefined} />}
                      >
                        <item.icon />
                        <span>{item.title}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <UserMenu email={userEmail} name={userName} role={role} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
