import type { Metadata } from "next";
import { SignInPanel } from "./SignInPanel";
import { SiteHeader } from "@/app/components/SiteHeader";
import { isClerkConfigured } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="auth-page section-wrap">
        <div className="auth-copy">
          <span className="section-index">CONTRIBUTOR ACCESS</span>
          <h1>Publish and manage your model tests.</h1>
          <p>
            Sign in with Google, GitHub, or a one-time email code. Browsing
            remains public.
          </p>
          <ul>
            <li>Benchmax never stores your password</li>
            <li>Uploads require a verified account</li>
            <li>Every published test has a clear owner</li>
          </ul>
        </div>
        <SignInPanel
          configured={isClerkConfigured()}
        />
      </main>
    </div>
  );
}
