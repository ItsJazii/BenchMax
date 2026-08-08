"use client";

import { SignInButton, useAuth } from "@clerk/clerk-react";
import { useEffect, useState } from "react";
import { z } from "zod";

const catalogSeedResponseSchema = z.object({
  catalog: z
    .object({
      benchmarkCount: z.number().int().nonnegative(),
      configurationCount: z.number().int().nonnegative(),
      evaluationVersionStatus: z.string().min(1),
      harnessCount: z.number().int().nonnegative(),
      modelCount: z.number().int().nonnegative(),
    })
    .optional(),
  error: z.string().optional(),
});

const calibrationStartResponseSchema = z.object({
  calibration: z.object({ status: z.literal("started") }).optional(),
  error: z.string().optional(),
});

type Operations = {
  generatedAt: string;
  lifecycle: Array<Record<string, string | number>>;
  stages: Array<Record<string, string | number>>;
  evaluations: Array<Record<string, string | number>>;
  judgeBudget: Record<string, string | number | null>;
  overdue: Record<string, string | number | null>;
  catalogRequests: Array<Record<string, string | number>>;
  disputes: Array<Record<string, string | number>>;
  reports: Array<Record<string, string | number>>;
  recentAudit: Array<Record<string, unknown>>;
  spend: DailySpend;
  storage: Array<Record<string, string | number | boolean>>;
};

type DailySpend = {
  dayStartedAt: string;
  dayEndsAt: string;
  currency: "USD";
  pricedCostMicrousd: number;
  unpricedAttemptCount: number;
  breakdown: Array<{
    attemptCount: number;
    durationMs: number;
    firstRecordedAt: string;
    inputTokens: number;
    lastRecordedAt: string;
    operation: string;
    outputTokens: number;
    pricedCostMicrousd: number;
    service: string;
    status: string;
    unpricedAttemptCount: number;
  }>;
};

type CatalogQueue = {
  requests: Array<{
    id: string;
    kind: "model-version" | "harness";
    requestedLabel: string;
    modelLabel: string;
    modelVersionLabel: string;
    harnessLabel: string;
  }>;
  modelFamilies: Array<{ id: string; name: string }>;
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
  const [catalogQueue, setCatalogQueue] = useState<CatalogQueue | null>(null);
  const [modelChoices, setModelChoices] = useState<Record<string, string>>({});
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
      const [response, catalogResponse] = await Promise.all([
        authorizedFetch("/api/admin/operations"),
        authorizedFetch("/api/admin/catalog/requests"),
      ]);
      const payload = (await response.json()) as {
        operations?: Operations;
        error?: string;
      };
      if (!response.ok || !payload.operations) {
        throw new Error(payload.error ?? "Could not load operations.");
      }
      setData(payload.operations);
      const catalogPayload = (await catalogResponse.json()) as {
        requests?: CatalogQueue["requests"];
        modelFamilies?: CatalogQueue["modelFamilies"];
        error?: string;
      };
      if (!catalogResponse.ok) {
        throw new Error(
          catalogPayload.error ?? "Could not load catalog requests.",
        );
      }
      setCatalogQueue({
        requests: catalogPayload.requests ?? [],
        modelFamilies: catalogPayload.modelFamilies ?? [],
      });
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

  async function seedCatalog() {
    setBusy(true);
    setError(null);
    try {
      const response = await authorizedFetch("/api/admin/catalog/seed", {
        method: "POST",
      });
      const parsed = catalogSeedResponseSchema.safeParse(await response.json());
      if (!response.ok) {
        throw new Error(
          parsed.success
            ? parsed.data.error ?? "Could not seed the catalog."
            : "Could not seed the catalog.",
        );
      }
      if (!parsed.success || !parsed.data.catalog) {
        throw new Error("The catalog seed response was invalid.");
      }
      await refresh();
      const catalog = parsed.data.catalog;
      setError(
        `Catalog seeded: ${catalog.benchmarkCount} benchmarks, ${catalog.modelCount} models, ${catalog.harnessCount} harnesses, ${catalog.configurationCount} configurations; judge evaluation ${catalog.evaluationVersionStatus}.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  async function runCalibration() {
    setBusy(true);
    setError(null);
    try {
      const response = await authorizedFetch("/api/admin/judge/calibrate", {
        method: "POST",
      });
      const parsed = calibrationStartResponseSchema.safeParse(
        await response.json(),
      );
      if (!response.ok) {
        throw new Error(
          parsed.success
            ? parsed.data.error ?? "Could not start judge calibration."
            : "Could not start judge calibration.",
        );
      }
      if (!parsed.success || !parsed.data.calibration) {
        throw new Error("The judge calibration response was invalid.");
      }
      await refresh();
      setError(
        "Judge calibration started. Refresh to see its outcome in the audit trail and calibration alerts.",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  async function resolveCatalogRequest(
    requestId: string,
    action: "approve" | "reject",
  ) {
    setBusy(true);
    setError(null);
    try {
      const response = await authorizedFetch("/api/admin/catalog/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          action,
          modelId:
            action === "approve"
              ? modelChoices[requestId] ??
                catalogQueue?.modelFamilies[0]?.id
              : undefined,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not resolve catalog request.");
      }
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
        <button className="button button-secondary" disabled={busy} onClick={() => void seedCatalog()} type="button">
          Seed catalog
        </button>
        <button className="button button-secondary" disabled={busy} onClick={() => void runCalibration()} type="button">
          Run calibration
        </button>
        <button className="button button-primary" disabled={busy} onClick={() => void createManifest()} type="button">
          {busy ? "Writing…" : "Write backup manifest"}
        </button>
      </div>
      <section aria-labelledby="daily-burn-heading" className="daily-burn-panel">
        <div className="section-heading compact">
          <div>
            <span className="section-index">UTC daily ledger</span>
            <h2 id="daily-burn-heading">Daily judge and sandbox burn</h2>
          </div>
          <span
            className={`status-pill ${
              data.spend.unpricedAttemptCount > 0 ? "blocked" : "approved"
            }`}
          >
            {data.spend.unpricedAttemptCount > 0
              ? `${data.spend.unpricedAttemptCount} unpriced`
              : "Fully priced"}
          </span>
        </div>
        <div className="daily-burn-summary">
          <div>
            <small>Priced cost</small>
            <strong>{formatUsd(data.spend.pricedCostMicrousd)}</strong>
          </div>
          <div>
            <small>Window</small>
            <strong>
              {formatTimestamp(data.spend.dayStartedAt)} – {formatTimestamp(data.spend.dayEndsAt)}
            </strong>
          </div>
        </div>
        {data.spend.unpricedAttemptCount > 0 && (
          <div className="operations-action-required" role="alert">
            <strong>Action required: daily burn is incomplete.</strong>
            <p>
              Set current integer-microusd rates in{" "}
              <code>BENCHMAX_JUDGE_INPUT_MICROUSD_PER_MILLION_TOKENS</code>,{" "}
              <code>BENCHMAX_JUDGE_OUTPUT_MICROUSD_PER_MILLION_TOKENS</code>, and{" "}
              <code>BENCHMAX_SANDBOX_MICROUSD_PER_HOUR</code> from the pinned
              vendors&apos; price sheets before enabling queue consumers. Provider
              calls without token usage remain unpriced and must be investigated.
            </p>
          </div>
        )}
        <div className="daily-burn-breakdown">
          {data.spend.breakdown.map((item) => (
            <article
              key={`${item.service}:${item.operation}:${item.status}`}
            >
              <div>
                <strong>{titleCase(item.service)} · {titleCase(item.operation)}</strong>
                <p>
                  {item.status} · {item.attemptCount} attempt
                  {item.attemptCount === 1 ? "" : "s"}
                </p>
              </div>
              <dl>
                <div>
                  <dt>Priced</dt>
                  <dd>{formatUsd(item.pricedCostMicrousd)}</dd>
                </div>
                <div>
                  <dt>Unpriced</dt>
                  <dd>{item.unpricedAttemptCount}</dd>
                </div>
                {item.service === "judge" ? (
                  <div>
                    <dt>Tokens</dt>
                    <dd>
                      {item.inputTokens.toLocaleString()} in /{" "}
                      {item.outputTokens.toLocaleString()} out
                    </dd>
                  </div>
                ) : (
                  <div>
                    <dt>Runtime</dt>
                    <dd>{formatDuration(item.durationMs)}</dd>
                  </div>
                )}
              </dl>
            </article>
          ))}
          {data.spend.breakdown.length === 0 && (
            <p className="muted">No judge or sandbox attempts recorded today.</p>
          )}
        </div>
      </section>
      {catalogQueue && catalogQueue.requests.length > 0 && (
        <section>
          <h2>Resolve catalog requests</h2>
          <div className="dashboard-list">
            {catalogQueue.requests.map((request) => (
              <article key={request.id}>
                <div>
                  <strong>{request.kind}</strong>
                  <p>
                    {request.modelLabel} · {request.modelVersionLabel} ·{" "}
                    {request.harnessLabel}
                  </p>
                </div>
                {request.kind === "model-version" && (
                  <select
                    aria-label={`Model family for ${request.requestedLabel}`}
                    onChange={(event) =>
                      setModelChoices({
                        ...modelChoices,
                        [request.id]: event.target.value,
                      })
                    }
                    value={
                      modelChoices[request.id] ??
                      catalogQueue.modelFamilies[0]?.id ??
                      ""
                    }
                  >
                    {catalogQueue.modelFamilies.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.name}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  className="button button-primary"
                  disabled={busy}
                  onClick={() =>
                    void resolveCatalogRequest(request.id, "approve")
                  }
                  type="button"
                >
                  Approve
                </button>
                <button
                  className="button button-secondary"
                  disabled={busy}
                  onClick={() =>
                    void resolveCatalogRequest(request.id, "reject")
                  }
                  type="button"
                >
                  Reject
                </button>
              </article>
            ))}
          </div>
        </section>
      )}
      {[
        ["Run lifecycle", data.lifecycle],
        ["Queue stages", data.stages],
        ["Judge versions", data.evaluations],
        ["Daily judge budget", [data.judgeBudget]],
        ["Overdue AI reviews", [data.overdue]],
        ["Catalog requests", data.catalogRequests],
        ["Disputes", data.disputes],
        ["Abuse reports", data.reports],
        ["Recent audit trail", data.recentAudit],
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

function formatUsd(microusd: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(microusd / 1_000_000);
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function formatDuration(durationMs: number) {
  if (durationMs < 1_000) return `${durationMs} ms`;
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(1)} sec`;
  return `${(durationMs / 60_000).toFixed(1)} min`;
}

function titleCase(value: string) {
  return value.replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) =>
    letter.toUpperCase(),
  );
}
