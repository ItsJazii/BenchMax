"use client";

import { SignInButton, useAuth } from "@clerk/clerk-react";
import { useState } from "react";

export function ProposalForm({ authConfigured }: { authConfigured: boolean }) {
  if (!authConfigured) {
    return <div className="security-gate">Proposals are locked until auth is configured.</div>;
  }
  return <ConfiguredProposalForm />;
}

function ConfiguredProposalForm() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [busy, setBusy] = useState(false);
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!isLoaded) return <div className="wizard-loading">Checking session…</div>;
  if (!isSignedIn) {
    return (
      <div className="sign-in-gate">
        <h2>Sign in to submit a proposal.</h2>
        <SignInButton mode="modal">
          <button className="button button-primary" type="button">Sign in</button>
        </SignInButton>
      </div>
    );
  }
  if (proposalId) {
    return (
      <div className="wizard-panel success-panel">
        <span className="success-mark">✓</span>
        <h2>Proposal submitted.</h2>
        <p>Reference {proposalId}. Owner approval is still required.</p>
      </div>
    );
  }
  return (
    <form
      className="wizard-panel"
      action={(form) => {
        void (async () => {
          setBusy(true);
          setError(null);
          try {
            const token = await getToken();
            if (!token) throw new Error("Your session expired.");
            const response = await fetch("/api/proposals", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                title: String(form.get("title") ?? ""),
                category: String(form.get("category") ?? ""),
                canonicalPrompt: String(form.get("canonicalPrompt") ?? ""),
                rationale: String(form.get("rationale") ?? ""),
                requiredOutputs: String(form.get("requiredOutputs") ?? "")
                  .split("\n")
                  .map((value) => value.trim())
                  .filter(Boolean),
                rubric: [
                  {
                    key: "functional-completeness",
                    title: "Functional completeness",
                    description: "Required behavior works under scripted checks.",
                    mechanism: "objective",
                    weightBps: 3500,
                    judgeSourceRequired: false,
                  },
                  {
                    key: "information-design",
                    title: "Information design",
                    description: "Content and controls communicate a clear hierarchy.",
                    mechanism: "judge",
                    weightBps: 2500,
                    judgeSourceRequired: false,
                  },
                  {
                    key: "visual-quality",
                    title: "Visual quality",
                    description: "The rendered result is coherent and polished.",
                    mechanism: "judge",
                    weightBps: 2000,
                    judgeSourceRequired: false,
                  },
                  {
                    key: "resilience",
                    title: "Resilience and accessibility",
                    description: "The result handles viewport and accessibility requirements.",
                    mechanism: "hybrid",
                    weightBps: 2000,
                    judgeSourceRequired: true,
                  },
                ],
              }),
            });
            const payload = (await response.json()) as {
              proposal?: { id: string };
              error?: string;
            };
            if (!response.ok || !payload.proposal) {
              throw new Error(payload.error ?? "Could not submit proposal.");
            }
            setProposalId(payload.proposal.id);
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Request failed.");
          } finally {
            setBusy(false);
          }
        })();
      }}
    >
      <div className="field-grid">
        <label className="field-wide">
          <span>Title</span>
          <input name="title" minLength={8} maxLength={120} required />
        </label>
        <label>
          <span>Category</span>
          <select name="category">
            <option value="frontend">Frontend</option>
            <option value="browser-game">Browser game</option>
            <option value="browser-3d">Browser 3D</option>
          </select>
        </label>
        <label className="field-wide">
          <span>Canonical prompt</span>
          <textarea name="canonicalPrompt" minLength={50} maxLength={40000} rows={10} required />
        </label>
        <label className="field-wide">
          <span>Why this measures something useful</span>
          <textarea name="rationale" minLength={30} maxLength={4000} rows={6} required />
        </label>
        <label className="field-wide">
          <span>Required outputs, one per line</span>
          <textarea name="requiredOutputs" minLength={2} maxLength={3000} rows={6} required />
        </label>
      </div>
      <p className="form-note">
        The initial rubric is explicit and totals 100%. Approval records a
        review decision but does not bypass evaluator implementation.
      </p>
      <button className="button button-primary" disabled={busy} type="submit">
        {busy ? "Submitting…" : "Submit for owner review"}
      </button>
      {error && <p className="form-error">{error}</p>}
    </form>
  );
}
