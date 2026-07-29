"use client";

import { SignInButton, useAuth } from "@clerk/clerk-react";
import { useState } from "react";

export function DisputeForm({
  authConfigured,
  runId,
}: {
  authConfigured: boolean;
  runId: string;
}) {
  if (!authConfigured) {
    return <div className="security-gate">Disputes are locked until auth is configured.</div>;
  }
  return <ConfiguredDisputeForm runId={runId} />;
}

function ConfiguredDisputeForm({ runId }: { runId: string }) {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!isLoaded) return <div className="wizard-loading">Checking session…</div>;
  if (!isSignedIn) {
    return (
      <div className="sign-in-gate">
        <h2>Sign in to open a dispute.</h2>
        <SignInButton mode="modal">
          <button className="button button-primary" type="button">
            Sign in
          </button>
        </SignInButton>
      </div>
    );
  }
  if (result) {
    return (
      <div className="wizard-panel success-panel">
        <span className="success-mark">✓</span>
        <h2>Dispute opened.</h2>
        <p>Reference {result}. It is now part of the public run record.</p>
      </div>
    );
  }
  return (
    <form
      className="report-form"
      action={(form) => {
        void (async () => {
          setBusy(true);
          setError(null);
          try {
            const token = await getToken();
            if (!token) throw new Error("Your session expired.");
            const response = await fetch("/api/disputes", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                runId,
                reason: String(form.get("reason") ?? ""),
              }),
            });
            const payload = (await response.json()) as {
              dispute?: { id: string };
              error?: string;
            };
            if (!response.ok || !payload.dispute) {
              throw new Error(payload.error ?? "Could not open dispute.");
            }
            setResult(payload.dispute.id);
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Request failed.");
          } finally {
            setBusy(false);
          }
        })();
      }}
    >
      <label>
        <span>Run ID</span>
        <input name="runId" readOnly value={runId} />
      </label>
      <label>
        <span>Evidence and requested review</span>
        <textarea minLength={20} maxLength={4000} name="reason" required rows={10} />
      </label>
      <button className="button button-primary" disabled={busy} type="submit">
        {busy ? "Opening…" : "Open public dispute"}
      </button>
      {error && <p className="form-error">{error}</p>}
    </form>
  );
}
