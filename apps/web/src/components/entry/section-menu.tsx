"use client";

import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

export type SectionMenuItem = {
  id: string;
  label: string;
  onSelect: () => void;
  destructive?: boolean;
  confirm?: string;
};

export function splitSectionMenuItems(items: SectionMenuItem[]) {
  return {
    actions: items.filter((item) => !item.destructive),
    destructive: items.filter((item) => item.destructive),
  };
}

export function SectionMenu({ label = "Section actions", items }: { label?: string; items: SectionMenuItem[] }) {
  const [pending, setPending] = useState<SectionMenuItem | null>(null);
  const { actions, destructive } = splitSectionMenuItems(items);
  if (items.length === 0) return null;

  const choose = (item: SectionMenuItem) => {
    if (item.destructive) setPending(item);
    else item.onSelect();
  };
  const divided = actions.length > 0 && destructive.length > 0;

  return (
    <>
      <div className="hidden lg:block">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label={label} />}>
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {actions.length > 0 ? (
              <DropdownMenuGroup>
                {actions.map((item) => (
                  <DropdownMenuItem key={item.id} onClick={() => choose(item)}>{item.label}</DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            ) : null}
            {divided ? <DropdownMenuSeparator /> : null}
            {destructive.length > 0 ? (
              <DropdownMenuGroup>
                {destructive.map((item) => (
                  <DropdownMenuItem key={item.id} variant="destructive" onClick={() => choose(item)}>{item.label}</DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="lg:hidden">
        <Sheet>
          <SheetTrigger render={<Button type="button" variant="ghost" size="icon" className="size-11" aria-label={label} />}>
            <MoreHorizontal />
          </SheetTrigger>
          <SheetContent side="bottom" className="pb-[env(safe-area-inset-bottom)]">
            <SheetHeader>
              <SheetTitle>{label}</SheetTitle>
            </SheetHeader>
            <div className="flex flex-col gap-2 px-4 pb-4">
              {actions.map((item) => (
                <Button key={item.id} type="button" variant="outline" className="min-h-11 justify-start" onClick={() => choose(item)}>
                  {item.label}
                </Button>
              ))}
              {divided ? <Separator /> : null}
              {destructive.map((item) => (
                <Button key={item.id} type="button" variant="destructive" className="min-h-11 justify-start" onClick={() => choose(item)}>
                  {item.label}
                </Button>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      </div>
      <AlertDialog open={pending !== null} onOpenChange={(open) => { if (!open) setPending(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.label ?? "Confirm"}</AlertDialogTitle>
            <AlertDialogDescription>{pending?.confirm ?? "This can't be undone."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <AlertDialogAction type="button" variant="destructive" onClick={() => { pending?.onSelect(); setPending(null); }}>
              {pending?.label ?? "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
