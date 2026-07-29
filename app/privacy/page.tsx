import type { Metadata } from "next";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";

export const metadata: Metadata = { title: "Privacy and BYOK handling" };

export default function PrivacyPage() {
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="inner-page section-wrap legal-page">
        <header className="page-title">
          <span className="section-index">PRIVACY</span>
          <h1>The key is not a record.</h1>
          <p>
            Benchmax minimizes account data and separates public evidence from
            private provenance.
          </p>
        </header>
        <section>
          <h2>BYOK handling policy</h2>
          <p>
            BYOK keys are never persisted, anywhere. A key lives solely in the
            memory of one run&apos;s GenerationSession Durable Object, is never
            written to D1, R2, logs, analytics, or a queue, and is destroyed
            when generation completes, the connection closes, or the job
            fails. Evaluation starts only after the key is gone.
          </p>
        </section>
        <section>
          <h2>Public and private records</h2>
          <p>
            Public run pages contain a redacted transcript, hashes, resolved
            model configuration, settings, timestamps, and evaluation
            artifacts. Raw provider request and response envelopes remain
            private and encrypted at rest. Authorization headers and provider
            account metadata are not public fields.
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
