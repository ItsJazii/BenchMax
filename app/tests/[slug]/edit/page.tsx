import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";
import { TestCreator } from "@/app/tests/TestCreator";
import { isClerkConfigured } from "@/lib/auth/server";
import { getPublicBenchmarkPage } from "@/lib/data/public-catalog";
import { communityTestDraftSchema } from "@/lib/security/policy";

export const metadata: Metadata = {
  title: "Create a new test version",
  description:
    "Publish an updated immutable version without changing earlier results.",
};

export default async function EditTestPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await getPublicBenchmarkPage(slug).catch(() => null);
  const current = data?.versions[0];
  if (!data || !current) notFound();

  let successCriteria: unknown;
  try {
    successCriteria = JSON.parse(String(current.success_criteria_json));
  } catch {
    notFound();
  }
  const source = communityTestDraftSchema.safeParse({
    category: current.category,
    goal: current.goal,
    prompt: current.canonical_prompt,
    successCriteria,
    title: current.title,
  });
  if (!source.success) notFound();

  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="inner-page section-wrap">
        <div className="showcase-breadcrumbs">
          <Link href="/tests">Tests</Link>
          <span>/</span>
          <Link href={`/tests/${slug}`}>{source.data.title}</Link>
          <span>/</span>
          <span>New version</span>
        </div>
        <header className="page-title">
          <span className="section-index">IMMUTABLE VERSIONING</span>
          <h1>Create the next version.</h1>
          <p>
            Version {Number(current.version)} and every result attached to it
            stay unchanged. Only the approved new version becomes available for
            future submissions.
          </p>
        </header>
        <TestCreator
          authConfigured={isClerkConfigured()}
          sourceTest={{
            id: data.benchmark.id,
            ...source.data,
            version: Number(current.version),
          }}
        />
      </main>
      <SiteFooter />
    </div>
  );
}

