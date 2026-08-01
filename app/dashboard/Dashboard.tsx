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
        <strong>{data.submissions.length} submitted results</strong>
        <small>
          {publicCount} public · {rankedCount} ranked. Public results stay visible
          while AI review is pending.
        </small>
      </section>
      <section>
        <div className="section-heading compact">
          <h2>Submitted results</h2>
          <Link href="/submit">Submit result →</Link>
        </div>
        <div className="dashboard-list">
          {data.submissions.map((submission) => (
            <article className="submission-status-card" key={submission.id}>
              <div className="submission-status-body">
                <strong>{submission.title}</strong>
                <p>
                  {submission.benchmark ?? "Test pending"} · {submission.model}
                  {submission.modelVersion
                    ? ` ${submission.modelVersion}`
                    : ""} · {submission.reasoning}
                </p>
                <p>{submission.state.detail}</p>
                {submission.judgeDueAt &&
                  submission.state.code === "public_pending_review" && (
                    <p>
                      Review target: {formatTimestamp(submission.judgeDueAt)}
                    </p>
                  )}
                {submission.state.blockedReason && (
                  <p className="submission-blocked-reason">
                    <strong>
                      {submission.state.publicVisible
                        ? "Why not ranked:"
                        : "Blocked reason:"}
                    </strong>{" "}
                    {submission.state.blockedReason}
                  </p>
                )}
                <details className="submission-history">
                  <summary>
                    Stage history ({submission.timeline.length})
                  </summary>
                  {submission.timeline.length > 0 ? (
                    <ol>
                      {submission.timeline.map((event) => (
                        <li key={event.key}>
                          <span
                            className={`status-pill ${timelineTone(event.status)}`}
                          >
                            {event.status}
                          </span>
                          <div>
                            <strong>{event.label}</strong>
                            {event.detail && <p>{event.detail}</p>}
                            <time dateTime={event.occurredAt}>
                              {formatTimestamp(event.occurredAt)}
                            </time>
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p>No recorded stage events yet.</p>
                  )}
                </details>
              </div>
              <span className={`status-pill ${submission.state.tone}`}>
                {submission.state.label}
              </span>
              {submission.state.publicVisible && (
                <Link href={`/results/${submission.slug}`}>Open →</Link>
              )}
            </article>
          ))}
          {data.submissions.length === 0 && (
            <p className="muted">No submitted results yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function timelineTone(status: "completed" | "failed" | "info" | "pending") {
  if (status === "completed") return "approved";
  if (status === "failed") return "blocked";
  if (status === "pending") return "pending";
  return "neutral";
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
