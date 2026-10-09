"use client";

import { MoreHorizontal } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { ORG_ROLES, type OrgRole } from "@lawnquoter/shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { updateMember } from "../actions";

export function MemberRowActions({
  membershipId,
  role,
  status,
  isSelf,
  isOwner,
}: {
  membershipId: string;
  role: OrgRole;
  status: "invited" | "active" | "disabled";
  isSelf: boolean;
  isOwner: boolean;
}) {
  const [pending, startTransition] = useTransition();

  const run = (patch: { role?: OrgRole; status?: "active" | "disabled" }) => {
    const fd = new FormData();
    fd.set("membership_id", membershipId);
    if (patch.role) fd.set("role", patch.role);
    if (patch.status) fd.set("status", patch.status);
    startTransition(async () => {
      const result = await updateMember(fd);
      if (result.ok) toast.success("Member updated");
      else toast.error(result.error);
    });
  };

  if (isOwner || isSelf) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" disabled={pending} />}>
        <MoreHorizontal />
        <span className="sr-only">Member actions</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Change role</DropdownMenuLabel>
        <DropdownMenuGroup>
          {ORG_ROLES.filter((r) => r !== "owner" && r !== role).map((r) => (
            <DropdownMenuItem key={r} className="capitalize" onClick={() => run({ role: r })}>
              {r.replace("_", " ")}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {status === "disabled" ? (
            <DropdownMenuItem onClick={() => run({ status: "active" })}>Re-enable access</DropdownMenuItem>
          ) : (
            <DropdownMenuItem variant="destructive" onClick={() => run({ status: "disabled" })}>
              Disable access
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
