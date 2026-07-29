"use client";

import { useMemo, useState } from "react";
import { SignInButton, useAuth, useUser } from "@clerk/clerk-react";

type Profile = {
  displayName: string;
  handle: string;
  id: string;
};

type DraftFields = {
  category: "frontend" | "browser-game" | "browser-3d" | "other";
  harness: string;
  modelLabel: string;
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
  title: "",
  summary: "",
  category: "frontend",
  modelLabel: "",
  harness: "",
  reasoningLevel: "High",
  prompt: "",
  systemPrompt: "",
  sourceVisibility: "public",
  rightsConfirmed: false,
};

export function UploadWizard({
  authConfigured,
}: {
  authConfigured: boolean;
}) {
  if (!authConfigured) return <AuthSetupNotice />;
  return <ConfiguredUploadWizard />;
}

function AuthSetupNotice() {
  return (
    <div className="security-gate">
      <span className="gate-icon" aria-hidden="true">
        !
      </span>
      <div>
        <strong>Account creation is locked until production auth is connected.</strong>
        <p>
          Benchmax will not enable anonymous or placeholder writes. Google,
          GitHub, and email-code signup activate after the verified Clerk keys
          are installed as encrypted runtime values.
        </p>
      </div>
      <span className="status-pill pending">Fail closed</span>
    </div>
  );
}

function ConfiguredUploadWizard() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { user: clerkUser } = useUser();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileChecked, setProfileChecked] = useState(false);
  const [draft, setDraft] = useState(initialDraft);
  const [files, setFiles] = useState<File[]>([]);
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const totalBytes = useMemo(
    () => files.reduce((total, file) => total + file.size, 0),
    [files],
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
        <h2>Choose how your work is credited.</h2>
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
              <span>Test title</span>
              <input
                maxLength={120}
                minLength={8}
                onChange={(event) =>
                  setDraft({ ...draft, title: event.target.value })
                }
                placeholder="K3 built a playable voxel world from one prompt"
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
              <span>Model</span>
              <input
                maxLength={100}
                minLength={2}
                onChange={(event) =>
                  setDraft({ ...draft, modelLabel: event.target.value })
                }
                placeholder="K3"
                required
                value={draft.modelLabel}
              />
            </label>
            <label>
              <span>Harness</span>
              <input
                maxLength={80}
                onChange={(event) =>
                  setDraft({ ...draft, harness: event.target.value })
                }
                placeholder="Cursor, Codex, Claude Code..."
                required
                value={draft.harness}
              />
            </label>
            <label>
              <span>Category</span>
              <select
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    category: event.target.value as DraftFields["category"],
                  })
                }
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
              <input
                maxLength={40}
                onChange={(event) =>
                  setDraft({ ...draft, reasoningLevel: event.target.value })
                }
                placeholder="Low, medium, high, max..."
                required
                value={draft.reasoningLevel}
              />
            </label>
            <label className="field-wide">
              <span>Prompt</span>
              <textarea
                maxLength={40_000}
                onChange={(event) =>
                  setDraft({ ...draft, prompt: event.target.value })
                }
                placeholder="Paste the complete prompt exactly as tested."
                required
                rows={8}
                value={draft.prompt}
              />
              <small>Secrets are detected before this text is stored.</small>
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
                license to host, scan, execute where applicable, and publicly
                display this Test Report under the Terms.
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
              <h2>Add the evidence.</h2>
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
            <strong>Choose source, video, screenshots, or logs</strong>
            <span>
              ZIP up to 100 MB · video up to 500 MB · image up to 20 MB
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
              Files are isolated first. Type signatures, paths, expansion
              ratios, executable content, and credential patterns are checked
              before approval.
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
              <h2>Review the public record.</h2>
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
            <span>Community Showcase — not ranked</span>
            <p>
              This report can be inspected publicly, but it will never affect
              official model rankings.
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
            It is labeled as a Community Showcase and excluded from official
            rankings.
          </p>
          <a className="button button-primary" href="/explore">
            View public tests
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
