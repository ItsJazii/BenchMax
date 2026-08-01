import type { Metadata } from "next";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader } from "@/app/components/SiteHeader";
import { UploadWizard } from "@/app/upload/UploadWizard";
import { isClerkConfigured } from "@/lib/auth/server";

export const metadata: Metadata = {
  title: "Submit a model result",
  description:
    "Submit code, images, video, or logs from a model test for public evidence and asynchronous AI judging.",
};

export default async function SubmitPage({
  searchParams,
}: {
  searchParams: Promise<{ test?: string }>;
}) {
  const { test } = await searchParams;
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="upload-page section-wrap">
        <header className="upload-title">
          <span className="section-index">SUBMIT A RESULT</span>
          <h1>Put your model test result on the record.</h1>
          <p>
            Choose the test, model version, reasoning level, and harness. Attach
            code, images, video, or logs. The result publishes after safety
            checks; AI judging can take up to 24 hours.
          </p>
        </header>
        <UploadWizard
          authConfigured={isClerkConfigured()}
          initialTestId={test}
        />
      </main>
      <SiteFooter />
    </div>
  );
}
