import type { Metadata } from "next";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="inner-page section-wrap legal-page">
        <header className="page-title">
          <span className="section-index">PRIVACY</span>
          <h1>Public evidence, minimal account data.</h1>
          <p>
            Benchmax minimizes account data and separates public evidence from
            private provenance.
          </p>
        </header>
        <section>
          <h2>No tested-model credentials</h2>
          <p>
            Benchmax does not call the model you tested and does not request,
            transmit, or store its provider API key. The only model credential
            used by the service is the operator-managed credential for the
            pinned AI judge.
          </p>
        </section>
        <section>
          <h2>Public and private records</h2>
          <p>
            Public result pages contain the submitted description, declared
            model configuration, settings, timestamps, status, score, and safe
            artifact metadata. Private source bytes and internal object keys
            are never exposed as public fields.
          </p>
        </section>
        <section>
          <h2>Accounts</h2>
          <p>
            Benchmax stores the Clerk subject needed to own records, a public
            handle and display name, role, status, rate-limit records, and the
            audit trail required for integrity. It does not copy your email
            address into the Benchmax user table.
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
