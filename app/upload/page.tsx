import type { Metadata } from "next";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";
import { UploadWizard } from "./UploadWizard";
import { isClerkConfigured } from "@/lib/auth/server";

export const metadata: Metadata = {
  title: "Upload a test",
  description:
    "Create a public Benchmax Test Report with prompt, model settings, source, screenshots, and video evidence.",
};

export default function UploadPage() {
  const authConfigured = isClerkConfigured();
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="upload-page section-wrap">
        <header className="upload-title">
          <span className="section-index">CREATE A TEST REPORT</span>
          <h1>Put your model test on the record.</h1>
          <p>
            Describe the exact setup, then attach the evidence. Every upload is
            quarantined and scanned before it can be published.
          </p>
        </header>
        <UploadWizard authConfigured={authConfigured} />
      </main>
      <SiteFooter />
    </div>
  );
}
