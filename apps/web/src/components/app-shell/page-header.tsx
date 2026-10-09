import type { ReactNode } from "react";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header
      className="sticky top-0 z-10 flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b bg-background px-4 py-2"
      style={{ paddingBlockStart: "calc(0.5rem + env(safe-area-inset-top, 0px))" }}
    >
      <SidebarTrigger className="hit-expand -ms-1" />
      <Separator orientation="vertical" className="me-2 h-4" />
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <h1 className="text-sm font-semibold leading-snug [overflow-wrap:anywhere]">{title}</h1>
        {description ? (
          <p className="text-xs text-muted-foreground [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-clip">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="ms-auto flex flex-wrap items-center justify-end gap-2">{actions}</div> : null}
    </header>
  );
}
