# Benchmax pivot review — round 3 (2026-08-01)

## Round 3.1 addendum — P0 verification results (same day)

All six P0s below are **verified FIXED** (adversarial re-review + full suite green,
including trigger-level SQL regression tests for the catalog path and the
escalation state machine). Residuals found during verification, for the next pass:

- **[Med] 0018 missing from Drizzle journal/meta** — `_journal.json` ends at idx 17
  and there is no `0018_snapshot.json`; next `drizzle-kit generate` will mint a
  colliding 0018. Fold into the P1-8 regeneration (which still owes 0003–0007 too).
- **[Med] Dispute-rejudge loops forever on frozen evaluation versions** — neither
  `lib/data/dispute-rejudge.ts` entry point checks `evaluationVersions.status='active'`
  (the escalation sweep does, result-snapshots.ts:283); a dispute on a frozen-eval run
  re-enqueues a doomed judge message every 2 minutes indefinitely. Add the same guard.
- **[Med] No backoff on the 2-minute repair sweeps** — a persistently failing
  escalation attempts a real judge call (with failed-spend records) every 2 minutes,
  ~720/day per stuck run. Add exponential backoff or an attempt cap with ops surfacing.
- **[Low] Two-UPDATE hash-freeze bypass at raw-SQL level** (canonical→pending→canonical
  re-hash; app code never does this) — optional: freeze `catalog_status` transitions to
  the legal set by trigger.
- **[Low] Missing end-to-end test of `resolveCatalogRequest`** (asked in P0-1; only
  trigger-level SQL is covered) and two small invariants-script coverage gaps
  (pending-row hash update without status flip; pending declared-field freeze;
  new trigger absent from the trigger-existence list).
- The Windows EPERM rendered-test cleanup is fixed (tolerated with a warning after
  assertions pass) — full `npm test` is green on Windows.

## Round 3.2 addendum — residual-pass verification (2026-08-01, final)

Verified FIXED this pass: dispute-rejudge frozen-eval guards (both entry points,
terminal not looping); 0018 strengthened (4 triggers; the canonical→pending→canonical
raw-SQL bypass is closed; full invariants coverage incl. trigger-existence list);
durable repair backoff (D1-backed, 2min→60min, 8-attempt cap) for the judge-call
path with behavioral policy tests; real e2e lifecycle test against migrations
0000–0018 covering the requested unknown-model→publish→judge→approve→rankable arc;
0015 legacy seal completed; showcases_test_status_idx; DO v1/v2 migration history;
dangling env types removed; rebuild-path active-version check; snapshot chain
0000–0018 fully reconstructed (`drizzle-kit check` clean, `generate` reports no
changes). Full suite green.

**Cleared to commit.** Remaining items, none commit-blocking — finish before the
production rollout (LAUNCH-PLAN Phase 3 gate):

The list below is the verification snapshot. The bounded follow-up resolution is
recorded immediately after it.

1. Dispatch-failure paths (budget-denied / queue-unavailable / lost message) bypass
   the 8-attempt cap — attempt_count only increments on consumer claims, so those
   modes retry every 2 min unbounded (cheap, no judge spend, but unbounded).
2. No behavioral test of the D1 CAS backoff mechanics (claim/lease/race/exhaustion)
   or of either sweep end-to-end — policy functions only.
3. FK divergence masked: 0011 migrated DBs have NO ACTION on
   catalog_requests.result_configuration_id while snapshots claim restrict — align
   with a tiny migration before any snapshot-derived migration is generated.
4. Frozen-eval showcases stuck showing judging/overdue with no terminal reset —
   inflates ops overdue metric; add a terminal state + ops surfacing for exhausted/
   frozen repairs.
5. Round-3 P2s untouched: blocked-result owner view; contributor-page server-side
   filter; status-label set vs PLAN §2.2 (amend plan or normalize); explicit CI build
   step; npm audit gating → report-only; safetyApproved re-read in judge eligibility.
6. Cosmetics: dead `kind='model'` enum; stale sampleCount=3 CHECK;
   harnessContractHash stores raw JSON; empty route dirs (incl. app/_sites-preview).
7. e2e gaps acceptable-but-noted: upload/scan step bypassed (direct approved-artifact
   insert); "rankable" asserted as flags, not a snapshot rebuild.

## Round 3.2 follow-up implementation — completed (2026-08-01)

The commit-blocking release residuals were implemented and rechecked in the follow-up
commit:

- Dispatch failures, queue-unavailable outcomes, and lost messages now consume a
  durable repair-dispatch attempt with bounded backoff and an eight-attempt cap;
  exhausted repairs surface as terminal judge failures instead of retrying forever.
- The catalog-request foreign key is aligned to the declared restrictive policy in
  migration 0019. Legacy run updates and deletes are sealed at SQL level, and the D1
  invariant probe covers the trigger behavior and foreign-key check.
- Frozen evaluation versions stop dispute and top-ten repair paths with an explicit
  terminal state. Judge eligibility re-reads the current safety decision.
- Public blocked-result ownership, contributor pagination, honest unavailable/empty
  states, normalized result labels, the explicit CI build, report-only dependency
  audit, and the frozen-evaluation rebuild guard are in place.

Still deferred to staging/launch work: the upload/scan-to-rankable browser journey,
the final submission-vs-judging cap decision, and the cosmetic cleanup/evidence-shape
items that do not block the committed release gate.

Original round-3 report follows.

---

Scope: commits 70bc9b2 + fd92da8 plus the uncommitted UI/docs batch, reviewed against
PLAN.md v3 by three adversarial passes (schema/retirement, judging/ranking, public
surface/security) plus live browser + migration verification. Codex's own known-open
items (Windows temp cleanup in rendered test, e2e lifecycle test, final suite run,
generated-artifact removal) are excluded here.

Overall: the pivot is architecturally faithful to v3 — schema axes exact, rubric flow
correct, budgets atomic, static-only execution genuinely un-foolable, ranking math and
supersession correct, evidence privacy and auth airtight, generation stack truly
deleted, CI real. But there are 2 HIGH defects that break core loops, one plan
contradiction, and migration-hygiene gaps. Fix P0s before the batch-3 commit.

## P0 — broken core loops (must fix before commit)

### 1. Catalog approval fails at the SQL level (core v3 loop broken, untested)
`canonicalizeResultConfiguration` (lib/data/catalog-requests.ts:410-413) runs
`UPDATE result_configurations SET catalog_status='canonical', metadata_hash=...`, but
the `result_configurations_identity_frozen` trigger (drizzle/0011 — `BEFORE UPDATE OF
... metadata_hash` with no WHEN clause) aborts ANY update whose SET list touches
`metadata_hash`. Approving a catalog request for a configuration without a pre-existing
canonical twin — the common path — throws "declared result metadata is immutable".
Verified empirically against SQLite. No test covers `resolveCatalogRequest`.
Fix: recompute the hash without listing it in the frozen-columns trigger (e.g. WHEN
clause permitting the pending→canonical transition), or write canonicalization as
insert-new-config + repoint. Add an integration test for the approve path
(unknown model → publish → judge → approve → becomes rankable).

### 2. Top-ten escalation can starve permanently (leaderboard unpublishes forever + daily budget drip)
`judgeRun` derives the k=3 target from live `showcases.judgeStatus === "judging"`
(lib/judging/judge-run.ts:160-167) instead of from the message's `stageVersion`
(lib/pipeline/judge-dispatch.ts:6-20 already knows it). `markOverdueResults` (2-min
cron) flips `judging → overdue` whenever `judgeDueAt` is past (lib/data/results.ts:319-334)
— true for any result entering the top 10 after its 24h deadline. If the cron fires
between escalation-enqueue and delivery, judgeRun runs with sampleTarget=1, adds no
samples, and completes the one-shot `escalation-three-sample-v1` claim; every later
re-enqueue acks as completed. The superseded snapshot is already unpublished, so that
test's leaderboard has NO published snapshot and never will; and the day-keyed
reservation id makes the repair sweep claim a fresh global-budget reservation every
day forever with zero progress.
Fix: (a) drive `sampleTarget` from `stageVersion`, not live judgeStatus; (b) exclude
already-`scored` runs from `markOverdueResults`; (c) make escalation stage versions
re-openable on failure (they are one-shot today).

### 3. Same starvation class for dispute/moderator rejudge
`MODERATOR_REJUDGE_STAGE_VERSION` is a single one-shot constant (judge-dispatch.ts:3-4);
the dispute path also sets `judging` (lib/data/dispute-rejudge.ts:59-62) and races the
overdue cron the same way. One collapsed execution → the dispute can never reach 3
samples. Same fix as #2 (stageVersion-driven target + reopenable claims).

### 4. Healthy escalations end stuck in "Delayed" with false ops alerts
After a successful k=3, nothing restores `judgeStatus` to `scored`: stale leaderboard
entries cause `repairBudgetPendingEscalations` to re-set `judging`
(lib/ranking/result-snapshots.ts:230-315), the re-sent message acks, and the only
repair path is `overdue → scored` on publish (worker/index.ts:348-356) which usually
never fires. Result shows "Delayed" indefinitely and inflates the overdue metric.
Fix: restore `scored` when sample count reaches target (in judgeRun completion), and
make `repairBudgetPendingEscalations` skip runs that already have 3 samples.

### 5. The judge never sees zipped source code (contradicts PLAN §3)
Community rubric dimensions are always created with `judgeSourceRequired: false`
(lib/data/community-tests.ts:73, 207), and judge-run includes `sourceBytes` only when
a dimension requires it (judge-run.ts:89-91). A zip-only source submission reaches the
judge as a manifest line — `correctness` is judged without the code. PLAN §3 says
"private source reaches the judge."
Fix: default `judgeSourceRequired: true` for the mandatory task-success/correctness
dimensions (blinded text extraction already exists and is size-capped), or amend the
plan if evidence-only judging of source is the deliberate choice — but then say so on
the methodology page.

### 6. D1 invariants script fixture bug (test-only; currently fails `npm test`)
scripts/test-d1-invariants.mjs:163-174 inserts leaderboard/aggregate snapshots already
`published`, then inserts entries — correctly blocked by the 0017 seal triggers. The
production writer uses building → entries → atomic publish
(lib/ranking/result-snapshots.ts:183). Fix the fixture to the same order for both the
leaderboard and aggregate sections, keeping the mutation assertions after publish.

## P1 — migration hygiene and seal gaps

7. **0015 legacy seal incomplete** vs "read-only at SQL level": `generation_records`
   blocks only INSERT (drizzle/0015:67-71) — UPDATE/DELETE pass; legacy runs' score/
   eligibility/failure columns and evaluate-family statuses stay mutable; legacy
   `run_artifacts`/`judge_samples`/`dimension_scores` unsealed. Extend the seal.
8. **Drizzle meta snapshots 0003–0007 missing** (meta/ jumps 0002 → 0008) while the
   journal lists all 18 entries; journal idx 8 `when` is non-monotonic. Regenerate.
9. **Index drift**: `showcases_test_status_idx` exists in drizzle/0008:53 but not in
   db/schema.ts or any snapshot — next `drizzle-kit generate` emits a DROP. Add to
   schema.
10. **DO deletion migration missing**: wrangler.jsonc dropped the GenerationSession
    binding and the whole `migrations` array; add
    `migrations: [{tag:"v2", deleted_classes:["GenerationSession"]}]` so a worker that
    ever deployed v1 can deploy again. (Never deployed so far, but costs one line.)
11. **Dangling types/config**: cloudflare-env.d.ts still declares GENERATION_SESSION +
    GENERATE_PLATFORM_QUEUE; catalog_requests FK rule mismatch (0011 bare REFERENCES
    vs schema `onDelete: restrict`); dead `kind='model'` enum value; empty route dirs
    (admin/credits/grant, runs/[id]/launch-platform, runs/catalog); stale
    `evaluation_versions_samples_three` CHECK forcing sampleCount=3 that community
    judging ignores; `runs.harnessContractHash` stores raw contract JSON, not a hash
    (lib/data/results.ts:56,159).

## P2 — product decisions and small fixes

12. **Decide the submission-cap intent**: drafts 10/day + publishes 20/day vs judged
    5/day means an account can put 20 public results/day on the site with 15+ stuck
    "pending AI review" and tripping the overdue alarm by design. Either lower the
    publish cap toward the judge cap or document the queue-depth expectation.
13. **Blocked result URL 404s for its owner** (app/results/[slug]/page.tsx:28-29) —
    plan §2.2 wants owner-visible reason; today only the dashboard shows it. Render an
    owner-only blocked view at the result URL.
14. **Contributor profile undercounts** (app/contributors/[handle]/page.tsx:28-31
    filters the global latest-50 client-side; `listPublicShowcaseCardsPage` already
    supports a contributor filter — use it).
15. `judgeRun` hard-codes `safetyApproved: true` into eligibility (judge-run.ts:275-280)
    — a safety block landing mid-judging isn't reflected; re-read it.
16. `rebuildResultLeaderboard` escalation enqueue doesn't check the evaluation version
    is still `active` (result-snapshots.ts:253 does; mirror it) — frozen-version
    escalations waste a reservation and dead-letter.
17. Status-label set drifts from PLAN §2.2 (extra "AI review failed — not ranked",
    "(AI recheck in progress)") — either add to plan or normalize.
18. CI fragility: production build happens only as a side effect of the `npm test`
    script (dry-run step depends on it — add an explicit build step);
    `npm audit --audit-level=high` will flake on unrelated upstream advisories —
    consider report-only.
19. Cosmetics: REVIEW-FIXES.md still describes BYOK as current (historical doc — fine
    to leave, or mark superseded); usercontent worker test discriminates deny-gates by
    runtime-SQL regex — add per-gate row fixtures; post-escalation rebuild rides the
    2-min repair cron (single point of failure for the fixpoint loop — acceptable,
    documented here).

## Confirmed good (spot-verified; do not re-open)

Schema matches PLAN §2.1–2.4 exactly (all four axes, CHECKed); rubric drafting
(3–6 dims, 10,000 bps, mandatory dims, evidence-sufficiency excluded, CAS approval,
trigger-immutable versions, rate-limited); budgets atomic in single-writer D1 with
idempotent reservations; 24h SLA wiring (due-at, overdue marking, ops surfacing,
public-while-delayed); static-only recognizer cannot be tricked into builds or network
(exec is `unzip` + pinned evaluator, browser aborts non-localhost); ranking math
(latest-eligible supersession, shared tie ranks, median-then-equal-weight aggregates,
provisional flags, catalog-gated) and immutable race-safe snapshots; evidence privacy
(private source never serveable, blocked = SQL-level private, redirect-not-stream);
auth + ownership + server-side quotas on every new mutating route; redirects + legacy
read-only + no generation UI/keys/queues left; declared-unverified labeling on every
surface incl. methodology's cherry-picking caveat; CI with mandatory evaluator smoke
on clean checkout; migrations 0000–0017 apply cleanly.
