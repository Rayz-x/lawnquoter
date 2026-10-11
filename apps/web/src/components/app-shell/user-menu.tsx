"use client";

import { LogOut, Monitor, Moon, SunMedium } from "lucide-react";
import Link from "next/link";
import { useTheme } from "next-themes";
import type { OrgRole } from "@lawnquoter/shared";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { NavItem } from "./nav-config";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function initials(name: string | null, email: string | null) {
  const source = name?.trim() || email || "?";
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function UserMenu({
  email,
  name,
  role,
  links = [],
}: {
  email: string | null;
  name: string | null;
  role: OrgRole;
  links?: NavItem[];
}) {
  const { theme, setTheme } = useTheme();
  const mark = initials(name, email);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="hit-expand grid size-8 place-items-center rounded-full bg-[var(--lime)] text-xs font-semibold text-[var(--lime-ink)] outline-offset-2"
        aria-label={`Account menu, ${name ?? email ?? "signed in"}`}
      >
        <Avatar className="size-8">
          <AvatarFallback className="bg-[var(--lime)] text-xs font-semibold text-[var(--lime-ink)]">{mark}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate">{name ?? "Account"}</span>
          <span className="block truncate text-xs text-muted-foreground">{email}</span>
          <span className="block truncate text-xs capitalize text-muted-foreground">{role.replaceAll("_", " ")}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {links.length > 0 ? (
          <DropdownMenuGroup>
            {links.map((link) => (
              <DropdownMenuItem key={link.href} render={<Link href={link.href} />}>
                <link.icon />
                {link.title === "Crew App" ? "Open crew app" : link.title}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuItem aria-checked={theme === "dark"} onClick={() => setTheme("dark")}>
            <Moon />
            Dark
            <span className="ms-auto font-mono text-[10px] text-muted-foreground">T</span>
          </DropdownMenuItem>
          <DropdownMenuItem aria-checked={theme === "light"} onClick={() => setTheme("light")}>
            <SunMedium />
            Daylight
          </DropdownMenuItem>
          <DropdownMenuItem aria-checked={theme === "system" || theme == null} onClick={() => setTheme("system")}>
            <Monitor />
            Auto
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <form action="/auth/signout" method="post">
            <DropdownMenuItem nativeButton render={<button type="submit" className="w-full" />}>
              <LogOut />
              Sign out
            </DropdownMenuItem>
          </form>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
