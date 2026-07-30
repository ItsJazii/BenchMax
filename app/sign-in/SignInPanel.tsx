"use client";

import { SignIn } from "@clerk/clerk-react";

export function SignInPanel({ configured }: { configured: boolean }) {
  if (!configured) {
    return (
      <div className="auth-unavailable">
        <span className="status-pill pending">Coming soon</span>
        <h2>Sign-in is not available yet.</h2>
        <p>
          Account creation will open after verified sign-in is ready. Until
          then, browsing stays public and uploads remain disabled.
        </p>
      </div>
    );
  }
  return (
    <div className="clerk-panel">
      <SignIn routing="hash" />
    </div>
  );
}
