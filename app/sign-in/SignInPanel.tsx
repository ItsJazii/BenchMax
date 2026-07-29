"use client";

import { SignIn } from "@clerk/clerk-react";

export function SignInPanel({ configured }: { configured: boolean }) {
  if (!configured) {
    return (
      <div className="auth-unavailable">
        <span className="status-pill pending">Fail closed</span>
        <h2>Authentication is not connected yet.</h2>
        <p>
          Sign-up stays disabled until verified production credentials are
          installed. Benchmax never falls back to insecure demo accounts.
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
