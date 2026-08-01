import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";
import { isClerkConfigured } from "@/lib/auth/server";
import { listCommunityTests } from "@/lib/data/community-tests";
import { TestCreator } from "./TestCreator";

export const metadata: Metadata = {
  title: "Community tests",
  description:
    "Create a public test contract or choose an existing test for a model result.",
};

export default async function TestsPage() {
  const tests = await listCommunityTests().catch(() => []);
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="inner-page section-wrap">
        <header className="page-title">
          <span className="section-index">COMMUNITY TESTS</span>
          <h1>Add the tests that matter.</h1>
          <p>
            Define the prompt, goal, and success criteria once. Every result is
            judged against that frozen test version.
          </p>
        </header>
        {tests.length > 0 && (
          <section className="benchmark-version-list">
            {tests.map((test) => (
              <article key={test.versionId}>
                <div>
                  <strong>
                    <Link href={`/tests/${test.slug}?version=${test.version}`}>
                      {test.title}
                    </Link>
                  </strong>
                  <span className="status-pill approved">v{test.version}</span>
                </div>
                <p>{test.goal}</p>
                <small>
                  Added by {test.creator ? `@${test.creator}` : "Benchmax"} ·{" "}
                  {test.category}
                </small>
                <Link
                  className="text-link"
                  href={`/submit?test=${encodeURIComponent(test.versionId)}`}
                >
                  Submit a result →
                </Link>
              </article>
            ))}
          </section>
        )}
        <section className="latest">
          <div className="section-heading compact">
            <div>
              <span className="section-index">CREATE A TEST</span>
              <h2>Turn a real prompt into a shared benchmark.</h2>
            </div>
          </div>
          <TestCreator authConfigured={isClerkConfigured()} />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
