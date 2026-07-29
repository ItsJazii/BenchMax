import type { Metadata } from "next";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";
import { isClerkConfigured } from "@/lib/auth/server";
import { RunWizard } from "./RunWizard";

export const metadata: Metadata = {
  title: "Launch benchmark run",
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
          <h1>Launch one honest attempt.</h1>
          <p>
            Pick a frozen benchmark and exact configuration. Benchmax performs
            generation, isolated execution, three-sample judging, and
            publication. There is no hidden retry path.
          </p>
        </header>
        <RunWizard authConfigured={isClerkConfigured()} />
      </main>
      <SiteFooter />
    </div>
  );
}
