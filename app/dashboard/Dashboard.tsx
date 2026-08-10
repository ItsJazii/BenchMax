"use client";

import { SignInButton, useAuth } from "@clerk/clerk-react";
import Link from "next/link";
import { useEffect, useState } from "react";

type DashboardData = {
  profile: { displayName: string; handle: string; role: string };
  submissions: Array<{
    id: string;
    slug: string;
    title: string;
    benchmark: string | null;
    model: string;
    modelVersion: string | null;
    harness: string;
    reasoning: string;
    scoreBps: number | null;
    rank: number | null;
    judgeDueAt: string | null;
    updatedAt: string;
    state: {
      code: string;
      label: string;
      detail: string;
      tone: "approved" | "blocked" | "neutral" | "pending";
      publicVisible: boolean;
      ranked: boolean;
      blockedReason: string | null;
    };
    timeline: Array<{
      key: string;
      label: string;
      detail: string | null;
      status: "completed" | "failed" | "info" | "pending";
      occurredAt: string;
    }>;
    enrichment: {
      status: string;
      failureCode: string | null;
      canRetry: boolean;
    } | null;
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
  const [retryingId, setRetryingId] = useState<string | null>(null);
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
  const publicCount = data.submissions.filter(
    (submission) => submission.state.publicVisible,
  ).length;
  const rankedCount = data.submissions.filter(
    (submission) => submission.state.ranked,
  ).length;
  return (
    <div className="dashboard-grid">
      <section className="dashboard-summary">
        <span className="section-index">@{data.profile.handle}</span>
        <h2>{data.profile.displayName}</h2>
        <p>{data.profile.role}</p>
        <strong>{data.submissions.length} submitted Tests</strong>
        <small>
          {publicCount} public · {rankedCount} ranked. Safe Tests stay visible
          while awaiting review.
        </small>
      </section>
      <section>
        <div className="section-heading compact">
          <h2>Your Tests</h2>
          <Link href="/submit">Submit Test →</Link>
        </div>
        <div className="dashboard-list">
          {data.submissions.map((submission) => (
            <article className="submission-status-card" key={submission.id}>
              <div className="submission-status-body">
                <strong>{submission.title}</strong>
                <p>
                  {submission.model}
                  {submission.modelVersion ? ` ${submission.modelVersion}` : ""}
                  {` · ${submission.harness} · ${submission.reasoning}`}
                </p>
                <p>{simpleDashboardDetail(submission.state)}</p>
                {submission.enrichment?.status === "failed" && (
                  <p>Automated preview unavailable.</p>
                )}
                {submission.state.blockedReason &&
                  ["Blocked", "Processing failed"].includes(
                    simpleDashboardStatus(submission.state),
                  ) && (
                  <p className="submission-blocked-reason">
                    <strong>Details:</strong>{" "}
                    {submission.state.blockedReason}
                  </p>
                  )}
              </div>
              <span className={`status-pill ${submission.state.tone}`}>
                {simpleDashboardStatus(submission.state)}
              </span>
              {submission.state.publicVisible && (
                <Link href={`/tests/${submission.slug}`}>Open →</Link>
              )}
              {submission.enrichment?.canRetry && (
                <button
                  className="button button-secondary"
                  disabled={retryingId === submission.id}
                  onClick={() => {
                    setRetryingId(submission.id);
                    void retryEnrichment(submission.id, getToken)
                      .then(() => window.location.reload())
                      .catch((caught) => {
                        setError(
                          caught instanceof Error
                            ? caught.message
                            : "Could not retry the automated preview.",
                        );
                        setRetryingId(null);
                      });
                  }}
                  type="button"
                >
                  {retryingId === submission.id ? "Retrying…" : "Retry preview"}
                </button>
              )}
            </article>
          ))}
          {data.submissions.length === 0 && (
            <p className="muted">No submitted Tests yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function simpleDashboardStatus(state: DashboardData["submissions"][number]["state"]) {
  if (state.code === "processing_failed") return "Processing failed";
  if (state.code === "ranked") return "Ranked";
  if (state.code === "reviewed") return "Reviewed";
  if (state.publicVisible) return "Awaiting review";
  if (["blocked", "rejected", "removed"].includes(state.code)) return "Blocked";
  return "Processing";
}

async function retryEnrichment(
  showcaseId: string,
  getToken: () => Promise<string | null>,
) {
  const token = await getToken();
  if (!token) throw new Error("Your session expired.");
  const response = await fetch(
    `/api/showcases/${encodeURIComponent(showcaseId)}/enrichment/retry`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  const payload = (await response.json()) as { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "Could not retry the automated preview.");
  }
}

function simpleDashboardDetail(state: DashboardData["submissions"][number]["state"]) {
  const status = simpleDashboardStatus(state);
  if (status === "Awaiting review") {
    return "This safe Test is public and waiting for review.";
  }
  if (status === "Reviewed") {
    return "This Test has been reviewed and remains public.";
  }
  if (status === "Ranked") {
    return "This Test is included in the current leaderboard.";
  }
  return state.detail;
}
