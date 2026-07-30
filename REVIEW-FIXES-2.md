# Benchmax review round 2 — remaining fixes (2026-07-30)

Verification of the uncommitted fix batch against REVIEW-FIXES.md: **all P0s and P1s are
substantively fixed** (verified by adversarial code review, behavioral tests, live
execution of the evaluator smoke test, and browser checks of every affected page).
This file lists what remains. Nothing here is launch-blocking for the showcase surface;
items 1–5 should land before the first real platform run.

## Fix before the first production platform run

### 1. Context-budget enforcement will fail legitimate runs (functional, medium)
`lib/generation/web-agent.ts` `enforceContextBudget` compares UTF-8 **byte** length of
the JSON request body against `contextBudgetTokens` (131072). Bytes ≈ 4× tokens, so a
long agent loop hits a spurious `context_budget_exceeded` at roughly 32k real tokens.
Fix: estimate tokens (bytes/4 with margin, or a real tokenizer budget per provider),
keep the refusal semantics. Update the behavioral test accordingly.

### 2. Pathological projects can dodge their earned 0 (scoring integrity)
The old bug (infra failure → fake 0) is fixed, but the inverse now exists: a generated
project that hangs the harness (e.g. `while(true)` stalls the rAF sampling in
`sandbox/browser-web-v1/evaluate.mjs:160-175`, which has no timeout → 120s sandbox kill
→ exit≠0) or crashes screenshot/innerText capture is classified
`EvaluationInfrastructureError` → run ends `evaluation_failed` and never gets scored.
Fix: wrap every in-page evaluation (rAF sampling, page text, screenshot) in explicit
timeouts inside evaluate.mjs that convert to per-check `fail` statuses with exit 0, so
the evaluator only exits non-zero for genuine harness faults.

### 3. Duplicate/late queue messages can kill healthy runs (two related edges)
- A duplicate evaluate message arriving while the run is `judging` throws
  `EvaluationContractError("invalid_run_state")` which is instantly terminal →
  `judging → evaluation_failed` under a live judge (`worker/index.ts:369-372, 415-431`,
  `lib/evaluation/frontend.ts:77-79`). State-mismatch contract errors on duplicates
  should ack (the run has moved on), not terminate.
- Busy-lease `message.retry` consumes queue attempts; a message that stays busy across
  4 deliveries dead-letters, and `lib/pipeline/dead-letter.ts:18-22` unconditionally
  fails the run even if the live holder then succeeds. The DLQ consumer should re-check
  run status and no-op if the run progressed.

### 4. run-policy loosened wider than needed
`lib/security/run-policy.ts:47-48` now allows `published → evaluation_failed` (a late
terminal failure of a duplicate publish message demotes an already-published run) and
`published → scored` (no caller at all). Remove both edges; make publish-stage terminal
failure a no-op when the run is already `published`.

### 5. Evaluator smoke test breaks on clean checkouts / CI
`tests/evaluator-smoke.test.mjs` hard-requires a hardcoded Chrome path
(`C:\Program Files\Google\Chrome\...`), `python` on PATH, playwright ffmpeg in
LOCALAPPDATA, and a pre-run `npm ci` in `sandbox/browser-web-v1` — and `npm test`
always runs it. Fix: resolve the browser via playwright's own resolution, autodetect
prerequisites and **skip with a loud warning** (not fail) when absent locally, and keep
it mandatory in CI via an env flag (`BENCHMAX_REQUIRE_EVALUATOR_SMOKE=1`).

## Smaller correctness items

6. Sweeper excludes `generation_failed`: a crash between `markGenerationFailed` and the
   `generation_failed → scored` transition (`lib/pipeline/platform-generation.ts:76-91`)
   strands the run; add that status to `lib/pipeline/recovery.ts:132-140`.
7. `videoDurationMs` must equal exactly 5000 (`evaluate.mjs:231`,
   `frontend.ts` z.literal): any ffmpeg rounding drift becomes an infra retry loop.
   Accept a ±50ms band.
8. Judge prompt: `checkKey` (evaluator-supplied, ≤120 chars) sits outside the untrusted
   delimiters and is never validated against the frozen benchmark's check set
   (`lib/evaluation/frontend.ts:27,304`, `lib/judging/protocol.ts:103`). Allowlist
   checkKeys against the frozen contract at report validation.
9. Orphan quarantine object: within the presign TTL a client can re-PUT to the
   quarantine key after promotion; the sweep only covers `created/uploading` sessions so
   the orphan persists (`lib/data/upload-maintenance.ts`,
   `lib/data/uploads.ts::listExpiredUploadSessions`). Sweep completed/expired session
   keys too, or delete quarantine keys unconditionally at promotion + TTL expiry.
10. Sweeper raw-SQL transitions (`recovery.ts:170-193`) write no audit rows for the
    status changes; add audit events for sweeper-driven transitions.

## Cleanups / cosmetics

11. Delete `.openai/hosting.json` (the one item 16 cleanup not done).
12. DB quota triggers count expired-but-unswept sessions the app check excludes
    (≤2 min window of spurious rejections) — align by filtering `expires_at`.
13. `app/upload/UploadWizard.tsx:401` placeholder still name-drops "K3 … voxel world";
    use a neutral example.
14. `drizzle/meta/_journal.json` has no entries past 0002 while 0003–0007 exist as SQL —
    wrangler applies by filename so it works, but `drizzle-kit generate` would desync.
    Regenerate the journal or document that migrations are hand-authored.
15. Moderation-dismiss publish re-enqueue failure is only console-logged (relies on the
    recovery cron); acceptable, but add an audit row.

## Confirmed fixed this round (spot-verified, do not re-open)

- Evaluator: local deps + PLAYWRIGHT_BROWSERS_PATH + digest-pinned base + build-derived
  environment hash; smoke test executes a real browser end-to-end and passes.
- Infra vs model-fault classification inverted correctly; infra failures retry and land
  in `evaluation_failed`, never published as 0.
- Aggregates: designated-version selection (highest published version per benchmark),
  regression test with v1/v2 proves no merging or double-weighting.
- Stage claims: lease-token rotation verified against real SQLite; stale holders cannot
  complete live claims; held leases retry with delay instead of ack.
- Recovery cron every 2 min re-drives stalled runs incl. publish; manual retry reopens
  failed judge/publish stages; real DLQ consumer with audit.
- Judge: all runtime evidence (console errors, page text, titles) inside sanitized
  untrusted-evidence envelopes; injection screen covers runtime strings; redaction list
  extended; flagged runs go to a moderation queue with reversible dismiss that restores
  rank eligibility.
- Fabricated placeholder data fully removed; honest empty/error/data states verified in
  the running app; /benchmarks counts DB-derived; regression tests assert absence.
- Uploads: presign signs Content-Length/Type; immutable evidence promotion + publish-time
  sha256 re-verification; 2-min sweep cron; source cap lowered to 20MB consistently.
- No double-scoring/double-refund paths found; credits idempotency-keyed; duplicate
  messages short-circuit on run status.
- Catalog decision documented: single-model launch (Kimi K3 / Moonshot, 3 reasoning
  configs) + env-pinned judge with origin frozen in evaluation_versions (drizzle/0006).
