import type { Metadata } from "next";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";
import { isClerkConfigured } from "@/lib/auth/server";
import { ProposalForm } from "./ProposalForm";

export const metadata: Metadata = {
  title: "Propose a benchmark",
  description: "Submit a structured benchmark proposal for owner review.",
};

export default function NewProposalPage() {
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="inner-page section-wrap">
        <header className="page-title">
          <span className="section-index">COMMUNITY PROPOSAL</span>
          <h1>Propose the next benchmark.</h1>
          <p>
            Proposals never activate automatically. The owner reviews the
            prompt, outputs, rubric, evaluator feasibility, and contamination
            plan before versioning anything.
          </p>
        </header>
        <ProposalForm authConfigured={isClerkConfigured()} />
      </main>
      <SiteFooter />
    </div>
  );
}
