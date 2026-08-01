# Benchmax — launch plan (2026-08-01)

Everything between the current state and a publicly launched product, in order.
Owner tags: **[Codex]** implements, **[Claude]** reviews/verifies, **[You]** are the
only one who can do accounts, payments, domains, and product decisions.
Reference docs: PLAN.md (product spec), REVIEW-FIXES-3.md (open code items).

---

## Phase 0 — Finish the code (in flight now)

1. **[Codex]** Round-3.1 residuals (REVIEW-FIXES-3.md addendum): regenerate Drizzle
   journal/meta for 0003–0007 AND 0018; frozen-evaluation-version guard on the
   dispute-rejudge sweep; backoff/attempt-cap on the 2-minute repair sweeps;
   `resolveCatalogRequest` end-to-end test; invariants coverage gaps.
2. **[Codex]** Round-3 P1 hygiene: complete the 0015 legacy seal (UPDATE/DELETE on
   generation records + legacy artifacts/samples); add `showcases_test_status_idx` to
   schema; `deleted_classes: ["GenerationSession"]` wrangler migration tag; dangling
   env types; FK rule mismatch; dead `kind='model'` enum; stale `sampleCount=3` CHECK;
   `harnessContractHash` storing raw JSON; empty route dirs.
3. **[Codex]** Round-3 P2 fixes: blocked-result owner view at the result URL;
   contributor-page server-side filter; status-label set normalized with PLAN §2.2;
   explicit CI build step; `npm audit` as report-only; `safetyApproved` re-read in
   judge eligibility; active-version check in the rebuild escalation path.
4. **[Codex]** Its own remaining items: genuine e2e lifecycle test; remove generated
   artifacts (`.wrangler-dry-run/` etc.); final full verification suite.
5. **[Codex]** The three curated commits (schema/catalogs/retirement · pipeline ·
   UI/docs/deploy) on `codex/community-results-pivot`.
6. **[Claude]** Verification pass on the commits: residual fixes real, suite green on
   clean state, no regressions in the sealed invariants. Gate: nothing proceeds until
   this is green.
7. **[You]** One product decision, needed before beta: the submission-vs-judging cap
   ratio (today: 20 publishes/day but 5 judged/day per account — either lower the
   publish cap or accept a visible "pending review" queue by design).

**Exit criteria:** clean worktree, curated commits, full suite + typecheck + lint +
dry-runs green, REVIEW-FIXES-3 fully closed.

## Phase 1 — Repo safety (do immediately after Phase 0; ~30 min)

1. **[You]** Create a private GitHub repo (or tell Claude/Codex to via `gh` once
   logged in). The whole project currently exists only on this disk.
2. **[Codex/Claude]** Push `main` + `codex/community-results-pivot`; confirm the CI
   workflow runs green on GitHub (it sets the mandatory evaluator-smoke flag — first
   true clean-checkout test).
3. **[Codex]** Open a PR from the pivot branch → merge to `main` after CI passes.

**Exit criteria:** code on GitHub, CI green on a machine that isn't yours.

## Phase 2 — Accounts and services (mostly [You]; ~1–2 hours + ~$5–15/mo)

1. **[You]** Cloudflare account, Workers Paid plan ($5/mo — required for Queues).
2. **[You]** Domain(s): one main domain (e.g. benchmax.dev) and one SEPARATE domain
   or distinct registrable origin for user content (cookieless isolation per PLAN §3;
   a `*.workers.dev` subdomain is acceptable for the usercontent origin at launch).
3. **[You]** Clerk app (free tier): enable Google, GitHub, email-code; add production
   domain; collect publishable + secret keys.
4. **[You]** Anthropic API key (judge). **[You + Claude]** near launch: compare
   current Sonnet-class snapshots on the calibration set, pin the winner
   (recommendation: current Sonnet snapshot; never an alias).
5. **[You]** E2B account; **[Codex]** build `sandbox/browser-web-v1` as a template,
   record immutable template ID + build hash.
6. **[Codex]** Create the Cloudflare resources: D1 database, private R2 bucket,
   queues (evaluate, judge, DLQ), both workers' routes/domains, crons. All secrets
   via `wrangler secret put` (Clerk, judge key/origin/model, provenance key,
   calibration hash/key, owner subjects) — never in files.

**Exit criteria:** all prerequisites in PLAN §8.2 exist; `.env.example` fully
mappable to real secrets.

## Phase 3 — Staging validation (PLAN §8.2; ~1–2 days)

1. **[Codex]** Deploy both workers to staging (workers.dev), apply migrations 0000→
   latest, seed metadata catalogs via the owner endpoint.
2. **[Codex]** Upload calibration fixtures to private R2; activate the evaluation
   version; run calibration — must pass with the pinned snapshot.
3. **[Claude]** Measure real judge cost per result on the calibration set; set the
   global daily judge budget and per-account caps from measurement (PLAN §7 says
   caps come from measurement, not estimates).
4. **[You + Codex]** Full synthetic lifecycle on staging, all three evidence types
   (image, video, source-zip): create test → rubric draft → approve → submit →
   scan → public-pending → judged → ranked. Plus: unknown model → catalog request →
   admin approve → becomes ranked; a dispute → re-judge; a safety-blocked upload
   (stays private, owner sees reason); an overdue simulation.
5. **[Claude]** Review staging behavior against PLAN §9 release gates; browser pass
   on mobile viewport + keyboard accessibility; verify no secret/private-source/
   judge-trace leaks in any public payload.

**Exit criteria:** every PLAN §9 release gate demonstrably passes on staging.

## Phase 4 — Production rollout (PLAN §8.2 order; ~half a day)

1. **[Codex]** Back up staging-verified state; capture D1 export + Time Travel
   bookmark procedure per docs/backup-restore.md.
2. **[Codex]** Deploy production with **submissions disabled** → apply migrations →
   seed catalogs → activate judge/evaluation version → verify calibration in prod.
3. **[You]** Smoke-test signup with all three auth methods on the real domain.
4. **[Codex]** Enable submissions. Watch `/operations`: queue age, overdue count,
   error rates, judge spend.
5. **[Codex]** After the first real results judge cleanly: enable leaderboard
   publication.

**Exit criteria:** a stranger can sign up, submit, get judged, and appear ranked.

## Phase 5 — Launch content (before announcing; ~1–2 days, mostly [You])

An empty community site launches dead. Before telling anyone:

1. **[You]** Create 6–10 good seed tests across the categories (frontend, browser
   game, browser 3D, other) — real prompts you'd actually want models compared on.
   Approve their rubrics carefully; they're immutable per version and they set the
   site's quality bar.
2. **[You]** Submit 3–5 honest seed results per popular test (your own runs of
   different models, correctly declared) so leaderboards and Explore aren't empty.
3. **[You]** Review ToS/privacy pages content (they exist; make sure you're happy
   putting your name behind them) and set a real DMCA/abuse contact address.
4. **[Claude]** Final copy pass: methodology page accuracy (declared-provenance
   caveats, judge identity, cost/caps), OG images, 404s, mobile nav.
5. **[You]** Optional: invite 1–2 trusted moderators (owner can grant roles).

**Exit criteria:** site looks alive and trustworthy to a first-time visitor.

## Phase 6 — Launch and operate

1. **[You]** Announce wherever your audience is (X, HN Show, Reddit r/LocalLLaMA
   etc.). Lead with the honest pitch: community evidence, AI-judged, per-test
   leaderboards, provenance declared-not-verified.
2. Operating rhythm: **[You/moderators]** clear the moderation queue (injection
   flags, catalog requests, disputes) — catalog requests are the growth bottleneck,
   keep them under ~24h; **[Claude]** periodic health reviews (`/operations` spend,
   overdue trends, DLQ, calibration drift alerts).
3. **[Codex]** Weekly backups per runbook; dependency updates only with green suite.
4. First-month iteration candidates (deliberately NOT in v1): submission-cap tuning
   from real data, more seeded catalogs, evidence-verified tier, richer compare
   views, build-step execution.

---

## Decisions only you can make (collect them here)

| Decision | Needed by | Recommendation |
|---|---|---|
| Submission vs judging cap ratio | Phase 0 exit | Lower publishes to ~8/day at launch |
| Domain name(s) | Phase 2 | One .dev/.com + workers.dev for usercontent |
| Judge snapshot to pin | Phase 3 | Current Sonnet snapshot, chosen via calibration set |
| Budget caps (from measurement) | Phase 3 | Set from calibration cost × expected volume |
| Seed tests + rubrics | Phase 5 | 6–10, you author them |
| Moderators | Phase 5–6 | Optional at launch |

## Cost picture (unchanged from PLAN §7)

Fixed: ~$5–10/mo (Workers Paid, R2, Clerk free tier, domain amortized). Variable:
judge spend only — measured in Phase 3, capped by budget; sandbox time is pennies.
No generation costs, no BYOK — the judge key is the only provider credential.
