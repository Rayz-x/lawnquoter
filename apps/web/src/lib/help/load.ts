import "server-only";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseHelpArticle, type HelpArticle } from "./parse";

/** Markdown lives in the app, next to the server process. See outputFileTracingIncludes. */
const directory = join(process.cwd(), "content/help");

export function loadHelpArticles(): HelpArticle[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".md"))
    .map((name) => parseHelpArticle(name.slice(0, -3), readFileSync(join(directory, name), "utf8")))
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

export function loadHelpArticle(slug: string): HelpArticle | null {
  return loadHelpArticles().find((article) => article.slug === slug) ?? null;
}
