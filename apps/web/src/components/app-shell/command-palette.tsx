"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, MapPinned, Search, UserRound } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { searchOffice, type OfficeHit } from "@/lib/actions/office-search";

export type PaletteCommand = { id: string; label: string; hint: string; href: string; keys?: string };

const ICONS = { account: UserRound, property: MapPinned, quote: FileText } as const;

export function CommandPalette({
  open,
  onOpenChange,
  commands,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: PaletteCommand[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="top-[18dvh] max-w-xl translate-y-0 gap-0 overflow-clip p-0 sm:max-w-xl">
        <DialogTitle className="sr-only">Search or jump</DialogTitle>
        <DialogDescription className="sr-only">Accounts, properties, quotes, and office sections.</DialogDescription>
        {open ? <PaletteFields commands={commands} onOpenChange={onOpenChange} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function PaletteFields({
  commands,
  onOpenChange,
}: {
  commands: PaletteCommand[];
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<OfficeHit[]>([]);
  const [pending, setPending] = useState(false);
  const [active, setActive] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((command) => `${command.label} ${command.hint}`.toLowerCase().includes(q));
  }, [commands, query]);

  const options = useMemo(() => {
    const found = query.trim().length < 2 ? [] : hits;
    return [
      ...filtered.map((command) => ({ ...command, kind: "command" as const })),
      ...found.map((hit) => ({ id: hit.id, label: hit.label, hint: hit.hint, href: hit.href, kind: hit.kind })),
    ];
  }, [filtered, hits, query]);
  const current = options[Math.min(active, Math.max(options.length - 1, 0))];

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setPending(true);
      void searchOffice(q)
        .then((next) => {
          if (!cancelled) setHits(next);
        })
        .catch(() => {
          if (!cancelled) setHits([]);
        })
        .finally(() => {
          if (!cancelled) setPending(false);
        });
    }, 160);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  function go(href: string) {
    onOpenChange(false);
    router.push(href);
  }

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Search aria-hidden className="size-4 text-muted-foreground" />
        <input
          ref={inputRef}
          value={query}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={current ? `${listId}-${current.id}` : undefined}
          placeholder="Search or jump to…"
          className="h-12 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground"
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((index) => Math.min(index + 1, Math.max(options.length - 1, 0)));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) => Math.max(index - 1, 0));
            } else if (event.key === "Enter" && current) {
              event.preventDefault();
              go(current.href);
            }
          }}
        />
        <kbd className="hidden rounded-md border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">esc</kbd>
      </div>
      <ul id={listId} role="listbox" className="max-h-[min(24rem,50dvh)] overflow-y-auto p-1.5">
        {options.length === 0 ? (
          <li className="px-3 py-6 text-center text-sm text-muted-foreground">{pending ? "Searching…" : "Nothing matches."}</li>
        ) : (
          options.map((option, index) => {
            const Icon = option.kind === "command" ? Search : ICONS[option.kind];
            return (
              <li key={`${option.kind}-${option.id}`} role="presentation">
                <button
                  id={`${listId}-${option.id}`}
                  type="button"
                  role="option"
                  aria-selected={option.id === current?.id && option.kind === current.kind}
                  className="flex min-h-11 w-full items-center gap-3 rounded-md px-2.5 text-start aria-selected:bg-accent"
                  onMouseEnter={() => setActive(index)}
                  onClick={() => go(option.href)}
                >
                  <Icon aria-hidden className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{option.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{option.hint}</span>
                  </span>
                  {"keys" in option && option.keys ? <kbd className="font-mono text-[10px] text-muted-foreground">{option.keys}</kbd> : null}
                </button>
              </li>
            );
          })
        )}
      </ul>
    </>
  );
}
