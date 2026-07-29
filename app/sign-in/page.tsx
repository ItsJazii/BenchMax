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
          <h1>Own the work you put on record.</h1>
          <p>
            Sign in with Google, GitHub, or a one-time email code. Browsing
            remains public.
          </p>
          <ul>
            <li>No password stored by Benchmax</li>
            <li>No anonymous uploads</li>
            <li>Every write tied to an auditable account</li>
          </ul>
        </div>
        <SignInPanel
          configured={isClerkConfigured()}
        />
      </main>
    </div>
  );
}
