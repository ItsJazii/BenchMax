import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";

export const metadata: Metadata = {
  title: "Leaderboards",
  description:
    "Top-rated public AI Test submissions, added after trustworthy reviews.",
};

export default function LeaderboardsPage() {
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="inner-page section-wrap">
        <header className="page-title split-title">
          <div>
            <span className="section-index">LEADERBOARDS</span>
            <h1>Rankings come after trustworthy reviews.</h1>
          </div>
          <p>
            This will be a showcase of top-rated submissions across different
            prompts, not a scientific like-for-like model benchmark.
          </p>
        </header>
        <div className="empty-state">
          <strong>No ranked Tests yet.</strong>
          <p>
            All safe Tests remain public while Benchmax adds AI and trusted
            human review. A score is never required to appear on All Tests.
          </p>
          <div>
            <Link className="button button-secondary" href="/tests">
              Browse All Tests
            </Link>
            <Link className="button button-primary" href="/submit">
              Submit a Test
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
