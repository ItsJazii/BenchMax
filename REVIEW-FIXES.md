# Benchmax review — required fixes (2026-07-30)

Review of commit `6089144` against PLAN.md. Security core passed adversarial review;
the items below are ordered by severity. P0 = broken product, P1 = trust/spec
violations, P2 = hardening. File references are exact.

## P0 — the platform does not work end-to-end

### 1. E2B evaluator cannot start; every run would publish as a rank-eligible 0
- `sandbox/browser-web-v1/e2b.Dockerfile` installs `playwright` with `npm install --global`,
  but `evaluate.mjs` uses ESM `import { chromium } from "playwright"` — Node ESM never
  resolves global installs, so the process exits with ERR_MODULE_NOT_FOUND.
- `npx playwright install` runs as root (browsers land in `/root/.cache/ms-playwright`)
  while the sandbox runs as `USER user` with no `PLAYWRIGHT_BROWSERS_PATH`.
- `lib/evaluation/frontend.ts:107-112` classifies the non-zero exit as
  `EvaluationDeterministicError("evaluator_process_failed")` → run is scored 0,
  rank-eligible, published. A broken environment is indistinguishable from a bad model.
- Fix: install deps locally in `/opt/benchmax` (package.json + `npm ci`), set
  `PLAYWRIGHT_BROWSERS_PATH` for the runtime user, and reclassify
  `evaluator_process_failed` / `source_extract_failed` as retriable infra failures
  (`evaluation_failed`), not deterministic scored failures.
- Add a test that actually executes `evaluate.mjs` against a fixture project;
  no current test runs it.

### 2. Aggregate rankings merge benchmark versions (spec violation, silently double-counts)
- `lib/ranking/aggregates.ts:14-29` selects every published benchmark snapshot for the
  evaluation version keyed only by `benchmark_id`. Once any benchmark has v1 and v2,
  both feed the category mean: same benchmark double-weighted and cross-version scores
  merged — violates PLAN §7.4 / §2.5. Latent (seed only creates v1) but structural.
- Fix: aggregate over exactly one designated version per benchmark (e.g. latest
  ranking-eligible version), and add a regression test with two versions of one benchmark.

### 3. Runs can get permanently stuck; retry path is broken
- `worker/index.ts:143-146`: when `claimStage` returns null (lease held), the queue
  message is ACKed. If the lease holder dies before `failStage`, no message remains and
  nothing re-drives the run. The weekly cron only does judge calibration.
- `app/api/runs/[id]/retry-evaluation/route.ts` + `lib/pipeline/stage-claims.ts:26-35`:
  a run that failed at the judge stage retries by enqueueing `evaluate`, whose claim row
  is `completed` and never reopens → message acked, run stuck at `queued_evaluation`.
- `worker/index.ts:290-343`: terminal failure of the `publish` stage leaves the run in
  `scored` with no recovery path.
- Fix: (a) retry-with-delay instead of ack when a lease is held; (b) add a frequent cron
  sweeper that re-enqueues expired-lease/stalled runs; (c) make retry-evaluation reopen
  or version stage claims so any failed stage can be re-driven; (d) handle publish-stage
  failure in `failRunAtCurrentStage`.

## P1 — trust and integrity

### 4. Judge prompt injection bypass via console-error strings
- `lib/judging/judge-run.ts:301-320` embeds `objectiveResults` — including verbatim
  `consoleErrors` captured at runtime (`sandbox/browser-web-v1/evaluate.mjs:69-74`) —
  OUTSIDE the `UNTRUSTED_EVIDENCE` delimiters. Generated code can
  `console.error(atob("..."))` to plant instructions that evade the source-regex screen.
- Fix: put every model-influenced string (console output, page text, titles) inside the
  untrusted delimiters and run the injection screen over runtime-captured text too.

### 5. Fabricated placeholder content shown as real community evidence
- `lib/domain/catalog.ts:25-71` hardcodes three fake showcases (fake contributors
  "maya"/"niko", fake models "Opus 4.6"/"GPT coding model", fake "2h ago" timestamps,
  and an unearned "Platform Replayed" trust badge). Used as the fallback whenever the DB
  is empty on home, /explore, /showcases/[slug], /contributors/[handle]
  (`app/page.tsx:33`, `app/explore/page.tsx:36`, `app/showcases/[slug]/page.tsx:20,47`,
  `app/contributors/[handle]/page.tsx:36`) and surfaces in /models. A fresh production
  deploy would display fabricated evidence on a trust-first product.
- `app/benchmarks/page.tsx:13-38` hardcodes "5/5/4 launch definitions" while fetching
  real versions from D1 (line 41) — home says "0/0 benchmarks", /benchmarks says 5.
- Fix: delete the fixture feed and all fallbacks; render honest empty states (the
  leaderboard and compare pages already do this correctly); derive benchmark counts from
  the DB query that already exists.

### 6. Blinding and injection screening gaps
- `lib/judging/protocol.ts:28` redaction list omits gpt, chatgpt, grok, deepseek, qwen,
  llama, mistral, glm, codex, copilot, o1/o3/o4. Extend it; also redact in page-text
  evidence, not just source.
- `protocol.ts:4-11` injection screen: flagged runs are silently deranked
  (`rankEligible=false`) with no review queue, but PLAN §6.3 says flagged runs go to
  moderator review — and pattern 3 (`system:`/`assistant:`) false-positives on benign
  text like "Design System: tokens". Route flags into the moderation queue instead of
  silent permanent exclusion.

### 7. Upload presign gaps
- `lib/storage/r2-presign.ts:36` signs no size constraint; quotas in
  `lib/data/uploads.ts:86-103` count declared bytes, not actual. A client can PUT
  oversized objects to quarantine keys and abandon them (cost abuse), or overwrite the
  object within the 600s URL TTL after scan approval (TOCTOU).
- Fix: sweep un-completed sessions (delete quarantine objects on expiry), and re-verify
  the stored object's sha256 at publish time.
- Also: `lib/security/artifact-scanner.ts:70,104` returns "scanning" forever for files
  over 20MB while policy allows 100MB — fail-closed but a dead end; either lower the
  policy cap to 20MB or implement chunked scanning.

## P2 — hardening / honesty

8. DLQ has no consumer and is nearly unreachable (worker terminal-acks at attempt 4);
   `PIPELINE_DLQ` binding is dead code. Add a DLQ consumer that marks runs failed +
   audits, or remove the claim from README.
9. Stage lease rows keep the same id across reclaims (`stage-claims.ts:22-64`), so a
   stale holder can complete a live claimant's lease. Downstream CAS + unique indexes
   currently prevent double-scoring, but rotate a lease token per claim.
10. Environment hash is self-referential: `evaluate.mjs:190` echoes the spec value and
    the Docker base is `e2bdev/base:latest` (unpinned). Pin the base image by digest and
    derive the hash from the built template, not a TS constant.
11. `contextBudgetTokens` (131072) is frozen/hashed in the harness contract but never
    enforced in `lib/generation/web-agent.ts`. Enforce or remove from the contract.
12. §5.3 requires fixed-duration video capture; evaluator takes one screenshot only.
    Implement or descope the plan/README claim.
13. Interaction checks are all-or-nothing and evaluator-crash paths silently fail unset
    checks (`evaluate.mjs:84-128`). Score steps individually; distinguish "not run".
14. Calibration drift "alert" is only an audit row; judge endpoint origin isn't part of
    the pinned evaluation version; `runs.evaluatedAt` is never written.
15. Two tests are decorative: `tests/security-policy.test.ts:477-498` regex-matches
    source comments instead of testing behavior. Replace with real queue-pipeline tests.
16. Cleanups: delete dead `app/chatgpt-auth.ts`, `.openai/hosting.json`, `examples/d1/`;
    rename `site-creator-d1`/`site-creator-r2` bindings; decide the launch catalog
    (currently Kimi K3 via Moonshot is the only seeded model and the judge is unpinned
    env config).

## What passed adversarial review (do not touch casually)

- BYOK key lifecycle (memory-only, zeroed in finally, stripped headers, key-free queue
  payloads, provenance excludes auth headers) — confirmed airtight.
- AES-GCM-256 encrypt-only provenance; no decrypt path in the app.
- Server-side Clerk auth + authorized parties + role gates on every mutating route.
- Upload quarantine ordering and publish gate (no client bypass found).
- Usercontent isolation: separate cookieless origin, default-src 'none' CSP,
  frame-ancestors pinned, sandbox="allow-scripts" without allow-same-origin.
- SQL triggers enforcing append-only audit/ledger/samples and benchmark-version/harness
  freeze — real enforcement, not convention.
- pass@1 (no hidden retry), median/IQR math (R type-7), equal-weight category/overall
  means, provisional flags, snapshot reproducibility with run_set_hash.
