export type HelpHeading = {
  id: string;
  text: string;
  level: 2 | 3;
};

export type HelpBlock =
  | { type: "p"; text: string }
  | { type: "h"; level: 2 | 3; id: string; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] };

export type HelpArticle = {
  slug: string;
  title: string;
  section: string;
  summary: string;
  order: number;
  headings: HelpHeading[];
  text: string;
  blocks: HelpBlock[];
};

export type HelpHit = {
  slug: string;
  title: string;
  section: string;
  summary: string;
};

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function frontValue(block: string, key: string) {
  const line = block.split(/\r?\n/).find((row) => row.startsWith(`${key}:`));
  if (!line) return "";
  return line.slice(key.length + 1).trim();
}

function anchor(text: string, used: Set<string>) {
  const base =
    text
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "section";
  let id = base;
  let n = 2;
  while (used.has(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  used.add(id);
  return id;
}

function pushParagraph(blocks: HelpBlock[], lines: string[]) {
  const text = lines.join(" ").trim();
  if (text) blocks.push({ type: "p", text });
  lines.length = 0;
}

export function parseHelpArticle(slug: string, source: string): HelpArticle {
  const front = source.match(FRONT);
  if (!front) throw new Error(`Help article ${slug} is missing a title block.`);
  const title = frontValue(front[1] ?? "", "title");
  const section = frontValue(front[1] ?? "", "section");
  const summary = frontValue(front[1] ?? "", "summary");
  const order = Number(frontValue(front[1] ?? "", "order") || "100");
  if (!title || !section || !summary) throw new Error(`Help article ${slug} needs a title, section, and summary.`);

  const blocks: HelpBlock[] = [];
  const headings: HelpHeading[] = [];
  const used = new Set<string>();
  const paragraph: string[] = [];
  let list: { type: "ul" | "ol"; items: string[] } | null = null;

  const closeList = () => {
    if (!list || list.items.length === 0) {
      list = null;
      return;
    }
    blocks.push({ type: list.type, items: list.items });
    list = null;
  };

  for (const raw of source.slice(front[0].length).split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^(#{2,3})\s+(.+)$/.exec(line);
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    const numbered = /^\d+\.\s+(.+)$/.exec(line);
    if (heading) {
      pushParagraph(blocks, paragraph);
      closeList();
      const level = heading[1]!.length === 2 ? 2 : 3;
      const text = heading[2]!.trim();
      const id = anchor(text, used);
      headings.push({ id, text, level });
      blocks.push({ type: "h", level, id, text });
      continue;
    }
    if (bullet || numbered) {
      pushParagraph(blocks, paragraph);
      const type = bullet ? "ul" : "ol";
      if (!list || list.type !== type) {
        closeList();
        list = { type, items: [] };
      }
      list.items.push((bullet ?? numbered)![1]!.trim());
      continue;
    }
    if (!line) {
      pushParagraph(blocks, paragraph);
      closeList();
      continue;
    }
    closeList();
    paragraph.push(line);
  }
  pushParagraph(blocks, paragraph);
  closeList();

  const text = blocks
    .flatMap((block) => (block.type === "ul" || block.type === "ol" ? block.items : [block.text]))
    .join("\n");

  return { slug, title, section, summary, order: Number.isFinite(order) ? order : 100, headings, text, blocks };
}

export function searchHelp(
  articles: readonly Pick<HelpArticle, "slug" | "title" | "section" | "summary" | "text" | "headings">[],
  query: string,
): HelpHit[] {
  const needle = query.trim().toLowerCase();
  return articles
    .filter((article) => {
      if (!needle) return true;
      const haystack = [article.title, article.section, article.summary, article.text, ...article.headings.map((heading) => heading.text)]
        .join("\n")
        .toLowerCase();
      return haystack.includes(needle);
    })
    .map((article) => ({ slug: article.slug, title: article.title, section: article.section, summary: article.summary }));
}

export function matchingHeadings(article: Pick<HelpArticle, "headings">, query: string): HelpHeading[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return article.headings.filter((heading) => heading.text.toLowerCase().includes(needle));
}
