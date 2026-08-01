"use client";

import { useEffect, useMemo, useState } from "react";
import { SignInButton, useAuth, useUser } from "@clerk/clerk-react";
import Link from "next/link";

type Profile = {
  displayName: string;
  handle: string;
  id: string;
};

type DraftFields = {
  benchmarkVersionId: string;
  category: "frontend" | "browser-game" | "browser-3d" | "other";
  declaredSettings: Record<string, unknown>;
  harness: string;
  harnessId?: string;
  modelLabel: string;
  modelVersionId?: string;
  modelVersionLabel: string;
  prompt: string;
  reasoningLevel: string;
  rightsConfirmed: boolean;
  sourceVisibility: "public" | "private";
  summary: string;
  systemPrompt: string;
  title: string;
};

type UploadState = {
  fileName: string;
  status: "waiting" | "uploading" | "approved" | "blocked" | "scanning";
};

const initialDraft: DraftFields = {
  benchmarkVersionId: "",
  title: "",
  summary: "",
  category: "frontend",
  modelLabel: "",
  modelVersionLabel: "",
  harness: "",
  reasoningLevel: "High",
  prompt: "",
  systemPrompt: "",
  sourceVisibility: "public",
  rightsConfirmed: false,
  declaredSettings: {},
};

type ResultCatalog = {
  tests: Array<{
    versionId: string;
    title: string;
    category: DraftFields["category"];
    prompt: string;
    version: number;
  }>;
  models: Array<{
    id: string;
    family: string;
    provider: string;
    version: string;
  }>;
  harnesses: Array<{ id: string; name: string; version: number }>;
};

export function UploadWizard({
  authConfigured,
  initialTestId,
}: {
  authConfigured: boolean;
  initialTestId?: string;
}) {
  if (!authConfigured) return <AuthSetupNotice />;
  return <ConfiguredUploadWizard initialTestId={initialTestId} />;
}

function AuthSetupNotice() {
  return (
    <div className="security-gate">
      <span className="gate-icon" aria-hidden="true">
        !
      </span>
      <div>
        <strong>Uploads are temporarily unavailable.</strong>
        <p>
          Verified contributor accounts are required before Benchmax can accept
          any files. Browsing remains open while sign-in is being prepared.
        </p>
      </div>
      <span className="status-pill pending">Protected</span>
    </div>
  );
}

function ConfiguredUploadWizard({ initialTestId }: { initialTestId?: string }) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { user: clerkUser } = useUser();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileChecked, setProfileChecked] = useState(false);
  const [draft, setDraft] = useState({
    ...initialDraft,
    benchmarkVersionId: initialTestId ?? "",
  });
  const [catalog, setCatalog] = useState<ResultCatalog | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [publishedSlug, setPublishedSlug] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const totalBytes = useMemo(
    () => files.reduce((total, file) => total + file.size, 0),
    [files],
  );

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/results/catalog");
        const payload = (await response.json()) as {
          catalog?: ResultCatalog;
          error?: string;
        };
        if (!response.ok || !payload.catalog) {
          throw new Error(payload.error ?? "Could not load the result catalog.");
        }
        setCatalog(payload.catalog);
        setDraft((current) => {
          const tests = payload.catalog?.tests ?? [];
          const selected =
            tests.find(
              (test) => test.versionId === current.benchmarkVersionId,
            ) ?? tests[0];
          if (!selected) return current;
          return {
            ...current,
            benchmarkVersionId: selected.versionId,
            category: selected.category,
            prompt: selected.prompt,
          };
        });
      } catch (caught) {
        setError(toMessage(caught));
      }
    })();
  }, []);

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

  async function checkProfile() {
    setBusy(true);
    setError(null);
    try {
      const response = await authorizedFetch("/api/profile");
      const payload = (await response.json()) as {
        error?: string;
        user?: Profile | null;
      };
      if (!response.ok) throw new Error(payload.error ?? "Profile check failed.");
      setProfile(payload.user ?? null);
      setProfileChecked(true);
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function createProfile(form: FormData) {
    setBusy(true);
    setError(null);
    try {
      const response = await authorizedFetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: String(form.get("displayName") ?? ""),
          handle: String(form.get("handle") ?? ""),
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        user?: Profile;
      };
      if (!response.ok || !payload.user) {
        throw new Error(payload.error ?? "Could not create profile.");
      }
      setProfile(payload.user);
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function createDraft() {
    setBusy(true);
    setError(null);
    try {
      const response = await authorizedFetch("/api/showcases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const payload = (await response.json()) as {
        error?: string;
        showcase?: { id: string };
      };
      if (!response.ok || !payload.showcase) {
        throw new Error(payload.error ?? "Could not create draft.");
      }
      setDraftId(payload.showcase.id);
      setStep(2);
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function uploadEvidence() {
    if (!draftId || files.length === 0) return;
    setBusy(true);
    setError(null);
    setUploads(
      files.map((file) => ({ fileName: file.name, status: "waiting" })),
    );
    try {
      for (const [index, file] of files.entries()) {
        updateUpload(index, "uploading");
        const kind = inferArtifactKind(file);
        const sessionResponse = await authorizedFetch("/api/uploads/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            showcaseId: draftId,
            kind,
            fileName: file.name,
            contentType: file.type || "text/plain",
            byteSize: file.size,
          }),
        });
        const sessionPayload = (await sessionResponse.json()) as {
          error?: string;
          session?: {
            id: string;
            upload: {
              headers: Record<string, string>;
              method: "PUT";
              url: string;
            };
          };
        };
        if (!sessionResponse.ok || !sessionPayload.session) {
          throw new Error(
            sessionPayload.error ?? `Could not prepare ${file.name}.`,
          );
        }
        const target = sessionPayload.session.upload;
        const uploadResponse = await fetch(target.url, {
          method: target.method,
          headers: target.headers,
          body: file,
        });
        if (!uploadResponse.ok) throw new Error(`Upload failed for ${file.name}.`);

        const completeResponse = await authorizedFetch(
          `/api/uploads/sessions/${sessionPayload.session.id}/complete`,
          { method: "POST" },
        );
        const completePayload = (await completeResponse.json()) as {
          error?: string;
          artifact?: {
            findings: string[];
            quarantineStatus: UploadState["status"];
          };
        };
        if (!completeResponse.ok || !completePayload.artifact) {
          throw new Error(
            completePayload.error ?? `Security scan failed for ${file.name}.`,
          );
        }
        updateUpload(index, completePayload.artifact.quarantineStatus);
      }
      setStep(3);
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!draftId) return;
    setBusy(true);
    setError(null);
    try {
      const response = await authorizedFetch(
        `/api/showcases/${draftId}/publish`,
        { method: "POST" },
      );
      const payload = (await response.json()) as {
        error?: string;
        showcase?: { slug: string };
      };
      if (!response.ok || !payload.showcase) {
        throw new Error(payload.error ?? "Could not publish this report.");
      }
      setPublishedSlug(payload.showcase.slug);
      setStep(4);
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  function updateUpload(index: number, status: UploadState["status"]) {
    setUploads((current) =>
      current.map((upload, uploadIndex) =>
        uploadIndex === index ? { ...upload, status } : upload,
      ),
    );
  }

  if (!isLoaded) {
    return <div className="wizard-loading">Checking your secure session…</div>;
  }
  if (!isSignedIn) {
    return (
      <div className="sign-in-gate">
        <span className="section-index">ACCOUNT REQUIRED</span>
        <h2>Sign in before sending any data.</h2>
        <p>
          Browsing stays public. Google, GitHub, or email-code sign-in is
          required to create and own a report.
        </p>
        <SignInButton mode="modal">
          <button className="button button-primary" type="button">
            Sign in to continue
          </button>
        </SignInButton>
      </div>
    );
  }
  if (!profileChecked) {
    return (
      <div className="sign-in-gate">
        <span className="section-index">SIGNED IN</span>
        <h2>Connect your public Benchmax profile.</h2>
        <p>No email address is stored in the Benchmax database.</p>
        <button
          className="button button-primary"
          disabled={busy}
          onClick={checkProfile}
          type="button"
        >
          {busy ? "Checking…" : "Continue"}
        </button>
        {error && <p className="form-error">{error}</p>}
      </div>
    );
  }
  if (!profile) {
    const suggestedName = clerkUser?.fullName ?? clerkUser?.firstName ?? "";
    const suggestedHandle =
      clerkUser?.username ??
      clerkUser?.primaryEmailAddress?.emailAddress.split("@")[0] ??
      "";
    return (
      <form
        className="profile-form"
        action={(form) => void createProfile(form)}
      >
        <span className="section-index">PUBLIC PROFILE</span>
        <h2>Choose how your work is attributed.</h2>
        <div className="field-grid">
          <label>
            <span>Display name</span>
            <input
              defaultValue={suggestedName}
              maxLength={80}
              minLength={2}
              name="displayName"
              required
            />
          </label>
          <label>
            <span>Handle</span>
            <div className="prefixed-input">
              <span>@</span>
              <input
                defaultValue={suggestedHandle.toLowerCase()}
                maxLength={32}
                minLength={3}
                name="handle"
                pattern="[a-z0-9][a-z0-9_-]{1,30}[a-z0-9]"
                required
              />
            </div>
          </label>
        </div>
        <button className="button button-primary" disabled={busy} type="submit">
          {busy ? "Creating…" : "Create profile"}
        </button>
        {error && <p className="form-error">{error}</p>}
      </form>
    );
  }
  if (catalog && catalog.tests.length === 0) {
    return (
      <section className="wizard-panel empty-state">
        <span className="section-index">A TEST COMES FIRST</span>
        <h2>Add the test you ran before submitting its result.</h2>
        <p>
          A test freezes the prompt, goal, and scoring criteria so every result
          is reviewed against the same contract.
        </p>
        <Link className="button button-primary" href="/tests">
          Add the first test
        </Link>
      </section>
    );
  }

  return (
    <div className="upload-wizard">
      <ol className="wizard-steps">
        {["Test context", "Evidence", "Review", "Published"].map(
          (label, index) => (
            <li
              className={
                step === index + 1 ? "active" : step > index + 1 ? "done" : ""
              }
              key={label}
            >
              <span>0{index + 1}</span>
              {label}
            </li>
          ),
        )}
      </ol>

      {step === 1 && (
        <form
          className="wizard-panel"
          onSubmit={(event) => {
            event.preventDefault();
            void createDraft();
          }}
        >
          <div className="panel-heading">
            <div>
              <span className="section-index">STEP 01</span>
              <h2>Record the exact test context.</h2>
            </div>
            <span className="saved-as">Owned by @{profile.handle}</span>
          </div>
          <div className="field-grid">
            <label className="field-wide">
              <span>Test</span>
              <select
                onChange={(event) => {
                  const selected = catalog?.tests.find(
                    (test) => test.versionId === event.target.value,
                  );
                  setDraft({
                    ...draft,
                    benchmarkVersionId: event.target.value,
                    category: selected?.category ?? draft.category,
                    prompt: selected?.prompt ?? "",
                  });
                }}
                required
                value={draft.benchmarkVersionId}
              >
                <option value="">Choose a published test</option>
                {catalog?.tests.map((test) => (
                  <option key={test.versionId} value={test.versionId}>
                    {test.title} · v{test.version}
                  </option>
                ))}
              </select>
              <small>
                Missing the test you ran? <Link href="/tests">Add it first.</Link>{" "}
                Results are ranked only against this exact test version.
              </small>
            </label>
            <label className="field-wide">
              <span>Test title</span>
              <input
                maxLength={120}
                minLength={8}
                onChange={(event) =>
                  setDraft({ ...draft, title: event.target.value })
                }
                placeholder="Responsive dashboard result with working filters"
                required
                value={draft.title}
              />
            </label>
            <label className="field-wide">
              <span>Short summary</span>
              <textarea
                maxLength={800}
                minLength={24}
                onChange={(event) =>
                  setDraft({ ...draft, summary: event.target.value })
                }
                placeholder="What was tested and what did the model produce?"
                required
                rows={3}
                value={draft.summary}
              />
            </label>
            <label>
              <span>Known model version</span>
              <select
                onChange={(event) => {
                  const selected = catalog?.models.find(
                    (model) => model.id === event.target.value,
                  );
                  setDraft(
                    selected
                      ? {
                          ...draft,
                          modelLabel: selected.family,
                          modelVersionLabel: selected.version,
                          modelVersionId: selected.id,
                        }
                      : {
                          ...draft,
                          modelLabel: "",
                          modelVersionLabel: "",
                          modelVersionId: undefined,
                        },
                  );
                }}
                value={draft.modelVersionId ?? ""}
              >
                <option value="">Other / not listed</option>
                {catalog?.models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.family} · {model.version} · {model.provider}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Known harness</span>
              <select
                onChange={(event) => {
                  const selected = catalog?.harnesses.find(
                    (harness) => harness.id === event.target.value,
                  );
                  setDraft(
                    selected
                      ? {
                          ...draft,
                          harness: `${selected.name} v${selected.version}`,
                          harnessId: selected.id,
                        }
                      : { ...draft, harness: "", harnessId: undefined },
                  );
                }}
                value={draft.harnessId ?? ""}
              >
                <option value="">Other / not listed</option>
                {catalog?.harnesses.map((harness) => (
                  <option key={harness.id} value={harness.id}>
                    {harness.name} · v{harness.version}
                  </option>
                ))}
              </select>
            </label>
            {!draft.modelVersionId && (
              <>
                <label>
                  <span>Model family</span>
                  <input
                    maxLength={100}
                    minLength={2}
                    onChange={(event) =>
                      setDraft({ ...draft, modelLabel: event.target.value })
                    }
                    placeholder="Model family"
                    required
                    value={draft.modelLabel}
                  />
                </label>
                <label>
                  <span>Exact model version</span>
                  <input
                    maxLength={100}
                    minLength={1}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        modelVersionLabel: event.target.value,
                      })
                    }
                    placeholder="Release, snapshot, or endpoint label"
                    required
                    value={draft.modelVersionLabel}
                  />
                  <small>
                    Use the release, dated snapshot, or endpoint label shown
                    when you ran the test—not only the model family.
                  </small>
                </label>
              </>
            )}
            {!draft.harnessId && (
              <label>
                <span>Harness name and version</span>
                <input
                  maxLength={80}
                  minLength={2}
                  onChange={(event) =>
                    setDraft({ ...draft, harness: event.target.value })
                  }
                  placeholder="Harness name and version"
                  required
                  value={draft.harness}
                />
                <small>
                  Include a version or dated build when the harness exposes one.
                </small>
              </label>
            )}
            <label>
              <span>Category</span>
              <select
                disabled
                value={draft.category}
              >
                <option value="frontend">Frontend</option>
                <option value="browser-game">Browser game</option>
                <option value="browser-3d">Browser 3D</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              <span>Reasoning level</span>
              <select
                onChange={(event) =>
                  setDraft({ ...draft, reasoningLevel: event.target.value })
                }
                required
                value={draft.reasoningLevel}
              >
                <option value="None">None / off</option>
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
                <option value="Max">Max</option>
                <option value="Unknown">Unknown / adaptive</option>
              </select>
            </label>
            <label className="field-wide">
              <span>Other test settings (optional)</span>
              <textarea
                maxLength={2000}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    declaredSettings: { notes: event.target.value },
                  })
                }
                placeholder="Context window, temperature, tool permissions, mode, or other settings that affected the result."
                rows={3}
                value={String(draft.declaredSettings.notes ?? "")}
              />
            </label>
            <label className="field-wide">
              <span>Prompt used for this result</span>
              <textarea
                maxLength={40_000}
                readOnly
                required
                rows={8}
                value={draft.prompt}
              />
              <small>
                Frozen by the selected test version. Choose a different test if
                this is not the exact prompt you ran.
              </small>
            </label>
            <label className="field-wide">
              <span>System prompt (optional)</span>
              <textarea
                maxLength={20_000}
                onChange={(event) =>
                  setDraft({ ...draft, systemPrompt: event.target.value })
                }
                placeholder="Include any system-level instructions that affected the run."
                rows={4}
                value={draft.systemPrompt}
              />
            </label>
            <label>
              <span>Source visibility</span>
              <select
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    sourceVisibility: event.target
                      .value as DraftFields["sourceVisibility"],
                  })
                }
                value={draft.sourceVisibility}
              >
                <option value="public">Public source</option>
                <option value="private">Private source</option>
              </select>
            </label>
            <label className="field-wide consent-field">
              <input
                checked={draft.rightsConfirmed}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    rightsConfirmed: event.target.checked,
                  })
                }
                required
                type="checkbox"
              />
              <span>
                I have the right to submit this material and grant Benchmax a
                license to host, scan, evaluate where applicable, and publicly
                display this result under the Terms.
              </span>
            </label>
          </div>
          <div className="wizard-actions">
            <p>Saving creates a private draft. Nothing publishes yet.</p>
            <button
              className="button button-primary"
              disabled={busy}
              type="submit"
            >
              {busy ? "Saving securely…" : "Save context and continue"}
            </button>
          </div>
          {error && <p className="form-error">{error}</p>}
        </form>
      )}

      {step === 2 && (
        <section className="wizard-panel">
          <div className="panel-heading">
            <div>
              <span className="section-index">STEP 02</span>
              <h2>Add what the model produced.</h2>
            </div>
            <span className="status-pill pending">Quarantine enabled</span>
          </div>
          <label className="drop-zone">
            <input
              accept=".zip,.txt,.json,.mp4,.webm,.png,.jpg,.jpeg,.webp"
              multiple
              onChange={(event) =>
                setFiles(Array.from(event.target.files ?? []))
              }
              type="file"
            />
            <strong>Choose code, video, screenshots, or logs</strong>
            <span>
              ZIP up to 20 MB · video up to 500 MB · image up to 20 MB
            </span>
          </label>
          {files.length > 0 && (
            <div className="selected-files">
              {files.map((file) => (
                <div key={`${file.name}-${file.size}`}>
                  <span>{file.name}</span>
                  <span>{formatBytes(file.size)}</span>
                </div>
              ))}
              <div className="file-total">
                <strong>Total</strong>
                <span>{formatBytes(totalBytes)} / 1 GB</span>
              </div>
            </div>
          )}
          {uploads.length > 0 && (
            <div className="scan-list">
              {uploads.map((upload) => (
                <div key={upload.fileName}>
                  <span>{upload.fileName}</span>
                  <span className={`status-pill ${upload.status}`}>
                    {upload.status}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="safety-callout">
            <strong>Security gate</strong>
            <p>
              Files are isolated first. Type signatures, paths, archive
              expansion, executable content, and credential patterns are
              checked before this result can appear publicly.
            </p>
          </div>
          <div className="wizard-actions">
            <button
              className="button button-secondary"
              disabled={busy}
              onClick={() => setStep(1)}
              type="button"
            >
              Back
            </button>
            <button
              className="button button-primary"
              disabled={
                busy ||
                files.length === 0 ||
                totalBytes > 1024 * 1024 * 1024
              }
              onClick={() => void uploadEvidence()}
              type="button"
            >
              {busy ? "Uploading and scanning…" : "Upload to quarantine"}
            </button>
          </div>
          {error && <p className="form-error">{error}</p>}
        </section>
      )}

      {step === 3 && (
        <section className="wizard-panel review-panel">
          <div className="panel-heading">
            <div>
              <span className="section-index">STEP 03</span>
              <h2>Review what everyone will see.</h2>
            </div>
          </div>
          <div className="review-summary">
            <div>
              <span>MODEL</span>
              <strong>{draft.modelLabel}</strong>
            </div>
            <div>
              <span>HARNESS</span>
              <strong>{draft.harness}</strong>
            </div>
            <div>
              <span>REASONING</span>
              <strong>{draft.reasoningLevel}</strong>
            </div>
            <div>
              <span>EVIDENCE</span>
              <strong>{files.length} files</strong>
            </div>
          </div>
          <div className="publish-rule">
            <span>Public after the safety scan — AI review follows</span>
            <p>
              Your result appears on the site as soon as it publishes. Benchmax
              may take up to 24 hours to judge it and decide ranking eligibility.
            </p>
          </div>
          <div className="wizard-actions">
            <button
              className="button button-secondary"
              disabled={busy}
              onClick={() => setStep(2)}
              type="button"
            >
              Back
            </button>
            <button
              className="button button-primary"
              disabled={
                busy ||
                uploads.some(
                  (upload) =>
                    upload.status !== "approved" &&
                    upload.status !== "scanning",
                ) ||
                uploads.some((upload) => upload.status === "scanning")
              }
              onClick={() => void publish()}
              type="button"
            >
              {busy ? "Publishing…" : "Publish test report"}
            </button>
          </div>
          {uploads.some((upload) => upload.status === "scanning") && (
            <p className="form-note">
              A deep scan is still pending. Publishing remains locked.
            </p>
          )}
          {error && <p className="form-error">{error}</p>}
        </section>
      )}

      {step === 4 && (
        <section className="wizard-panel success-panel">
          <span className="success-mark">✓</span>
          <span className="section-index">PUBLISHED</span>
          <h2>Your test is on the public record.</h2>
          <p>
            AI review is queued. The public page will show pending, delayed,
            ranked, or not-ranked status as the review progresses.
          </p>
          <a
            className="button button-primary"
            href={publishedSlug ? `/results/${publishedSlug}` : "/explore"}
          >
            View public result
          </a>
        </section>
      )}
    </div>
  );
}

function inferArtifactKind(
  file: File,
): "source" | "video" | "image" | "log" {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("image/")) return "image";
  if (
    file.type === "application/json" ||
    file.name.toLowerCase().endsWith(".log")
  ) {
    return "log";
  }
  return "source";
}

function formatBytes(value: number): string {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
