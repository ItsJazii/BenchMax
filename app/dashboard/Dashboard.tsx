"use client";

import { SignInButton, useAuth } from "@clerk/clerk-react";
import Link from "next/link";
import { useEffect, useState } from "react";

type DashboardData = {
  profile: { displayName: string; handle: string; role: string };
  creditBalance: number;
  runs: Array<{
    id: string;
    publicSlug: string;
    status: string;
    score: number | null;
    benchmark: string;
    model: string;
    reasoningLevel: string;
  }>;
  showcases: Array<{
    id: string;
    slug: string;
    title: string;
    status: string;
    safetyStatus: string;
  }>;
};

export function Dashboard({ authConfigured }: { authConfigured: boolean }) {
  if (!authConfigured) {
    return (
      <div className="security-gate">
        <strong>The contributor dashboard is not available yet.</strong>
        <p>It will open when verified sign-in and uploads are enabled.</p>
        <span className="status-pill pending">Coming soon</span>
      </div>
    );
  }
  return <ConfiguredDashboard />;
}

function ConfiguredDashboard() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!isSignedIn) return;
    void (async () => {
      try {
        const token = await getToken();
        if (!token) throw new Error("Your session expired.");
        const response = await fetch("/api/dashboard", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const payload = (await response.json()) as {
          dashboard?: DashboardData;
          error?: string;
        };
        if (!response.ok || !payload.dashboard) {
          throw new Error(payload.error ?? "Could not load dashboard.");
        }
        setData(payload.dashboard);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Request failed.");
      }
    })();
  }, [getToken, isSignedIn]);

  if (!isLoaded) return <div className="wizard-loading">Checking session…</div>;
  if (!isSignedIn) {
    return (
      <div className="sign-in-gate">
        <h2>Sign in to open your private workspace.</h2>
        <SignInButton mode="modal">
          <button className="button button-primary" type="button">Sign in</button>
        </SignInButton>
      </div>
    );
  }
  if (!data) return <div className="security-gate">{error ?? "Loading…"}</div>;
  return (
    <div className="dashboard-grid">
      <section className="dashboard-summary">
        <span className="section-index">@{data.profile.handle}</span>
        <h2>{data.profile.displayName}</h2>
        <p>{data.profile.role}</p>
        <strong>{data.creditBalance.toLocaleString()} milli-credits</strong>
        <small>Admin-granted balance. Credits cannot be purchased.</small>
      </section>
      <section>
        <div className="section-heading compact">
          <h2>Benchmark runs</h2>
          <Link href="/run">Launch run →</Link>
        </div>
        <div className="dashboard-list">
          {data.runs.map((run) => (
            <article key={run.id}>
              <div>
                <strong>{run.model} · {run.reasoningLevel}</strong>
                <p>{run.benchmark}</p>
              </div>
              <span className="status-pill neutral">{run.status}</span>
              {run.status === "published" && (
                <Link href={`/runs/${run.publicSlug}`}>Open →</Link>
              )}
            </article>
          ))}
          {data.runs.length === 0 && <p className="muted">No runs yet.</p>}
        </div>
      </section>
      <section>
        <div className="section-heading compact">
          <h2>Community tests</h2>
          <Link href="/upload">Upload a test →</Link>
        </div>
        <div className="dashboard-list">
          {data.showcases.map((showcase) => (
            <article key={showcase.id}>
              <div>
                <strong>{showcase.title}</strong>
                <p>{showcase.safetyStatus}</p>
              </div>
              <span className="status-pill neutral">{showcase.status}</span>
              {showcase.status === "published" && (
                <Link href={`/showcases/${showcase.slug}`}>Open →</Link>
              )}
            </article>
          ))}
          {data.showcases.length === 0 && <p className="muted">No community tests yet.</p>}
        </div>
      </section>
    </div>
  );
}
