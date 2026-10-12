import type { Metadata } from "next";
import { PageHeader } from "@/components/app-shell/page-header";
import { HelpIndex } from "@/components/help/help-index";
import { loadHelpArticles } from "@/lib/help/load";

export const metadata: Metadata = { title: "Help" };

export default function HelpPage() {
  const articles = loadHelpArticles().map(({ slug, title, section, summary, order, text, headings }) => ({
    slug,
    title,
    section,
    summary,
    order,
    text,
    headings,
  }));

  return (
    <>
      <PageHeader title="Help" description="Search how the office, the crew app, and the customer pages work." />
      <HelpIndex articles={articles} />
    </>
  );
}
