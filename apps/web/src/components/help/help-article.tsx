import Link from "next/link";
import type { ReactNode } from "react";
import type { HelpArticle, HelpBlock } from "@/lib/help/parse";

function Inline({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const pattern = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(text.slice(last, index));
    const label = match[1];
    const href = match[2];
    if (label && href && (href.startsWith("/") || href.startsWith("https://") || href.startsWith("http://"))) {
      parts.push(
        <Link key={key} href={href} className="underline">
          {label}
        </Link>,
      );
    } else if (label) {
      parts.push(label);
    } else if (match[3]) {
      parts.push(<strong key={key}>{match[3]}</strong>);
    } else if (match[4]) {
      parts.push(
        <code key={key} className="rounded bg-muted px-1 py-0.5 text-[0.9em]">
          {match[4]}
        </code>,
      );
    }
    key += 1;
    last = index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function BlockView({ block }: { block: HelpBlock }) {
  if (block.type === "h") {
    const Tag = block.level === 2 ? "h2" : "h3";
    return (
      <Tag id={block.id} className="scroll-mt-24 font-semibold tracking-tight text-foreground">
        <a href={`#${block.id}`} className={block.level === 2 ? "text-lg" : "text-base"}>
          {block.text}
        </a>
      </Tag>
    );
  }
  if (block.type === "ul" || block.type === "ol") {
    const Tag = block.type === "ul" ? "ul" : "ol";
    return (
      <Tag className={block.type === "ul" ? "list-disc space-y-1 ps-5" : "list-decimal space-y-1 ps-5"}>
        {block.items.map((item, index) => (
          <li key={`${index}-${item}`}>
            <Inline text={item} />
          </li>
        ))}
      </Tag>
    );
  }
  return (
    <p>
      <Inline text={block.text} />
    </p>
  );
}

export function HelpArticleView({ article }: { article: HelpArticle }) {
  return (
    <div className="page-body">
      <article className="flex max-w-2xl flex-col gap-3 text-sm leading-6">
        <p>
          <Link href="/help" className="text-muted-foreground underline">
            All topics
          </Link>
        </p>
        {article.blocks.map((block, index) => (
          <BlockView key={block.type === "h" ? block.id : `${block.type}-${index}`} block={block} />
        ))}
      </article>
    </div>
  );
}
