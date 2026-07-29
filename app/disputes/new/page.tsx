import type { Metadata } from "next";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";
import { isClerkConfigured } from "@/lib/auth/server";
import { DisputeForm } from "./DisputeForm";

export const metadata: Metadata = {
  title: "Open a run dispute",
  description: "Open a public, auditable dispute on a published benchmark run.",
};

export default async function NewDisputePage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string }>;
}) {
  const { run = "" } = await searchParams;
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="inner-page section-wrap">
        <header className="page-title">
          <span className="section-index">PUBLIC DISPUTE</span>
          <h1>Challenge a benchmark run.</h1>
          <p>
            State the evidence and the requested review. The dispute and its
            moderator resolution remain public on the run.
          </p>
        </header>
        <DisputeForm
          authConfigured={isClerkConfigured()}
          runId={run.slice(0, 36)}
        />
      </main>
      <SiteFooter />
    </div>
  );
}
