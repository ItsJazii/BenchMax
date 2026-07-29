import type { Metadata } from "next";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";
import { isClerkConfigured } from "@/lib/auth/server";
import { ModerationConsole } from "./ModerationConsole";

export const metadata: Metadata = {
  title: "Moderation queue",
  robots: { index: false, follow: false },
};

export default function ModerationPage() {
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="inner-page section-wrap">
        <header className="page-title">
          <span className="section-index">ROLE-GATED OPERATIONS</span>
          <h1>Moderation queue.</h1>
          <p>
            Every decision requires an owner or moderator role, a written
            reason, and an append-only action record.
          </p>
        </header>
        <ModerationConsole authConfigured={isClerkConfigured()} />
      </main>
      <SiteFooter />
    </div>
  );
}
