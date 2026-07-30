"use client";

import Link from "next/link";
import { SignInButton, useAuth } from "@clerk/clerk-react";
import { useEffect, useMemo, useState } from "react";

type Catalog = {
  benchmarks: Array<{
    id: string;
    title: string;
    version: number;
    attemptPolicy: string;
    environmentHash: string;
  }>;
  configurations: Array<{
    id: string;
    provider: string;
    model: string;
    modelVersion: string;
    endpointName: string;
    reasoningLevel: string;
    settingsHash: string;
    harness: string;
    harnessVersion: number;
  }>;
  evaluation: {
    id: string;
    version: number;
    judgeModel: string;
    judgeModelVersion: string;
  } | null;
};

type RunDraft = {
  id: string;
  publicSlug: string;
  status: string;
};

export function RunWizard({
  authConfigured,
}: {
  authConfigured: boolean;
}) {
  if (!authConfigured) {
    return (
      <div className="security-gate">
        <strong>Benchmark runs are temporarily unavailable.</strong>
        <p>
          Verified sign-in must be active before Benchmax can accept a provider
          key or use platform credits.
        </p>
        <span className="status-pill pending">Protected</span>
      </div>
    );
  }
  return <ConfiguredRunWizard />;
}

function ConfiguredRunWizard() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [benchmarkVersionId, setBenchmarkVersionId] = useState("");
  const [configurationId, setConfigurationId] = useState("");
  const [credentialMode, setCredentialMode] = useState<
    "byok" | "platform-credit"
  >("byok");
  const [apiKey, setApiKey] = useState("");
  const [run, setRun] = useState<RunDraft | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/runs/catalog")
      .then(async (response) => {
        const payload = (await response.json()) as {
          catalog?: Catalog;
          error?: string;
        };
        if (!response.ok || !payload.catalog) {
          throw new Error(payload.error ?? "Benchmark catalog is unavailable.");
        }
        if (!cancelled) {
          setCatalog(payload.catalog);
          setBenchmarkVersionId(payload.catalog.benchmarks[0]?.id ?? "");
          setConfigurationId(payload.catalog.configurations[0]?.id ?? "");
        }
      })
      .catch((caught) => {
        if (!cancelled) setError(toMessage(caught));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedBenchmark = useMemo(
    () =>
      catalog?.benchmarks.find(
        (benchmark) => benchmark.id === benchmarkVersionId,
      ) ?? null,
    [benchmarkVersionId, catalog],
  );
  const selectedConfiguration = useMemo(
    () =>
      catalog?.configurations.find(
        (configuration) => configuration.id === configurationId,
      ) ?? null,
    [catalog, configurationId],
  );

  async function authorizedFetch(url: string, init: RequestInit = {}) {
    const token = await getToken();
    if (!token) throw new Error("Your session expired. Sign in again.");
    return fetch(url, {
      ...init,
      headers: {
        ...Object.fromEntries(new Headers(init.headers).entries()),
        Authorization: `Bearer ${token}`,
      },
    });
  }

  async function createDraft() {
    setBusy(true);
    setError(null);
    try {
      const response = await authorizedFetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          benchmarkVersionId,
          configurationId,
          credentialMode,
        }),
      });
      const payload = (await response.json()) as {
        run?: RunDraft;
        error?: string;
      };
      if (!response.ok || !payload.run) {
        throw new Error(payload.error ?? "Could not create run draft.");
      }
      setRun(payload.run);
      setEvents(["Draft created. No model call has started."]);
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function launchPlatform() {
    if (!run) return;
    setBusy(true);
    setError(null);
    try {
      const response = await authorizedFetch(
        `/api/runs/${run.id}/launch-platform`,
        { method: "POST" },
      );
      const payload = (await response.json()) as {
        run?: RunDraft;
        error?: string;
      };
      if (!response.ok || !payload.run) {
        throw new Error(payload.error ?? "Could not queue generation.");
      }
      setRun(payload.run);
      setEvents((current) => [
        ...current,
        "Platform generation queued under the bounded retry policy.",
      ]);
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  function launchByok() {
    if (!run || apiKey.length < 8) return;
    setBusy(true);
    setError(null);
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(
      `${protocol}//${window.location.host}/api/runs/${run.id}/generate/byok`,
    );
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "start", apiKey }));
      setApiKey("");
      setEvents((current) => [
        ...current,
        "Key transferred to the single live generation session and removed from this form.",
      ]);
    });
    socket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as {
          code?: string;
          message?: string;
          status?: string;
          type?: string;
        };
        setEvents((current) => [
          ...current,
          payload.message ??
            (payload.type === "complete"
              ? `Generation complete; ${payload.status}.`
              : payload.type === "failed"
                ? `Generation failed: ${payload.code}. Re-initiation is required.`
                : payload.type ?? "Generation update"),
        ]);
        if (payload.type === "complete" || payload.type === "failed") {
          setBusy(false);
        }
      } catch {
        setEvents((current) => [...current, "Generation session update."]);
      }
    });
    socket.addEventListener("error", () => {
      setApiKey("");
      setBusy(false);
      setError(
        "The live BYOK session could not continue. The key was not queued or stored.",
      );
    });
    socket.addEventListener("close", () => setBusy(false));
  }

  if (!isLoaded) return <div className="wizard-loading">Checking session…</div>;
  if (!isSignedIn) {
    return (
      <div className="sign-in-gate">
        <span className="section-index">ACCOUNT REQUIRED</span>
        <h2>Sign in before launching compute.</h2>
        <p>Public browsing never requires an account.</p>
        <SignInButton mode="modal">
          <button className="button button-primary" type="button">
            Sign in to continue
          </button>
        </SignInButton>
      </div>
    );
  }
  if (!catalog?.benchmarks.length || !catalog.configurations.length) {
    return (
      <div className="security-gate">
        <strong>The benchmark catalog is being prepared.</strong>
        <p>
          Runs remain unavailable until every benchmark, execution environment,
          model configuration, and scoring contract is frozen.
        </p>
        <span className="status-pill pending">Not available yet</span>
      </div>
    );
  }

  return (
    <div className="upload-wizard">
      <section className="wizard-panel">
        <div className="panel-heading">
          <div>
            <span className="section-index">EXACT RUN CONTRACT</span>
            <h2>Choose the immutable inputs.</h2>
          </div>
          <span className="status-pill approved">Pass@1</span>
        </div>
        <div className="field-grid">
          <label className="field-wide">
            <span>Benchmark version</span>
            <select
              disabled={Boolean(run)}
              onChange={(event) => setBenchmarkVersionId(event.target.value)}
              value={benchmarkVersionId}
            >
              {catalog.benchmarks.map((benchmark) => (
                <option key={benchmark.id} value={benchmark.id}>
                  {benchmark.title} · v{benchmark.version} ·{" "}
                  {benchmark.attemptPolicy}
                </option>
              ))}
            </select>
          </label>
          <label className="field-wide">
            <span>Exact model configuration</span>
            <select
              disabled={Boolean(run)}
              onChange={(event) => setConfigurationId(event.target.value)}
              value={configurationId}
            >
              {catalog.configurations.map((configuration) => (
                <option key={configuration.id} value={configuration.id}>
                  {configuration.model} {configuration.modelVersion} ·{" "}
                  {configuration.reasoningLevel} · {configuration.provider}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Generation funding</span>
            <select
              disabled={Boolean(run)}
              onChange={(event) =>
                setCredentialMode(
                  event.target.value as "byok" | "platform-credit",
                )
              }
              value={credentialMode}
            >
              <option value="byok">Bring your own provider key</option>
              <option value="platform-credit">Admin-granted credits</option>
            </select>
          </label>
          <div className="contract-card">
            <span>FROZEN HASHES</span>
            <code>
              env {selectedBenchmark?.environmentHash.slice(0, 12)}… · settings{" "}
              {selectedConfiguration?.settingsHash.slice(0, 12)}…
            </code>
          </div>
        </div>
        {!run && (
          <div className="wizard-actions">
            <p>Creating a draft does not spend credits or call a provider.</p>
            <button
              className="button button-primary"
              disabled={busy}
              onClick={() => void createDraft()}
              type="button"
            >
              Create private run draft
            </button>
          </div>
        )}
        {run && credentialMode === "byok" && run.status === "draft" && (
          <div className="byok-panel">
            <div>
              <span className="section-index">MEMORY-ONLY KEY</span>
              <h3>Start the live generation session.</h3>
              <p>
                The key goes directly to this run&apos;s Durable Object, exists
                only in that generation job&apos;s memory, and dies with the
                session. It is never stored in D1, R2, logs, or a queue. A
                provider failure requires you to initiate a new run.
              </p>
            </div>
            <label>
              <span>Provider API key</span>
              <input
                autoComplete="off"
                maxLength={4096}
                minLength={8}
                onChange={(event) => setApiKey(event.target.value)}
                spellCheck={false}
                type="password"
                value={apiKey}
              />
            </label>
            <button
              className="button button-primary"
              disabled={busy || apiKey.length < 8}
              onClick={launchByok}
              type="button"
            >
              {busy ? "Generation active…" : "Start pass@1 generation"}
            </button>
          </div>
        )}
        {run &&
          credentialMode === "platform-credit" &&
          run.status === "draft" && (
            <div className="byok-panel">
              <div>
                <span className="section-index">ADMIN-GRANTED ONLY</span>
                <h3>Use platform credits.</h3>
                <p>
                  Credits cannot be purchased. Reservation and every retry are
                  idempotent, so an outage cannot charge the same run twice.
                </p>
              </div>
              <button
                className="button button-primary"
                disabled={busy}
                onClick={() => void launchPlatform()}
                type="button"
              >
                {busy ? "Queuing…" : "Reserve credits and launch"}
              </button>
            </div>
          )}
        {events.length > 0 && (
          <ol className="run-events" aria-live="polite">
            {events.map((event, index) => (
              <li key={`${index}-${event}`}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                {event}
              </li>
            ))}
          </ol>
        )}
        {error && (
          <div className="form-error">
            {error}{" "}
            {error.includes("profile") && (
              <Link href="/upload">Create your profile first.</Link>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function toMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}
