"use client";

import { SignInButton, useAuth } from "@clerk/clerk-react";
import { useEffect, useState } from "react";

type Queue = {
  reports: Array<{
    id: string;
    reason: string;
    details: string;
    showcaseId: string | null;
    runId: string | null;
  }>;
  disputes: Array<{ id: string; runId: string; reason: string }>;
  proposals: Array<{ id: string; title: string; category: string }>;
};

export function ModerationConsole({
  authConfigured,
}: {
  authConfigured: boolean;
}) {
  if (!authConfigured) {
    return (
      <div className="security-gate">
        <strong>The moderation workspace is unavailable.</strong>
        <p>Verified staff sign-in must be active before this queue can open.</p>
        <span className="status-pill pending">Staff only</span>
      </div>
    );
  }
  return <ConfiguredModerationConsole />;
}

function ConfiguredModerationConsole() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [queue, setQueue] = useState<Queue | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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

  async function loadQueue() {
    setError(null);
    try {
      const response = await authorizedFetch("/api/moderation/queue");
      const payload = (await response.json()) as { queue?: Queue; error?: string };
      if (!response.ok || !payload.queue) {
        throw new Error(payload.error ?? "Could not load moderation queue.");
      }
      setQueue(payload.queue);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed.");
    }
  }

  useEffect(() => {
    if (!isSignedIn) return;
    const timeout = window.setTimeout(() => void loadQueue(), 0);
    return () => window.clearTimeout(timeout);
    // Loading is intentionally tied only to authenticated state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  async function decide(
    kind: "report" | "dispute" | "proposal",
    id: string,
    decision: string,
  ) {
    if (reason.trim().length < 10) {
      setError("Write a reason of at least 10 characters.");
      return;
    }
    setBusyId(id);
    setError(null);
    try {
      let url: string;
      let body: Record<string, unknown>;
      if (kind === "dispute") {
        url = `/api/moderation/disputes/${id}`;
        body = { status: decision, resolution: reason };
      } else if (kind === "proposal") {
        url = `/api/moderation/proposals/${id}`;
        body = { status: decision, reason };
      } else {
        url = "/api/moderation/actions";
        body = {
          entityType: "abuse-report",
          entityId: id,
          action: decision,
          reason,
        };
      }
      const response = await authorizedFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Decision failed.");
      setReason("");
      await loadQueue();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed.");
    } finally {
      setBusyId(null);
    }
  }

  if (!isLoaded) return <div className="wizard-loading">Checking session…</div>;
  if (!isSignedIn) {
    return (
      <div className="sign-in-gate">
        <h2>Sign in with a moderation account.</h2>
        <SignInButton mode="modal">
          <button className="button button-primary" type="button">Sign in</button>
        </SignInButton>
      </div>
    );
  }
  if (!queue) {
    return <div className="security-gate">{error ?? "Loading role-gated queue…"}</div>;
  }
  return (
    <div className="moderation-console">
      <label>
        <span>Decision reason</span>
        <textarea
          maxLength={2000}
          minLength={10}
          onChange={(event) => setReason(event.target.value)}
          rows={4}
          value={reason}
        />
      </label>
      <QueueSection title="Abuse reports">
        {queue.reports.map((item) => (
          <QueueItem key={item.id} title={`${item.reason} · ${item.id}`} body={item.details}>
            <button disabled={busyId === item.id} onClick={() => void decide("report", item.id, "resolve")} type="button">Resolve</button>
            <button disabled={busyId === item.id} onClick={() => void decide("report", item.id, "dismiss")} type="button">Dismiss</button>
          </QueueItem>
        ))}
      </QueueSection>
      <QueueSection title="Run disputes">
        {queue.disputes.map((item) => (
          <QueueItem key={item.id} title={`Run ${item.runId}`} body={item.reason}>
            <button disabled={busyId === item.id} onClick={() => void decide("dispute", item.id, "resolved")} type="button">Resolve</button>
            <button disabled={busyId === item.id} onClick={() => void decide("dispute", item.id, "dismissed")} type="button">Dismiss</button>
          </QueueItem>
        ))}
      </QueueSection>
      <QueueSection title="Benchmark proposals">
        {queue.proposals.map((item) => (
          <QueueItem key={item.id} title={item.title} body={item.category}>
            <button disabled={busyId === item.id} onClick={() => void decide("proposal", item.id, "approved")} type="button">Approve</button>
            <button disabled={busyId === item.id} onClick={() => void decide("proposal", item.id, "rejected")} type="button">Reject</button>
          </QueueItem>
        ))}
      </QueueSection>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

function QueueSection({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <section>
      <h2>{title}</h2>
      <div className="queue-list">{children}</div>
    </section>
  );
}

function QueueItem({
  body,
  children,
  title,
}: {
  body: string;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <article>
      <strong>{title}</strong>
      <p>{body}</p>
      <div>{children}</div>
    </article>
  );
}
