import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";

export const metadata: Metadata = {
  title: "Terms and submission license",
};

export default function TermsPage() {
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="inner-page section-wrap legal-page">
        <header className="page-title">
          <span className="section-index">TERMS</span>
          <h1>Rights before reach.</h1>
          <p>
            These launch terms describe what contributors may submit and what
            Benchmax needs permission to do with it.
          </p>
        </header>
        <section>
          <h2>Submission rights and license</h2>
          <p>
            You must own the submitted material or have permission to submit
            it. By publishing a Test Report, you grant Benchmax a worldwide,
            non-exclusive license to store, scan, reproduce, execute where the
            product clearly says it will, and publicly display the submission
            for operating and documenting the service.
          </p>
        </section>
        <section>
          <h2>Submitted model output</h2>
          <p>
            You remain responsible for complying with the tested model and
            harness terms, removing secrets and personal data, and confirming
            that the evidence accurately represents the declared test.
          </p>
        </section>
        <section>
          <h2>Safety, removal, and disputes</h2>
          <p>
            Benchmax may quarantine, reject, unpublish, or disqualify content
            that is unsafe, infringing, deceptive, or inconsistent with the
            published protocol. Moderator actions preserve an audit record.
          </p>
          <Link href="/report">Copyright, DMCA, and safety report →</Link>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
