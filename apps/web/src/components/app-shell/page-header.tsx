import type { ReactNode } from "react";

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
    <header className="sticky z-20 flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-background/95 px-[clamp(1rem,0.6rem+1vw,1.5rem)] py-2 backdrop-blur-sm [inset-block-start:var(--app-header-height)]">
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <h1 className="font-sans text-base font-semibold leading-snug tracking-tight [overflow-wrap:anywhere]">{title}</h1>
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
