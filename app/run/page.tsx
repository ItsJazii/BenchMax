import type { Metadata } from "next";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";
import { isClerkConfigured } from "@/lib/auth/server";
import { RunWizard } from "./RunWizard";

export const metadata: Metadata = {
  title: "Run a benchmark",
  description:
    "Launch a platform-generated pass@1 benchmark run with a frozen prompt, harness, environment, and scoring protocol.",
};

export default function RunPage() {
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="upload-page section-wrap">
        <header className="upload-title">
          <span className="section-index">PLATFORM-GENERATED BENCHMARK</span>
          <h1>Run one controlled benchmark.</h1>
          <p>
            Choose a frozen benchmark and exact model configuration. Benchmax
            handles generation, isolated execution, scoring, and publication
            in one recorded attempt.
          </p>
        </header>
        <RunWizard authConfigured={isClerkConfigured()} />
      </main>
      <SiteFooter />
    </div>
  );
}
