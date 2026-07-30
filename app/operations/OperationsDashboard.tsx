"use client";

import { SignInButton, useAuth } from "@clerk/clerk-react";
import { useEffect, useState } from "react";

type Operations = {
  generatedAt: string;
  lifecycle: Array<Record<string, string | number>>;
  stages: Array<Record<string, string | number>>;
  evaluations: Array<Record<string, string | number>>;
  credits: Array<Record<string, string | number>>;
  disputes: Array<Record<string, string | number>>;
  reports: Array<Record<string, string | number>>;
  storage: Array<Record<string, string | number | boolean>>;
};

export function OperationsDashboard({
  authConfigured,
}: {
  authConfigured: boolean;
}) {
  if (!authConfigured) {
    return (
      <div className="security-gate">
        <strong>The operations workspace is unavailable.</strong>
        <p>Verified owner sign-in must be active before this dashboard can open.</p>
        <span className="status-pill pending">Owner only</span>
      </div>
    );
  }
  return <ConfiguredOperationsDashboard />;
}

function ConfiguredOperationsDashboard() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [data, setData] = useState<Operations | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function authorizedFetch(url: string, init: RequestInit = {}) {
    const token = await getToken();
    if (!token) throw new Error("Your session expired.");
    return fetch(url, {
      ...init,
      headers: {
        ...Object.fromEntries(new Headers(init.headers).entries()),
        Authorization: `Bearer ${token}`,
      },
    });
  }

  async function refresh() {
    setError(null);
    try {
      const response = await authorizedFetch("/api/admin/operations");
      const payload = (await response.json()) as {
        operations?: Operations;
        error?: string;
      };
      if (!response.ok || !payload.operations) {
        throw new Error(payload.error ?? "Could not load operations.");
      }
      setData(payload.operations);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed.");
    }
  }

  useEffect(() => {
    if (!isSignedIn) return;
    const timeout = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  async function createManifest() {
    setBusy(true);
    try {
      const response = await authorizedFetch("/api/admin/backup-manifest", {
        method: "POST",
      });
      const payload = (await response.json()) as {
        manifest?: { sha256: string };
        error?: string;
      };
      if (!response.ok || !payload.manifest) {
        throw new Error(payload.error ?? "Could not create manifest.");
      }
      setError(`Backup manifest created: ${payload.manifest.sha256}`);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!isLoaded) return <div className="wizard-loading">Checking session…</div>;
  if (!isSignedIn) {
    return (
      <div className="sign-in-gate">
        <h2>Sign in with the owner account.</h2>
        <SignInButton mode="modal">
          <button className="button button-primary" type="button">Sign in</button>
        </SignInButton>
      </div>
    );
  }
  if (!data) return <div className="security-gate">{error ?? "Loading…"}</div>;
  return (
    <div className="operations-dashboard">
      <div className="wizard-actions">
        <p>Snapshot {data.generatedAt}</p>
        <button className="button button-secondary" onClick={() => void refresh()} type="button">
          Refresh
        </button>
        <button className="button button-primary" disabled={busy} onClick={() => void createManifest()} type="button">
          {busy ? "Writing…" : "Write backup manifest"}
        </button>
      </div>
      {[
        ["Run lifecycle", data.lifecycle],
        ["Queue stages", data.stages],
        ["Judge versions", data.evaluations],
        ["Credit ledger", data.credits],
        ["Disputes", data.disputes],
        ["Abuse reports", data.reports],
        ["R2 inventory", data.storage],
      ].map(([title, rows]) => (
        <section key={title as string}>
          <h2>{title as string}</h2>
          <pre>{JSON.stringify(rows, null, 2)}</pre>
        </section>
      ))}
      {error && <p className="form-note">{error}</p>}
    </div>
  );
}
