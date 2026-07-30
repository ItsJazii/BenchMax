# Benchmax v3 — Community Test Results

**This version supersedes the v2 platform-generation plan.** Benchmax is now a public
hub where anyone can create a reusable AI model test, submit evidence of a model's
attempt at it, and get an AI-judged score on a public per-test leaderboard — free to
browse, cheap to run, with **no tested-model generation keys anywhere**; the only
provider credential in the system is the pinned judge's API key.

## 1. What changed from v2, and the honest trade

v2's thesis was that only platform-generated runs are verifiable, so only they could
rank. That was true — and it made the product expensive (platform pays generation),
high-friction (contributors bring API keys), and narrow (one seeded model). v3 trades
verified provenance for accessibility:

- **Anyone can participate**: pick or create a test, upload evidence, get judged.
- **Costs collapse**: no generation spend, no BYOK infrastructure; the only variable
  cost is judging, which §7 caps.
- **The trade, stated plainly**: rankings now measure *submitted evidence*, not
  independently verified model runs. Contributor-declared model/harness/reasoning
  metadata is unverifiable and always labeled as such. Nothing stops best-of-N
  cherry-picking. Benchmax's honesty guarantee shifts from "we verified this run" to
  "we judged this evidence with a pinned, blinded, published process — and we never
  pretend the metadata is verified."

Consequences for framing (enforced in UI and copy):
- **Per-test leaderboards are the product.** Comparing results on the same immutable
  test version is meaningful: same prompt, same rubric, same judge.
- **Model aggregate pages are summaries, not benchmarks.** They carry a permanent
  "community-declared metadata" caveat and never present themselves as verified model
  rankings.
- The methodology page states all of the above in plain language.

The generation stack (run wizard, BYOK GenerationSession Durable Object, platform
credits, generate-platform queue, Moonshot runtime key, context budgeting, generation
recovery states) is **deleted, not deactivated**. Any existing run records stay
read-only at their URLs; navigation and creation APIs are removed.

## 2. Product

### 2.1 Core objects

- **CommunityTest** → immutable **CommunityTestVersion**: prompt, goal, category
  (frontend / browser game / browser 3D / other), success criteria, approved rubric,
  creator, published timestamp. Editing anything creates a new version.
- **TestResult** (evolved from the showcase concept, keeping its artifact
  relationships): `testVersionId`, model/harness catalog references (canonical or
  pending), raw + normalized reasoning level (`none|low|medium|high|max|unknown`),
  declared settings + metadata hash, judge status/score/deadline, ranking eligibility
  with reason, superseded-result reference.

### 2.2 Lifecycle (four internal axes, one visible status)

Internal state axes (kept separate so no axis blocks another incorrectly):
- Publication: `draft | published | removed | rejected`
- Safety: `pending | scanning | approved | blocked`
- Judge: `not_queued | queued | evaluating | judging | scored | unranked | overdue | failed`
- Ranking: `pending | eligible | catalog_pending | insufficient_evidence | moderation_hold | superseded | ineligible`

**Users see exactly one computed status** on every result: `Draft`, `Scanning`,
`Public — pending AI review`, `Scored — ranked #N`, `Scored — not ranked (reason)`,
`Delayed`, or `Blocked (owner-visible reason)`. The axis detail lives in an expandable
"status history" for those who want it.

Safety-blocked results are the only exception to public visibility: private to the
owner, with the reason shown.

### 2.3 The flow

1. **Create or pick a test** (`/tests`, `/tests/[slug]`): creator supplies prompt,
   goal, category, success criteria. Benchmax's judge drafts a rubric (§5.2); the
   creator approves → immutable test version published.
2. **Submit a result** (`/submit`): declare model, version, harness, reasoning
   (free-text allowed — unmatched entries create a catalog request, §2.4); upload
   evidence (images, video, code, logs). At least one approved public artifact
   required; source artifacts may be marked private (judge-visible only).
3. **Safety scan** (existing quarantine pipeline, unchanged) → publish as
   `Public — pending AI review`.
4. **Judged** (§5) as capacity allows; hard target 24h (`judgeDueAt =
   publishedAt + 24h`; at the deadline mark `overdue`, alert operations, keep the
   result public, keep retrying).
5. **Ranked** on the test-version leaderboard (§6); model/config aggregate pages
   update via snapshots.

### 2.4 Metadata catalogs (no provider APIs)

Model and harness catalogs are metadata-only. Seed the major families — GPT, Claude,
Gemini, Kimi, GLM, MiniMax, Qwen, DeepSeek — plus common harnesses (Cursor, Codex,
Claude Code, Cline, aider, custom). Admins add versions without deploys. A missing
entry creates a **catalog request**: the result still publishes and gets judged, but
stays `catalog_pending` for ranking until an admin maps or approves it. Free-text
model names never enter rankings uncanonicalized.

### 2.5 Pages

`/tests`, `/tests/[slug]` (create/browse/compare tests), `/submit`, `/results/[slug]`
(evidence, status, score breakdown, rank), plus updated Explore, model pages,
contributor profiles, dashboard, moderation console, and leaderboards. Old showcase
URLs 301-redirect; legacy run pages stay read-only if records exist.

## 3. Evidence handling

- **Reuse unchanged**: R2 quarantine, MIME/magic-byte checks, traversal/zip-bomb
  limits, executable rejection, secret scanning + redaction, quotas, safe headers,
  sha256 verification at publish, upload-session sweep, abuse reporting.
- **Source evidence**: always statically inspected after scanning.
  **Static-only execution in v1**: recognized web projects that include runnable
  static files (no build/install step — a build step would require network in the
  sandbox, which stays disabled) execute in the no-network E2B sandbox with the
  hardened evaluator: build-log/console capture, accessibility checks, screenshots,
  fixed-duration video (±50ms tolerance), and explicit per-operation timeouts so
  model-caused hangs become failed checks and scores, never infra retries. Projects
  needing a build, and non-web languages, are judged from submitted evidence only —
  never executed.
- Private source reaches the judge but never public APIs or pages.

## 4. Trust and integrity rules

- Contributor-declared provenance is labeled **"declared, unverified"** everywhere it
  appears — result pages, leaderboards, aggregates, API responses.
- Judge process is fully published: pinned judge snapshot, rubric, prompts template
  hash, sample count, blinding rules.
- Anti-gaming baseline (v1): email-verified accounts to submit; per-account daily
  submission caps (§7); one eligible result per contributor per exact configuration
  per test version (latest wins, older marked `Superseded`, scores retained);
  contributor count N displayed on every aggregate; new-account swarm detection
  deferred but result sets are snapshotted so retroactive cleanup is possible.
- Injection-flagged evidence stays publicly visible, enters `moderation_hold`, and
  does not rank until a moderator clears it (reversible, as built).
- Every state change, judgment, and moderation action remains append-only audited.

## 5. Judging

### 5.1 The judge (cheap by default, rigorous where it matters)

- **One pinned judge snapshot** (a current Sonnet-class multimodal snapshot, exact ID
  fixed in config at launch — chosen over Opus-class for materially lower cost; the
  precise multiple depends on current pricing and evidence mix, so **per-result cost
  is measured against the calibration set before leaderboards are enabled**, not
  assumed from list prices. Near launch, compare current Sonnet snapshots on the
  calibration set and pin the exact immutable winner. The pinned-snapshot rule is
  what matters: launch is blocked if the snapshot is unavailable and no silent
  substitution ever happens; judge changes create a new evaluation version).
- **k=1 sample for standard results.** Score, dimension breakdown, and concise
  reasoning publish with judge/evaluation version and timestamps.
- **k=3 samples with per-dimension median** (escalation) for: results entering the
  displayed top 10 of their test-version leaderboard, disputed results, and
  moderator-requested re-judgments. **Escalation iterates to a fixpoint**: if a k=3
  re-judgment demotes a result out of the top 10, whichever un-escalated result now
  enters the top 10 is escalated in turn, repeating until every displayed top-10
  result carries k=3 scoring. This concentrates rigor where variance changes
  outcomes while keeping the average cost per result near the k=1 price.
- Calibration set re-judged on the existing weekly cron; drift beyond threshold
  freezes the evaluation version and alerts (as built).

### 5.2 Rubric creation (judge-assisted, creator-approved)

- Creator supplies prompt, goal, success criteria; the judge drafts 3–6 dimensions
  with stable keys and weights totaling 10,000 bps; **task success and correctness
  are mandatory dimensions**; evidence sufficiency is an eligibility gate, not a
  scored dimension. Creator reviews/edits/approves before the version publishes;
  later changes = new version. Test creation is rate-limited (it costs judge tokens).

### 5.3 Judging a result (hardening carried over from the verified pipeline)

- Blind model, harness, contributor, filenames, and provider-identifying strings
  (full redaction list as built).
- All evidence inside sanitized untrusted-evidence envelopes; injection screen runs
  over source and runtime-captured text; `checkKey`/dimension keys returned by the
  judge validated against the frozen rubric (allowlist).
- Queue jobs idempotent by (result, stage, evaluation version); late duplicates ack
  without regressing progressed results; DLQ and recovery handlers re-read current
  status before failing anything; 2-minute recovery cron as built.

## 6. Ranking

- Every judged result stays visible; eligibility only controls ranking.
- **Per-test-version leaderboard**: eligible results ranked by score; ties share rank.
- **Configuration aggregates** (model version + harness + reasoning): median eligible
  score per test version, then equal-weight mean across test medians (popular tests
  can't dominate). Display N, IQR, test coverage, provisional flag, declared-metadata
  caveat, and snapshot date.
- Immutable, reproducible leaderboard snapshots on every eligible-set change (existing
  snapshot machinery, redirected from benchmark versions to test versions).

## 7. Cost model and abuse economics

Fixed costs stay ~$5–10/mo (Workers Paid, R2, Clerk free tier). The only variable
cost is judging:

- Standard k=1 Sonnet-class judgment: several-fold cheaper per result than the k=3
  Opus design it replaces (the exact multiple depends on current per-token pricing
  and the evidence mix — **real per-result cost is established by judging the
  calibration set before leaderboards go live**, and the budget caps below are set
  from that measurement, not from estimates).
- **Caps, enforced server-side**: per-account daily judged-submission quota (launch:
  5/day) and monthly test-creation quota (launch: 10/month); a global daily judge
  budget — when exhausted, new results queue as `Public — pending AI review` and the
  24h clock keeps them honest; storage quotas as built.
- Judge and sandbox spend metered per result in the existing ledger; `/operations`
  shows daily burn.

## 8. Repository changes and rollout

### 8.1 Cleanup (adopting the pivot plan's list)

Order matters — the current worktree is valuable but not commit-ready (the evaluator
smoke test fails on clean checkouts until the portability fix lands, and
`sandbox/browser-web-v1/node_modules/` is untracked-but-unignored, so a blanket
`git add -A` would commit hundreds of dependency files):

1. Create the pivot branch (`codex/community-results-pivot`); never reset the
   worktree.
2. Fix `.gitignore` first: nested `node_modules`, `.claude/launch.json`; stage
   selectively from then on.
3. Finish the still-relevant evaluator/upload/queue fixes (below) and get the full
   suite green on a clean checkout.
4. Commit that hardened baseline as one commit.
5. Then the three curated pivot commits (§ below).
- Preserve all verified hardening (uploads, security, moderation, audit, evaluator,
  queues, recovery).
- Delete generation-only code: run wizard, GenerationSession DO, generate-platform
  queue, platform credits, provider generation keys, Kimi runtime catalog, context
  budgeting, generation recovery states. Legacy run records read-only.
- Land the still-relevant round-2 fixes: evaluator per-operation timeouts + ±50ms
  video tolerance; portable smoke-test prerequisite detection with mandatory CI mode;
  duplicate/DLQ status re-checks; quarantine orphan cleanup; quota triggers filtered
  by `expires_at`; recovery/moderation audit events; rubric key allowlisting.
- Delete `.openai/hosting.json`; neutral upload placeholder copy; rewrite
  README/PLAN/methodology around community-submitted results and declared provenance.
- Regenerate the Drizzle journal/snapshots against a clean scratch DB so 0003+ and the
  pivot migration are consistent.
- Three curated commits: (1) schema/migrations/catalogs/legacy retirement,
  (2) upload/evaluation/judge/recovery/ranking pipeline, (3) UI/moderation/docs/deploy
  config.

### 8.2 Production rollout

Prerequisites: Clerk + exact authorized origins; D1, private R2, judge/evaluation
queues + DLQ + 2-min cron; separate cookieless usercontent origin; E2B template +
pinned build hash; Anthropic key with access to the pinned judge snapshot; calibration
fixtures + hash; owner identities.

Order: staging deploy → migrations → seed catalogs → synthetic image/video/source
submissions through the full lifecycle → back up D1/R2 → production deploy with
submissions disabled → migrations → seed → activate judge version → verify calibration
→ enable submissions → watch queue age/error/spend → enable leaderboard publication.

## 9. Test and acceptance plan

Unit: rubric immutability + weight validation; catalog mapping + pending requests;
reasoning normalization + metadata hashing; eligibility/supersession; per-test ranking
(ties, medians, IQR, equal-test aggregation, snapshot reproducibility); judge schema,
blinding, injection screening, rubric-key allowlisting; **judge budget caps and
escalation triggers** (k=1 → k=3 on top-10 entry).

Integration: draft → upload → scan → public-pending → judged → ranked; results stay
public while queued/delayed/overdue/unranked/superseded; unknown catalog entries
publish + score but don't rank until mapped; duplicates and late DLQ deliveries can't
regress completed results; private source never reaches public APIs; blocked artifacts
never publish; static web execution success, model-caused failure, sandbox timeout →
scored, infra fault → retried; upload expiry/orphan cleanup/quota alignment;
moderation hold, dispute, audit immutability; **budget-exhausted queuing behavior**.

E2E browser: create test → approve rubric → upload each artifact type → pending →
scored → ranked; catalog approval; moderation; mobile + keyboard accessibility.

Release gates: full `npm test` + TypeScript + lint + production build + migration
invariants + evaluator smoke (mandatory CI mode) + Cloudflare dry-runs + prod
dependency audit; a safe result publishes after scanning; escalated scoring produces
the calibrated median with full public breakdown; synthetic results judged within 24h;
**no provider generation keys, BYOK flows, or credits remain in the codebase**; no
unsafe artifact, private source, raw judge trace, secret, or model identity leaks.

## 10. Assumptions

- Benchmax ranks community-submitted evidence; provenance is declared, not verified,
  and is always labeled as such.
- Results are comparable only within the same immutable test version; model summaries
  are equal-weight aggregates across tests with a permanent caveat.
- Judging starts promptly; 24h is the operational maximum, not a waiting period.
- Native multi-language execution, build-step execution, payments, comments, voting,
  and Benchmax-funded model generation are out of scope for v1.
