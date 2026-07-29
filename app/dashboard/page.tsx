import type { Metadata } from "next";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";
import { isClerkConfigured } from "@/lib/auth/server";
import { Dashboard } from "./Dashboard";

export const metadata: Metadata = {
  title: "Dashboard",
  robots: { index: false, follow: false },
};

export default function DashboardPage() {
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="inner-page section-wrap">
        <header className="page-title">
          <span className="section-index">PRIVATE WORKSPACE</span>
          <h1>Your tests and runs.</h1>
          <p>
            Drafts, safety status, generation progress, run history, and
            admin-granted credit balance.
          </p>
        </header>
        <Dashboard authConfigured={isClerkConfigured()} />
      </main>
      <SiteFooter />
    </div>
  );
}
