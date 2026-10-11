"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { AttentionItem } from "./load-today";

export function AttentionQueue({ items }: { items: AttentionItem[] }) {
  const router = useRouter();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target;
      const idle = target === document.body || target === document.documentElement;
      if (!idle || event.metaKey || event.ctrlKey || event.altKey || items.length === 0) return;
      if (event.key === "j") {
        event.preventDefault();
        setIndex((current) => Math.min(current + 1, items.length - 1));
      } else if (event.key === "k") {
        event.preventDefault();
        setIndex((current) => Math.max(current - 1, 0));
      } else if (event.key === "Enter") {
        const item = items[index];
        if (!item) return;
        event.preventDefault();
        router.push(item.href);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, items, router]);

  if (items.length === 0) {
    return <p className="px-4 py-6 text-sm text-muted-foreground">Nothing is waiting. New requests and final-price asks land here.</p>;
  }

  return (
    <ul className="divide-y divide-border">
      {items.map((item, itemIndex) => (
        <li key={item.id} className={itemIndex === index ? "bg-accent/60" : undefined}>
          <div className="flex items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{item.title}</p>
              <p className="truncate text-xs text-muted-foreground">{item.detail}</p>
            </div>
            <Link href={item.href} className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm">
              {item.action}
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}
