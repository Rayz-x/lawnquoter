"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { matchingHeadings, searchHelp, type HelpArticle } from "@/lib/help/parse";

export type HelpIndexArticle = Pick<HelpArticle, "slug" | "title" | "section" | "summary" | "order" | "text" | "headings">;

const SECTION_ORDER = ["Setup", "Customers", "Quotes", "Pricing", "Schedule", "Field work", "Money", "For your customers", "Settings"];

export function HelpIndex({ articles }: { articles: HelpIndexArticle[] }) {
  const [query, setQuery] = useState("");
  const hits = useMemo(() => searchHelp(articles, query), [articles, query]);
  const needle = query.trim();
  const sections = SECTION_ORDER.filter((section) => hits.some((hit) => hit.section === section));
  const extra = [...new Set(hits.map((hit) => hit.section))].filter((section) => !SECTION_ORDER.includes(section));

  return (
    <div className="page-body flex max-w-2xl flex-col gap-6">
      <form role="search" onSubmit={(event) => event.preventDefault()}>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Search help</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search topics"
            className="min-h-11 rounded-md border border-input bg-background px-3"
          />
        </label>
      </form>

      {hits.length === 0 ? <p className="text-sm text-muted-foreground">Nothing matches that search.</p> : null}

      {[...sections, ...extra].map((section) => (
        <section key={section} className="flex flex-col gap-3">
          <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{section}</h2>
          <ul className="flex flex-col gap-3">
            {hits
              .filter((hit) => hit.section === section)
              .map((hit) => {
                const article = articles.find((row) => row.slug === hit.slug);
                const headings = article && needle ? matchingHeadings(article, needle) : [];
                return (
                  <li key={hit.slug}>
                    <Link href={`/help/${hit.slug}`} className="font-medium underline">
                      {hit.title}
                    </Link>
                    <p className="text-sm text-muted-foreground">{hit.summary}</p>
                    {headings.length > 0 ? (
                      <ul className="mt-1 flex flex-col gap-1">
                        {headings.map((heading) => (
                          <li key={heading.id}>
                            <Link href={`/help/${hit.slug}#${heading.id}`} className="text-sm underline">
                              {heading.text}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </div>
  );
}
