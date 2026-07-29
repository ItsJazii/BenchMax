"use client";

import { SignInButton, useAuth } from "@clerk/clerk-react";
import { useState } from "react";

export function ReportForm({
  authConfigured,
  initialTarget = "",
}: {
  authConfigured: boolean;
  initialTarget?: string;
}) {
  if (!authConfigured) {
    return (
      <div className="security-gate">
        <span className="gate-icon" aria-hidden="true">
          !
        </span>
        <div>
          <strong>Reporting is locked until verified auth is connected.</strong>
          <p>
            Benchmax does not accept anonymous reports because the moderation
            channel itself must resist spam and abuse.
          </p>
        </div>
        <span className="status-pill pending">Fail closed</span>
      </div>
    );
  }
  return <AuthenticatedReportForm initialTarget={initialTarget} />;
}

function AuthenticatedReportForm({ initialTarget }: { initialTarget: string }) {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);

  if (!isLoaded) {
    return <div className="wizard-loading">Checking your secure session…</div>;
  }
  if (!isSignedIn) {
    return (
      <div className="sign-in-gate">
        <span className="section-index">ACCOUNT REQUIRED</span>
        <h2>Sign in to file a report.</h2>
        <p>
          Your public email is never added to the report. Account identity is
          retained only for rate limiting, follow-up, and abuse prevention.
        </p>
        <SignInButton mode="modal">
          <button className="button button-primary" type="button">
            Sign in to report
          </button>
        </SignInButton>
      </div>
    );
  }
  if (reportId) {
    return (
      <section className="wizard-panel success-panel">
        <span className="success-mark">✓</span>
        <span className="section-index">REPORT RECEIVED</span>
        <h2>Moderators have the case.</h2>
        <p>
          Reference <code>{reportId}</code>. Reports never remove content
          automatically; a moderator must review the evidence and audit trail.
        </p>
      </section>
    );
  }

  async function submit(form: FormData) {
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Your session expired. Sign in again.");
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: String(form.get("url") ?? ""),
          reason: String(form.get("reason") ?? ""),
          details: String(form.get("details") ?? ""),
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        report?: { id: string };
      };
      if (!response.ok || !payload.report) {
        throw new Error(payload.error ?? "Could not create the report.");
      }
      setReportId(payload.report.id);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not create the report.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="report-form" action={(form) => void submit(form)}>
      <label>
        <span>Benchmax showcase or run URL</span>
        <input
          autoComplete="url"
          defaultValue={initialTarget}
          maxLength={500}
          name="url"
          placeholder="/showcases/... or /runs/..."
          required
          type="text"
        />
      </label>
      <label>
        <span>Reason</span>
        <select name="reason" required>
          <option value="malware">Malware or unsafe code</option>
          <option value="fraud">False or manipulated evidence</option>
          <option value="copyright">Copyright or ownership</option>
          <option value="harassment">Harassment or personal data</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label>
        <span>What should moderators review?</span>
        <textarea
          maxLength={2000}
          minLength={10}
          name="details"
          placeholder="Describe the issue without including harmful payloads or private information."
          required
          rows={7}
        />
      </label>
      <button className="button button-primary" disabled={busy} type="submit">
        {busy ? "Sending securely…" : "Submit report"}
      </button>
      <p className="form-note">
        Limit: five reports per account per day. Credentials and secret-like
        text are rejected before storage.
      </p>
      {error && <p className="form-error">{error}</p>}
    </form>
  );
}
