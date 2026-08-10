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
          <h1>Your Tests.</h1>
          <p>
            Track private processing, public Awaiting review Tests, reviews,
            and rankings.
          </p>
        </header>
        <Dashboard authConfigured={isClerkConfigured()} />
      </main>
      <SiteFooter />
    </div>
  );
}
