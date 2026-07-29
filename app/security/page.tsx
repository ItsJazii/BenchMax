import type { Metadata } from "next";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";

export const metadata: Metadata = {
  title: "Security",
  description:
    "Benchmax security boundaries for accounts, uploads, execution, and public evidence.",
};

export default function SecurityPage() {
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="inner-page security-page section-wrap">
        <header className="page-title">
          <span className="section-index">SECURITY MODEL / V0.1</span>
          <h1>Untrusted by default.</h1>
          <p>
            Community code and media never earn trust because they look
            plausible. Every boundary is explicit and publishing fails closed.
          </p>
        </header>
        <div className="security-grid">
          {[
            [
              "01",
              "Identity",
              "Google, GitHub, and email-code sessions are verified server-side, and writes require a verified email. Authorization never relies on hidden buttons or client state.",
            ],
            [
              "02",
              "Quarantine",
              "Uploads enter a private object prefix. Size, declared type, signature, archive paths, expansion, executable types, and secret patterns are checked before approval.",
            ],
            [
              "03",
              "No main-origin execution",
              "Community uploads never execute. Platform-generated playable output uses a separate cookieless user-content Worker with network-blocking CSP and an iframe restricted to scripts only.",
            ],
            [
              "04",
              "Minimal data",
              "Benchmax stores the auth provider subject and public profile—not contributor email addresses or provider API keys.",
            ],
            [
              "05",
              "Auditability",
              "Profile creation, draft creation, uploads, scans, publication, moderation, and future scoring changes append audit events.",
            ],
            [
              "06",
              "Rate and spend limits",
              "Write limits, submission and account storage quotas, daily run caps, per-run generation budgets, escrowed credits, and queue backpressure are enforced server-side.",
            ],
          ].map(([number, title, body]) => (
            <article key={number}>
              <span>{number}</span>
              <h2>{title}</h2>
              <p>{body}</p>
            </article>
          ))}
        </div>
        <section className="security-disclosure">
          <span className="section-index">RESPONSIBLE DISCLOSURE</span>
          <h2>Found a security issue?</h2>
          <p>
            Do not include secrets, exploit payloads, or personal data in a
            public report. The private disclosure channel will be published
            before external accounts are enabled.
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
