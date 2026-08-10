import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";

export const metadata: Metadata = {
  title: "Methodology",
  description:
    "How Benchmax publishes contributor-submitted AI Tests and adds reviews later.",
};

export default function MethodologyPage() {
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="inner-page section-wrap">
        <header className="page-title">
          <span className="section-index">PUBLIC TEST PROTOCOL</span>
          <h1>Publish the evidence. Review it later.</h1>
          <p>
            Benchmax hosts Tests run and submitted by contributors. It does not
            call the tested model or ask for that model&apos;s API key.
          </p>
        </header>

        <section className="method-section">
          <span className="section-index">01 / ONE TEST</span>
          <h2>One submission creates one public Test.</h2>
          <p>
            The contributor records the prompt, model and version, harness,
            reasoning, optional settings and notes, and the output evidence.
            There is no separate reusable-test or rubric-approval flow.
          </p>
        </section>

        <section className="method-section">
          <span className="section-index">02 / DECLARED SETUP</span>
          <h2>Attribution is visible, and the honesty label is explicit.</h2>
          <p>
            Model, harness, reasoning, and settings are labeled{" "}
            <strong>
              Declared by contributor — not independently verified
            </strong>
            . Benchmax preserves free-text names even when they are not in a
            catalog.
          </p>
        </section>

        <section className="method-section">
          <span className="section-index">03 / SAFETY</span>
          <h2>Mandatory evidence checks happen before publication.</h2>
          <p>
            Files enter quarantine for type, archive, executable, path, secret,
            and abuse checks. A safe Test becomes public as Awaiting review. A
            blocked Test remains private to its contributor and admins.
          </p>
        </section>

        <section className="method-section">
          <span className="section-index">04 / AUTOMATED PREVIEW</span>
          <h2>Compatible source ZIPs receive non-blocking enrichment.</h2>
          <p>
            A safe Test publishes first. Sandbox-generated screenshots, video,
            console, and accessibility evidence attach afterward when
            available. Enrichment failure never removes the Test.
          </p>
        </section>

        <section className="method-section">
          <span className="section-index">05 / REVIEW AND RANKING</span>
          <h2>Reviews add context without changing the submission.</h2>
          <p>
            AI and trusted human reviews are a later layer. Only reviewed,
            eligible Tests can become Ranked; unreviewed Tests stay visible in
            All Tests.
          </p>
        </section>

        <section className="method-section">
          <span className="section-index">06 / PUBLIC STATES</span>
          <h2>The main label stays simple.</h2>
          <div className="review-summary">
            {[
              ["Awaiting review", "Public, safe, and not scored yet."],
              ["Reviewed", "Has one or more AI or human reviews."],
              ["Ranked", "Eligible and included in a leaderboard."],
            ].map(([title, description]) => (
              <div key={title}>
                <strong>{title}</strong>
                <small>{description}</small>
              </div>
            ))}
          </div>
          <p>
            Processing, Processing failed, and Blocked are private contributor
            or admin states and do not appear as public feed items.
          </p>
        </section>

        <div className="closing-cta">
          <p>Have a Test ready?</p>
          <h2>Put the prompt, setup, and evidence on the record.</h2>
          <Link className="button button-primary" href="/submit">
            Submit a Test
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
