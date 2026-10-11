"use client";

import Link from "next/link";
import { Mail, Phone } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { SectionMenu, type SectionMenuItem } from "@/components/entry";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Tables } from "@/lib/supabase/types";
import { accountStatusMenuItems } from "../account-status-menu";
import { archiveAccount, setAccountStatus } from "../identity-action";

const STATUS_LABEL = { lead: "Lead", active: "Active", inactive: "Archived" } as const;
function exportAccount(account: Tables<"accounts">) {
  const blob = new Blob([JSON.stringify(account, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${account.name.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "") || "account"}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function ContactValue({ href, value, label }: { href: string; value: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="min-h-11 lg:min-h-8"
        title={`Copy ${label}`}
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => toast.success("Copied"));
        }}
      >
        {value}
      </Button>
      <Button variant="ghost" size="icon" className="size-11 lg:size-8" aria-label={label} render={<a href={href} />}>
        {label === "Call" ? <Phone /> : <Mail />}
      </Button>
    </span>
  );
}

export function AccountHeader({
  account,
  primaryName,
  canEdit = true,
}: {
  account: Tables<"accounts">;
  primaryName: string | null;
  canEdit?: boolean;
}) {
  const router = useRouter();
  const contactName =
    primaryName && primaryName.trim().toLowerCase() !== account.name.trim().toLowerCase() ? primaryName : null;

  const changeStatus = (status: "lead" | "active" | "inactive") => {
    void setAccountStatus(account.id, status).then((result) => {
      if (result.ok) router.refresh();
      else toast.error(result.error);
    });
  };

  const items: SectionMenuItem[] = accountStatusMenuItems(account.status)
    .filter((item) => canEdit || item.id === "export")
    .map((item) => {
      if (item.id === "export") return { ...item, onSelect: () => exportAccount(account) };
      if (item.id === "archive") {
        return {
          ...item,
          onSelect: () => {
            void archiveAccount(account.id).then((result) => {
              if (result.ok) router.refresh();
              else toast.error(result.error);
            });
          },
        };
      }
      if (item.id === "activate" || item.id === "unarchive") {
        return { ...item, onSelect: () => changeStatus("active") };
      }
      return { ...item, onSelect: () => changeStatus("lead") };
    });

  return (
    <header className="flex flex-col gap-3">
      <h1 className="font-serif text-3xl font-semibold tracking-tight [overflow-wrap:anywhere]">{account.name}</h1>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{account.type === "commercial" ? "Commercial" : "Residential"}</Badge>
        <Badge variant="secondary">{STATUS_LABEL[account.status]}</Badge>
      </div>
      {contactName || account.phone || account.email ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {contactName ? <span>{contactName}</span> : null}
          {account.phone ? <ContactValue href={`tel:${account.phone}`} value={account.phone} label="Call" /> : null}
          {account.email ? <ContactValue href={`mailto:${account.email}`} value={account.email} label="Email" /> : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {canEdit ? (
          <>
            <Button className="hidden min-h-11 lg:inline-flex" render={<Link href={`/quotes/new?account=${account.id}`} />}>
              New quote
            </Button>
            <Button variant="outline" className="min-h-11 lg:min-h-9" render={<Link href={`/accounts/${account.id}?tab=properties#quick-property`} />}>
              Add property
            </Button>
          </>
        ) : null}
        <SectionMenu label="Account actions" items={items} />
      </div>
      {canEdit ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
          <Button className="h-12 w-full" render={<Link href={`/quotes/new?account=${account.id}`} />}>
            New quote
          </Button>
        </div>
      ) : null}
    </header>
  );
}
