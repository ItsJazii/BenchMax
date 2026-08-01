# BenchMax handoff

**Checkpoint date:** 2026-08-02 (Asia/Karachi)
**Repository:** `E:\benchmax` · remote `https://github.com/ItsJazii/BenchMax` (private)
**Current branch:** `codex/phase-2-foundation` (pushed, worktree clean)
**Local/remote head:** `31b4166` — `Silence intentional migrations_dir strip lint warning`
**Remote main:** `ce96c5c`
**Open PR:** #2 — "Phase 2 foundation: environment isolation, deploy safety, and audit closures" (open, not draft; supersedes closed PR #1)

No credentials, tokens, keys, or exports in this file. This is the restart point
for the next session. Reference docs: `PLAN.md` (product spec, source of truth),
`LAUNCH-PLAN.md` (phases), `REVIEW-FIXES-3.md` (audit history),
`docs/phase-2-provisioning.md` (deploy procedure).

## What happened since the previous checkpoint (`580df53`)

Codex usage limits were hit, so Claude implemented directly. All work is
committed and pushed; every commit passed preflight + typecheck + lint + full
suite before push.

1. `5fae3cc` **Close Phase 2 audit findings** — migration `0020` restores the
   `catalog_requests_no_delete` trigger dropped by 0019's table rebuild (with
   invariants existence + behavioral delete probes); top-ten escalation sweep
   excludes terminally failed results; preflight pins the provisioned
   staging/production D1 IDs and required crons; `prepare-main-deploy.mjs`
   errors on missing env override keys and non-empty unmanaged binding types;
   lifecycle fixture gained a `/sweeps` endpoint (real-migrations e2e of both
   repair sweeps); corrected two inaccurate completion claims in
   REVIEW-FIXES-3.md.
2. PR #1 was closed by the owner; the full branch was pushed and **PR #2**
   opened as the complete reviewable surface. Four Devin review rounds
   followed, each triaged, fixed, gated, and pushed:
   - `900046a` (round 1): environment-agnostic DLQ routing
     (`isPipelineDeadLetterQueue`, suffix match, unit-tested);
     `markRepairFailure` (both copies) terminalizes from `scored` too; exact
     per-environment queue-set validation in preflight; inverted known-safe
     allowlist over built-config keys in prepare-main-deploy; e2e scenario:
     frozen-eval top-ten candidate with a `scored` showcase terminalizes on
     pass one.
   - `3d627f9` (round 2): top-level (no `--env`) configs returned to the
     fail-closed placeholder D1 ID with preflight asserting the placeholder
     (a stray remote command can never reach production);
     frozen-evaluation dispute termination is sweep-only (a stranger's
     dispute can no longer flip a public scored result to failed);
     `markRepairFailure` lands from any non-`failed` state and the sweep also
     excludes `evaluation_failed`/`disqualified` runs; benign scalar plugin
     keys pre-classified.
   - `e49b2b9` (round 3): symmetric env-block guard (any env key outside the
     copied set fails loudly instead of being silently dropped); top-level
     queues/buckets renamed local-only (`benchmax-local-*`) so a stray deploy
     cannot attach to production resources regardless of wrangler's binding
     validation order; frozen-dispute semantics documented in-code as
     deliberate.
   - `d25af32` + `31b4166` (round 4): CI rehearses the production release
     path (prepare + dry-runs for production, both workers); generated deploy
     configs strip `migrations_dir` (migrations only ever via
     `wrangler.jsonc --env <environment>`, documented with the exact
     command); lint cleanup.

Devin verified all round 1–3 findings as resolved (13 findings addressed
total). Round 5 may still arrive for the last two commits — check first
(below). CI was green on every pushed head; the newest run was in progress at
checkpoint time.

## Deliberate design decisions — do NOT "fix" these

- **Top-level wrangler blocks are local-only by design**: placeholder D1 ID
  `00000000-0000-4000-8000-000000000000`, `benchmax-local-*` queues,
  `benchmax-local-uploads` bucket. Real resources exist only in
  `env.staging` / `env.production`. Preflight enforces this shape; reverting
  it reintroduces the production-touch hazard Devin flagged.
- **Frozen-evaluation disputes on a `scored` showcase never terminalize**:
  the result keeps its valid score; the open dispute in the moderation queue
  is the ops signal; moderators resolve with rejudgment "not-applicable".
  Only stuck `judging`/`overdue` states are sweep-terminalized.
- **Migrations never use generated deploy configs** (`migrations_dir` is
  stripped from them intentionally).
- The gating production dependency audit in CI is a documented decision
  (accepted flake risk), not an oversight.

## Where to start tomorrow

1. `git fetch && git status` — confirm clean and on `codex/phase-2-foundation`.
2. Check PR #2: latest CI run result and whether Devin posted a round-5
   review (`gh api repos/ItsJazii/BenchMax/pulls/2/comments`, baseline count
   at checkpoint: 32). If new findings exist: triage, fix, run the full gates
   (`npm run phase2:preflight`, `npx tsc --noEmit`, `npm run lint`,
   `npm test`), push. Repeat until Devin is clean.
3. When CI + Devin are clean: the owner decides the merge. After merge,
   delete the branch and continue on focused PRs off `main`.
4. Then Phase 2 external prerequisites (owner actions, in this order —
   nothing below may proceed before items 1–2):
   1. Owner enrolls Cloudflare 2FA, then enables account-level enforcement.
   2. Enable R2 and the Workers Paid capability in the dashboard.
   3. Choose the main HTTPS origin and the separate cookieless user-content
      origin (workers.dev acceptable for user content if deliberately chosen).
   4. Clerk app: Google, GitHub, email-code; exact production origins.
   5. Anthropic judge API key (snapshot pinned later, during Phase 3
      calibration).
   6. E2B account.
5. After prerequisites, agent work: create private buckets
   `benchmax-uploads-staging` and `benchmax-uploads`; build the
   `sandbox/browser-web-v1` E2B template and record the immutable template ID
   + build hash; load all secrets via `wrangler secret put` (never in files);
   deploy both Workers to isolated staging
   (`npm run phase2:prepare-main -- staging`, dry-run first); apply
   migrations via `wrangler.jsonc --env staging`; seed catalogs via the
   owner endpoint.
6. Then LAUNCH-PLAN Phase 3 (staging validation): calibration with the pinned
   judge snapshot, **measure real judge cost per result and set budget caps
   from measurement**, full synthetic lifecycle for all three evidence types,
   catalog-request/dispute/safety-block/overdue paths, PLAN §9 release gates.

## Open items that are not code

- Owner product decision (needed before beta): submission-vs-judging cap
  ratio — currently 10 drafts + 20 publishes/day vs 5 judged/day per account.
- Cloudflare account state (unchanged from last checkpoint): 2FA off, R2 not
  enabled, no zones/workers deployed; production + staging D1 and all six
  queues provisioned; no migrations applied remotely (deferred to Phase 3).
- Known non-fatal local warnings: Windows EPERM temp-dir cleanup after the
  rendered/lifecycle tests (tolerated with a warning), Vite native config
  loader notice, `unstable_dev` experimental notice.
- Deferred cosmetics (tracked in REVIEW-FIXES-3.md round-3.3 item 7):
  dead `kind='model'` enum value, stale `sampleCount=3` CHECK,
  `harnessContractHash` stores raw contract JSON, empty route dirs.

## Verification evidence at checkpoint

Green locally before every push: `npm run phase2:preflight`,
`npx tsc --noEmit`, `npm run lint`, full `npm test` (pretests, 100+ core
tests, evaluator smoke with real Chromium, lifecycle + sweeps e2e against
migrations 0000–0020, D1 invariants, production build, 28 rendered checks),
`drizzle-kit check`, staging + production deploy-prep and dry-runs.

## Resume commands

```powershell
Set-Location E:\benchmax
git fetch
git status
git log -3 --oneline
gh pr view 2 -R ItsJazii/BenchMax
npm run phase2:preflight
```
