import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app-shell/page-header";
import { HelpArticleView } from "@/components/help/help-article";
import { loadHelpArticle } from "@/lib/help/load";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const article = loadHelpArticle(slug);
  return { title: article ? `${article.title} · Help` : "Help" };
}

export default async function HelpArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = loadHelpArticle(slug);
  if (!article) notFound();

  return (
    <>
      <PageHeader title={article.title} description={article.summary} />
      <HelpArticleView article={article} />
    </>
  );
}
