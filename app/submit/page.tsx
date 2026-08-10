import type { Metadata } from "next";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";
import { UploadWizard } from "@/app/upload/UploadWizard";
import { isClerkConfigured } from "@/lib/auth/server";

export const metadata: Metadata = {
  title: "Submit a Test",
  description:
    "Submit an AI Test with its prompt, declared setup, and output evidence.",
};

export default function SubmitPage() {
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="upload-page section-wrap">
        <header className="upload-title">
          <span className="section-index">SUBMIT A TEST</span>
          <h1>Share the Test you ran and what the model produced.</h1>
          <p>
            Record the prompt, model, harness, and reasoning, then attach the
            output as code, images, video, or logs. Safe Tests publish as
            Awaiting review.
          </p>
        </header>
        <UploadWizard authConfigured={isClerkConfigured()} />
      </main>
      <SiteFooter />
    </div>
  );
}
