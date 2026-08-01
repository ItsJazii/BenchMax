import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";

export const metadata: Metadata = {
  title: "Methodology",
  description:
    "How Benchmax publishes community model results, judges evidence, and creates per-test rankings.",
};

export default function MethodologyPage() {
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="inner-page section-wrap">
        <header className="page-title">
          <span className="section-index">PUBLIC RESULT PROTOCOL</span>
          <h1>Evidence first. Ranking second.</h1>
          <p>
            Benchmax hosts community-run model tests. It does not call the model
            being tested and never asks contributors for a tested-model API key.
          </p>
        </header>
        <section className="method-section">
          <span className="section-index">01 / TEST CONTRACT</span>
          <h2>Every result points to one frozen test version.</h2>
          <p>
            The test records its goal, exact prompt, success criteria, and
            rubric. Editing any scoring-relevant part creates a new version so
            incompatible results are not ranked together.
          </p>
        </section>
        <section className="method-section">
          <span className="section-index">02 / SUBMISSION</span>
          <h2>The contributor declares the exact configuration.</h2>
          <p>
            A result records model family and version, reasoning level, harness
            and version, prompt context, settings, and evidence. Evidence may be
            code, images, video, or logs. Missing catalog entries are accepted
            publicly but held out of ranking until mapped.
          </p>
          <p>
            These configuration fields are always labeled <strong>declared,
            unverified</strong>. Benchmax cannot prove that the named model,
            reasoning level, harness, or settings produced the submitted files.
            Catalog mapping standardizes names; it does not verify the run.
          </p>
        </section>
        <section className="method-section">
          <span className="section-index">03 / PUBLICATION</span>
          <h2>Safe results appear before AI judging finishes.</h2>
          <p>
            Files enter quarantine first. After type, path, archive, malware,
            and secret checks pass, the result is published with a visible
            pending-review state. The result remains public whether it later
            ranks or not.
          </p>
        </section>
        <section className="method-section">
          <span className="section-index">04 / AI JUDGE</span>
          <h2>Review can take up to 24 hours.</h2>
          <p>
            The pinned judge receives the frozen rubric and bounded,
            identity-blinded evidence. Submitted content is treated as
            untrusted data. Objective evaluator output is included when a safe,
            executable source bundle and compatible environment are available.
          </p>
        </section>
        <section className="method-section">
          <span className="section-index">05 / RANKING</span>
          <h2>One immutable leaderboard snapshot per test version.</h2>
          <p>
            Eligible results rank by score within the same test and judge
            version. Equal scores share a rank. Initial review uses one judge
            sample; top-ten results are rechecked to three samples before the
            leaderboard settles. Every published snapshot is retained.
          </p>
        </section>
        <section className="method-section">
          <span className="section-index">06 / INTERPRETATION RISK</span>
          <h2>A high score is evidence quality, not independent reproduction.</h2>
          <p>
            A contributor can run a model many times and submit only the best
            output. Benchmax does not observe the unsubmitted attempts, so
            best-of-N cherry-picking cannot be detected or corrected. Treat a
            ranking as a comparison of the submitted evidence under one frozen
            test and judge version, not as a verified estimate of pass@1 model
            performance.
          </p>
        </section>
        <section className="method-section">
          <span className="section-index">07 / STATES</span>
          <h2>The public label says what is actually known.</h2>
          <div className="review-summary">
            {[
              ["Pending AI review", "Public, safe, and waiting for judgment."],
              ["Delayed", "The 24-hour target passed; the result stays public."],
              ["Ranked", "Scored, catalog-mapped, eligible, and in a snapshot."],
              ["Not ranked", "Scored or failed review but excluded with a reason."],
            ].map(([title, description]) => (
              <div key={title}>
                <strong>{title}</strong>
                <small>{description}</small>
              </div>
            ))}
          </div>
        </section>
        <div className="closing-cta">
          <p>Have a result ready?</p>
          <h2>Put the evidence on the record.</h2>
          <Link className="button button-primary" href="/submit">
            Submit a result
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
