import type { Metadata } from "next";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";
import { isClerkConfigured } from "@/lib/auth/server";
import { OperationsDashboard } from "./OperationsDashboard";

export const metadata: Metadata = {
  title: "Operations",
  robots: { index: false, follow: false },
};

export default function OperationsPage() {
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="inner-page section-wrap">
        <header className="page-title">
          <span className="section-index">OWNER OPERATIONS</span>
          <h1>Pipeline health and spend.</h1>
          <p>
            Queue stages, run failures, judge state, credit entries, disputes,
            reports, and bounded storage inventory in one role-gated view.
          </p>
        </header>
        <OperationsDashboard authConfigured={isClerkConfigured()} />
      </main>
      <SiteFooter />
    </div>
  );
}
