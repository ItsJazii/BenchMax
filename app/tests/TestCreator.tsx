"use client";

import { SignInButton, useAuth, useUser } from "@clerk/clerk-react";
import Link from "next/link";
import { useState } from "react";

type RubricDimension = {
  key: string;
  title: string;
  description: string;
  mechanism: "judge";
  weightBps: number;
};

type CreatedTest = {
  id: string;
  versionId: string;
  version: number;
  rubric: RubricDimension[];
};

export type TestVersionSource = {
  id: string;
  title: string;
  goal: string;
  category: "frontend" | "browser-game" | "browser-3d" | "other";
  prompt: string;
  successCriteria: string[];
  version: number;
};

type Profile = {
  displayName: string;
  handle: string;
};

export function TestCreator({
  authConfigured,
  sourceTest,
}: {
  authConfigured: boolean;
  sourceTest?: TestVersionSource;
}) {
  if (!authConfigured) {
    return (
      <div className="security-gate">
        <strong>Test creation is temporarily unavailable.</strong>
        <p>Browsing remains public while verified sign-in is configured.</p>
      </div>
    );
  }
  return <ConfiguredTestCreator sourceTest={sourceTest} />;
}

function ConfiguredTestCreator({
  sourceTest,
}: {
  sourceTest?: TestVersionSource;
}) {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const [created, setCreated] = useState<CreatedTest | null>(null);
  const [approved, setApproved] = useState(false);
  const [rubricSaved, setRubricSaved] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileChecked, setProfileChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not check your profile.");
      }
      setProfile(payload.user ?? null);
      setProfileChecked(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed.");
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
        throw new Error(payload.error ?? "Could not create your profile.");
      }
      setProfile(payload.user);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  async function createTest(form: FormData) {
    setBusy(true);
    setError(null);
    try {
      const successCriteria = String(form.get("successCriteria") ?? "")
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean);
      const response = await authorizedFetch(
        sourceTest
          ? `/api/tests/${encodeURIComponent(sourceTest.id)}/versions`
          : "/api/tests",
        {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: String(form.get("title") ?? ""),
          goal: String(form.get("goal") ?? ""),
          category: String(form.get("category") ?? "other"),
          prompt: String(form.get("prompt") ?? ""),
          successCriteria,
        }),
        },
      );
      const payload = (await response.json()) as {
        error?: string;
        test?: CreatedTest;
      };
      if (!response.ok || !payload.test) {
        throw new Error(payload.error ?? "Could not create this test.");
      }
      setCreated(payload.test);
      setRubricSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  function updateRubricDimension(
    index: number,
    field: "key" | "title" | "description" | "weightBps",
    value: string,
  ) {
    setCreated((current) => {
      if (!current) return current;
      return {
        ...current,
        rubric: current.rubric.map((dimension, dimensionIndex) =>
          dimensionIndex === index
            ? {
                ...dimension,
                [field]: field === "weightBps" ? Number(value) : value,
              }
            : dimension,
        ),
      };
    });
    setRubricSaved(false);
  }

  async function saveRubric() {
    if (!created) return;
    setBusy(true);
    setError(null);
    try {
      const response = await authorizedFetch(
        `/api/tests/${encodeURIComponent(created.id)}/rubric`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dimensions: created.rubric }),
        },
      );
      const payload = (await response.json()) as {
        error?: string;
        test?: { rubric: RubricDimension[] };
      };
      if (!response.ok || !payload.test) {
        throw new Error(payload.error ?? "Could not save this rubric.");
      }
      setCreated({ ...created, ...payload.test, rubric: payload.test.rubric });
      setRubricSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  async function approveTest() {
    if (!created) return;
    setBusy(true);
    setError(null);
    try {
      const response = await authorizedFetch(
        `/api/tests/${encodeURIComponent(created.id)}/approve`,
        { method: "POST" },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not approve this test.");
      }
      setApproved(true);
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
        <h2>Sign in to add a test.</h2>
        <p>Your public profile owns the test and its future versions.</p>
        <SignInButton mode="modal">
          <button className="button button-primary" type="button">
            Sign in
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
        <p>Your profile owns the test and its frozen versions.</p>
        <button
          className="button button-primary"
          disabled={busy}
          onClick={() => void checkProfile()}
          type="button"
        >
          {busy ? "Checking…" : "Continue"}
        </button>
        {error && <p className="form-error">{error}</p>}
      </div>
    );
  }
  if (!profile) {
    const suggestedName = user?.fullName ?? user?.firstName ?? "";
    const suggestedHandle =
      user?.username ??
      user?.primaryEmailAddress?.emailAddress.split("@")[0] ??
      "";
    return (
      <form
        className="profile-form"
        action={(form) => void createProfile(form)}
      >
        <span className="section-index">PUBLIC PROFILE</span>
        <h2>Choose how your test is attributed.</h2>
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
  if (approved && created) {
    return (
      <div className="wizard-panel success-panel">
        <span className="success-mark">✓</span>
        <h2>Your test is live.</h2>
        <p>
          People can now submit model results against version {created.version}.
        </p>
        <Link
          className="button button-primary"
          href={`/submit?test=${encodeURIComponent(created.versionId)}`}
        >
          Submit the first result
        </Link>
      </div>
    );
  }
  if (created) {
    return (
      <section className="wizard-panel review-panel">
        <span className="section-index">REVIEW THE RUBRIC</span>
        <h2>Approve the scoring contract.</h2>
        <p>
          Benchmax&apos;s pinned AI judge drafted these dimensions from your
          prompt, goal, and success criteria. Edit them if needed. Approval
          freezes this version so every result uses the same contract.
        </p>
        <div className="review-summary rubric-editor">
          {created.rubric.map((dimension, index) => (
            <div key={`${index}-${dimension.key}`}>
              <label>
                <span>Stable key</span>
                <input
                  maxLength={48}
                  pattern="[a-z][a-z0-9]*(?:-[a-z0-9]+)*"
                  required
                  value={dimension.key}
                  onChange={(event) =>
                    updateRubricDimension(index, "key", event.target.value)
                  }
                />
              </label>
              <label>
                <span>Title</span>
                <input
                  maxLength={100}
                  minLength={2}
                  required
                  value={dimension.title}
                  onChange={(event) =>
                    updateRubricDimension(index, "title", event.target.value)
                  }
                />
              </label>
              <label>
                <span>Description</span>
                <textarea
                  maxLength={600}
                  minLength={10}
                  required
                  rows={3}
                  value={dimension.description}
                  onChange={(event) =>
                    updateRubricDimension(
                      index,
                      "description",
                      event.target.value,
                    )
                  }
                />
              </label>
              <label>
                <span>Weight (basis points)</span>
                <input
                  max={9999}
                  min={1}
                  required
                  type="number"
                  value={dimension.weightBps}
                  onChange={(event) =>
                    updateRubricDimension(
                      index,
                      "weightBps",
                      event.target.value,
                    )
                  }
                />
              </label>
            </div>
          ))}
        </div>
        <div className="wizard-actions">
          <p>
            Weights must total 10,000. Task success and correctness are
            required.
          </p>
          <button
            className="button button-secondary"
            disabled={busy || rubricSaved}
            onClick={() => void saveRubric()}
            type="button"
          >
            {busy ? "Saving…" : rubricSaved ? "Rubric saved" : "Save changes"}
          </button>
          <button
            className="button button-primary"
            disabled={busy || !rubricSaved}
            onClick={() => void approveTest()}
            type="button"
          >
            {busy ? "Approving…" : "Approve and publish test"}
          </button>
        </div>
        {error && <p className="form-error">{error}</p>}
      </section>
    );
  }
  return (
    <form className="wizard-panel" action={(form) => void createTest(form)}>
      <div className="panel-heading">
        <div>
          <span className="section-index">
            {sourceTest ? `NEW VERSION AFTER V${sourceTest.version}` : "NEW TEST"}
          </span>
          <h2>
            {sourceTest
              ? "Update the test without changing its history."
              : "Freeze a test others can use."}
          </h2>
        </div>
        <span className="saved-as">Owned by @{profile.handle}</span>
      </div>
      <div className="field-grid">
        <label className="field-wide">
          <span>Test name</span>
          <input
            defaultValue={sourceTest?.title}
            name="title"
            minLength={8}
            maxLength={120}
            placeholder="Build a responsive analytics dashboard"
            required
          />
        </label>
        <label>
          <span>Category</span>
          <select name="category" defaultValue={sourceTest?.category ?? "other"}>
            <option value="frontend">Frontend</option>
            <option value="browser-game">Browser game</option>
            <option value="browser-3d">Browser 3D</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="field-wide">
          <span>What does this test measure?</span>
          <textarea
            defaultValue={sourceTest?.goal}
            name="goal"
            minLength={20}
            maxLength={2000}
            rows={4}
            required
          />
        </label>
        <label className="field-wide">
          <span>Exact prompt</span>
          <textarea
            defaultValue={sourceTest?.prompt}
            name="prompt"
            minLength={20}
            maxLength={40000}
            rows={8}
            required
          />
        </label>
        <label className="field-wide">
          <span>Success criteria — one per line</span>
          <textarea
            defaultValue={sourceTest?.successCriteria.join("\n")}
            name="successCriteria"
            minLength={4}
            maxLength={6000}
            rows={5}
            placeholder={"The requested output is complete\nThe result works as described\nNo critical errors are visible"}
            required
          />
        </label>
      </div>
      <div className="wizard-actions">
        <p>
          {sourceTest
            ? `Version ${sourceTest.version} stays unchanged. You will review and approve the new rubric before the next version is public.`
            : "You will review and approve the rubric before this test is public."}
        </p>
        <button className="button button-primary" disabled={busy} type="submit">
          {busy ? "Drafting…" : "Draft scoring rubric"}
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
    </form>
  );
}
