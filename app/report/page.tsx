import type { Metadata } from "next";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";
import { ReportForm } from "./ReportForm";
import { isClerkConfigured } from "@/lib/auth/server";

export const metadata: Metadata = {
  title: "Report content",
  description:
    "Report malware, fraud, copyright issues, harassment, or unsafe Benchmax content.",
};

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ target?: string }>;
}) {
  const authConfigured = isClerkConfigured();
  const { target = "" } = await searchParams;
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="inner-page section-wrap">
        <header className="page-title">
          <span className="section-index">TRUST & SAFETY</span>
          <h1>Report unsafe or dishonest content.</h1>
          <p>
            Reports enter the moderator audit queue. Do not paste malware,
            credentials, or private personal information.
          </p>
        </header>
        <ReportForm
          authConfigured={authConfigured}
          initialTarget={target.slice(0, 500)}
        />
      </main>
      <SiteFooter />
    </div>
  );
}
