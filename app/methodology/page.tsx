import type { Metadata } from "next";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";

export const metadata: Metadata = {
  title: "Methodology",
  description:
    "How Benchmax verifies generation provenance, evaluates outputs, and calculates rankings.",
};

const principles = [
  {
    number: "01",
    title: "Uploaded tests never affect rankings",
    body: "Community work remains useful public evidence, but only runs generated and evaluated by Benchmax can change a leaderboard.",
  },
  {
    number: "02",
    title: "Every configuration stays separate",
    body: "Model version, endpoint, harness, reasoning level, sampling settings, and benchmark version define one row. Different test conditions are never silently merged.",
  },
  {
    number: "03",
    title: "Objective checks come first",
    body: "Build stability, scripted interaction, console errors, accessibility, bundle size, and bounded performance measurements make up 60% of the default score.",
  },
  {
    number: "04",
    title: "AI judging is fixed and blinded",
    body: "The judge never receives the tested model or contributor identity. Its prompt, rubric, version, samples, and any moderator override remain auditable.",
  },
];

export default function MethodologyPage() {
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="inner-page methodology-page section-wrap">
        <header className="page-title">
          <span className="section-index">PUBLISHED METHODOLOGY / V0.1</span>
          <h1>How Benchmax verifies every ranked run.</h1>
          <p>
            Uploaded tests show what people built. Rankings require more:
            Benchmax must generate, execute, and score the work under one
            frozen, inspectable contract.
          </p>
        </header>

        <section className="method-principles">
          {principles.map((principle) => (
            <article key={principle.number}>
              <span>{principle.number}</span>
              <div>
                <h2>{principle.title}</h2>
                <p>{principle.body}</p>
              </div>
            </article>
          ))}
        </section>

        <section className="method-flow">
          <div className="section-heading compact">
            <div>
              <span className="section-index">PLATFORM RUN FLOW</span>
              <h2>One fixed path from prompt to score.</h2>
            </div>
          </div>
          <div className="flow-steps">
            {[
              ["1", "Generate", "Pinned prompt and single-attempt policy"],
              ["2", "Execute", "Isolated environment with network disabled"],
              ["3", "Measure", "Objective checks and fixed captures"],
              ["4", "Judge", "Three blinded rubric samples"],
              ["5", "Publish", "Artifacts, scores, provenance, and audit trail"],
            ].map(([number, title, copy]) => (
              <div key={number}>
                <span>{number}</span>
                <strong>{title}</strong>
                <p>{copy}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="score-formula">
          <div>
            <span>DEFAULT SCORE</span>
            <strong>60 / 40</strong>
          </div>
          <div>
            <h2>Objective checks / blinded judgment</h2>
            <p>
              A benchmark may redistribute dimensions, but weights freeze once
              runs exist. Cross-version results are never merged.
            </p>
          </div>
        </section>

        <section className="aggregation-block">
          <h2>Ranking aggregation</h2>
          <div className="aggregation-grid">
            <div>
              <span>RUN SCORE</span>
              <p>
                Median across all platform-generated runs for one exact
                configuration and benchmark version, with N and IQR shown.
              </p>
            </div>
            <div>
              <span>CATEGORY SCORE</span>
              <p>
                Equal-weight mean of benchmark medians so one popular benchmark
                cannot dominate a category.
              </p>
            </div>
            <div>
              <span>OVERALL SCORE</span>
              <p>
                Equal-weight mean of eligible categories, provisional until
                coverage requirements are met.
              </p>
            </div>
          </div>
        </section>

        <section className="legal-page methodology-policy">
          <section>
            <span className="section-index">BYOK HANDLING POLICY</span>
            <h2>The key lives only inside one generation job.</h2>
            <p>
              BYOK keys are never persisted, anywhere. The key lives solely in
              the memory of the run&apos;s GenerationSession Durable Object,
              is destroyed when the session ends for any reason, and is never
              written to a queue, database, object store, log, or analytics
              event. Evaluation is queued only after the key is gone. A failed
              BYOK generation is never silently retried.
            </p>
          </section>
          <section>
            <span className="section-index">JUDGE PROTOCOL</span>
            <h2>Injection screened, blinded, and calibrated.</h2>
            <p>
              Generated text is delimited as untrusted data. Instruction-like
              strings trigger a review flag; model-identifying comments are
              stripped when source is required; exactly three structured
              samples are stored and reduced by per-dimension median. A pinned
              private calibration set is re-judged weekly. Drift beyond the
              frozen threshold freezes judging rather than quietly changing
              scores.
            </p>
          </section>
          <section>
            <span className="section-index">CONTAMINATION POLICY</span>
            <h2>Public prompts decay, so dates stay visible.</h2>
            <p>
              Every benchmark version carries a publication date and model
              versions carry a training cutoff where known. Runs whose cutoff
              postdates the benchmark receive a visible marker. Refreshed
              prompts become new benchmark versions, and scores across
              versions are never merged.
            </p>
          </section>
          <section>
            <span className="section-index">CHANGELOG</span>
            <h2>Methodology v0.1 · 2026-07-29</h2>
            <p>
              Initial protocol: platform-generated pass@1 runs, exact
              configuration rows, 60/40 default scoring, k=3 blinded judging,
              median/IQR aggregation, frozen contracts, and public disputes.
              Future changes will be added here with an effective date and a
              new evaluation or benchmark version where comparability changes.
            </p>
          </section>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
